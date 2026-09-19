//! The actual UI Automation walk: turns a window handle into a bounded list
//! of `DescribeNode`s.
//!
//! Every UIA call here can fail because the target window closed mid-walk --
//! that is the normal case this module is written around, not an exceptional
//! one. A failed call on one element means: skip that element (and do not
//! descend into it), never abort the whole walk, never panic. A panic here
//! kills the whole helper process, which the supervisor reports as
//! `DESKTOP_DRIVER_DIED` and which invalidates every outstanding ref -- the
//! wrong response to one unreadable element.

use std::collections::VecDeque;

use ::windows::core::Interface;
use ::windows::Win32::Foundation::HWND;
use ::windows::Win32::UI::Accessibility::{
    IUIAutomation, IUIAutomationElement, IUIAutomationValuePattern, UIA_CONTROLTYPE_ID,
    UIA_AppBarControlTypeId, UIA_ButtonControlTypeId, UIA_CalendarControlTypeId,
    UIA_CheckBoxControlTypeId, UIA_ComboBoxControlTypeId, UIA_CustomControlTypeId,
    UIA_DataGridControlTypeId, UIA_DataItemControlTypeId, UIA_DocumentControlTypeId,
    UIA_EditControlTypeId, UIA_GroupControlTypeId, UIA_HeaderControlTypeId,
    UIA_HeaderItemControlTypeId, UIA_HyperlinkControlTypeId, UIA_ImageControlTypeId,
    UIA_ListItemControlTypeId, UIA_MenuBarControlTypeId, UIA_MenuControlTypeId,
    UIA_MenuItemControlTypeId, UIA_PaneControlTypeId, UIA_ProgressBarControlTypeId,
    UIA_RadioButtonControlTypeId, UIA_ScrollBarControlTypeId, UIA_SemanticZoomControlTypeId,
    UIA_SeparatorControlTypeId, UIA_SliderControlTypeId, UIA_SpinnerControlTypeId,
    UIA_SplitButtonControlTypeId, UIA_StatusBarControlTypeId, UIA_TabItemControlTypeId,
    UIA_TableControlTypeId, UIA_TextControlTypeId, UIA_ThumbControlTypeId,
    UIA_TitleBarControlTypeId, UIA_ToolBarControlTypeId, UIA_ToolTipControlTypeId,
    UIA_TreeItemControlTypeId, UIA_ValuePatternId, UIA_WindowControlTypeId,
};

use crate::backend::DescribeNode;
use crate::handles::HandleTable;

/// Real UI trees are rarely more than 10-15 levels deep. 20 leaves generous
/// headroom for legitimate deep nesting (docked panels, ribbon UIs, nested
/// grids) while still bounding a pathological tree to a fixed number of
/// levels rather than descending forever.
const MAX_DEPTH: u32 = 20;

/// A safety valve independent of `maxNodes`: bounds how many elements this
/// walk will even LOOK AT, not just how many it returns. Without this, a
/// tiny `maxNodes` combined with `interactiveOnly` on a huge, mostly
/// non-interactive tree (thousands of layout panes wrapping a handful of
/// buttons) would still visit the whole tree before giving up. Scaled off
/// `maxNodes` so a caller asking for more nodes also gets to look further,
/// with a floor so a tiny `maxNodes` doesn't stop the walk almost
/// immediately.
fn max_visited(max_nodes: usize) -> usize {
    max_nodes.saturating_mul(20).max(500)
}

/// True once accepting one more node would exceed the cap -- the point at
/// which the walk must stop, rather than keep collecting and slicing
/// afterwards.
fn cap_reached(accepted_len: usize, max_nodes: usize) -> bool {
    accepted_len >= max_nodes
}

/// True once queueing another sibling cannot matter. `visit_cap` bounds how
/// many elements the outer loop will ever pop and look at, but that check
/// only runs on POP -- without a matching check here, in the loop that
/// enqueues every sibling at one level before the outer loop gets to run
/// again, a single level with far more children than `visit_cap` allows
/// would push all of them into `queue` first. `visited + queued` is exactly
/// the number of elements this walk has already committed to looking at
/// (popped or waiting to be popped), so once that reaches `visit_cap`,
/// nothing later in the sibling chain will ever be popped anyway.
fn queue_is_full(visited: usize, queued: usize, visit_cap: usize) -> bool {
    visited + queued >= visit_cap
}

struct RawNode {
    control_type: UIA_CONTROLTYPE_ID,
    name: String,
    value: Option<String>,
    enabled: bool,
    focused: bool,
}

