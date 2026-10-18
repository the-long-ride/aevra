use super::*;

#[test]
fn complete_sequence_is_validated_before_any_native_effect() {
    assert!(parse_keys("ctrl+a delete").is_ok());
    for invalid in [
        "",
        "ctrl++a",
        "ctrl+a unknown",
        "shift+",
        "ctrl+ctrl+a",
        "f25",
    ] {
        assert!(parse_keys(invalid).is_err(), "{invalid:?}");
    }
    assert_eq!(parse_keys("cmd+shift+home").unwrap()[0].len(), 3);
}

#[test]
fn window_binding_requires_pid_exact_bounds_and_unique_native_window() {
    let expected = NativeWindow {
        buffer: None,
        id: 8,
        pid: 42,
        rect: Rect {
            x: -20,
            y: 5,
            width: 200,
            height: 100,
        },
    };
    assert_eq!(bind_window(42, expected.rect, &[expected]).unwrap(), 8);
    assert!(bind_window(43, expected.rect, &[expected]).is_err());
    assert!(bind_window(
        42,
        expected.rect,
        &[
            expected,
            NativeWindow {
                buffer: None,
                id: 9,
                ..expected
            }
        ]
    )
    .is_err());
    assert!(bind_window(
        42,
        Rect {
            x: 0,
            ..expected.rect
        },
        &[expected]
    )
    .is_err());
}

#[test]
fn point_must_hit_the_verified_foreground_native_window() {
    let rect = Rect {
        x: -20,
        y: 5,
        width: 200,
        height: 100,
    };
    assert!(guard_point(rect, -20, 5, 7, 7).is_ok());
    for (x, y) in [(180, 5), (-21, 5), (0, 105), (0, 4)] {
        assert!(guard_point(rect, x, y, 7, 7).is_err());
    }
    assert!(guard_point(rect, 0, 10, 7, 8).is_err());
    assert!(guard_point(Rect { width: 0, ..rect }, 0, 10, 7, 7).is_err());
}

#[test]
fn rgba_validation_and_stride_conversion_preserve_pixels_without_alpha() {
    let rgb = rgba_to_rgb(
        2,
        1,
        12,
        &[255, 0, 0, 255, 0, 128, 255, 255, 9, 9, 9, 9],
        false,
    )
    .unwrap();
    assert_eq!(rgb, vec![255, 0, 0, 0, 128, 255]);
    assert_eq!(
        rgba_to_rgb(1, 1, 4, &[1, 2, 3, 255], true).unwrap(),
        vec![3, 2, 1]
    );
    for (w, h, stride, data) in [
        (0, 1, 4, vec![0; 4]),
        (2, 1, 4, vec![0; 8]),
        (2, 2, 8, vec![0; 8]),
        (40000, 40000, 160000, vec![]),
    ] {
        assert!(rgba_to_rgb(w, h, stride, &data, false).is_err());
    }
}

#[test]
fn capture_scale_uses_actual_output_width_and_logical_width() {
    assert_eq!(capture_scale(1024, 2048).unwrap(), 0.5);
    assert_eq!(capture_scale(1000, 500).unwrap(), 2.0);
    assert!(capture_scale(0, 100).is_err());
    assert!(capture_scale(100, 0).is_err());
}

#[test]
fn failed_chord_releases_held_keys_and_never_replays() {
    #[derive(Default)]
    struct Sink {
        events: Vec<(String, bool)>,
        failed: bool,
    }
    impl KeySink for Sink {
        type Key = String;
        fn key(&mut self, key: &String, down: bool) -> Result<(), String> {
            self.events.push((key.into(), down));
            if key == "a" && down && !self.failed {
                self.failed = true;
                return Err("native failure".into());
            }
            Ok(())
        }
    }
    let mut sink = Sink::default();
    let err =
        execute_chords(&mut sink, &parse_keys("ctrl+a ctrl+b").unwrap(), || Ok(())).unwrap_err();
    assert!(err.starts_with("DESKTOP_OUTCOME_UNKNOWN"));
    assert_eq!(
        sink.events,
        vec![
            ("ctrl".into(), true),
            ("a".into(), true),
            ("a".into(), false),
            ("ctrl".into(), false)
        ]
    );
}

