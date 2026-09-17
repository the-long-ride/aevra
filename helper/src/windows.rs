//! The Windows backend: window identity (no COM required) plus, as of 9b,
//! the UI Automation tree walk behind `describe`. Everything here is
//! `unsafe` FFI into user32/kernel32/UI Automation via the `windows` crate.
//!
//! Referenced with a leading `::` (`::windows::...`) throughout: this module
//! is loaded under the local name `windows_backend` (see the `#[path = ...]`
//! attribute in `main.rs`), but the leading `::` makes every path here
//! unambiguously the extern crate regardless of how this module is mounted.

use crate::backend::{
    ActRequest, Capabilities, CaptureRequest, CaptureResult, DescribeNode, DescribeRequest,
    DescribeResult, DesktopBackend, ScreenState, WindowIdentity,
};
use crate::act::{self, ActContext};
use crate::capture;
use crate::grab;
use crate::handles::HandleTable;
use crate::uia;
use std::cell::RefCell;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use ::windows::Win32::Foundation::{BOOL, CloseHandle, HWND, LPARAM};
use ::windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
};
use ::windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use ::windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation, IUIAutomationElement};
use ::windows::Win32::UI::HiDpi::{
    SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
};
use ::windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
    IsWindow, IsWindowVisible,
};
use ::windows::core::PWSTR;

pub struct WindowsBackend {
    /// Lazily created on the first `describe` call and reused after that --
    /// creating a `CUIAutomation` COM object per call would be wasteful, and
    /// this helper is single-threaded so there is no concurrent-access
    /// hazard in caching it behind a `RefCell`.
    automation: RefCell<Option<IUIAutomation>>,
    /// Discarded and rebuilt on every `describe`. See `handles.rs` for the
    /// handle representation decision and the stale-handle guarantee this
    /// table exists to provide.
    handle_table: RefCell<HandleTable<IUIAutomationElement>>,
    /// The window the most recent `describe` walked, as a raw HWND value.
    /// `act` refuses an element handle unless this window is still the
    /// foreground one: a bounding rectangle read from a window that has since
    /// gone behind another would be clicked straight through to whatever is
    /// now on top of it.
    described_window: RefCell<Option<isize>>,
}

impl WindowsBackend {
    pub fn new() -> Self {
        // UI Automation is a COM client API. Microsoft's own guidance for UI
        // Automation CLIENTS is to run on a single-threaded apartment (STA):
        // UIA's event/callback marshalling relies on the calling thread
        // pumping messages. This helper is single-threaded and already
        // processes exactly one request at a time with no message loop of
        // its own beyond blocking stdin reads, so STA costs nothing here and
        // keeps the door open for a later feature (UIA event subscriptions
        // for change notifications) that would need STA regardless. Plain
        // synchronous property/pattern gets -- everything 9b does -- would
        // also work under MTA, but there is no reason to pick the apartment
        // model that would need revisiting first.
        // Per-monitor DPI awareness, set before anything reads screen
        // geometry. A process that is not DPI-aware is handed VIRTUALISED
        // coordinates: UI Automation bounding rectangles and SetCursorPos
        // would then sit in different spaces, and every click on a scaled
        // display would land somewhere other than the element it named --
        // which is most laptops. Failure is non-fatal and expected when a
        // manifest already set awareness for this process.
        // SAFETY: takes an opaque context value and reports failure through
        // its result; it cannot corrupt memory.
        if let Err(err) = unsafe {
            SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)
        } {
            eprintln!("SetProcessDpiAwarenessContext failed (already set by a manifest?): {err:?}");
        }
        let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        if hr.is_err() {
            // Not a panic: a helper that cannot initialise COM can still
            // serve window-identity requests (9a's surface), just not
            // `describe`. `automation()` below surfaces the real failure to
            // whichever `describe` call actually needs COM.
            eprintln!("CoInitializeEx failed: {hr:?}");
        }
        WindowsBackend {
            automation: RefCell::new(None),
            handle_table: RefCell::new(HandleTable::new()),
            described_window: RefCell::new(None),
        }
    }

    fn identity_for(hwnd: HWND) -> WindowIdentity {
        let window_id = format!("{}", hwnd.0 as isize);
        let title = window_title(hwnd);
        let (process_name, executable_path) = executable_for(hwnd);
        WindowIdentity { window_id, process_name, executable_path, title }
    }

    /// Returns the cached `IUIAutomation` instance, creating it on first use.
    fn automation(&self) -> Result<IUIAutomation, String> {
        let mut slot = self.automation.borrow_mut();
        if slot.is_none() {
            let created: IUIAutomation =
                unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) }
                    .map_err(|err| format!("CoCreateInstance(CUIAutomation) failed: {err:?}"))?;
            *slot = Some(created);
        }
        Ok(slot.as_ref().expect("just populated above").clone())
    }
    /// A cheap, coarse fingerprint of whatever currently holds keyboard
    /// focus, folded into `screen_state`'s signature.
    ///
    /// Without it the signature moves only when the focused WINDOW or the
    /// window set changes, so a click that alters a window's contents --
    /// which is most clicks -- would report `subtreeChanged: false` and the
    /// caller would skip the re-describe it actually needs. Hashing the
    /// whole tree on every action would be correct and far too expensive:
    /// `act` calls `screenState` twice, so that cost lands on every single
    /// action. The focused element's name and control type is one property
    /// get and moves for the great majority of real interactions. It is a
    /// heuristic, and deliberately a conservative one -- a missed change
    /// costs a redundant describe, never a wrong click.
    fn focused_element_hint(&self) -> Option<String> {
        let automation = self.automation().ok()?;
        // SAFETY: COM calls on a live interface pointer; each reports
        // failure through its own result, which is discarded here because a
        // missing focus hint degrades the signature rather than breaking it.
        let element = unsafe { automation.GetFocusedElement() }.ok()?;
        let name = unsafe { element.CurrentName() }.ok()?;
        let control_type = unsafe { element.CurrentControlType() }.ok()?;
        Some(format!("{}|{}", name.to_string(), control_type.0))
    }
}

