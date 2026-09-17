//! The `act` implementation: resolve a handle, satisfy itself that acting is
//! still safe, and synthesise real input.
//!
//! Kept out of `windows.rs` so the pre-flight checks below read as one
//! sequence rather than being buried among the identity and tree code. The
//! checks are the point of this module: everything else in the desktop
//! subsystem exists to make sure a click lands on the element the model
//! actually chose, and this is the last place that can still be got wrong.

use crate::backend::ActRequest;
use crate::handles::HandleTable;
use crate::input;
use crate::keys;

use ::windows::Win32::Foundation::POINT;
use ::windows::Win32::UI::Accessibility::IUIAutomationElement;
use ::windows::Win32::UI::WindowsAndMessaging::{
    GetAncestor, GetForegroundWindow, GetSystemMetrics, WindowFromPoint, GA_ROOT,
    SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
};

/// Everything `perform` needs from the backend, borrowed for the call.
pub struct ActContext<'a> {
    pub table: &'a HandleTable<IUIAutomationElement>,
    /// The window the most recent `describe` walked. `None` means no
    /// `describe` has run in this helper's lifetime, so there is no element
    /// anyone could legitimately be naming.
    pub described_window: Option<isize>,
}

pub fn perform(context: &ActContext, request: &ActRequest) -> Result<bool, String> {
    match request.op.as_str() {
        "click" => click(context, request),
        "type" => {
            let text = request
                .text
                .as_deref()
                .ok_or_else(|| "type requires text".to_string())?;
            input::send_text(text)?;
            Ok(true)
        }
        "key" => {
            let spec = request
                .keys
                .as_deref()
                .ok_or_else(|| "key requires keys".to_string())?;
            // Parsed in full BEFORE anything is sent, so a malformed chord
            // late in a sequence cannot leave the earlier chords applied.
            let chords = keys::parse_sequence(spec)?;
            input::send_chords(&chords)?;
            Ok(true)
        }
        "scroll" => {
            let delta = request
                .delta_y
                .ok_or_else(|| "scroll requires deltaY".to_string())?;
            input::scroll(delta)?;
            Ok(true)
        }
        other => Err(format!("unknown act op: {other}")),
    }
}

fn click(context: &ActContext, request: &ActRequest) -> Result<bool, String> {
    match request.handle.as_deref() {
        Some(handle) => click_element(context, handle),
        None => match (request.x, request.y) {
            // A coordinate click is for canvas and game surfaces, which
            // expose no accessibility tree to name, so it carries none of
            // `click_element`'s element-identity protection. That is not a
            // free pass, though: the gate upstream (`window-gate.ts`, run by
            // the worker before this request is even sent) evaluated the
            // FOCUSED window's identity, not the identity of whatever
            // happens to sit at (x, y). Without the two checks below, a
            // click allowed because a small, allowlisted tool is focused
            // could still strike the pixels of an entirely different,
            // denylisted window elsewhere on screen -- a password manager,
            // an elevation prompt -- simply by naming its coordinates
            // instead of a handle inside it. Requiring the window under the
            // point to BE the foreground window closes that gap, and also
            // re-checks focus at the last possible moment, narrowing the
            // TOCTOU gap between the gate's check and this input landing.
            (Some(x), Some(y)) => {
                require_point_within_virtual_desktop(x, y, "the point")?;
                require_point_on_foreground_window(x, y)?;
                input::click_at(x, y)?;
                Ok(true)
            }
            _ => Err("click requires either a handle or both x and y".to_string()),
        },
    }
}

fn click_element(context: &ActContext, handle: &str) -> Result<bool, String> {
    // 1. The handle must still name a live element. `HandleTable::resolve`
    //    compares the generation the handle was minted under, so a handle
    //    from an earlier `describe` fails here even when its index is in
    //    range for the current table and a DIFFERENT element now occupies
    //    that slot. Refusing is the whole point: acting on "whatever is in
    //    slot 3 now" is how a click lands on the wrong control.
    let element = context
        .table
        .resolve(handle)
        .ok_or_else(|| format!("handle {handle} is stale or unknown -- call describe again"))?;

    // 2. The window that was described must still be the foreground window.
    //    A rectangle read from a background window would be clicked through
    //    to whatever is now on top of it.
    let described = context
        .described_window
        .ok_or_else(|| "no describe has run, so no element handle can be resolved".to_string())?;
    // SAFETY: `GetForegroundWindow` takes no arguments and may return null,
    // which the comparison below treats as "not the described window".
    let foreground = unsafe { GetForegroundWindow() };
    if foreground.0 as isize != described {
        return Err(format!(
            "the described window {described} is no longer in the foreground -- describe again before acting"
        ));
    }

    // 3. The element must still occupy a real rectangle. An element that has
    //    been scrolled out of view or collapsed reports an empty one, and
    //    clicking its "centre" would land at an arbitrary point.
    let rect = unsafe { element.CurrentBoundingRectangle() }
        .map_err(|err| format!("could not read the element's bounding rectangle: {err:?}"))?;
    if rect.right <= rect.left || rect.bottom <= rect.top {
        return Err(
            "the element has an empty bounding rectangle -- it is not visible on screen".to_string(),
        );
    }

    let x = rect.left + (rect.right - rect.left) / 2;
    let y = rect.top + (rect.bottom - rect.top) / 2;

    // 4. The point must lie on an actual monitor. A non-empty rectangle can
    //    still sit outside the virtual desktop -- a provider reporting stale
    //    or offset coordinates, or a window straddling a monitor edge --
    //    and `SetCursorPos` CLAMPS such a point rather than failing. Clamped
    //    means the click lands on some other surface entirely, which is the
    //    wrong-thing-clicked failure these checks exist to stop.
    require_point_within_virtual_desktop(x, y, "the element's centre")?;
    input::click_at(x, y)?;
    Ok(true)
}

