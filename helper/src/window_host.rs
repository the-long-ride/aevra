//! Native WebView2-to-host attribution.
//!
//! A runtime process name, process parent, title, or user data folder is not
//! enough to identify the app behind a WebView2 HWND. This module accepts a
//! host only when native parent/owner relationships lead to one live app
//! process instance and a distinct live host HWND.

use crate::backend::VerifiedWindowHost;
use crate::target_guard::WindowInstance;
use ::windows::Win32::Foundation::HWND;
use ::windows::Win32::UI::WindowsAndMessaging::{
    GetAncestor, GetParent, GetWindow, IsWindow, IsWindowVisible, GA_ROOT, GW_OWNER,
};
use std::collections::HashSet;

const MAX_CHAIN_DEPTH: usize = 32;

#[derive(Debug, Clone)]
struct HostCandidate {
    hwnd: HWND,
    executable_path: String,
    instance: WindowInstance,
}

fn hwnd_value(hwnd: HWND) -> isize {
    hwnd.0 as isize
}

fn is_null(hwnd: HWND) -> bool {
    hwnd_value(hwnd) == 0
}

fn basename(path: &str) -> &str {
    path.rsplit(['\\', '/']).next().unwrap_or(path)
}

fn normalized_path(path: &str) -> String {
    let mut normalized = path.replace('/', "\\");
    if normalized
        .get(..8)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("\\\\?\\UNC\\"))
    {
        normalized = format!("\\\\{}", &normalized[8..]);
    } else if let Some(rest) = normalized.strip_prefix("\\\\?\\") {
        normalized = rest.to_string();
    }
    normalized.to_ascii_lowercase()
}

fn same_process_instance(left: &WindowInstance, right: &WindowInstance) -> bool {
    left.process_id == right.process_id && left.process_started_at == right.process_started_at
}

fn append_chain(start: HWND, owners: bool, output: &mut Vec<HWND>, seen: &mut HashSet<isize>) {
    let mut current = start;
    for _ in 0..MAX_CHAIN_DEPTH {
        if is_null(current) || !seen.insert(hwnd_value(current)) {
            break;
        }
        output.push(current);
        // SAFETY: both APIs accept a live HWND and return either another HWND
        // or null. Every returned handle is revalidated before use below.
        current = unsafe {
            if owners {
                GetWindow(current, GW_OWNER)
            } else {
                GetParent(current)
            }
        }
        .unwrap_or_default();
    }
}

fn candidate_for(hwnd: HWND, target: &WindowInstance) -> Option<HostCandidate> {
    if is_null(hwnd)
        || !unsafe { IsWindow(hwnd) }.as_bool()
        || !unsafe { IsWindowVisible(hwnd) }.as_bool()
    {
        return None;
    }

    let instance = crate::target_guard::native::get_window_instance(hwnd).ok()?;
    if instance.process_id == target.process_id {
        return None;
    }

    let (process_name, executable_path) = crate::windows_backend::executable_for(hwnd);
    let executable_path = executable_path?;
    if process_name
        .as_deref()
        .map(|name| name.eq_ignore_ascii_case("msedgewebview2.exe"))
        == Some(true)
    {
        return None;
    }

    Some(HostCandidate {
        hwnd,
        executable_path,
        instance,
    })
}

/// Returns a host only for a WebView2 target whose native HWND relationships
/// lead to one distinct live host process instance. A direct non-WebView2
/// window has no inherited host and returns `None`.
pub fn resolve_verified_host(hwnd: HWND) -> Result<Option<VerifiedWindowHost>, String> {
    if !unsafe { IsWindow(hwnd) }.as_bool() {
        return Err("DESKTOP_TARGET_CHANGED: target HWND no longer exists".to_string());
    }
    if !unsafe { IsWindowVisible(hwnd) }.as_bool() {
        return Err("DESKTOP_TARGET_CHANGED: target window is not visible".to_string());
    }

    let target_instance = crate::target_guard::native::get_window_instance(hwnd)
        .map_err(|err| format!("DESKTOP_TARGET_CHANGED: {err}"))?;
    let (target_name, _) = crate::windows_backend::executable_for(hwnd);
    if target_name
        .as_deref()
        .map(|name| name.eq_ignore_ascii_case("msedgewebview2.exe"))
        != Some(true)
    {
        return Ok(None);
    }

    // GA_ROOT follows native parent relationships to the unique root window.
    // Also inspect owner chains because some frameworks host WebView2 in an
    // owned top-level window rather than a child HWND.
    let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
    let mut handles = Vec::new();
    let mut seen = HashSet::new();
    if !is_null(root) && seen.insert(hwnd_value(root)) {
        handles.push(root);
    }
    append_chain(hwnd, false, &mut handles, &mut seen);
    append_chain(hwnd, true, &mut handles, &mut seen);
    if !is_null(root) {
        append_chain(root, true, &mut handles, &mut seen);
    }

    let mut candidates = Vec::new();
    let mut instances = HashSet::new();
    for candidate_hwnd in handles {
        if hwnd_value(candidate_hwnd) == hwnd_value(hwnd) {
            continue;
        }
        if let Some(candidate) = candidate_for(candidate_hwnd, &target_instance) {
            let key = format!(
                "{}|{}|{}",
                candidate.instance.process_id,
                candidate.instance.process_started_at,
                normalized_path(&candidate.executable_path)
            );
            if instances.insert(key) {
                candidates.push(candidate);
            }
        }
    }

    // Multiple HWNDs from one host process are common (for example, a Tauri
    // root, WRY_WEBVIEW, and Chromium container). They still identify one app.
    // A second process instance or executable in the chain makes attribution
    // ambiguous and must fail closed.
    if candidates.is_empty() || candidates.len() != 1 {
        return Ok(None);
    }

    let candidate = candidates.pop().expect("one candidate was checked above");
    if !unsafe { IsWindow(candidate.hwnd) }.as_bool()
        || !unsafe { IsWindowVisible(candidate.hwnd) }.as_bool()
    {
        return Ok(None);
    }
    let current_host = crate::target_guard::native::get_window_instance(candidate.hwnd)
        .map_err(|err| format!("DESKTOP_TARGET_CHANGED: {err}"))?;
    let (_, current_path) = crate::windows_backend::executable_for(candidate.hwnd);
    if !same_process_instance(&candidate.instance, &current_host)
        || current_host.window_id != candidate.instance.window_id
        || current_path.as_deref().map(normalized_path).as_deref()
            != Some(normalized_path(&candidate.executable_path).as_str())
        || !unsafe { IsWindow(hwnd) }.as_bool()
        || !unsafe { IsWindowVisible(hwnd) }.as_bool()
    {
        return Err(
            "DESKTOP_TARGET_CHANGED: target or host HWND changed during attribution".to_string(),
        );
    }
    let current_target = crate::target_guard::native::get_window_instance(hwnd)
        .map_err(|err| format!("DESKTOP_TARGET_CHANGED: {err}"))?;
    if !same_process_instance(&target_instance, &current_target)
        || current_target.window_id != target_instance.window_id
    {
        return Err(
            "DESKTOP_TARGET_CHANGED: target process instance changed during attribution"
                .to_string(),
        );
    }

    Ok(Some(VerifiedWindowHost {
        executable_path: candidate.executable_path,
        instance: candidate.instance,
    }))
}
