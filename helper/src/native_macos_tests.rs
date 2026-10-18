//! Explicit opt-in fixture test. Never drives an existing human application.
use crate::backend::ActRequest;
use crate::{portable_input, portable_pixels};
use std::process::{Child, Command};
use std::time::{Duration, Instant};
struct Fixture(Child, std::path::PathBuf);
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
        let _ = std::fs::remove_file(&self.1);
        let _ = std::fs::remove_file(self.1.with_extension("json.focus"));
    }
}
#[test]
#[ignore = "required native macOS run needs AEVRA_MAC_FIXTURE and Screen Recording/Accessibility grants"]
fn native_macos_capture_and_input() {
    assert!(
        portable_pixels::ready(),
        "Required native permission missing: Screen Recording"
    );
    assert!(
        portable_input::ready(),
        "Required native permission missing: Accessibility"
    );
    let binary = std::env::var_os("AEVRA_MAC_FIXTURE")
        .expect("Build helper/tests/fixtures/PortableMacFixture.swift and set AEVRA_MAC_FIXTURE");
    let state =
        std::env::temp_dir().join(format!("aevra-native-fixture-{}.json", std::process::id()));
    let fixture = Fixture(
        Command::new(binary)
            .arg(&state)
            .arg("--occluder")
            .arg("--multi-window")
            .spawn()
            .expect("start dedicated fixture"),
        state,
    );
    let deadline = Instant::now() + Duration::from_secs(8);
    let target = loop {
        let windows = portable_pixels::windows().unwrap();
        let original = std::fs::read(&fixture.1)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
            .and_then(|v| v["windowId"].as_u64());
        if let Some(window) = windows
            .into_iter()
            .find(|w| w.pid == fixture.0.id() && Some(u64::from(w.id)) == original)
        {
            if portable_pixels::focused().ok() == Some(window.id) {
                break window;
            }
        }
        assert!(
            Instant::now() < deadline,
            "native fixture did not become foreground"
        );
        std::thread::sleep(Duration::from_millis(50));
    };
    assert_ne!(
        portable_pixels::hit(target.rect.x + 175, target.rect.y + 75).unwrap(),
        target.id,
        "unnamed/unshareable occluder must block pointer input"
    );
    let (frame, width) =
        portable_pixels::capture_window(target.id).expect("actual ScreenCaptureKit window frame");
    assert_eq!(width, 400);
    let color = frame.pixel(frame.width / 2, frame.height / 2);
    assert!(
        color[0] < 8 && (160..=180).contains(&color[1]) && (60..=80).contains(&color[2]),
        "fixture pixels: {color:?}"
    );
    let request = |op: &str| ActRequest {
        expected_target: None,
        op: op.into(),
        handle: None,
        x: None,
        y: None,
        text: None,
        keys: None,
        delta_y: None,
    };
    let mut click = request("click");
    click.x = Some(target.rect.x + 50);
    click.y = Some(target.rect.y + 50);
    let guard = || {
        if portable_pixels::focused()? == target.id {
            Ok(())
        } else {
            Err("DESKTOP_TARGET_CHANGED: fixture lost focus".into())
        }
    };
    portable_input::perform(&click, guard).unwrap();
    let mut keys = request("key");
    keys.keys = Some("cmd+a".into());
    portable_input::perform(&keys, guard).unwrap();
    let expected = "Aevra café 漢字";
    let mut text = request("type");
    text.text = Some(expected.into());
    portable_input::perform(&text, guard).unwrap();
    let mut wheel = request("scroll");
    wheel.delta_y = Some(-120);
    portable_input::perform(&wheel, guard).unwrap();
    let deadline = Instant::now() + Duration::from_secs(4);
    loop {
        let value = std::fs::read(&fixture.1)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok());
        if let Some(v) = value {
            if v["text"] == expected
                && v["clicks"].as_u64().unwrap_or(0) > 0
                && v["scrolls"].as_u64().unwrap_or(0) > 0
            {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "native input outcomes were not observed: {v}"
            );
        } else {
            assert!(Instant::now() < deadline, "fixture output unavailable");
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    let value: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&fixture.1).unwrap()).unwrap();
    let editor = value["editorWindowId"]
        .as_u64()
        .expect("second ordinary window") as u32;
    for (command, expected_window) in [("2", editor), ("1", target.id)] {
        std::fs::write(fixture.1.with_extension("json.focus"), command).unwrap();
        let deadline = Instant::now() + Duration::from_secs(4);
        while portable_pixels::focused().ok() != Some(expected_window) {
            assert!(
                Instant::now() < deadline,
                "AX key-window binding chose a non-key editor or palette"
            );
            std::thread::sleep(Duration::from_millis(25));
        }
        if command == "2" {
            let mut typing = request("type");
            typing.text = Some("Editor two".into());
            portable_input::perform(&typing, || {
                if portable_pixels::focused()? == editor {
                    Ok(())
                } else {
                    Err("DESKTOP_TARGET_CHANGED: second editor lost focus".into())
                }
            })
            .unwrap();
            let deadline = Instant::now() + Duration::from_secs(4);
            loop {
                let value: serde_json::Value =
                    serde_json::from_slice(&std::fs::read(&fixture.1).unwrap()).unwrap();
                if value["editorText"] == "Editor two" {
                    break;
                }
                assert!(
                    Instant::now() < deadline,
                    "input did not reach the focused second editor"
                );
                std::thread::sleep(Duration::from_millis(25));
            }
        }
    }
}
