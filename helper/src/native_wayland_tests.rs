//! Opt-in native Wayland fixture; test runner supplies a private compositor.
use crate::backend::{
    ActRequest, CaptureRequest, DescribeRequest, DesktopBackend, TargetIdentityRequest,
};
use serde_json::json;
use std::time::{Duration, Instant};
#[path = "native_wayland_modal.rs"]
mod modal;
#[path = "native_wayland_teardown.rs"]
mod teardown;
struct Child(std::process::Child);
impl Drop for Child {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
#[ignore = "requires private GNOME/KWin Wayland compositor, test-only companion and GTK fixture"]
fn native_wayland_capture_and_input() {
    assert!(crate::wayland::active(), "native Wayland session required");
    let state =
        std::env::var("AEVRA_WAYLAND_FIXTURE_STATE").expect("set dedicated fixture state path");
    let read =
        || serde_json::from_slice::<serde_json::Value>(&std::fs::read(&state).unwrap()).unwrap();
    let pid = read()["pid"].as_u64().unwrap() as u32;
    let bus = zbus::blocking::Connection::session().unwrap();
    let service =
        std::env::var("AEVRA_WAYLAND_TEST_SERVICE").unwrap_or_else(|_| "org.gnome.Shell".into());
    let control = zbus::blocking::Proxy::new(
        &bus,
        service.as_str(),
        "/org/aevra/Desktop",
        "org.aevra.Desktop1",
    )
    .unwrap();
    let fixture = |value: serde_json::Value| {
        let _: String = control
            .call("Call", &("Fixture", value.to_string()))
            .unwrap();
    };
    let backend = crate::portable::PortableBackend::new();
    assert!(
        !backend.connect().unwrap().input,
        "disabled companion must not advertise input"
    );
    fixture(json!({"op":"allow"}));
    let connected = backend.connect().unwrap();
    assert!(
        connected.input,
        "explicit connect after permission grant: {connected:?}; retry={:?}",
        crate::wayland::reconnect()
    );
    fixture(json!({"op":"move","pid":pid,"x":100,"y":400,"width":400,"height":240}));
    fixture(json!({"op":"focus","pid":pid}));
    let deadline = Instant::now() + Duration::from_secs(8);
    let target = loop {
        let focus = backend.focused_window();
        if let Ok(window) = &focus {
            if window
                .executable_path
                .as_deref()
                .is_some_and(|p| p.contains("python"))
            {
                break window.clone();
            }
        }
        assert!(
            Instant::now() < deadline,
            "native accessible fixture not focused: {focus:?}; native={:?}",
            crate::wayland::windows()
        );
        std::thread::sleep(Duration::from_millis(50));
    };
    let identity = backend
        .target_identity(TargetIdentityRequest {
            window_id: target.window_id.clone(),
        })
        .unwrap();
    let action = |value| {
        let mut request: ActRequest = serde_json::from_value(value).unwrap();
        request.expected_target = Some(identity.clone());
        request
    };
    let describe = || {
        backend
            .describe(DescribeRequest {
                expected_target: None,
                window_id: Some(target.window_id.clone()),
                max_nodes: 100,
                interactive_only: false,
                mode: None,
            })
            .unwrap()
    };
    let tree = describe();
    let notes = tree
        .nodes
        .iter()
        .find(|n| n.name == "Native notes")
        .expect("accessible notes entry");
    let button = tree
        .nodes
        .iter()
        .find(|n| n.name == "Fixture button")
        .expect("native button");
    let clicks = read()["clicks"].as_u64().unwrap();
    backend
        .act(action(json!({"op":"click","handle":button.handle})))
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(4);
    while read()["clicks"].as_u64().unwrap() <= clicks {
        assert!(
            Instant::now() < deadline,
            "native button click missing; pointer={:?}, state={:?}",
            crate::wayland::pointer(),
            read()
        );
        std::thread::sleep(Duration::from_millis(25));
    }
    teardown::verify_button_release(&service, &state);
    modal::verify(&service, pid);
    if service == "org.kde.KWin" {
        fixture(json!({"op":"fractional"}));
    }
    let scrolls = read()["scrolls"].as_u64().unwrap();
    backend
        .act(action(json!({"op":"scroll","deltaY":-120})))
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(4);
    while read()["scrolls"].as_u64().unwrap() <= scrolls {
        assert!(Instant::now() < deadline, "native wheel input missing");
        std::thread::sleep(Duration::from_millis(25));
    }
    backend
        .act(action(json!({"op":"click","handle":notes.handle})))
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(4);
    loop {
        if describe()
            .nodes
            .iter()
            .any(|n| n.name == "Native notes" && n.focused)
        {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "clicked entry did not gain actual accessible focus"
        );
        std::thread::sleep(Duration::from_millis(25));
    }
    backend
        .act(action(json!({"op":"key","keys":"ctrl+a backspace"})))
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(4);
    while read()["text"] != "" {
        assert!(Instant::now() < deadline, "fixture text did not clear");
        std::thread::sleep(Duration::from_millis(25));
    }
    let expected = "Aevra café 漢字";
    backend
        .act(action(json!({"op":"type","text":expected})))
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(4);
    while read()["text"] != expected {
        assert!(
            Instant::now() < deadline,
            "actual Unicode input missing: {:?}",
            read()
        );
        std::thread::sleep(Duration::from_millis(25));
    }
    backend
        .act(action(json!({"op":"key","keys":"ctrl+a"})))
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(4);
    while read()["selection"] != json!([0, expected.chars().count()]) {
        assert!(
            Instant::now() < deadline,
            "Ctrl+A did not select native text: {:?}",
            read()
        );
        std::thread::sleep(Duration::from_millis(25));
    }
    backend
        .act(action(json!({"op":"type","text":"Replaced"})))
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(4);
    while read()["text"] != "Replaced" {
        assert!(
            Instant::now() < deadline,
            "native replacement missing: {:?}",
            read()
        );
        std::thread::sleep(Duration::from_millis(25));
    }
    let shot = backend
        .capture(CaptureRequest {
            expected_target: None,
            window_id: Some(target.window_id.clone()),
        })
        .unwrap();
    assert_eq!(shot.window.unwrap().window_id, target.window_id);
    assert!(shot.image_data_uri.starts_with("data:image/jpeg;base64,"));
    assert!(shot.device_pixel_ratio > 0.0);
    let native = crate::wayland::focused().unwrap();
    let script = std::env::var("AEVRA_WAYLAND_FIXTURE").expect("set dedicated fixture script");
    let sentinel_state = std::path::PathBuf::from(format!("{state}.sentinel"));
    let sentinel = Child(
        std::process::Command::new("/usr/bin/python3")
            .arg(script)
            .arg(&sentinel_state)
            .arg("--sentinel")
            .spawn()
            .unwrap(),
    );
    let deadline = Instant::now() + Duration::from_secs(6);
    while !crate::wayland::windows()
        .unwrap()
        .iter()
        .any(|w| w.pid == sentinel.0.id())
    {
        assert!(Instant::now() < deadline, "sentinel did not map");
        std::thread::sleep(Duration::from_millis(25));
    }
    // Same dimensions in a different process must not confuse target binding.
    fixture(json!({"op":"move","pid":sentinel.0.id(),"x":100,"y":400,"width":400,"height":240}));
    fixture(json!({"op":"above","pid":sentinel.0.id()}));
    fixture(json!({"op":"focus","pid":pid}));
    let deadline = Instant::now() + Duration::from_secs(4);
    while crate::wayland::hit(300, 610).unwrap() == native {
        assert!(
            Instant::now() < deadline,
            "sentinel must occlude target pixels"
        );
        std::thread::sleep(Duration::from_millis(25));
    }
    assert!(backend
        .act(action(json!({"op":"click","x":300,"y":610})))
        .is_err());
    let (frame, _) = crate::wayland::capture_window(native).unwrap();
    let pixel = frame.pixel(frame.width / 2, frame.height * 9 / 10);
    assert!(
        pixel[0] < 8 && (160..=180).contains(&pixel[1]) && (60..=80).contains(&pixel[2]),
        "isolated target pixels under sentinel: {pixel:?}"
    );
    fixture(json!({"op":"focus","pid":sentinel.0.id()}));
    assert!(backend.act(action(json!({"op":"key","keys":"a"}))).is_err());
    assert!(backend
        .act(action(json!({"op":"type","text":"blocked"})))
        .is_err());
    drop(sentinel);
    fixture(json!({"op":"focus","pid":pid}));
    let tree = describe();
    let secret = tree
        .nodes
        .iter()
        .find(|n| n.name == "Protected value")
        .unwrap();
    assert!(backend
        .act(action(json!({"op":"click","handle":secret.handle})))
        .is_err());
    assert_eq!(read()["password"], "");
    fixture(json!({"op":"pause"}));
    assert!(backend.act(action(json!({"op":"key","keys":"a"}))).is_err());
    assert!(backend
        .capture(CaptureRequest {
            expected_target: None,
            window_id: Some(target.window_id)
        })
        .is_err());
    assert!(!backend.connect().unwrap().input);
    fixture(json!({"op":"allow"}));
    assert!(
        backend.act(action(json!({"op":"key","keys":"a"}))).is_err(),
        "permission must not silently reconnect during an action"
    );
    assert!(
        backend.connect().unwrap().input,
        "explicit reconnect must restore the newly granted session"
    );
    crate::portable::session_tests::verify_reconnect(&backend);
    let _ = std::fs::remove_file(&sentinel_state);
}
