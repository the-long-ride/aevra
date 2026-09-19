//! Real input synthesis via `SendInput`.
//!
//! **Foreground input synthesis rationale**: foreground tools use `SendInput`
//! and `SetCursorPos` with physical desktop coordinates. Note that UI Automation
//! also enforces integrity levels and UIPI unless UIAccess is explicitly granted,
//! but background automation uses dedicated UIA semantic patterns with explicit
//! token integrity, elevation, desktop, and ancestry validation in `target_guard.rs`.
//!
//! The sink and the cursor mover are INJECTED rather than called directly.
//! That is not ceremony: the guarantee this module exists to provide is that
//! no key and no mouse button is ever left held when an injection is refused
//! partway through, and the only way to test that is to make a refusal
//! happen on demand without synthesising anything into the desktop of
//! whoever is running the suite. A review of the first version of this file
//! found exactly that bug -- a chord's main key stayed down when its key-up
//! was refused, autorepeating into the focused window -- and no test could
//! have caught it. A later review found a third instance in `send_text`,
//! which sends whole batches rather than individual presses and so is NOT
//! covered by `ReleaseGuard`; it releases a stranded key explicitly instead
//! (see `send_text_with`). Two mechanisms, one guarantee: no exit from this
//! module leaves a key or a button held.

use crate::keys::Chord;
use ::windows::Win32::Foundation::GetLastError;
use ::windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYBD_EVENT_FLAGS,
    KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, MOUSEEVENTF_LEFTDOWN,
    MOUSEEVENTF_LEFTUP, MOUSEEVENTF_WHEEL, MOUSEINPUT, MOUSE_EVENT_FLAGS, VIRTUAL_KEY,
};
use ::windows::Win32::UI::WindowsAndMessaging::SetCursorPos;

/// Accepts a batch and returns how many events the sink took.
pub type Sink<'a> = &'a dyn Fn(&[INPUT]) -> u32;
/// Positions the pointer, in physical screen pixels.
pub type Mover<'a> = &'a dyn Fn(i32, i32) -> Result<(), String>;

/// A single `SendInput` batch is kept small so a refusal cannot strand a
/// large unknown fraction of a long string.
const MAX_BATCH_EVENTS: usize = 256;
/// Refused outright rather than allocating megabytes of `INPUT` structs for
/// a caller that has almost certainly made a mistake.
const MAX_TEXT_UNITS: usize = 4096;

fn real_sink(events: &[INPUT]) -> u32 {
    // SAFETY: `events` is live for the call and the size argument is the real
    // size of the struct, as `SendInput` requires.
    unsafe { SendInput(events, std::mem::size_of::<INPUT>() as i32) }
}

fn real_mover(x: i32, y: i32) -> Result<(), String> {
    // SAFETY: two integers in, failure reported through the result.
    unsafe { SetCursorPos(x, y) }
        .map_err(|err| format!("could not position the cursor at ({x}, {y}): {err:?}"))
}

/// Sends one batch and insists every event was accepted.
///
/// `SendInput` returns the number of events actually inserted. Fewer than
/// requested means the OS blocked the injection -- overwhelmingly UIPI,
/// because the target belongs to a more privileged process. That is neither
/// a crash nor a success, and the two short-count cases are NOT the same
/// thing: nothing landed, or an unknown prefix landed and the machine is now
/// in a state nobody chose. The audit trail is downstream of this message,
/// so it distinguishes them instead of asserting "nothing happened" for both.
fn send_batch(sink: Sink, events: &[INPUT]) -> Result<(), String> {
    send_batch_counted(sink, events).map_err(|(_, message)| message)
}

