//! Semantic action execution via Windows UI Automation patterns.
//! Executes invoke, setValue, select, and toggle without input synthesis or cursor movement.

use crate::backend::{BackgroundActRequest, BackgroundActResult};
use crate::background_snapshots::BackgroundSnapshotManager;

#[cfg(windows)]
pub use native::*;

#[cfg(windows)]
mod native {
    use super::*;
    use crate::target_guard::native::{
        check_security, get_window_instance, verify_element_ancestry,
    };
    use crate::target_guard::require_same_instance;
    use crate::window_host::resolve_verified_host;
    use ::windows::core::{Interface, BSTR};
    use ::windows::Win32::Foundation::HWND;
    use ::windows::Win32::UI::Accessibility::{
        IUIAutomation, IUIAutomationInvokePattern, IUIAutomationSelectionItemPattern,
        IUIAutomationTogglePattern, IUIAutomationValuePattern, ToggleState_Indeterminate,
        ToggleState_Off, ToggleState_On, UIA_InvokePatternId, UIA_SelectionItemPatternId,
        UIA_TogglePatternId, UIA_ValuePatternId,
    };
    use ::windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    pub fn execute_background_act(
        automation: &IUIAutomation,
        snapshots: &BackgroundSnapshotManager,
        request: &BackgroundActRequest,
    ) -> Result<BackgroundActResult, String> {
        let snapshot = snapshots
            .get_snapshot(&request.snapshot_id)
            .ok_or_else(|| "DESKTOP_REF_STALE: Snapshot not found or expired".to_string())?;

        require_same_instance(&request.expected_instance, &snapshot.window_instance)
            .map_err(|err| format!("DESKTOP_TARGET_CHANGED: {err}"))?;

        let hwnd_value: isize = request
            .expected_instance
            .window_id
            .parse()
            .map_err(|_| "DESKTOP_TARGET_CHANGED: invalid target window id".to_string())?;
        let hwnd = HWND(hwnd_value as *mut ::core::ffi::c_void);
        let live_instance =
            get_window_instance(hwnd).map_err(|err| format!("DESKTOP_TARGET_CHANGED: {err}"))?;
        require_same_instance(&request.expected_instance, &live_instance)
            .map_err(|err| format!("DESKTOP_TARGET_CHANGED: {err}"))?;

        let live_host = resolve_verified_host(hwnd)?;
        if live_host != request.expected_host {
            return Err("DESKTOP_TARGET_CHANGED: verified host identity changed".to_string());
        }

        let element = snapshot.elements.get(&request.handle).ok_or_else(|| {
            format!(
                "DESKTOP_REF_STALE: Element handle {} not found in snapshot",
                request.handle
            )
        })?;

        // 1. Target security and privilege checks
        check_security(request.expected_instance.process_id)
            .map_err(|err| format!("DESKTOP_INPUT_REFUSED: {err}"))?;
        if let Some(host) = &request.expected_host {
            check_security(host.instance.process_id)
                .map_err(|err| format!("DESKTOP_INPUT_REFUSED: {err}"))?;
        }

        // 2. Element ancestry verification to root
        verify_element_ancestry(automation, element, &snapshot.root)
            .map_err(|err| format!("DESKTOP_TARGET_CHANGED: {err}"))?;

        // 3. Ensure element is enabled
        let enabled = unsafe { element.CurrentIsEnabled() }
            .map(|b| b.as_bool())
            .unwrap_or(false);
        if !enabled {
            return Err("DESKTOP_ELEMENT_DISABLED: Element is disabled".to_string());
        }

        // Sample foreground window before action
        let fg_before = unsafe { GetForegroundWindow() };

        let mut toggle_state = None;

        // 4. Dispatch semantic action
        match request.op.as_str() {
            "invoke" => unsafe {
                let pattern = element
                    .GetCurrentPattern(UIA_InvokePatternId)
                    .map_err(|_| {
                        "DESKTOP_PATTERN_UNSUPPORTED: InvokePattern not supported".to_string()
                    })?;
                let invoke_pat: IUIAutomationInvokePattern = pattern.cast().map_err(|_| {
                    "DESKTOP_PATTERN_UNSUPPORTED: Cannot cast to InvokePattern".to_string()
                })?;
                invoke_pat
                    .Invoke()
                    .map_err(|err| format!("DESKTOP_PATTERN_UNSUPPORTED: Invoke failed: {err}"))?;
            },
            "setValue" => unsafe {
                let val_str = request.value.as_deref().ok_or_else(|| {
                    "DESKTOP_PATTERN_UNSUPPORTED: setValue requires value argument".to_string()
                })?;

                if val_str.encode_utf16().count() > 65536 {
                    return Err(
                        "DESKTOP_PATTERN_UNSUPPORTED: Value exceeds 65536 UTF-16 code units"
                            .to_string(),
                    );
                }

                let is_password = element
                    .CurrentIsPassword()
                    .map(|b| b.as_bool())
                    .unwrap_or(false);
                if is_password {
                    return Err(
                        "DESKTOP_INPUT_REFUSED: setValue refused on password field".to_string()
                    );
                }

                let pattern = element.GetCurrentPattern(UIA_ValuePatternId).map_err(|_| {
                    "DESKTOP_PATTERN_UNSUPPORTED: ValuePattern not supported".to_string()
                })?;
                let value_pat: IUIAutomationValuePattern = pattern.cast().map_err(|_| {
                    "DESKTOP_PATTERN_UNSUPPORTED: Cannot cast to ValuePattern".to_string()
                })?;

                let read_only = value_pat
                    .CurrentIsReadOnly()
                    .map(|b| b.as_bool())
                    .unwrap_or(false);
                if read_only {
                    return Err("DESKTOP_VALUE_READ_ONLY: Element value is read-only".to_string());
                }

                let bstr = BSTR::from(val_str);
                value_pat.SetValue(&bstr).map_err(|err| {
                    format!("DESKTOP_PATTERN_UNSUPPORTED: SetValue failed: {err}")
                })?;
            },
            "select" => unsafe {
                let pattern = element
                    .GetCurrentPattern(UIA_SelectionItemPatternId)
                    .map_err(|_| {
                        "DESKTOP_PATTERN_UNSUPPORTED: SelectionItemPattern not supported"
                            .to_string()
                    })?;
                let select_pat: IUIAutomationSelectionItemPattern =
                    pattern.cast().map_err(|_| {
                        "DESKTOP_PATTERN_UNSUPPORTED: Cannot cast to SelectionItemPattern"
                            .to_string()
                    })?;
                select_pat
                    .Select()
                    .map_err(|err| format!("DESKTOP_PATTERN_UNSUPPORTED: Select failed: {err}"))?;
            },
            "toggle" => unsafe {
                let pattern = element
                    .GetCurrentPattern(UIA_TogglePatternId)
                    .map_err(|_| {
                        "DESKTOP_PATTERN_UNSUPPORTED: TogglePattern not supported".to_string()
                    })?;
                let toggle_pat: IUIAutomationTogglePattern = pattern.cast().map_err(|_| {
                    "DESKTOP_PATTERN_UNSUPPORTED: Cannot cast to TogglePattern".to_string()
                })?;
                toggle_pat
                    .Toggle()
                    .map_err(|err| format!("DESKTOP_PATTERN_UNSUPPORTED: Toggle failed: {err}"))?;

                if let Ok(state) = toggle_pat.CurrentToggleState() {
                    toggle_state = match state {
                        s if s == ToggleState_Off => Some("off".to_string()),
                        s if s == ToggleState_On => Some("on".to_string()),
                        s if s == ToggleState_Indeterminate => Some("indeterminate".to_string()),
                        _ => None,
                    };
                }
            },
            unknown => {
                return Err(format!(
                    "DESKTOP_PATTERN_UNSUPPORTED: Unknown action operation: {unknown}"
                ))
            }
        }

        // Sample foreground window after action
        let fg_after = unsafe { GetForegroundWindow() };
        let focus_changed = fg_before != fg_after;

        Ok(BackgroundActResult {
            ok: true,
            outcome: "completed".to_string(),
            focus_changed,
            toggle_state,
        })
    }
}
