//! One effect-ordering and cleanup contract for native input transports.
use crate::portable_action::PreparedAction;
use crate::portable_contract::{execute_chords, execute_text, KeySink, TextSink};
pub trait InputSink: KeySink + TextSink {
    fn move_pointer(&mut self, x: i32, y: i32) -> Result<(), String>;
    fn button(&mut self, down: bool) -> Result<(), String>;
    fn scroll(&mut self, steps: i32) -> Result<(), String>;
}
fn uncertain(_: String) -> String {
    "DESKTOP_OUTCOME_UNKNOWN: native input may have been applied; observe before continuing".into()
}
pub fn execute<S: InputSink>(
    sink: &mut S,
    action: PreparedAction<'_, S::Key>,
    mut guard: impl FnMut() -> Result<(), String>,
) -> Result<bool, String> {
    guard()?;
    match action {
        PreparedAction::Text(text) => execute_text(sink, text, guard)?,
        PreparedAction::Chords(chords) => execute_chords(sink, &chords, guard)?,
        PreparedAction::Click(x, y) => {
            sink.move_pointer(x, y).map_err(uncertain)?;
            guard().map_err(uncertain)?;
            let pressed = sink.button(true);
            let released = sink.button(false);
            pressed.map_err(uncertain)?;
            released.map_err(uncertain)?;
        }
        PreparedAction::Scroll(steps) => sink.scroll(steps).map_err(uncertain)?,
    }
    Ok(true)
}
#[cfg(test)]
#[path = "input_executor_tests.rs"]
mod tests;
