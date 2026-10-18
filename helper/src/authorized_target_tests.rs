use super::*;
fn target() -> TargetIdentityResult {
    serde_json::from_value(serde_json::json!({
        "window":{"windowId":"1","processName":"editor","executablePath":"/usr/bin/editor"},
        "windowInstance":{"windowId":"1","processId":42,"processStartedAt":"100"}
    }))
    .unwrap()
}

#[test]
fn native_boundary_rejects_missing_or_changed_authorization_before_effects() {
    let expected = target();
    assert!(require_authorized_target(None, &expected)
        .unwrap_err()
        .starts_with("DESKTOP_INPUT_REFUSED"));
    for kind in ["window", "pid", "start", "exe", "host"] {
        let mut actual = expected.clone();
        match kind {
            "window" => {
                actual.window.window_id = "2".into();
                actual.window_instance.window_id = "2".into();
            }
            "pid" => actual.window_instance.process_id += 1,
            "start" => actual.window_instance.process_started_at = "reused PID".into(),
            "exe" => actual.window.executable_path = Some("/usr/bin/blocked".into()),
            "host" => {
                actual.host_application = Some(VerifiedWindowHost {
                    executable_path: "/usr/bin/host".into(),
                    instance: actual.window_instance.clone(),
                })
            }
            _ => unreachable!(),
        }
        assert!(
            require_authorized_target(Some(&expected), &actual)
                .unwrap_err()
                .starts_with("DESKTOP_TARGET_CHANGED"),
            "{kind}"
        );
    }
    let mut actual = expected.clone();
    actual.window.title = Some("mutable presentation".into());
    require_authorized_target(Some(&expected), &actual).unwrap();
    let request: ActRequest = serde_json::from_value(
        serde_json::json!({"op":"key","keys":"ctrl+a","expectedTarget":expected}),
    )
    .unwrap();
    require_authorized_target(request.expected_target.as_ref(), &actual).unwrap();
}