fn read_node(element: &IUIAutomationElement) -> ::windows::core::Result<RawNode> {
    // SAFETY: `element` is a live IUIAutomationElement handed back by the
    // tree walker or `ElementFromHandle`. Each of these calls can fail with a
    // COM error if the underlying UI element went away since we obtained the
    // handle (window closed mid-walk); the binding reports that as `Err`, not
    // UB, so the only "unsafe" contract here is the ordinary COM one of
    // calling through a valid vtable pointer.
    unsafe {
        let control_type = element.CurrentControlType()?;
        let name = element.CurrentName()?.to_string();
        let enabled = element.CurrentIsEnabled()?.as_bool();
        let focused = element.CurrentHasKeyboardFocus()?.as_bool();
        let value = read_value(element);
        Ok(RawNode { control_type, name, value, enabled, focused })
    }
}

/// `None` whenever the element has no Value pattern (most control types) or
/// the pattern lookup itself fails -- both are the normal case, not logged as
/// errors.
fn read_value(element: &IUIAutomationElement) -> Option<String> {
    unsafe {
        let pattern = element.GetCurrentPattern(UIA_ValuePatternId).ok()?;
        let value_pattern: IUIAutomationValuePattern = pattern.cast().ok()?;
        let value = value_pattern.CurrentValue().ok()?;
        Some(value.to_string())
    }
}

/// Control types a person could plausibly act on: click, type into, check,
/// select. Deliberately excludes purely structural/presentational types
/// (pane, group, text, image, toolbar, ...) even though those still appear in
/// the fuller (`interactiveOnly: false`) tree.
fn is_interactive(control_type: UIA_CONTROLTYPE_ID) -> bool {
    control_type == UIA_ButtonControlTypeId
        || control_type == UIA_EditControlTypeId
        || control_type == UIA_CheckBoxControlTypeId
        || control_type == UIA_RadioButtonControlTypeId
        || control_type == UIA_ComboBoxControlTypeId
        || control_type == UIA_ListItemControlTypeId
        || control_type == UIA_MenuItemControlTypeId
        || control_type == UIA_HyperlinkControlTypeId
        || control_type == UIA_TabItemControlTypeId
        || control_type == UIA_SplitButtonControlTypeId
        || control_type == UIA_SliderControlTypeId
        || control_type == UIA_SpinnerControlTypeId
        || control_type == UIA_DataItemControlTypeId
        || control_type == UIA_HeaderItemControlTypeId
        || control_type == UIA_TreeItemControlTypeId
        || control_type == UIA_ThumbControlTypeId
}

/// Maps a UIA control-type id to a readable role string for the wire
/// protocol instead of exposing the numeric id to callers. An unrecognised
/// type (a custom control, or a UIA control type this list predates) falls
/// back to a numeric-but-labelled string instead of silently vanishing from
/// the tree.
fn role_for(control_type: UIA_CONTROLTYPE_ID) -> String {
    if control_type == UIA_ButtonControlTypeId { return "button".to_string(); }
    if control_type == UIA_EditControlTypeId { return "edit".to_string(); }
    if control_type == UIA_CheckBoxControlTypeId { return "checkbox".to_string(); }
    if control_type == UIA_RadioButtonControlTypeId { return "radioButton".to_string(); }
    if control_type == UIA_ComboBoxControlTypeId { return "comboBox".to_string(); }
    if control_type == UIA_ListItemControlTypeId { return "listItem".to_string(); }
    if control_type == UIA_MenuItemControlTypeId { return "menuItem".to_string(); }
    if control_type == UIA_HyperlinkControlTypeId { return "link".to_string(); }
    if control_type == UIA_TabItemControlTypeId { return "tab".to_string(); }
    if control_type == UIA_SplitButtonControlTypeId { return "splitButton".to_string(); }
    if control_type == UIA_SliderControlTypeId { return "slider".to_string(); }
    if control_type == UIA_SpinnerControlTypeId { return "spinner".to_string(); }
    if control_type == UIA_DataItemControlTypeId { return "dataItem".to_string(); }
    if control_type == UIA_HeaderItemControlTypeId { return "headerItem".to_string(); }
    if control_type == UIA_TreeItemControlTypeId { return "treeItem".to_string(); }
    if control_type == UIA_ThumbControlTypeId { return "thumb".to_string(); }
    if control_type == UIA_TextControlTypeId { return "text".to_string(); }
    if control_type == UIA_PaneControlTypeId { return "pane".to_string(); }
    if control_type == UIA_WindowControlTypeId { return "window".to_string(); }
    if control_type == UIA_GroupControlTypeId { return "group".to_string(); }
    if control_type == UIA_ImageControlTypeId { return "image".to_string(); }
    if control_type == UIA_DocumentControlTypeId { return "document".to_string(); }
    if control_type == UIA_ToolBarControlTypeId { return "toolbar".to_string(); }
    if control_type == UIA_StatusBarControlTypeId { return "statusBar".to_string(); }
    if control_type == UIA_TitleBarControlTypeId { return "titleBar".to_string(); }
    if control_type == UIA_ScrollBarControlTypeId { return "scrollBar".to_string(); }
    if control_type == UIA_ProgressBarControlTypeId { return "progressBar".to_string(); }
    if control_type == UIA_TableControlTypeId { return "table".to_string(); }
    if control_type == UIA_MenuControlTypeId { return "menu".to_string(); }
    if control_type == UIA_MenuBarControlTypeId { return "menuBar".to_string(); }
    if control_type == UIA_SeparatorControlTypeId { return "separator".to_string(); }
    if control_type == UIA_ToolTipControlTypeId { return "tooltip".to_string(); }
    if control_type == UIA_DataGridControlTypeId { return "dataGrid".to_string(); }
    if control_type == UIA_HeaderControlTypeId { return "header".to_string(); }
    if control_type == UIA_AppBarControlTypeId { return "appBar".to_string(); }
    if control_type == UIA_CalendarControlTypeId { return "calendar".to_string(); }
    if control_type == UIA_SemanticZoomControlTypeId { return "semanticZoom".to_string(); }
    if control_type == UIA_CustomControlTypeId { return "custom".to_string(); }
    format!("unknown({})", control_type.0)
}

