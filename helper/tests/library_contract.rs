//! Both hosts consume this library; the executable only owns stdio transport.
use aevra_desktop_helper::{
    backend::{CaptureRequest, DescribeRequest, DesktopBackend},
    new_native_backend,
};
#[test]
fn library_exposes_native_backend_and_authorized_read_wire_contract() {
    let capture: CaptureRequest =
        serde_json::from_value(serde_json::json!({"windowId":"7"})).unwrap();
    assert!(capture.expected_target.is_none());
    let describe: DescribeRequest = serde_json::from_value(
        serde_json::json!({"windowId":"7","maxNodes":1,"interactiveOnly":false}),
    )
    .unwrap();
    assert!(describe.expected_target.is_none());
    let _factory = new_native_backend;
    fn accepts_backend(_: &dyn DesktopBackend) {}
    let _ = accepts_backend;
}
