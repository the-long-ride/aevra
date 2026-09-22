//! Shared semantic accessibility backend for macOS (AX) and Linux (AT-SPI2).
//! Host input synthesis is intentionally absent: shared control uses provider actions only.

use crate::backend::{
    ActRequest, BackgroundActRequest, BackgroundActResult, Capabilities, CaptureRequest,
    CaptureResult, DescribeBackgroundRequest, DescribeBackgroundResult, DescribeNode,
    DescribeRequest, DescribeResult, DesktopBackend, ReleaseBackgroundSnapshotRequest,
    ScreenState, TargetIdentityRequest, TargetIdentityResult, WindowIdentity,
};
use crate::target_guard::WindowInstance;
use std::cell::RefCell;
use std::collections::{HashMap, VecDeque};
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use sysinfo::{Pid, System};
use xa11y::{App, Element, Error as A11yError, Provider, Role, Toggled};

struct PortableSnapshot {
    instance: WindowInstance,
    elements: HashMap<String, Element>,
}

pub struct PortableBackend {
    provider: Result<Arc<dyn Provider>, String>,
    snapshots: RefCell<HashMap<String, PortableSnapshot>>,
    next_handle: RefCell<u64>,
}

impl PortableBackend {
    pub fn new() -> Self {
        Self {
            provider: xa11y::provider().map_err(map_provider_error),
            snapshots: RefCell::new(HashMap::new()),
            next_handle: RefCell::new(1),
        }
    }

    fn provider(&self) -> Result<Arc<dyn Provider>, String> {
        self.provider.clone()
    }

    fn next_handle(&self) -> String {
        let mut next = self.next_handle.borrow_mut();
        let value = *next;
        *next += 1;
        format!("portable_{value}")
    }

    fn apps(&self) -> Result<Vec<App>, String> {
        App::list_with(self.provider()?).map_err(map_a11y)
    }

    fn windows_elements(&self) -> Result<Vec<Element>, String> {
        let mut windows = Vec::new();
        for app in self.apps()? {
            windows.extend(app.windows().map_err(map_a11y)?);
        }
        Ok(windows)
    }

    fn resolve_window(&self, window_id: &str) -> Result<Element, String> {
        self.windows_elements()?
            .into_iter()
            .find(|window| window_id_for(window) == window_id)
            .ok_or_else(|| {
                format!("DESKTOP_TARGET_CHANGED: window {window_id:?} no longer exists")
            })
    }

    fn focused_window_element(&self) -> Result<Element, String> {
        let provider = self.provider()?;
        let app_data = provider.focused_app().map_err(map_a11y)?;
        let app = App::from_data(Arc::clone(&provider), app_data);
        let windows = app.windows().map_err(map_a11y)?;
        let mut active = windows.iter().filter(|window| window.states.active);
        if let Some(window) = active.next() {
            if active.next().is_none() {
                return Ok(window.clone());
            }
        }
        if windows.len() == 1 {
            return Ok(windows[0].clone());
        }
        Err("DESKTOP_TARGET_CHANGED: focused application has no unique active window".into())
    }

    fn process_instance(&self, window: &Element) -> Result<WindowInstance, String> {
        let pid = window
            .pid
            .ok_or_else(|| "DESKTOP_INPUT_REFUSED: target process is unattributable".to_string())?;
        let system = System::new_all();
        let process = system
            .process(Pid::from_u32(pid))
            .ok_or_else(|| "DESKTOP_TARGET_CHANGED: target process exited".to_string())?;
        Ok(WindowInstance::new(
            window_id_for(window),
            pid,
            process.start_time().to_string(),
        ))
    }

    fn identity(&self, window: &Element) -> WindowIdentity {
        let mut process_name = None;
        let mut executable_path = None;
        if let Some(pid) = window.pid {
            let system = System::new_all();
            if let Some(process) = system.process(Pid::from_u32(pid)) {
                let name = process.name().to_string_lossy().to_string();
                if !name.is_empty() {
                    process_name = Some(name);
                }
                executable_path = process
                    .exe()
                    .filter(|path| !path.as_os_str().is_empty())
                    .map(|path| path.to_string_lossy().to_string());
            }
        }
        WindowIdentity {
            window_id: window_id_for(window),
            process_name,
            executable_path,
            title: window.name.clone(),
        }
    }

