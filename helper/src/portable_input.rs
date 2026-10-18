//! One native input transport, recreated per operation after permission/focus checks.
use crate::backend::ActRequest;
use crate::portable_action::prepare;
use crate::portable_contract::{KeySink, TextSink};
use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};
fn error(_: impl std::fmt::Display) -> String {
    "DESKTOP_OUTCOME_UNKNOWN: native input was refused or interrupted; observe before sending further input".into()
}
fn open() -> Result<Enigo, String> {
    crate::portable_pixels::ensure_session()?;
    Enigo::new(&Settings{open_prompt_to_get_permissions:false,release_keys_when_dropped:true,..Settings::default()})
        .map_err(|_|"DESKTOP_PERMISSION_REQUIRED: native input unavailable; grant Accessibility on macOS or check the X11/XTest session, then reconnect".into())
}
#[cfg(target_os = "linux")]
pub fn pointer() -> Result<(i32, i32), String> {
    if crate::wayland::active() {
        return crate::wayland::pointer();
    }
    open()?.location().map_err(error)
}
#[cfg(target_os = "macos")]
pub fn pointer() -> Result<(i32, i32), String> {
    use core_graphics::{
        event::CGEvent,
        event_source::{CGEventSource, CGEventSourceStateID},
    };
    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
        .map_err(|_| "DESKTOP_INPUT_REFUSED: Quartz pointer source unavailable".to_string())?;
    let event = CGEvent::new(source)
        .map_err(|_| "DESKTOP_INPUT_REFUSED: Quartz pointer location unavailable".to_string())?;
    let p = event.location();
    // Quartz already uses the global top-left logical coordinate system. Do
    // not flip with a physical display height (incorrect on Retina displays).
    crate::portable_contract::logical_pointer(p.x, p.y)
}
pub fn ready() -> bool {
    #[cfg(target_os = "linux")]
    if crate::wayland::active() {
        return crate::wayland::ready();
    }
    open().is_ok()
}
fn key(name: &str) -> Result<Key, String> {
    Ok(match name {
        "ctrl" => Key::Control,
        "alt" => Key::Alt,
        "shift" => Key::Shift,
        "meta" => Key::Meta,
        "enter" | "return" => Key::Return,
        "escape" | "esc" => Key::Escape,
        "tab" => Key::Tab,
        "space" => Key::Space,
        "backspace" => Key::Backspace,
        "delete" | "del" => Key::Delete,
        #[cfg(not(target_os = "macos"))]
        "insert" => Key::Insert,
        "up" => Key::UpArrow,
        "down" => Key::DownArrow,
        "left" => Key::LeftArrow,
        "right" => Key::RightArrow,
        "home" => Key::Home,
        "end" => Key::End,
        "pageup" => Key::PageUp,
        "pagedown" => Key::PageDown,
        "f1" => Key::F1,
        "f2" => Key::F2,
        "f3" => Key::F3,
        "f4" => Key::F4,
        "f5" => Key::F5,
        "f6" => Key::F6,
        "f7" => Key::F7,
        "f8" => Key::F8,
        "f9" => Key::F9,
        "f10" => Key::F10,
        "f11" => Key::F11,
        "f12" => Key::F12,
        "f13" => Key::F13,
        "f14" => Key::F14,
        "f15" => Key::F15,
        "f16" => Key::F16,
        "f17" => Key::F17,
        "f18" => Key::F18,
        "f19" => Key::F19,
        "f20" => Key::F20,
        #[cfg(not(target_os = "macos"))]
        "f21" => Key::F21,
        #[cfg(not(target_os = "macos"))]
        "f22" => Key::F22,
        #[cfg(not(target_os = "macos"))]
        "f23" => Key::F23,
        #[cfg(not(target_os = "macos"))]
        "f24" => Key::F24,
        _ if name.len() == 1 => Key::Unicode(name.chars().next().expect("validated key name")),
        _ => {
            return Err("DESKTOP_INPUT_REFUSED: key is unavailable on this operating system".into())
        }
    })
}
struct Sink(Enigo);
impl KeySink for Sink {
    type Key = Key;
    fn key(&mut self, key: &Key, down: bool) -> Result<(), String> {
        self.0
            .key(
                *key,
                if down {
                    Direction::Press
                } else {
                    Direction::Release
                },
            )
            .map_err(error)
    }
}
impl TextSink for Sink {
    fn text(&mut self, text: &str) -> Result<(), String> {
        self.0.text(text).map_err(error)
    }
}

impl crate::input_executor::InputSink for Sink {
    fn move_pointer(&mut self, x: i32, y: i32) -> Result<(), String> {
        self.0.move_mouse(x, y, Coordinate::Abs).map_err(error)
    }
    fn button(&mut self, down: bool) -> Result<(), String> {
        self.0
            .button(
                Button::Left,
                if down {
                    Direction::Press
                } else {
                    Direction::Release
                },
            )
            .map_err(error)
    }
    fn scroll(&mut self, steps: i32) -> Result<(), String> {
        self.0.scroll(steps, Axis::Vertical).map_err(error)
    }
}
pub fn perform(
    request: &ActRequest,
    mut guard: impl FnMut() -> Result<(), String>,
) -> Result<bool, String> {
    #[cfg(target_os = "linux")]
    if crate::wayland::active() {
        return crate::wayland_input::perform(request, guard);
    }
    let action = prepare(request, key)?;
    guard()?;
    let mut sink = Sink(open()?);
    crate::input_executor::execute(&mut sink, action, guard)
}