impl Default for WindowsBackend {
    fn default() -> Self {
        Self::new()
    }
}

/// `None` (not `Some("")`) for a window with no title, per the brief: a
/// window with no title is `None`.
fn window_title(hwnd: HWND) -> Option<String> {
    // SAFETY: `hwnd` is a window handle obtained from `GetForegroundWindow` or
    // `EnumWindows`, both of which hand back live top-level window handles.
    // `GetWindowTextLengthW`/`GetWindowTextW` are safe to call with any HWND,
    // including a stale or invalid one -- they simply report failure.
    unsafe {
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return None;
        }
        let mut buffer = vec![0u16; (len as usize) + 1];
        let copied = GetWindowTextW(hwnd, &mut buffer);
        if copied <= 0 {
            return None;
        }
        buffer.truncate(copied as usize);
        let text = String::from_utf16_lossy(&buffer);
        if text.is_empty() {
            None
        } else {
            Some(text)
        }
    }
}

/// Resolves `(processName, executablePath)` for the process owning `hwnd`.
/// Returns `(None, None)` whenever ANY step fails -- no partial result, no
/// fallback to the window class or title. This is the normal outcome for a
/// window on the secure desktop (a UAC consent prompt) or any process this
/// helper is not privileged to query; it is not logged as an error because it
/// is not one.
fn executable_for(hwnd: HWND) -> (Option<String>, Option<String>) {
    // SAFETY: all calls below take either a window handle already known to be
    // valid for this call, or a process handle we just opened and always
    // close before returning.
    unsafe {
        let mut pid: u32 = 0;
        let thread_id = GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if thread_id == 0 || pid == 0 {
            return (None, None);
        }
        let process = match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            Ok(handle) => handle,
            Err(_) => return (None, None),
        };
        let mut buffer = vec![0u16; 32768];
        let mut size = buffer.len() as u32;
        let result = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut size,
        );
        let _ = CloseHandle(process);
        if result.is_err() || size == 0 {
            return (None, None);
        }
        buffer.truncate(size as usize);
        let path = String::from_utf16_lossy(&buffer);
        if path.is_empty() {
            return (None, None);
        }
        let name = path
            .rsplit(['\\', '/'])
            .next()
            .filter(|segment| !segment.is_empty())
            .map(str::to_string);
        (name, Some(path))
    }
}

/// Resolves the window to describe. `Some(id)` must name a window that
/// STILL EXISTS -- per the brief, a `windowId` that no longer exists is an
/// error reply, not an empty tree. `None` means the currently focused
/// window, and no focused window (e.g. during a lock-screen transition) is
/// likewise an error, not an empty tree.
fn resolve_target_hwnd(window_id: Option<&str>) -> Result<HWND, String> {
    match window_id {
        Some(id) => {
            let raw: isize = id
                .parse()
                .map_err(|_| format!("windowId {id:?} is not a valid window identifier"))?;
            let hwnd = HWND(raw as *mut ::core::ffi::c_void);
            // SAFETY: `IsWindow` accepts any value, including a stale or
            // bogus handle -- it simply reports whether it currently names a
            // live window.
            let exists = unsafe { IsWindow(hwnd) }.as_bool();
            if !exists {
                return Err(format!("window {id} no longer exists"));
            }
            Ok(hwnd)
        }
        None => {
            // SAFETY: `GetForegroundWindow` takes no arguments and may return
            // a null handle; that is the normal case when the desktop itself
            // has focus, not an error we need to guard with anything beyond
            // the null check below.
            let hwnd = unsafe { GetForegroundWindow() };
            if hwnd.0 as isize == 0 {
                return Err("no focused window".to_string());
            }
            Ok(hwnd)
        }
    }
}