/// As `send_batch`, but also reports HOW MANY events the OS accepted before
/// it stopped.
///
/// `send_text_with` needs that number and nothing else can supply it: a
/// partially accepted batch can end on a key-DOWN whose matching key-up was
/// never sent, and without the count there is no way to know which key is
/// still held.
fn send_batch_counted(sink: Sink, events: &[INPUT]) -> Result<(), (usize, String)> {
    if events.is_empty() {
        return Ok(());
    }
    let sent = sink(events) as usize;
    if sent == events.len() {
        return Ok(());
    }
    // SAFETY: no arguments, returns a thread-local error code.
    let code = unsafe { GetLastError() };
    let message = if sent == 0 {
        format!(
            "the OS refused the synthetic input and NOTHING landed (last error {code:?}) -- this is what happens when the target window belongs to a more privileged process (UIPI)"
        )
    } else {
        format!(
            "the OS accepted only {sent} of {} events (last error {code:?}) -- input landed PARTIALLY and the machine may be in a state nobody chose",
            events.len()
        )
    };
    Err((sent, message))
}

fn keyboard_event(key: VIRTUAL_KEY, extended: bool, up: bool) -> INPUT {
    let mut flags = KEYBD_EVENT_FLAGS(0);
    if extended {
        flags |= KEYEVENTF_EXTENDEDKEY;
    }
    if up {
        flags |= KEYEVENTF_KEYUP;
    }
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT { wVk: key, wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 },
        },
    }
}

fn unicode_event(unit: u16, up: bool) -> INPUT {
    let mut flags = KEYEVENTF_UNICODE;
    if up {
        flags |= KEYEVENTF_KEYUP;
    }
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(0),
                wScan: unit,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

fn mouse_event(flags: MOUSE_EVENT_FLAGS, data: i32) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: 0,
                dy: 0,
                mouseData: data as u32,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

/// Owns the release of everything currently held down -- every key AND the
/// mouse button, not just modifiers.
///
/// Each release event is registered BEFORE its press is sent, so a press
/// that is refused or only partially accepted is still released. `Drop` runs
/// on success, on a `?` anywhere in the sequence, and on an unwind, which is
/// what makes "nothing is left held" a property of the structure rather than
/// of remembering it at each early return. A stuck Ctrl autorepeats; a stuck
/// left button turns the next pointer move into a drag. Both are destructive
/// for whoever is using the machine.
struct ReleaseGuard<'a> {
    sink: Sink<'a>,
    pending: Vec<INPUT>,
}

impl<'a> ReleaseGuard<'a> {
    fn new(sink: Sink<'a>) -> Self {
        ReleaseGuard { sink, pending: Vec::new() }
    }

    fn press_key(&mut self, key: VIRTUAL_KEY, extended: bool) -> Result<(), String> {
        self.pending.push(keyboard_event(key, extended, true));
        send_batch(self.sink, &[keyboard_event(key, extended, false)])
    }

    fn press_left_button(&mut self) -> Result<(), String> {
        self.pending.push(mouse_event(MOUSEEVENTF_LEFTUP, 0));
        send_batch(self.sink, &[mouse_event(MOUSEEVENTF_LEFTDOWN, 0)])
    }

    /// Releases everything and reports a failure to do so, for the paths that
    /// can still surface it. `Drop` remains the backstop for the paths that
    /// cannot.
    fn release(mut self) -> Result<(), String> {
        let mut first_error = None;
        for event in self.pending.drain(..).rev() {
            if let Err(err) = send_batch(self.sink, &[event]) {
                first_error = first_error.or(Some(err));
            }
        }
        match first_error {
            Some(err) => Err(format!("a key or button could not be released: {err}")),
            None => Ok(()),
        }
    }
}

impl Drop for ReleaseGuard<'_> {
    fn drop(&mut self) {
        for event in self.pending.drain(..).rev() {
            let _ = send_batch(self.sink, &[event]);
        }
    }
}

pub fn send_chords(chords: &[Chord]) -> Result<(), String> {
    send_chords_with(chords, &real_sink)
}

fn send_chords_with(chords: &[Chord], sink: Sink) -> Result<(), String> {
    for chord in chords {
        let mut guard = ReleaseGuard::new(sink);
        for modifier in &chord.modifiers {
            guard.press_key(*modifier, false)?;
        }
        guard.press_key(chord.key, chord.extended)?;
        guard.release()?;
    }
    Ok(())
}

