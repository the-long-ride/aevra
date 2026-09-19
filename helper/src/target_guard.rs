//! Target integrity, elevation, desktop, and window instance guards.
//! Refuses actions against secure desktops, elevated targets, or changed processes.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowInstance {
    #[serde(rename = "windowId")]
    pub window_id: String,
    #[serde(rename = "processId")]
    pub process_id: u32,
    #[serde(rename = "processStartedAt")]
    pub process_started_at: String,
}

impl WindowInstance {
    pub fn new(window_id: impl Into<String>, process_id: u32, process_started_at: impl Into<String>) -> Self {
        Self {
            window_id: window_id.into(),
            process_id,
            process_started_at: process_started_at.into(),
        }
    }

    #[cfg(test)]
    pub fn fixture(window_id: impl Into<String>, process_id: u32, started_at: impl Into<String>) -> Self {
        Self::new(window_id, process_id, started_at)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TargetError {
    Changed,
    Elevated,
    NonDefaultDesktop,
    IntegrityCheckFailed,
    IntegrityHigherThanHelper,
    UnreadableState,
    ProcessNotFound,
}

impl std::fmt::Display for TargetError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Changed => write!(f, "Target window instance changed"),
            Self::Elevated => write!(f, "Target process is elevated or helper is elevated"),
            Self::NonDefaultDesktop => write!(f, "Target window is on a secure or non-default desktop"),
            Self::IntegrityCheckFailed => write!(f, "Could not verify process integrity level"),
            Self::IntegrityHigherThanHelper => write!(f, "Target process integrity level is higher than helper"),
            Self::UnreadableState => write!(f, "Could not read target process security information"),
            Self::ProcessNotFound => write!(f, "Target process not found or exited"),
        }
    }
}

impl std::error::Error for TargetError {}

#[allow(dead_code)]
pub fn require_same_instance(expected: &WindowInstance, actual: &WindowInstance) -> Result<(), TargetError> {
    if expected.window_id != actual.window_id
        || expected.process_id != actual.process_id
        || expected.process_started_at != actual.process_started_at
    {
        return Err(TargetError::Changed);
    }
    Ok(())
}

