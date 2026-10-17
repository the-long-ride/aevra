//! Real revocation on the private X server, including halfway through typing.
use super::*;
use crate::backend::{DesktopBackend, TargetIdentityRequest, WindowIdentity};
use x11rb::protocol::Event;

pub(super) fn verify(
    backend: &impl DesktopBackend,
    target: &WindowIdentity,
    display: &str,
    original: u32,
    state: &std::path::Path,
) {
    let (c, n) = x11rb::connect(Some(display)).unwrap();
    let root = c.setup().roots[n].root;
    let blocked = c.generate_id().unwrap();
    c.create_window(
        x11rb::COPY_DEPTH_FROM_PARENT,
        blocked,
        root,
        500,
        300,
        100,
        100,
        0,
        WindowClass::INPUT_OUTPUT,
        c.setup().roots[n].root_visual,
        &CreateWindowAux::new().event_mask(EventMask::KEY_PRESS | EventMask::BUTTON_PRESS),
    )
    .unwrap()
    .check()
    .unwrap();
    c.map_window(blocked).unwrap().check().unwrap();
    let active = c
        .intern_atom(false, b"_NET_ACTIVE_WINDOW")
        .unwrap()
        .reply()
        .unwrap()
        .atom;
    let focus = |window| {
        c.change_property32(PropMode::REPLACE, root, active, AtomEnum::WINDOW, &[window])
            .unwrap()
            .check()
            .unwrap();
        c.set_input_focus(InputFocus::PARENT, window, x11rb::CURRENT_TIME)
            .unwrap()
            .check()
            .unwrap();
        c.flush().unwrap();
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
    focus(blocked);
    for value in [
        serde_json::json!({"op":"click","x":30,"y":40}),
        serde_json::json!({"op":"type","text":"must not land"}),
        serde_json::json!({"op":"key","keys":"ctrl+a"}),
        serde_json::json!({"op":"scroll","deltaY":120}),
    ] {
        assert!(
            backend.act(action(value)).is_err(),
            "input after authorization race"
        );
    }
    assert_no_effects(&c);
    focus(original);
    backend
        .act(action(
            serde_json::json!({"op":"key","keys":"ctrl+a backspace"}),
        ))
        .unwrap();
    let path = state.to_owned();
    let display = display.to_owned();
    let switcher = std::thread::spawn(move || {
        let (c, _) = x11rb::connect(Some(&display)).unwrap();
        let deadline = Instant::now() + Duration::from_secs(6);
        loop {
            let value = std::fs::read(&path)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok());
            if value
                .and_then(|v| v["text"].as_str().map(|s| s.len()))
                .is_some_and(|len| len >= 100)
            {
                c.change_property32(
                    PropMode::REPLACE,
                    root,
                    active,
                    AtomEnum::WINDOW,
                    &[blocked],
                )
                .unwrap()
                .check()
                .unwrap();
                c.set_input_focus(InputFocus::PARENT, blocked, x11rb::CURRENT_TIME)
                    .unwrap()
                    .check()
                    .unwrap();
                c.flush().unwrap();
                return;
            }
            assert!(
                Instant::now() < deadline,
                "typing never reached revocation checkpoint"
            );
            std::thread::sleep(Duration::from_millis(5));
        }
    });
    let result = backend.act(action(
        serde_json::json!({"op":"type","text":"a".repeat(600)}),
    ));
    switcher.join().unwrap();
    assert!(result.unwrap_err().starts_with("DESKTOP_OUTCOME_UNKNOWN"));
    std::thread::sleep(Duration::from_millis(40));
    let value: serde_json::Value = serde_json::from_slice(&std::fs::read(state).unwrap()).unwrap();
    let count = value["text"].as_str().unwrap().len();
    assert!(
        (100..600).contains(&count),
        "input must stop after revocation, observed {count}"
    );
    assert_no_effects(&c);
}

fn assert_no_effects(c: &impl Connection) {
    c.get_input_focus().unwrap().reply().unwrap();
    while let Some(event) = c.poll_for_event().unwrap() {
        assert!(
            !matches!(event, Event::KeyPress(_) | Event::ButtonPress(_)),
            "blocked window received input"
        );
    }
}