/// Types `text` as Unicode rather than mapping to virtual keys, so
/// characters outside the active keyboard layout still arrive. Sent per
/// UTF-16 code unit, which keeps surrogate pairs intact, and in bounded
/// batches so a refusal strands as little as possible.
pub fn send_text(text: &str) -> Result<(), String> {
    send_text_with(text, &real_sink)
}

fn send_text_with(text: &str, sink: Sink) -> Result<(), String> {
    let units: Vec<u16> = text.encode_utf16().collect();
    if units.len() > MAX_TEXT_UNITS {
        return Err(format!(
            "refusing to type {} UTF-16 units in one action (limit {MAX_TEXT_UNITS}) -- send it in smaller pieces",
            units.len()
        ));
    }
    let mut events = Vec::with_capacity(units.len() * 2);
    for unit in units {
        events.push(unicode_event(unit, false));
        events.push(unicode_event(unit, true));
    }
    // MAX_BATCH_EVENTS is even and every unit contributes exactly two
    // events, so a chunk boundary never splits a down/up pair. An index
    // within a chunk is therefore a key-DOWN when it is even.
    for batch in events.chunks(MAX_BATCH_EVENTS) {
        if let Err((sent, message)) = send_batch_counted(sink, batch) {
            // A partially accepted batch that stopped after an odd number of
            // events ended on a key-down, and its key-up is still sitting in
            // the part the OS refused. That leaves a VK_PACKET key held down
            // in the target's input queue. `ReleaseGuard` cannot help here --
            // it owns presses IT made, one at a time, and text is sent in
            // batches for speed -- so the release is done explicitly, and
            // best-effort: the caller is getting an error either way, and a
            // second failure must not mask the first.
            if sent % 2 == 1 {
                let _ = send_batch(sink, &batch[sent..sent + 1]);
            }
            return Err(message);
        }
    }
    Ok(())
}

/// Clicks at a physical screen pixel.
///
/// The cursor is positioned with `SetCursorPos`, which takes physical screen
/// coordinates, rather than normalising into `SendInput`'s 0..65535 absolute
/// space -- that normalisation is per-virtual-desktop and gets multi-monitor
/// layouts subtly wrong. The process is per-monitor DPI-aware so these
/// coordinates and UI Automation's rectangles share one space.
///
/// The cursor is left where it clicked, deliberately: restoring it would be
/// a second visible jump, and a human watching needs to see where the agent
/// actually clicked.
pub fn click_at(x: i32, y: i32) -> Result<(), String> {
    click_at_with(x, y, &real_mover, &real_sink)
}

fn click_at_with(x: i32, y: i32, mover: Mover, sink: Sink) -> Result<(), String> {
    mover(x, y)?;
    let mut guard = ReleaseGuard::new(sink);
    guard.press_left_button()?;
    guard.release()
}

