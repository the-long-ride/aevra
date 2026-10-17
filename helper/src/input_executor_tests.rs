use super::*;
#[derive(Default)]
struct Sink {
    events: Vec<&'static str>,
    fail_press: bool,
}
impl KeySink for Sink {
    type Key = u32;
    fn key(&mut self, _: &u32, _: bool) -> Result<(), String> {
        Ok(())
    }
}
impl TextSink for Sink {
    fn text(&mut self, _: &str) -> Result<(), String> {
        Ok(())
    }
}
impl InputSink for Sink {
    fn move_pointer(&mut self, _: i32, _: i32) -> Result<(), String> {
        self.events.push("move");
        Ok(())
    }
    fn button(&mut self, down: bool) -> Result<(), String> {
        self.events.push(if down { "press" } else { "release" });
        if down && self.fail_press {
            Err("interrupted".into())
        } else {
            Ok(())
        }
    }
    fn scroll(&mut self, _: i32) -> Result<(), String> {
        self.events.push("scroll");
        Ok(())
    }
}
#[test]
fn click_releases_an_uncertain_press_and_does_not_dispatch_after_guard_failure() {
    let mut sink = Sink {
        fail_press: true,
        ..Sink::default()
    };
    assert!(execute(&mut sink, PreparedAction::Click(1, 2), || Ok(()))
        .unwrap_err()
        .starts_with("DESKTOP_OUTCOME_UNKNOWN"));
    assert_eq!(sink.events, ["move", "press", "release"]);
    let mut sink = Sink::default();
    let mut calls = 0;
    assert!(execute(&mut sink, PreparedAction::Click(1, 2), || {
        calls += 1;
        if calls == 2 {
            Err("target changed".into())
        } else {
            Ok(())
        }
    })
    .unwrap_err()
    .starts_with("DESKTOP_OUTCOME_UNKNOWN"));
    assert_eq!(sink.events, ["move"]);
    let mut sink = Sink::default();
    assert!(execute(&mut sink, PreparedAction::Scroll(1), || Err(
        "refused".into()
    ))
    .is_err());
    assert!(sink.events.is_empty());
}