/// Breadth-first walk of the UI Automation tree rooted at `hwnd`'s element,
/// bounded by `max_nodes` (the cap that matters to the caller) and
/// `MAX_DEPTH`/`max_visited` (safety valves independent of it). Breadth-first
/// on purpose: when `max_nodes` is hit the walk stops immediately, so
/// whatever survives is whatever was closest to the root across every
/// branch -- not everything down one deep branch and nothing from the rest
/// of the window.
pub fn describe_tree(
    automation: &IUIAutomation,
    hwnd: HWND,
    max_nodes: usize,
    interactive_only: bool,
    table: &mut HandleTable<IUIAutomationElement>,
) -> ::windows::core::Result<(Vec<DescribeNode>, bool)> {
    let walker = unsafe { automation.RawViewWalker() }?;
    let root = unsafe { automation.ElementFromHandle(hwnd) }?;

    table.begin_generation();
    let visit_cap = max_visited(max_nodes);

    let mut nodes = Vec::new();
    let mut truncated = false;
    let mut visited = 0usize;
    let mut queue: VecDeque<(IUIAutomationElement, u32)> = VecDeque::new();
    queue.push_back((root, 0));

    while let Some((element, depth)) = queue.pop_front() {
        visited += 1;
        if visited > visit_cap {
            truncated = true;
            break;
        }

        let info = match read_node(&element) {
            Ok(info) => info,
            // The element itself is unreadable (COM call failed -- typically
            // the underlying control or window went away mid-walk). Skip it:
            // do not include it, do not descend from it, do not abort.
            Err(_) => continue,
        };

        if !interactive_only || is_interactive(info.control_type) {
            if cap_reached(nodes.len(), max_nodes) {
                truncated = true;
                break;
            }
            let handle = table.store(element.clone());
            nodes.push(DescribeNode {
                handle,
                role: role_for(info.control_type),
                name: info.name,
                value: info.value,
                enabled: info.enabled,
                focused: info.focused,
                supported_actions: None,
                read_only: None,
                toggle_state: None,
            });
        }

        if depth >= MAX_DEPTH {
            continue;
        }

        let mut child = match unsafe { walker.GetFirstChildElement(&element) } {
            Ok(child) => child,
            // No children, or the fetch itself failed (again: normal on a
            // closing window). Either way there is nothing to enqueue.
            Err(_) => continue,
        };
        loop {
            // Checked BEFORE each push, not just at the top of `describe_tree`'s
            // outer loop: a single level can have far more children than
            // `visit_cap` allows, and without this the walker would happily
            // enumerate every one of them into `queue` before the outer loop's
            // own cap check ever gets to run again (it only runs on pop).
            if queue_is_full(visited, queue.len(), visit_cap) {
                truncated = true;
                break;
            }
            queue.push_back((child.clone(), depth + 1));
            child = match unsafe { walker.GetNextSiblingElement(&child) } {
                Ok(next) => next,
                Err(_) => break,
            };
        }
    }

    Ok((nodes, truncated))
}