#[test]
fn focus_revocation_before_dispatch_sends_no_events() {
    struct Sink;
    impl KeySink for Sink {
        type Key = String;
        fn key(&mut self, _: &String, _: bool) -> Result<(), String> {
            panic!("input after revocation")
        }
    }
    let result = execute_chords(&mut Sink, &parse_keys("ctrl+a").unwrap(), || {
        Err("DESKTOP_TARGET_CHANGED: focus".into())
    });
    assert!(result.unwrap_err().starts_with("DESKTOP_TARGET_CHANGED"));
}

#[test]
fn unicode_text_uses_text_transport_and_stops_after_focus_changes() {
    struct Sink(Vec<String>);
    impl TextSink for Sink {
        fn text(&mut self, text: &str) -> Result<(), String> {
            self.0.push(text.into());
            Ok(())
        }
    }
    let mut sink = Sink(Vec::new());
    execute_text(&mut sink, "café 漢字", || Ok(())).unwrap();
    assert_eq!(sink.0.concat(), "café 漢字");
    assert_eq!(sink.0.last().unwrap(), "字");
    let mut checks = 0;
    let result = execute_text(&mut sink, "abc", || {
        checks += 1;
        if checks > 1 {
            Err("DESKTOP_TARGET_CHANGED: focus".into())
        } else {
            Ok(())
        }
    });
    assert!(result.unwrap_err().starts_with("DESKTOP_OUTCOME_UNKNOWN"));
    assert_eq!(sink.0.last().unwrap(), "a");
}

#[test]
fn provider_identity_scopes_atspi_paths_and_ignores_nonunique_ax_identifiers() {
    assert_eq!(
        provider_key(42, "1", Some(":1.2"), Some("/object/1")),
        provider_key(42, "2", Some(":1.2"), Some("/object/1"))
    );
    assert_ne!(
        provider_key(42, "1", Some(":1.2"), Some("/object/1")),
        provider_key(42, "1", Some(":1.3"), Some("/object/1"))
    );
    assert_ne!(
        provider_key(42, "1", None, Some("shared AXIdentifier")),
        provider_key(42, "2", None, Some("shared AXIdentifier"))
    );
}

#[test]
fn quartz_pointer_preserves_global_logical_coordinates_on_retina() {
    assert_eq!(logical_pointer(100.0, 400.0).unwrap(), (100, 400));
    assert_eq!(logical_pointer(-150.0, -20.0).unwrap(), (-150, -20));
    assert!(logical_pointer(f64::NAN, 0.0).is_err());
    assert!(logical_pointer(0.0, f64::INFINITY).is_err());
    assert!(logical_pointer(f64::from(i32::MAX) + 1.0, 0.0).is_err());
}

#[test]
fn focused_native_binding_uses_the_active_ax_window_in_a_multiwindow_process() {
    let rect = |x| Rect {
        x,
        y: 0,
        width: 400,
        height: 200,
    };
    let native = [
        NativeWindow {
            buffer: None,
            id: 9,
            pid: 42,
            rect: rect(900),
        },
        NativeWindow {
            buffer: None,
            id: 1,
            pid: 42,
            rect: rect(0),
        },
        NativeWindow {
            buffer: None,
            id: 2,
            pid: 42,
            rect: rect(450),
        },
    ];
    for (active, expected) in [(0, 1), (1, 2)] {
        let ax = [
            (42, rect(0), active == 0),
            (42, rect(450), active == 1),
            (42, rect(900), false),
        ];
        assert_eq!(bind_focused_window(&ax, &native).unwrap(), expected);
    }
    assert!(bind_focused_window(&[(42, rect(0), true), (42, rect(450), true)], &native).is_err());
    assert!(bind_focused_window(&[(42, rect(0), false)], &native).is_err());
}

#[test]
fn expired_input_budget_stops_text_before_the_next_effect() {
    InputBudget::new().check().unwrap();
    struct Sink(String);
    impl TextSink for Sink {
        fn text(&mut self, text: &str) -> Result<(), String> {
            self.0.push_str(text);
            Ok(())
        }
    }
    let budget = InputBudget(std::time::Instant::now() - std::time::Duration::from_secs(8));
    let mut sink = Sink(String::new());
    assert!(execute_text(&mut sink, "must not land", || budget.check())
        .unwrap_err()
        .starts_with("DESKTOP_TIMEOUT"));
    assert!(sink.0.is_empty());
}
