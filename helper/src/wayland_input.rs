//! Prepared native input through the same authorized compositor connection.
use crate::{
    backend::ActRequest,
    portable_action::prepare,
    portable_contract::{KeySink, TextSink},
    wayland,
};
use serde_json::json;
struct Sink;
impl KeySink for Sink {
    type Key = u32;
    fn key(&mut self, key: &u32, down: bool) -> Result<(), String> {
        wayland::input(json!({"op":"key","key":key,"down":down}))
    }
}
impl TextSink for Sink {
    fn text(&mut self, text: &str) -> Result<(), String> {
        wayland::input(json!({"op":"text","text":text}))
    }
}
impl crate::input_executor::InputSink for Sink {
    fn move_pointer(&mut self, x: i32, y: i32) -> Result<(), String> {
        wayland::input(json!({"op":"move","x":x,"y":y}))
    }
    fn button(&mut self, down: bool) -> Result<(), String> {
        wayland::input(json!({"op":"button","down":down}))
    }
    fn scroll(&mut self, steps: i32) -> Result<(), String> {
        wayland::input(json!({"op":"scroll","steps":steps}))
    }
}
pub fn perform(
    request: &ActRequest,
    guard: impl FnMut() -> Result<(), String>,
) -> Result<bool, String> {
    let action = prepare(request, crate::wayland_contract::key)?;
    crate::input_executor::execute(&mut Sink, action, guard)
}
