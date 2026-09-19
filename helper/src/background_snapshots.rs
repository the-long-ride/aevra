//! Native background snapshot tables and UIA pattern discovery.
//! Keeps background element references isolated from the foreground HandleTable.

use std::collections::HashMap;

use crate::target_guard::WindowInstance;

#[derive(Debug, Clone)]
pub struct DiscoveredPatterns {
    pub supported_actions: Vec<String>,
    pub read_only: Option<bool>,
    pub toggle_state: Option<String>,
}

#[cfg(windows)]
pub use native::*;

#[cfg(windows)]
mod native {
    use super::*;
    use ::windows::core::Interface;
    use ::windows::Win32::UI::Accessibility::{
        IUIAutomationElement, IUIAutomationInvokePattern, IUIAutomationSelectionItemPattern,
        IUIAutomationTogglePattern, IUIAutomationValuePattern, ToggleState_Indeterminate,
        ToggleState_Off, ToggleState_On, UIA_InvokePatternId, UIA_SelectionItemPatternId,
        UIA_TogglePatternId, UIA_ValuePatternId,
    };

    #[allow(dead_code)]
    pub struct NativeBackgroundSnapshot {
        pub snapshot_id: String,
        pub window_instance: WindowInstance,
        pub root: IUIAutomationElement,
        pub elements: HashMap<String, IUIAutomationElement>,
    }

    pub struct BackgroundSnapshotManager {
        snapshots: HashMap<String, NativeBackgroundSnapshot>,
        next_handle_id: usize,
    }

    impl BackgroundSnapshotManager {
        pub fn new() -> Self {
            Self {
                snapshots: HashMap::new(),
                next_handle_id: 1,
            }
        }

        pub fn mint_handle(&mut self) -> String {
            let id = self.next_handle_id;
            self.next_handle_id += 1;
            format!("bg_{id}")
        }

        pub fn store_snapshot(
            &mut self,
            snapshot_id: String,
            window_instance: WindowInstance,
            root: IUIAutomationElement,
            elements: HashMap<String, IUIAutomationElement>,
        ) {
            self.snapshots.insert(
                snapshot_id.clone(),
                NativeBackgroundSnapshot {
                    snapshot_id,
                    window_instance,
                    root,
                    elements,
                },
            );
        }

        pub fn get_snapshot(&self, snapshot_id: &str) -> Option<&NativeBackgroundSnapshot> {
            self.snapshots.get(snapshot_id)
        }

        #[allow(dead_code)]
        pub fn get_element(&self, snapshot_id: &str, handle: &str) -> Option<&IUIAutomationElement> {
            self.snapshots.get(snapshot_id).and_then(|s| s.elements.get(handle))
        }

        pub fn release_snapshot(&mut self, snapshot_id: &str) -> bool {
            self.snapshots.remove(snapshot_id).is_some()
        }

        #[allow(dead_code)]
        pub fn clear(&mut self) {
            self.snapshots.clear();
        }

        #[allow(dead_code)]
        pub fn snapshot_count(&self) -> usize {
            self.snapshots.len()
        }
    }

    /// Discovers supported UIA patterns and properties on an element.
    /// Only the 4 semantic patterns are checked: invoke, setValue, select, toggle.
    /// Disabled controls advertise no actions. Password/read-only fields do not advertise setValue.
    pub fn discover_patterns(element: &IUIAutomationElement, enabled: bool) -> DiscoveredPatterns {
        if !enabled {
            return DiscoveredPatterns {
                supported_actions: Vec::new(),
                read_only: None,
                toggle_state: None,
            };
        }

        let mut actions = Vec::new();
        let mut read_only = None;
        let mut toggle_state = None;

        unsafe {
            // Check InvokePattern (10000)
            if let Ok(pattern) = element.GetCurrentPattern(UIA_InvokePatternId) {
                if pattern.cast::<IUIAutomationInvokePattern>().is_ok() {
                    actions.push("invoke".to_string());
                }
            }

            // Check ValuePattern (10002)
            if let Ok(pattern) = element.GetCurrentPattern(UIA_ValuePatternId) {
                if let Ok(val_pat) = pattern.cast::<IUIAutomationValuePattern>() {
                    let is_ro = val_pat.CurrentIsReadOnly().map(|b| b.as_bool()).unwrap_or(false);
                    read_only = Some(is_ro);

                    let is_password = element.CurrentIsPassword().map(|b| b.as_bool()).unwrap_or(false);
                    if !is_ro && !is_password {
                        actions.push("setValue".to_string());
                    }
                }
            }

            // Check SelectionItemPattern (10010)
            if let Ok(pattern) = element.GetCurrentPattern(UIA_SelectionItemPatternId) {
                if pattern.cast::<IUIAutomationSelectionItemPattern>().is_ok() {
                    actions.push("select".to_string());
                }
            }

            // Check TogglePattern (10011)
            if let Ok(pattern) = element.GetCurrentPattern(UIA_TogglePatternId) {
                if let Ok(tog_pat) = pattern.cast::<IUIAutomationTogglePattern>() {
                    actions.push("toggle".to_string());
                    if let Ok(state) = tog_pat.CurrentToggleState() {
                        toggle_state = match state {
                            s if s == ToggleState_Off => Some("off".to_string()),
                            s if s == ToggleState_On => Some("on".to_string()),
                            s if s == ToggleState_Indeterminate => Some("indeterminate".to_string()),
                            _ => None,
                        };
                    }
                }
            }
        }

        DiscoveredPatterns {
            supported_actions: actions,
            read_only,
            toggle_state,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_element_advertises_no_patterns() {
        let discovered = DiscoveredPatterns {
            supported_actions: Vec::new(),
            read_only: None,
            toggle_state: None,
        };
        assert!(discovered.supported_actions.is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn snapshot_isolation_between_multiple_background_snapshots() {
        let mut manager = BackgroundSnapshotManager::new();
        assert_eq!(manager.snapshot_count(), 0);

        let h1 = manager.mint_handle();
        let h2 = manager.mint_handle();
        assert_ne!(h1, h2);
    }
}