    fn describe_window(
        &self,
        window: &Element,
        max_nodes: usize,
        interactive_only: bool,
    ) -> Result<(Vec<DescribeNode>, HashMap<String, Element>, bool), String> {
        let limit = max_nodes.max(1);
        let mut nodes = Vec::new();
        let mut elements = HashMap::new();
        let mut queue = VecDeque::from([window.clone()]);
        let mut visited = 0usize;

        while let Some(element) = queue.pop_front() {
            visited += 1;
            let children = element.children().map_err(map_a11y)?;
            queue.extend(children);
            let supported = supported_actions(&element);
            if interactive_only && supported.is_empty() {
                continue;
            }
            if nodes.len() >= limit {
                return Ok((nodes, elements, true));
            }
            let handle = self.next_handle();
            let protected = protected_field(&element);
            let value = if protected { None } else { element.value.clone() };
            let read_only = matches!(element.role, Role::TextField | Role::TextArea)
                .then_some(!element.states.editable);
            let toggle_state = element.states.checked.map(toggle_name);
            nodes.push(DescribeNode {
                handle: handle.clone(),
                role: element.role.to_snake_case().to_string(),
                name: element.name.clone().unwrap_or_default(),
                value,
                enabled: element.states.enabled,
                focused: element.states.focused,
                supported_actions: Some(supported),
                read_only,
                toggle_state,
            });
            elements.insert(handle, element);
        }

        Ok((nodes, elements, visited > limit))
    }

    fn verify_instance(&self, expected: &WindowInstance) -> Result<Element, String> {
        let window = self.resolve_window(&expected.window_id)?;
        let actual = self.process_instance(&window)?;
        if &actual != expected {
            return Err("DESKTOP_TARGET_CHANGED: target process instance changed".into());
        }
        Ok(window)
    }
}

impl DesktopBackend for PortableBackend {
    fn connect(&self) -> Result<Capabilities, String> {
        self.provider()?;
        Ok(Capabilities {
            capture: false,
            tree: true,
            attribution: true,
            input: false,
            background_actions: Some(true),
        })
    }

    fn windows(&self) -> Result<Vec<WindowIdentity>, String> {
        Ok(self
            .windows_elements()?
            .iter()
            .map(|window| self.identity(window))
            .collect())
    }

    fn focused_window(&self) -> Result<WindowIdentity, String> {
        Ok(self.identity(&self.focused_window_element()?))
    }

    fn screen_state(&self) -> Result<ScreenState, String> {
        let window = self.focused_window()?;
        let window_ids: Vec<String> = self.windows()?.into_iter().map(|entry| entry.window_id).collect();
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        window.window_id.hash(&mut hasher);
        window.process_name.hash(&mut hasher);
        window.executable_path.hash(&mut hasher);
        window_ids.hash(&mut hasher);
        Ok(ScreenState {
            window,
            window_ids,
            signature: format!("{:x}", hasher.finish()),
        })
    }

    fn describe(&self, request: DescribeRequest) -> Result<DescribeResult, String> {
        let window = match request.window_id.as_deref() {
            Some(window_id) => self.resolve_window(window_id)?,
            None => self.focused_window_element()?,
        };
        let (nodes, _, truncated) =
            self.describe_window(&window, request.max_nodes, request.interactive_only)?;
        Ok(DescribeResult {
            window: self.identity(&window),
            nodes,
            truncated,
            snapshot_id: None,
            window_lease_id: None,
            lease_expires_at: None,
        })
    }

    fn capture(&self, _request: CaptureRequest) -> Result<CaptureResult, String> {
        Err("DESKTOP_CAPTURE_UNSUPPORTED: portable shared-semantic backend does not capture pixels".into())
    }

    fn act(&self, _request: ActRequest) -> Result<bool, String> {
        Err(
            "DESKTOP_INPUT_REFUSED: macOS/Linux shared control requires semantic background actions; host input synthesis is disabled"
                .into(),
        )
    }

    fn target_identity(&self, request: TargetIdentityRequest) -> Result<TargetIdentityResult, String> {
        let window = self.resolve_window(&request.window_id)?;
        Ok(TargetIdentityResult {
            window: self.identity(&window),
            window_instance: self.process_instance(&window)?,
        })
    }

    fn describe_background(
        &self,
        request: DescribeBackgroundRequest,
    ) -> Result<DescribeBackgroundResult, String> {
        let window = self.resolve_window(&request.window_id)?;
        let instance = self.process_instance(&window)?;
        let (nodes, elements, truncated) =
            self.describe_window(&window, request.max_nodes, request.interactive_only)?;
        self.snapshots.borrow_mut().insert(
            request.snapshot_id,
            PortableSnapshot {
                instance: instance.clone(),
                elements,
            },
        );
        Ok(DescribeBackgroundResult {
            window: self.identity(&window),
            window_instance: instance,
            nodes,
            truncated,
        })
    }

    fn release_background_snapshot(
        &self,
        request: ReleaseBackgroundSnapshotRequest,
    ) -> Result<bool, String> {
        Ok(self.snapshots.borrow_mut().remove(&request.snapshot_id).is_some())
    }