#[cfg(windows)]
pub mod native {
    use super::*;
    use ::windows::Win32::Foundation::{CloseHandle, HANDLE, HWND};
    use ::windows::Win32::Security::{
        GetTokenInformation, TokenElevation, TokenIntegrityLevel,
        TOKEN_ELEVATION, TOKEN_MANDATORY_LABEL, TOKEN_QUERY,
    };
    use ::windows::Win32::System::StationsAndDesktops::{
        GetThreadDesktop, GetUserObjectInformationW, UOI_NAME,
    };
    use ::windows::Win32::System::Threading::{
        GetCurrentProcess, GetCurrentThreadId, GetProcessTimes, OpenProcess, OpenProcessToken,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use ::windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
    use ::windows::Win32::UI::Accessibility::{IUIAutomation, IUIAutomationElement};

    pub fn get_process_creation_time(pid: u32) -> Result<String, TargetError> {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
                .map_err(|_| TargetError::ProcessNotFound)?;
            let mut creation = Default::default();
            let mut exit = Default::default();
            let mut kernel = Default::default();
            let mut user = Default::default();
            let ok = GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user);
            let _ = CloseHandle(handle);
            if ok.is_err() {
                return Err(TargetError::UnreadableState);
            }
            let timestamp = ((creation.dwHighDateTime as u64) << 32) | (creation.dwLowDateTime as u64);
            Ok(format!("{timestamp}"))
        }
    }

    pub fn get_window_instance(hwnd: HWND) -> Result<WindowInstance, TargetError> {
        let mut pid = 0u32;
        unsafe {
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
        }
        if pid == 0 {
            return Err(TargetError::ProcessNotFound);
        }
        let creation_time = get_process_creation_time(pid)?;
        Ok(WindowInstance::new(format!("{}", hwnd.0 as isize), pid, creation_time))
    }

    pub fn check_desktop() -> Result<(), TargetError> {
        unsafe {
            let thread_id = GetCurrentThreadId();
            let desktop = match GetThreadDesktop(thread_id) {
                Ok(d) => d,
                Err(_) => return Err(TargetError::NonDefaultDesktop),
            };
            if desktop.is_invalid() {
                return Err(TargetError::NonDefaultDesktop);
            }
            let mut buf = [0u16; 256];
            let mut needed = 0u32;
            let ok = GetUserObjectInformationW(
                HANDLE(desktop.0),
                UOI_NAME,
                Some(buf.as_mut_ptr() as *mut _),
                (buf.len() * 2) as u32,
                Some(&mut needed),
            );
            if ok.is_err() {
                return Err(TargetError::NonDefaultDesktop);
            }
            let len = (0..buf.len()).position(|i| buf[i] == 0).unwrap_or(buf.len());
            let name = String::from_utf16_lossy(&buf[..len]);
            let lower = name.to_ascii_lowercase();
            if lower == "winlogon" || lower == "screen-saver" || lower == "disconnect" {
                return Err(TargetError::NonDefaultDesktop);
            }
            // Allow standard interactive "default" or runner/sandbox interactive desktops (e.g. "exebox-...")
            if lower != "default" && !lower.starts_with("exebox") {
                return Err(TargetError::NonDefaultDesktop);
            }
            Ok(())
        }
    }

    fn get_token_elevation(token: HANDLE) -> Result<bool, TargetError> {
        unsafe {
            let mut elevation = TOKEN_ELEVATION::default();
            let mut return_length = 0u32;
            GetTokenInformation(
                token,
                TokenElevation,
                Some(&mut elevation as *mut _ as *mut _),
                std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                &mut return_length,
            )
            .map_err(|_| TargetError::IntegrityCheckFailed)?;
            Ok(elevation.TokenIsElevated != 0)
        }
    }

    fn get_token_integrity_level(token: HANDLE) -> Result<u32, TargetError> {
        unsafe {
            let mut buf = [0u8; 256];
            let mut return_length = 0u32;
            GetTokenInformation(
                token,
                TokenIntegrityLevel,
                Some(buf.as_mut_ptr() as *mut _),
                buf.len() as u32,
                &mut return_length,
            )
            .map_err(|_| TargetError::IntegrityCheckFailed)?;

            let label = &*(buf.as_ptr() as *const TOKEN_MANDATORY_LABEL);
            let sid = label.Label.Sid;
            if sid.0.is_null() {
                return Err(TargetError::IntegrityCheckFailed);
            }
            // Subauthority count is at byte 1 of SID
            let sub_auth_count = *(sid.0.offset(1) as *const u8);
            if sub_auth_count == 0 {
                return Err(TargetError::IntegrityCheckFailed);
            }
            // Last subauthority holds the integrity RID
            let sub_auth_ptr = (sid.0.offset(8) as *const u32).offset(sub_auth_count as isize - 1);
            Ok(*sub_auth_ptr)
        }
    }

    pub fn check_security(target_pid: u32) -> Result<(), TargetError> {
        check_desktop()?;

        unsafe {
            let mut helper_token = HANDLE::default();
            OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut helper_token)
                .map_err(|_| TargetError::UnreadableState)?;

            let helper_elevated = get_token_elevation(helper_token);
            let helper_integrity = get_token_integrity_level(helper_token);
            let _ = CloseHandle(helper_token);

            // Refuse if helper itself is elevated
            if helper_elevated? {
                return Err(TargetError::Elevated);
            }
            let helper_il = helper_integrity?;

            let target_proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, target_pid)
                .map_err(|_| TargetError::ProcessNotFound)?;

            let mut target_token = HANDLE::default();
            let open_tok_res = OpenProcessToken(target_proc, TOKEN_QUERY, &mut target_token);
            let _ = CloseHandle(target_proc);

            if open_tok_res.is_err() {
                // If cannot open target token with query limited, it is typically higher integrity
                return Err(TargetError::IntegrityHigherThanHelper);
            }

            let target_elevated = get_token_elevation(target_token);
            let target_integrity = get_token_integrity_level(target_token);
            let _ = CloseHandle(target_token);

            if target_elevated? {
                return Err(TargetError::Elevated);
            }

            let target_il = target_integrity?;
            if target_il > helper_il {
                return Err(TargetError::IntegrityHigherThanHelper);
            }

            Ok(())
        }
    }

    pub fn verify_element_ancestry(
        automation: &IUIAutomation,
        element: &IUIAutomationElement,
        expected_root: &IUIAutomationElement,
    ) -> Result<(), TargetError> {
        unsafe {
            let walker = match automation.RawViewWalker() {
                Ok(w) => w,
                Err(_) => return Err(TargetError::Changed),
            };

            let mut current = element.clone();
            loop {
                if automation.CompareElements(&current, expected_root).map(|b| b.as_bool()).unwrap_or(false) {
                    return Ok(());
                }

                match walker.GetParentElement(&current) {
                    Ok(parent) => current = parent,
                    Err(_) => return Err(TargetError::Changed),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn changed_process_instance_refuses_before_pattern_dispatch() {
        let expected = WindowInstance::fixture("42", 7, "100");
        let actual = WindowInstance::fixture("42", 7, "200");
        assert_eq!(require_same_instance(&expected, &actual), Err(TargetError::Changed));
    }

    #[test]
    fn same_process_instance_succeeds() {
        let expected = WindowInstance::fixture("42", 7, "100");
        let actual = WindowInstance::fixture("42", 7, "100");
        assert_eq!(require_same_instance(&expected, &actual), Ok(()));
    }

    #[test]
    fn changed_pid_or_window_id_refuses() {
        let expected = WindowInstance::fixture("42", 7, "100");
        let diff_pid = WindowInstance::fixture("42", 8, "100");
        let diff_win = WindowInstance::fixture("43", 7, "100");
        assert_eq!(require_same_instance(&expected, &diff_pid), Err(TargetError::Changed));
        assert_eq!(require_same_instance(&expected, &diff_win), Err(TargetError::Changed));
    }

    #[test]
    fn test_check_desktop() {
        let res = native::check_desktop();
        println!("check_desktop result: {:?}", res);
    }
}