#[allow(clippy::type_complexity)]
pub fn describe_background_tree(
    automation: &IUIAutomation,
    hwnd: HWND,
    max_nodes: usize,
    interactive_only: bool,
    manager: &mut crate::background_snapshots::BackgroundSnapshotManager,
) -> ::windows::core::Result<(IUIAutomationElement, Vec<DescribeNode>, std::collections::HashMap<String, IUIAutomationElement>, bool)> {
    let walker = unsafe { automation.RawViewWalker() }?;
    let root = unsafe { automation.ElementFromHandle(hwnd) }?;

    let visit_cap = max_visited(max_nodes);

    let mut nodes = Vec::new();
    let mut elements = std::collections::HashMap::new();
    let mut truncated = false;
    let mut visited = 0usize;
    let mut queue: VecDeque<(IUIAutomationElement, u32)> = VecDeque::new();
    queue.push_back((root.clone(), 0));

    while let Some((element, depth)) = queue.pop_front() {
        visited += 1;
        if visited > visit_cap {
            truncated = true;
            break;
        }

        let info = match read_node(&element) {
            Ok(info) => info,
            Err(_) => continue,
        };

        if !interactive_only || is_interactive(info.control_type) {
            if cap_reached(nodes.len(), max_nodes) {
                truncated = true;
                break;
            }
            let handle = manager.mint_handle();
            let patterns = crate::background_snapshots::discover_patterns(&element, info.enabled);
            elements.insert(handle.clone(), element.clone());
            nodes.push(DescribeNode {
                handle,
                role: role_for(info.control_type),
                name: info.name,
                value: info.value,
                enabled: info.enabled,
                focused: info.focused,
                supported_actions: Some(patterns.supported_actions),
                read_only: patterns.read_only,
                toggle_state: patterns.toggle_state,
            });
        }

        if depth >= MAX_DEPTH {
            continue;
        }

        let mut child = match unsafe { walker.GetFirstChildElement(&element) } {
            Ok(child) => child,
            Err(_) => continue,
        };
        loop {
            if queue_is_full(visited, queue.len(), visit_cap) {
                truncated = true;
                break;
            }
            queue.push_back((child.clone(), depth + 1));
            child = match unsafe { walker.GetNextSiblingElement(&child) } {
                Ok(next) => next,
                Err(_) => break,
            };
        }
    }

    Ok((root, nodes, elements, truncated))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn button_maps_to_a_readable_role() {
        assert_eq!(role_for(UIA_ButtonControlTypeId), "button");
    }

    #[test]
    fn pane_maps_to_a_readable_role_but_is_not_interactive() {
        assert_eq!(role_for(UIA_PaneControlTypeId), "pane");
        assert!(!is_interactive(UIA_PaneControlTypeId));
    }

    #[test]
    fn buttons_and_edits_are_interactive() {
        assert!(is_interactive(UIA_ButtonControlTypeId));
        assert!(is_interactive(UIA_EditControlTypeId));
    }

    #[test]
    fn an_unrecognised_control_type_gets_a_numeric_fallback_role() {
        let unknown = UIA_CONTROLTYPE_ID(999_999_999);
        assert_eq!(role_for(unknown), "unknown(999999999)");
    }

    #[test]
    fn cap_reached_is_false_below_the_limit_and_true_at_it() {
        assert!(!cap_reached(0, 10));
        assert!(!cap_reached(9, 10));
        assert!(cap_reached(10, 10));
    }

    #[test]
    fn a_zero_max_nodes_reaches_cap_immediately() {
        assert!(cap_reached(0, 0));
    }

    #[test]
    fn max_visited_scales_with_max_nodes_but_has_a_floor() {
        assert_eq!(max_visited(0), 500);
        assert_eq!(max_visited(1000), 20000);
    }

    #[test]
    fn queue_is_full_is_false_below_the_cap_and_true_at_it() {
        assert!(!queue_is_full(0, 0, 10));
        assert!(!queue_is_full(5, 4, 10));
        assert!(queue_is_full(5, 5, 10));
        assert!(queue_is_full(0, 10, 10));
    }

    #[test]
    fn queue_is_full_counts_already_visited_and_still_queued_together() {
        // A sibling loop that has already queued right up to the cap must be
        // recognised as full even with zero already popped, and a walk that
        // has popped its way right up to the cap must be recognised as full
        // even with an empty queue -- `visited` and `queued` are two parts of
        // the same budget, not independent limits.
        assert!(queue_is_full(0, 500, 500));
        assert!(queue_is_full(500, 0, 500));
    }
}