/// Shared by both click paths. A point can sit outside the virtual desktop
/// -- a provider reporting stale or offset coordinates, a caller-supplied
/// coordinate, or a window straddling a monitor edge -- and `SetCursorPos`
/// CLAMPS such a point rather than failing. Clamped means the click lands on
/// some other surface entirely, which is the wrong-thing-clicked failure
/// these checks exist to stop. `what` names the point in the error message
/// so each call site's failure reads specifically ("the element's centre"
/// vs "the point").
fn require_point_within_virtual_desktop(x: i32, y: i32, what: &str) -> Result<(), String> {
    // SAFETY: `GetSystemMetrics` takes an index and returns an integer.
    let (vx, vy, vw, vh) = unsafe {
        (
            GetSystemMetrics(SM_XVIRTUALSCREEN),
            GetSystemMetrics(SM_YVIRTUALSCREEN),
            GetSystemMetrics(SM_CXVIRTUALSCREEN),
            GetSystemMetrics(SM_CYVIRTUALSCREEN),
        )
    };
    if x < vx || y < vy || x >= vx + vw || y >= vy + vh {
        return Err(format!(
            "{what} ({x}, {y}) is outside the virtual desktop -- refusing rather than letting SetCursorPos clamp it onto another surface"
        ));
    }
    Ok(())
}

/// The window under a coordinate click's point must be the foreground
/// window -- see the long comment in `click` for why this exists. A click on
/// a child control resolves via `GA_ROOT` to its top-level owner, which is
/// what `GetForegroundWindow` and window identity elsewhere in this helper
/// both mean by "the window".
fn require_point_on_foreground_window(x: i32, y: i32) -> Result<(), String> {
    // SAFETY: `WindowFromPoint` takes a POINT by value and returns whatever
    // window occupies that screen pixel, or null if none does (the desktop
    // background, or a point between monitors).
    let hit = unsafe { WindowFromPoint(POINT { x, y }) };
    if hit.0.is_null() {
        return Err(format!(
            "no window occupies ({x}, {y}) -- refusing a click into the desktop background"
        ));
    }
    // SAFETY: `GetAncestor` takes the window found above and a flag; GA_ROOT
    // walks up to its top-level owner. `GetForegroundWindow` takes no
    // arguments and may return null, which cannot equal a real hit-tested
    // window and so is correctly refused below.
    let root = unsafe { GetAncestor(hit, GA_ROOT) };
    let foreground = unsafe { GetForegroundWindow() };
    if root.0 != foreground.0 {
        return Err(
            "the window under this point is not the foreground window -- describe it and act on it by handle, or bring it to the foreground first"
                .to_string(),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(op: &str) -> ActRequest {
        ActRequest {
            op: op.to_string(),
            handle: None,
            x: None,
            y: None,
            text: None,
            keys: None,
            delta_y: None,
        }
    }

    fn empty_context() -> ActContext<'static> {
        // A leaked empty table: these tests only exercise paths that reject
        // before touching an element, and a leak in a test binary is
        // irrelevant.
        let table: &'static HandleTable<IUIAutomationElement> =
            Box::leak(Box::new(HandleTable::new()));
        ActContext { table, described_window: None }
    }

    #[test]
    fn an_unknown_op_is_rejected() {
        let err = perform(&empty_context(), &request("levitate")).unwrap_err();
        assert!(err.contains("levitate"), "error should name the op: {err}");
    }

    #[test]
    fn a_click_with_neither_handle_nor_coordinates_is_rejected() {
        let err = perform(&empty_context(), &request("click")).unwrap_err();
        assert!(err.contains("handle"), "error should say what is missing: {err}");
    }

    #[test]
    fn a_click_with_only_one_coordinate_is_rejected() {
        let mut act = request("click");
        act.x = Some(10);
        assert!(perform(&empty_context(), &act).is_err());
    }

    #[test]
    fn a_coordinate_click_outside_the_virtual_desktop_is_refused() {
        // Real virtual-desktop bounds are never negative-million-sized, so
        // this point is refused on every machine this test can run on,
        // before `require_point_on_foreground_window` is ever reached.
        let mut act = request("click");
        act.x = Some(-1_000_000);
        act.y = Some(-1_000_000);
        let err = perform(&empty_context(), &act).unwrap_err();
        assert!(err.contains("virtual desktop"), "got: {err}");
    }

    #[test]
    fn a_stale_handle_is_refused_before_any_input_is_sent() {
        let mut act = request("click");
        act.handle = Some("1:0".to_string());
        let err = perform(&empty_context(), &act).unwrap_err();
        assert!(err.contains("stale or unknown"), "got: {err}");
    }

    #[test]
    fn a_malformed_handle_is_refused_rather_than_panicking() {
        let mut act = request("click");
        act.handle = Some("not-a-handle".to_string());
        assert!(perform(&empty_context(), &act).is_err());
    }

    #[test]
    fn type_without_text_is_rejected() {
        assert!(perform(&empty_context(), &request("type")).is_err());
    }

    #[test]
    fn key_without_keys_is_rejected() {
        assert!(perform(&empty_context(), &request("key")).is_err());
    }

    #[test]
    fn a_malformed_chord_is_rejected_and_sends_nothing() {
        let mut act = request("key");
        act.keys = Some("hyper+q".to_string());
        let err = perform(&empty_context(), &act).unwrap_err();
        assert!(err.contains("hyper"), "got: {err}");
    }

    #[test]
    fn scroll_without_delta_is_rejected() {
        assert!(perform(&empty_context(), &request("scroll")).is_err());
    }
}