    fn background_act(&self, request: BackgroundActRequest) -> Result<BackgroundActResult, String> {
        self.verify_instance(&request.expected_instance)?;
        let before_focus = self.focused_window_element().map(|window| window_id_for(&window))?;
        let snapshots = self.snapshots.borrow();
        let snapshot = snapshots
            .get(&request.snapshot_id)
            .ok_or_else(|| "DESKTOP_REF_STALE: background snapshot expired".to_string())?;
        if snapshot.instance != request.expected_instance {
            return Err("DESKTOP_TARGET_CHANGED: snapshot belongs to an older process instance".into());
        }
        let element = snapshot
            .elements
            .get(&request.handle)
            .ok_or_else(|| "DESKTOP_REF_STALE: element handle is not in the snapshot".to_string())?;
        if !element.states.enabled {
            return Err("DESKTOP_ELEMENT_DISABLED: element is disabled".into());
        }
        if request.op == "setValue" && protected_field(element) {
            return Err("DESKTOP_INPUT_REFUSED: refusing value mutation on protected text".into());
        }

        match request.op.as_str() {
            "invoke" => element.press().map_err(map_a11y)?,
            "setValue" => element
                .set_value(request.value.as_deref().ok_or_else(|| {
                    "DESKTOP_PATTERN_UNSUPPORTED: setValue requires a value".to_string()
                })?)
                .map_err(map_a11y)?,
            "select" => element.select().map_err(map_a11y)?,
            "toggle" => element.toggle().map_err(map_a11y)?,
            other => {
                return Err(format!(
                    "DESKTOP_PATTERN_UNSUPPORTED: unsupported semantic action {other}"
                ))
            }
        }

        let after_focus = self.focused_window_element().map_err(|error| {
            format!(
                "DESKTOP_OUTCOME_UNKNOWN: semantic action completed but focus could not be revalidated: {error}"
            )
        })?;
        Ok(BackgroundActResult {
            ok: true,
            outcome: "completed".into(),
            focus_changed: before_focus != window_id_for(&after_focus),
            // Element state here is snapshot data from before dispatch. Returning
            // it as the new state would be a false postcondition; the executor
            // performs a fresh scoped observation instead.
            toggle_state: None,
        })
    }
}

fn supported_actions(element: &Element) -> Vec<String> {
    let mut actions = Vec::new();
    if element.actions.iter().any(|action| action == "press" || action == "click") {
        actions.push("invoke".into());
    }
    if element.states.editable && !protected_field(element) {
        actions.push("setValue".into());
    }
    if element.actions.iter().any(|action| action == "select") {
        actions.push("select".into());
    }
    if element.actions.iter().any(|action| action == "toggle") || element.states.checked.is_some() {
        actions.push("toggle".into());
    }
    actions
}

fn protected_field(element: &Element) -> bool {
    element.raw.iter().any(|(key, value)| {
        let key = key.to_ascii_lowercase();
        let value = value.as_str().unwrap_or_default().to_ascii_lowercase();
        (key == "ax_role" && value == "axsecuretextfield")
            || (key == "atspi_role" && value.contains("password"))
            || key.contains("password")
            || key.contains("protected")
    })
}

fn toggle_name(state: Toggled) -> String {
    match state {
        Toggled::Off => "off",
        Toggled::On => "on",
        Toggled::Mixed => "indeterminate",
    }
    .into()
}

fn window_id_for(window: &Element) -> String {
    let pid = window.pid.unwrap_or(0);
    match window.stable_id.as_deref() {
        Some(stable) if !stable.is_empty() => format!("{pid}:stable:{stable}"),
        _ => format!("{pid}:handle:{}", window.handle),
    }
}

fn map_provider_error(error: A11yError) -> String {
    match error {
        A11yError::PermissionDenied { instructions } => {
            format!("DESKTOP_PERMISSION_REQUIRED: {instructions}")
        }
        other => map_a11y(other),
    }
}

fn map_a11y(error: A11yError) -> String {
    match error {
        A11yError::PermissionDenied { instructions } => {
            format!("DESKTOP_PERMISSION_REQUIRED: {instructions}")
        }
        A11yError::AccessibilityNotEnabled { app, instructions } => {
            format!("DESKTOP_PROVIDER_UNAVAILABLE: accessibility is disabled for {app}: {instructions}")
        }
        A11yError::ElementStale { .. } | A11yError::SelectorNotMatched { .. } => {
            format!("DESKTOP_REF_STALE: {error}")
        }
        A11yError::ActionNotSupported { .. } | A11yError::TextValueNotSupported => {
            format!("DESKTOP_PATTERN_UNSUPPORTED: {error}")
        }
        A11yError::Unsupported { .. } => format!("DESKTOP_BACKGROUND_UNSUPPORTED: {error}"),
        other => format!("DESKTOP_PROVIDER_UNAVAILABLE: {other}"),
    }
}