pub fn scroll(delta_y: i32) -> Result<(), String> {
    send_batch(&real_sink, &[mouse_event(MOUSEEVENTF_WHEEL, delta_y)])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::parse_sequence;
    use std::cell::RefCell;

    /// Records every batch and can refuse the Nth one, so the release
    /// guarantees are testable without synthesising anything.
    struct Recorder {
        batches: RefCell<Vec<Vec<INPUT>>>,
        refuse_from: Option<usize>,
    }

    impl Recorder {
        fn new(refuse_from: Option<usize>) -> Self {
            Recorder { batches: RefCell::new(Vec::new()), refuse_from }
        }

        fn sink(&self) -> impl Fn(&[INPUT]) -> u32 + '_ {
            move |events| {
                let mut batches = self.batches.borrow_mut();
                batches.push(events.to_vec());
                match self.refuse_from {
                    Some(index) if batches.len() > index => 0,
                    _ => events.len() as u32,
                }
            }
        }

        /// Every event sent, flattened, as (virtual key, is_up) for keyboard
        /// events and (0, is_up) for the mouse button.
        fn keyboard_events(&self) -> Vec<(u16, bool)> {
            self.batches
                .borrow()
                .iter()
                .flatten()
                .filter(|event| event.r#type == INPUT_KEYBOARD)
                .map(|event| {
                    // SAFETY: filtered to keyboard events above.
                    let ki = unsafe { event.Anonymous.ki };
                    (ki.wVk.0, (ki.dwFlags & KEYEVENTF_KEYUP) == KEYEVENTF_KEYUP)
                })
                .collect()
        }

        fn mouse_flags(&self) -> Vec<u32> {
            self.batches
                .borrow()
                .iter()
                .flatten()
                .filter(|event| event.r#type == INPUT_MOUSE)
                // SAFETY: filtered to mouse events above.
                .map(|event| unsafe { event.Anonymous.mi }.dwFlags.0)
                .collect()
        }
    }

    fn no_move(_x: i32, _y: i32) -> Result<(), String> {
        Ok(())
    }

    #[test]
    fn a_chord_presses_modifiers_then_the_key_and_releases_in_reverse() {
        let recorder = Recorder::new(None);
        let sink = recorder.sink();
        send_chords_with(&parse_sequence("ctrl+shift+a").unwrap(), &sink).unwrap();
        let events = recorder.keyboard_events();
        let ups: Vec<u16> = events.iter().filter(|(_, up)| *up).map(|(vk, _)| *vk).collect();
        let downs: Vec<u16> = events.iter().filter(|(_, up)| !*up).map(|(vk, _)| *vk).collect();
        assert_eq!(downs.len(), 3, "ctrl, shift, then the key");
        // Reverse of the press order: key, then shift, then ctrl.
        assert_eq!(ups, vec![downs[2], downs[1], downs[0]]);
    }

    #[test]
    fn the_main_key_is_released_even_when_its_key_up_is_refused() {
        // The bug a review found in the first version of this file: the main
        // key was sent outside the guard, so a refused key-up left it held
        // down, autorepeating into whatever had focus.
        let recorder = Recorder::new(Some(3));
        let sink = recorder.sink();
        let result = send_chords_with(&parse_sequence("ctrl+a").unwrap(), &sink);
        assert!(result.is_err(), "a refused release must surface as an error");
        let events = recorder.keyboard_events();
        for (vk, _) in events.iter().filter(|(_, up)| !*up) {
            assert!(
                events.contains(&(*vk, true)),
                "every pressed key must have a release attempt: {vk} did not"
            );
        }
    }

    #[test]
    fn a_key_whose_press_is_refused_is_still_released() {
        let recorder = Recorder::new(Some(0));
        let sink = recorder.sink();
        assert!(send_chords_with(&parse_sequence("ctrl+a").unwrap(), &sink).is_err());
        let events = recorder.keyboard_events();
        assert!(events.iter().any(|(_, up)| *up), "a refused press must still be released");
    }

    #[test]
    fn the_mouse_button_is_released_even_when_its_up_is_refused() {
        let recorder = Recorder::new(Some(1));
        let sink = recorder.sink();
        let result = click_at_with(10, 20, &no_move, &sink);
        assert!(result.is_err());
        let flags = recorder.mouse_flags();
        assert!(flags.contains(&MOUSEEVENTF_LEFTDOWN.0));
        assert!(flags.contains(&MOUSEEVENTF_LEFTUP.0), "a stuck button becomes a drag");
    }

    #[test]
    fn a_click_sends_exactly_one_down_and_one_up() {
        let recorder = Recorder::new(None);
        let sink = recorder.sink();
        click_at_with(1, 2, &no_move, &sink).unwrap();
        assert_eq!(recorder.mouse_flags(), vec![MOUSEEVENTF_LEFTDOWN.0, MOUSEEVENTF_LEFTUP.0]);
    }

    #[test]
    fn a_cursor_move_failure_prevents_the_click_entirely() {
        let recorder = Recorder::new(None);
        let sink = recorder.sink();
        let failing_move = |_x: i32, _y: i32| Err("no".to_string());
        assert!(click_at_with(5, 5, &failing_move, &sink).is_err());
        assert!(recorder.mouse_flags().is_empty(), "nothing should be clicked");
    }

    #[test]
    fn text_is_sent_as_utf16_units_with_surrogate_pairs_intact() {
        let recorder = Recorder::new(None);
        let sink = recorder.sink();
        // A character outside the BMP: two UTF-16 units, so four events.
        send_text_with("\u{1F600}", &sink).unwrap();
        assert_eq!(recorder.keyboard_events().len(), 4);
    }

    #[test]
    fn text_is_split_into_bounded_batches() {
        let recorder = Recorder::new(None);
        let sink = recorder.sink();
        send_text_with(&"a".repeat(400), &sink).unwrap();
        let batches = recorder.batches.borrow();
        assert!(batches.len() > 1, "800 events must not go in one batch");
        assert!(batches.iter().all(|batch| batch.len() <= MAX_BATCH_EVENTS));
    }

    #[test]
    fn an_absurdly_long_string_is_refused_rather_than_allocated() {
        let recorder = Recorder::new(None);
        let sink = recorder.sink();
        let err = send_text_with(&"a".repeat(MAX_TEXT_UNITS + 1), &sink).unwrap_err();
        assert!(err.contains("limit"), "got: {err}");
        assert!(recorder.batches.borrow().is_empty(), "nothing should be typed");
    }

    #[test]
    fn a_batch_that_stops_on_a_key_down_gets_an_explicit_release_attempt() {
        // Regression for the third stuck-input bug: send_text sends whole
        // batches rather than going through ReleaseGuard (which only owns
        // presses made one at a time), so a batch accepted up to an odd
        // offset ends on a key-DOWN whose key-up never went out in that same
        // batch. "ab" is one batch of 4 events: down(a), up(a), down(b),
        // up(b). A sink that takes only the first 3 stops right after
        // down(b), stranding it -- the OS was handed the real array (as
        // `SendInput` always is; the recorder mirrors that), it simply
        // reported back that only 3 landed.
        //
        // The fix's contract is specific: after such a batch fails, it sends
        // ONE MORE batch containing exactly the stranded release. This
        // checks that shape directly rather than pairing by virtual key --
        // every VK_PACKET unicode event carries `wVk == 0`, so a by-key
        // pairing check here would be vacuously true regardless of what the
        // fix does.
        let recorder = Recorder::new(None);
        let inner_sink = recorder.sink();
        let flaky = move |events: &[INPUT]| inner_sink(events).min(3);
        let err = send_text_with("ab", &flaky).unwrap_err();
        assert!(err.contains("PARTIALLY"), "got: {err}");

        let batches = recorder.batches.borrow();
        assert_eq!(batches.len(), 2, "the original batch, plus exactly one release retry");
        let retry = &batches[1];
        assert_eq!(retry.len(), 1, "the retry must contain only the stranded event");
        // SAFETY: a keyboard event, as constructed by unicode_event.
        let ki = unsafe { retry[0].Anonymous.ki };
        assert_eq!(retry[0].r#type, INPUT_KEYBOARD);
        assert!((ki.dwFlags & KEYEVENTF_KEYUP) == KEYEVENTF_KEYUP, "the retry must be a release, not another press");
    }

    #[test]
    fn a_total_refusal_and_a_partial_one_are_reported_differently() {
        let total = Recorder::new(Some(0));
        let total_sink = total.sink();
        let total_err = send_text_with("ab", &total_sink).unwrap_err();
        assert!(total_err.contains("NOTHING landed"), "got: {total_err}");

        // A sink that takes some but not all of a batch.
        let partial = |events: &[INPUT]| (events.len() as u32).saturating_sub(1);
        let partial_err = send_text_with("ab", &partial).unwrap_err();
        assert!(partial_err.contains("PARTIALLY"), "got: {partial_err}");
    }
}
