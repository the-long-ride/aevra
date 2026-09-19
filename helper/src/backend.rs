//! The `DesktopBackend` trait and the shared, serde-serialisable shapes it
//! returns. Field names are renamed to the camelCase the TypeScript side
//! (`packages/protocol/src/desktop.ts`) expects.

use serde::{Deserialize, Serialize};

/// What the security gate judges (`packages/security/src/window-gate.ts`).
///
/// THE RULE THAT MATTERS: `process_name` and `executable_path` are `None`,
/// never a placeholder, whenever the OS would not hand back a real
/// executable path -- which is the normal case for a window on the secure
/// desktop (a UAC consent prompt) or an elevated process this helper cannot
/// query. `evaluateWindowGate` treats a window with neither field present as
/// unattributable and refuses input to it; substituting the window class or
/// the title here would make every window look attributable and silently
/// defeat that gate. A title is never a substitute for attribution -- titles
/// are attacker-influenceable -- which is why it stays a separate, optional
/// field.
#[derive(Debug, Clone, Serialize)]
pub struct WindowIdentity {
    #[serde(rename = "windowId")]
    pub window_id: String,
    #[serde(rename = "processName", skip_serializing_if = "Option::is_none")]
    pub process_name: Option<String>,
    #[serde(rename = "executablePath", skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

/// Reported once at `connect`. `tree` flipped to `true` in 9b and `input` in
/// 9c, each only once the corresponding method genuinely worked end to end --
/// a capability record that claims something the binary cannot actually do
/// would defeat the entire purpose of this record, which is that a host can
/// trust what it says. `capture` flipped in 9d, once `capture` really returned pixels.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct Capabilities {
    pub capture: bool,
    pub tree: bool,
    pub attribution: bool,
    pub input: bool,
    #[serde(rename = "backgroundActions", skip_serializing_if = "Option::is_none")]
    pub background_actions: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScreenState {
    pub window: WindowIdentity,
    #[serde(rename = "windowIds")]
    pub window_ids: Vec<String>,
    pub signature: String,
}

/// Wire shape of one accessibility-tree node. `handle` (NOT `ref`) is the
/// helper-owned opaque string the TypeScript driver maps to its own
/// generation-tagged `ref_<generation>_<index>` -- see `helper/src/handles.rs`
/// for the handle representation decision and its stale-handle behaviour.
#[derive(Debug, Clone, Serialize)]
pub struct DescribeNode {
    pub handle: String,
    pub role: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    pub enabled: bool,
    pub focused: bool,
    #[serde(rename = "supportedActions", skip_serializing_if = "Option::is_none")]
    pub supported_actions: Option<Vec<String>>,
    #[serde(rename = "readOnly", skip_serializing_if = "Option::is_none")]
    pub read_only: Option<bool>,
    #[serde(rename = "toggleState", skip_serializing_if = "Option::is_none")]
    pub toggle_state: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DescribeResult {
    pub window: WindowIdentity,
    pub nodes: Vec<DescribeNode>,
    pub truncated: bool,
    #[serde(rename = "snapshotId", skip_serializing_if = "Option::is_none")]
    pub snapshot_id: Option<String>,
    #[serde(rename = "windowLeaseId", skip_serializing_if = "Option::is_none")]
    pub window_lease_id: Option<String>,
    #[serde(rename = "leaseExpiresAt", skip_serializing_if = "Option::is_none")]
    pub lease_expires_at: Option<String>,
}

/// `windowId` absent means "the focused window"; `maxNodes` and
/// `interactiveOnly` are always sent by `WindowsDesktopDriver.describe`
/// (`packages/desktop/src/driver.ts`'s `DescribeRequest` has them
/// non-optional), so they are required fields here too -- a missing one is a
/// protocol-level error, not a silently-assumed default.
#[derive(Debug, Clone, Deserialize)]
pub struct DescribeRequest {
    #[serde(rename = "windowId")]
    pub window_id: Option<String>,
    #[serde(rename = "maxNodes")]
    pub max_nodes: usize,
    #[serde(rename = "interactiveOnly")]
    pub interactive_only: bool,
    #[serde(default)]
    #[allow(dead_code)]
    pub mode: Option<String>,
}

/// `windowId` absent means "the primary monitor" -- NOT the focused window,
/// unlike `describe`. The reason is coordinate mapping: `DesktopCaptureResult`
/// carries an image and a `devicePixelRatio` but no origin, so the only
/// capture whose pixels a caller can turn back into clickable coordinates is
/// one whose origin is the origin of the coordinate space `act` clicks in --
/// the primary monitor's top-left. A window capture is still useful to look
/// at; it is just not coordinate-mappable, and the user manual says so.
#[derive(Debug, Clone, Deserialize)]
pub struct CaptureRequest {
    #[serde(rename = "windowId")]
    pub window_id: Option<String>,
}

/// `device_pixel_ratio` is returned-image pixels per screen coordinate:
/// `clickX = imageX / devicePixelRatio`. It is derived from the image that
/// was actually produced, never from the requested size cap.
///
/// `window` is `None` for a primary-monitor capture, which is not one
/// window's pixels and must not be labelled with one window's identity --
/// the MCP tool layer audits `window` as the capture's target, and naming a
/// single application there would be a false audit record.
#[derive(Debug, Clone, Serialize)]
pub struct CaptureResult {
    #[serde(rename = "imageDataUri")]
    pub image_data_uri: String,
    #[serde(rename = "devicePixelRatio")]
    pub device_pixel_ratio: f64,
    pub window: Option<WindowIdentity>,
}

/// What `WindowsDesktopDriver.act` sends. It has already resolved its own
/// `ref_<generation>_<index>` to the `handle` this helper minted, and has
/// already refused a ref whose generation is stale -- so a `handle` arriving
/// here is one the driver believes is live. This helper checks it again
/// anyway (see `handles.rs`): the driver's generation and the helper's are
/// separate counters, and only the helper's says whether the element is
/// still in the table.
///
/// The driver also forwards its `ref` field, which serde ignores here. `ref`
/// is a Rust keyword and the helper has no use for it -- the handle is the
/// only thing that names an element.
#[derive(Debug, Clone, Deserialize)]
pub struct ActRequest {
    pub op: String,
    pub handle: Option<String>,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub text: Option<String>,
    pub keys: Option<String>,
    #[serde(rename = "deltaY")]
    pub delta_y: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TargetIdentityRequest {
    #[serde(rename = "windowId")]
    pub window_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TargetIdentityResult {
    pub window: WindowIdentity,
    #[serde(rename = "windowInstance")]
    pub window_instance: crate::target_guard::WindowInstance,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DescribeBackgroundRequest {
    #[serde(rename = "windowId")]
    pub window_id: String,
    #[serde(rename = "snapshotId")]
    pub snapshot_id: String,
    #[serde(rename = "maxNodes")]
    pub max_nodes: usize,
    #[serde(rename = "interactiveOnly")]
    pub interactive_only: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct DescribeBackgroundResult {
    pub window: WindowIdentity,
    #[serde(rename = "windowInstance")]
    pub window_instance: crate::target_guard::WindowInstance,
    pub nodes: Vec<DescribeNode>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ReleaseBackgroundSnapshotRequest {
    #[serde(rename = "snapshotId")]
    pub snapshot_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BackgroundActRequest {
    #[serde(rename = "snapshotId")]
    pub snapshot_id: String,
    pub handle: String,
    pub op: String,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(rename = "expectedInstance")]
    pub expected_instance: crate::target_guard::WindowInstance,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackgroundActResult {
    pub ok: bool,
    pub outcome: String,
    #[serde(rename = "focusChanged")]
    pub focus_changed: bool,
    #[serde(rename = "toggleState", skip_serializing_if = "Option::is_none")]
    pub toggle_state: Option<String>,
}

pub trait DesktopBackend {
    fn connect(&self) -> Capabilities;
    fn windows(&self) -> Vec<WindowIdentity>;
    fn focused_window(&self) -> WindowIdentity;
    fn screen_state(&self) -> ScreenState;
    /// `Err` is a plain message suitable for a protocol-level error reply --
    /// used for a `windowId` that no longer exists (an error, per the brief,
    /// never an empty tree) and for a COM failure reading the root element
    /// itself. A failure reading one element DEEPER in the tree is instead
    /// handled inside the walk (skip that element, keep going); only a
    /// failure that prevents the walk from starting at all surfaces here.
    fn describe(&self, request: DescribeRequest) -> Result<DescribeResult, String>;
    /// `Err` covers every reason the input did not happen: a stale or
    /// unknown handle, an element that has moved off screen, a window that
    /// is no longer foreground, a malformed key chord, and -- importantly --
    /// an injection the OS refused because the target belongs to a more
    /// privileged process. `Ok(true)` means the events were accepted by the
    /// OS. Reporting success for input that never landed would put clicks in
    /// the audit log that never happened, which is worse than having no
    /// `act` at all.
    fn act(&self, request: ActRequest) -> Result<bool, String>;
    /// `Err` covers a `windowId` that no longer exists, a window whose
    /// rectangle is empty (minimised), and any GDI failure. It never returns
    /// a blank image in place of a failure: a black rectangle presented as a
    /// successful screenshot would have the model reasoning confidently
    /// about a screen it never saw.
    fn capture(&self, request: CaptureRequest) -> Result<CaptureResult, String>;

    fn target_identity(&self, _request: TargetIdentityRequest) -> Result<TargetIdentityResult, String> {
        Err("DESKTOP_BACKGROUND_UNSUPPORTED: Background desktop actions not supported".into())
    }
    fn describe_background(&self, _request: DescribeBackgroundRequest) -> Result<DescribeBackgroundResult, String> {
        Err("DESKTOP_BACKGROUND_UNSUPPORTED: Background desktop actions not supported".into())
    }
    fn release_background_snapshot(&self, _request: ReleaseBackgroundSnapshotRequest) -> Result<bool, String> {
        Err("DESKTOP_BACKGROUND_UNSUPPORTED: Background desktop actions not supported".into())
    }
    fn background_act(&self, _request: BackgroundActRequest) -> Result<BackgroundActResult, String> {
        Err("DESKTOP_BACKGROUND_UNSUPPORTED: Background desktop actions not supported".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unattributable_window_serialises_without_a_placeholder() {
        let identity = WindowIdentity {
            window_id: "12345".to_string(),
            process_name: None,
            executable_path: None,
            title: Some("User Account Control".to_string()),
        };
        let value = serde_json::to_value(&identity).unwrap();
        assert_eq!(value["windowId"], "12345");
        assert!(value.get("processName").is_none(), "processName must be absent, not a placeholder");
        assert!(value.get("executablePath").is_none(), "executablePath must be absent, not a placeholder");
        assert_eq!(value["title"], "User Account Control");
    }

    #[test]
    fn window_with_no_title_serialises_title_as_absent() {
        let identity = WindowIdentity {
            window_id: "1".to_string(),
            process_name: Some("notepad.exe".to_string()),
            executable_path: Some("C:\\Windows\\notepad.exe".to_string()),
            title: None,
        };
        let value = serde_json::to_value(&identity).unwrap();
        assert!(value.get("title").is_none());
    }

    #[test]
    fn capabilities_report_every_capability_true_once_9d_lands() {
        let capabilities = Capabilities { capture: true, tree: true, attribution: true, input: true, background_actions: None };
        let value = serde_json::to_value(capabilities).unwrap();
        assert_eq!(value["capture"], true);
        assert_eq!(value["tree"], true);
        assert_eq!(value["attribution"], true);
        assert_eq!(value["input"], true);
    }

    #[test]
    fn describe_node_omits_absent_value_rather_than_serialising_null() {
        let node = DescribeNode {
            handle: "1:0".to_string(),
            role: "button".to_string(),
            name: "OK".to_string(),
            value: None,
            enabled: true,
            focused: false,
            supported_actions: None,
            read_only: None,
            toggle_state: None,
        };
        let value = serde_json::to_value(&node).unwrap();
        assert!(value.get("value").is_none());
        assert_eq!(value["handle"], "1:0");
    }

    #[test]
    fn describe_request_deserialises_camel_case_wire_fields() {
        let request: DescribeRequest =
            serde_json::from_value(serde_json::json!({ "maxNodes": 50, "interactiveOnly": true }))
                .unwrap();
        assert_eq!(request.window_id, None);
        assert_eq!(request.max_nodes, 50);
        assert!(request.interactive_only);
    }

    #[test]
    fn describe_request_accepts_an_explicit_window_id() {
        let request: DescribeRequest = serde_json::from_value(serde_json::json!({
            "windowId": "12345",
            "maxNodes": 10,
            "interactiveOnly": false
        }))
        .unwrap();
        assert_eq!(request.window_id.as_deref(), Some("12345"));
    }

    #[test]
    fn act_request_deserialises_what_the_driver_actually_sends() {
        // Exactly the shape `WindowsDesktopDriver.act` puts on the wire,
        // including the `ref` field the helper has no use for.
        let request: ActRequest = serde_json::from_value(serde_json::json!({
            "op": "click",
            "ref": "ref_3_1",
            "handle": "7:2"
        }))
        .unwrap();
        assert_eq!(request.op, "click");
        assert_eq!(request.handle.as_deref(), Some("7:2"));
        assert_eq!(request.x, None);
    }

    #[test]
    fn capture_request_treats_an_absent_window_id_as_the_primary_monitor() {
        // What `WindowsDesktopDriver.capture()` puts on the wire when called
        // with no argument: `{ "windowId": undefined }` serialises to `{}`.
        let request: CaptureRequest = serde_json::from_value(serde_json::json!({})).unwrap();
        assert_eq!(request.window_id, None);
        let explicit: CaptureRequest =
            serde_json::from_value(serde_json::json!({ "windowId": "4242" })).unwrap();
        assert_eq!(explicit.window_id.as_deref(), Some("4242"));
    }

    #[test]
    fn capture_result_serialises_the_camel_case_wire_fields_and_a_null_window() {
        let result = CaptureResult {
            image_data_uri: "data:image/jpeg;base64,Zm9v".to_string(),
            device_pixel_ratio: 0.5,
            window: None,
        };
        let value = serde_json::to_value(&result).unwrap();
        assert_eq!(value["imageDataUri"], "data:image/jpeg;base64,Zm9v");
        assert_eq!(value["devicePixelRatio"], 0.5);
        // Explicitly null, not absent: the TypeScript side reads
        // `value.window ? ... : null` and a primary-monitor capture has no
        // single owning window.
        assert!(value["window"].is_null());
    }

    #[test]
    fn act_request_deserialises_a_coordinate_click_and_a_scroll() {
        let click: ActRequest =
            serde_json::from_value(serde_json::json!({ "op": "click", "x": 40, "y": 90 })).unwrap();
        assert_eq!((click.x, click.y), (Some(40), Some(90)));
        let scroll: ActRequest =
            serde_json::from_value(serde_json::json!({ "op": "scroll", "deltaY": -240 })).unwrap();
        assert_eq!(scroll.delta_y, Some(-240));
    }
}
