//! Guard new effects while always allowing held-input cleanup.
use super::*;
use std::cell::{Cell, RefCell};

pub(crate) fn run<T>(
    guard: &dyn Fn() -> Result<(), String>,
    action: impl FnOnce(Sink, Mover) -> Result<T, String>,
) -> Result<T, String> {
    run_with(guard, &real_sink, &real_mover, action)
}

fn run_with<T>(
    guard: &dyn Fn() -> Result<(), String>,
    native_sink: Sink,
    native_mover: Mover,
    action: impl FnOnce(Sink, Mover) -> Result<T, String>,
) -> Result<T, String> {
    let refusal = RefCell::new(None);
    let effected = Cell::new(false);
    let sink = |events: &[INPUT]| {
        let new_effect = events.iter().any(|event| unsafe {
            if event.r#type == INPUT_KEYBOARD {
                !event.Anonymous.ki.dwFlags.contains(KEYEVENTF_KEYUP)
            } else if event.r#type == INPUT_MOUSE {
                event.Anonymous.mi.dwFlags != MOUSEEVENTF_LEFTUP
            } else {
                true
            }
        });
        if new_effect {
            if let Err(error) = guard() {
                *refusal.borrow_mut() = Some(error);
                return 0;
            }
        }
        let sent = native_sink(events);
        if new_effect && sent > 0 {
            effected.set(true);
        }
        sent
    };
    let mover = |x, y| {
        guard().inspect_err(|error| {
            *refusal.borrow_mut() = Some(error.clone());
        })?;
        native_mover(x, y)?;
        effected.set(true);
        Ok(())
    };
    let result = action(&sink, &mover);
    if let Some(error) = refusal.into_inner() {
        Err(if effected.get() {
            "DESKTOP_OUTCOME_UNKNOWN: target changed after partial input; observe before continuing"
                .into()
        } else {
            error
        })
    } else {
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn revocation_stops_new_effects_but_releases_held_keys() {
        let checks = Cell::new(0);
        let events = RefCell::new(Vec::new());
        let guard = || {
            checks.set(checks.get() + 1);
            if checks.get() > 1 {
                Err("DESKTOP_TARGET_CHANGED: revoked".into())
            } else {
                Ok(())
            }
        };
        let sink = |batch: &[INPUT]| {
            for e in batch {
                events
                    .borrow_mut()
                    .push(unsafe { e.Anonymous.ki.dwFlags.contains(KEYEVENTF_KEYUP) });
            }
            batch.len() as u32
        };
        let chords = crate::keys::parse_sequence("ctrl+a ctrl+b").unwrap();
        let result = run_with(&guard, &sink, &|_, _| Ok(()), |sink, _| {
            send_chords_with(&chords, sink)
        });
        assert!(result.unwrap_err().starts_with("DESKTOP_OUTCOME_UNKNOWN"));
        assert_eq!(
            *events.borrow(),
            vec![false, true, true],
            "only first press and cleanup for attempted keys may reach OS"
        );
        events.borrow_mut().clear();
        let result = run_with(&guard, &sink, &|_, _| Ok(()), |sink, _| {
            send_text_with("secret", sink)
        });
        assert!(result.unwrap_err().starts_with("DESKTOP_TARGET_CHANGED"));
        assert!(events.borrow().is_empty());
    }
}