struct EnumState {
    handles: Vec<HWND>,
}

unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let state = &mut *(lparam.0 as *mut EnumState);
    // Filtered to visible top-level windows with a non-empty title. An
    // unfiltered `EnumWindows` on a real desktop returns hundreds of
    // invisible helper/message-only windows (tray icons, IME hosts, hidden
    // tool windows); none of those are something a model driving the desktop
    // could plausibly act on, and including them would swamp `windows()`
    // with noise no caller can use.
    if IsWindowVisible(hwnd).as_bool() && GetWindowTextLengthW(hwnd) > 0 {
        state.handles.push(hwnd);
    }
    BOOL(1)
}

impl DesktopBackend for WindowsBackend {
    fn connect(&self) -> Capabilities {
        // Every capability is now genuinely implemented: identity in 9a,
        // `describe` in 9b (`uia::describe_tree`), `act` in 9c, and
        // `capture` in 9d (`grab` + `capture`). Each flag was flipped only
        // once its method worked end to end against the real desktop --
        // claiming one this binary cannot deliver would defeat the whole
        // point of a capability record, which is that the model can trust
        // what it says and stop guessing.
        Capabilities { capture: true, tree: true, attribution: true, input: true }
    }

    fn windows(&self) -> Vec<WindowIdentity> {
        let mut state = EnumState { handles: Vec::new() };
        // SAFETY: `enum_windows_proc` only touches the `EnumState` behind the
        // pointer we pass as `lparam`, and `EnumWindows` runs it synchronously
        // on this thread before returning, so `state` outlives every call.
        unsafe {
            let _ = EnumWindows(Some(enum_windows_proc), LPARAM(&mut state as *mut EnumState as isize));
        }
        state.handles.into_iter().map(Self::identity_for).collect()
    }

    fn focused_window(&self) -> WindowIdentity {
        // SAFETY: `GetForegroundWindow` takes no arguments; it may return a
        // null handle, which is the normal case when the desktop itself has
        // focus or during a lock-screen transition, not an error.
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.0 as isize == 0 {
            return WindowIdentity {
                window_id: "0".to_string(),
                process_name: None,
                executable_path: None,
                title: None,
            };
        }
        Self::identity_for(hwnd)
    }

    fn screen_state(&self) -> ScreenState {
        let window = self.focused_window();
        let window_ids: Vec<String> = self.windows().into_iter().map(|w| w.window_id).collect();
        // Signature: a hash of the focused window's identity (window id,
        // process name, executable path -- title is deliberately excluded,
        // since it is attacker-influenceable and would let a page flip the
        // signature without any real change) folded with the full window id
        // list. There is no accessibility tree yet in 9a, so this is the
        // finest-grained signal available; it changes whenever the focused
        // window or the window set changes, and is stable otherwise.
        let mut hasher = DefaultHasher::new();
        window.window_id.hash(&mut hasher);
        window.process_name.hash(&mut hasher);
        window.executable_path.hash(&mut hasher);
        window_ids.hash(&mut hasher);
        self.focused_element_hint().hash(&mut hasher);
        let signature = format!("{:x}", hasher.finish());
        ScreenState { window, window_ids, signature }
    }

    fn describe(&self, request: DescribeRequest) -> Result<DescribeResult, String> {
        let hwnd = resolve_target_hwnd(request.window_id.as_deref())?;
        *self.described_window.borrow_mut() = Some(hwnd.0 as isize);
        let window = Self::identity_for(hwnd);
        let automation = self.automation()?;
        let mut table = self.handle_table.borrow_mut();
        let (nodes, truncated): (Vec<DescribeNode>, bool) = uia::describe_tree(
            &automation,
            hwnd,
            request.max_nodes,
            request.interactive_only,
            &mut table,
        )
        .map_err(|err| format!("failed to read the accessibility tree: {err:?}"))?;
        Ok(DescribeResult { window, nodes, truncated })
    }

    fn capture(&self, request: CaptureRequest) -> Result<CaptureResult, String> {
        // A window capture reports that window's identity; a primary-monitor
        // capture reports none, because it is not one window and the tool
        // layer audits this field as the capture's target.
        let (frame, window) = match request.window_id.as_deref() {
            Some(id) => {
                let hwnd = resolve_target_hwnd(Some(id))?;
                (grab::grab_window(hwnd)?, Some(Self::identity_for(hwnd)))
            }
            None => (grab::grab_primary_screen()?, None),
        };
        let (image_data_uri, device_pixel_ratio) = capture::encode_frame(frame)?;
        Ok(CaptureResult { image_data_uri, device_pixel_ratio, window })
    }

    fn act(&self, request: ActRequest) -> Result<bool, String> {
        let table = self.handle_table.borrow();
        let context = ActContext {
            table: &table,
            described_window: *self.described_window.borrow(),
        };
        act::perform(&context, &request)
    }
}
