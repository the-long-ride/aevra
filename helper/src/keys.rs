//! Key-chord syntax and its parser.
//!
//! Split out of `input.rs` so the synthesis code there stays about
//! synthesis. The parser is pure, which is why it carries the bulk of this
//! subsystem's unit tests: the whole sequence is parsed before a single
//! event is sent, so a malformed chord cannot leave earlier chords applied.

use ::windows::Win32::UI::Input::KeyboardAndMouse::{
    VIRTUAL_KEY, VK_0, VK_1, VK_2, VK_3, VK_4, VK_5, VK_6, VK_7, VK_8, VK_9, VK_A, VK_B, VK_BACK,
    VK_C, VK_CONTROL, VK_D, VK_DELETE, VK_DOWN, VK_E, VK_END, VK_ESCAPE, VK_F, VK_F1, VK_F10,
    VK_F11, VK_F12, VK_F2, VK_F3, VK_F4, VK_F5, VK_F6, VK_F7, VK_F8, VK_F9, VK_G, VK_H, VK_HOME,
    VK_I, VK_J, VK_K, VK_L, VK_LEFT, VK_LWIN, VK_M, VK_MENU, VK_N, VK_NEXT, VK_O, VK_P, VK_PRIOR,
    VK_Q, VK_R, VK_RETURN, VK_RIGHT, VK_S, VK_SHIFT, VK_SPACE, VK_T, VK_TAB, VK_U, VK_UP, VK_V,
    VK_W, VK_X, VK_Y, VK_Z,
};

/// One parsed chord: any number of modifiers plus exactly one main key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chord {
    pub modifiers: Vec<VIRTUAL_KEY>,
    pub key: VIRTUAL_KEY,
    /// Navigation and editing keys live on the extended half of the keyboard.
    /// Injected without this flag, lParam bit 24 stays clear and anything
    /// reading raw scan codes -- games, DirectInput, some terminals -- sees
    /// the numpad variant instead of the arrow or Delete the caller meant.
    pub extended: bool,
}

/// Accepted syntax, deliberately small and obvious:
///
/// * a chord is `modifier+modifier+key`, e.g. `ctrl+a`, `ctrl+shift+home`
/// * modifiers are `ctrl`/`control`, `shift`, `alt`, `win`/`meta`/`cmd`
/// * a key is a single letter or digit, or one of the named keys below
/// * whitespace separates a sequence: `ctrl+a delete`
///
/// Anything else is rejected outright, including an empty component --
/// `ctrl++a` is a typo, not a synonym for `ctrl+a`, and guessing at what
/// someone meant to send to a real keyboard is the wrong instinct.
pub fn parse_sequence(spec: &str) -> Result<Vec<Chord>, String> {
    let mut chords = Vec::new();
    for token in spec.split_whitespace() {
        chords.push(parse_chord(token)?);
    }
    if chords.is_empty() {
        return Err("no keys given".to_string());
    }
    Ok(chords)
}

fn parse_chord(token: &str) -> Result<Chord, String> {
    let parts: Vec<&str> = token.split('+').collect();
    if parts.iter().any(|part| part.is_empty()) {
        return Err(format!(
            "{token:?} has an empty component -- write modifiers and the key separated by single plus signs"
        ));
    }
    let (key_part, modifier_parts) = parts
        .split_last()
        .ok_or_else(|| format!("{token:?} is not a key chord"))?;
    let mut modifiers = Vec::new();
    for part in modifier_parts {
        modifiers.push(match part.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => VK_CONTROL,
            "shift" => VK_SHIFT,
            "alt" => VK_MENU,
            "win" | "meta" | "cmd" => VK_LWIN,
            other => return Err(format!("unknown modifier {other:?} in {token:?}")),
        });
    }
    let key = parse_key(key_part)
        .ok_or_else(|| format!("unknown key {key_part:?} in {token:?}"))?;
    Ok(Chord { modifiers, key, extended: is_extended(key) })
}

fn is_extended(key: VIRTUAL_KEY) -> bool {
    matches!(
        key,
        VK_UP | VK_DOWN | VK_LEFT | VK_RIGHT | VK_HOME | VK_END | VK_PRIOR | VK_NEXT | VK_DELETE
    )
}

fn parse_key(name: &str) -> Option<VIRTUAL_KEY> {
    let lower = name.to_ascii_lowercase();
    if lower.chars().count() == 1 {
        return single_char_key(lower.chars().next()?);
    }
    match lower.as_str() {
        "return" | "enter" => Some(VK_RETURN),
        "tab" => Some(VK_TAB),
        "escape" | "esc" => Some(VK_ESCAPE),
        "space" => Some(VK_SPACE),
        "backspace" => Some(VK_BACK),
        "delete" | "del" => Some(VK_DELETE),
        "home" => Some(VK_HOME),
        "end" => Some(VK_END),
        "pageup" => Some(VK_PRIOR),
        "pagedown" => Some(VK_NEXT),
        "up" => Some(VK_UP),
        "down" => Some(VK_DOWN),
        "left" => Some(VK_LEFT),
        "right" => Some(VK_RIGHT),
        "f1" => Some(VK_F1),
        "f2" => Some(VK_F2),
        "f3" => Some(VK_F3),
        "f4" => Some(VK_F4),
        "f5" => Some(VK_F5),
        "f6" => Some(VK_F6),
        "f7" => Some(VK_F7),
        "f8" => Some(VK_F8),
        "f9" => Some(VK_F9),
        "f10" => Some(VK_F10),
        "f11" => Some(VK_F11),
        "f12" => Some(VK_F12),
        _ => None,
    }
}

fn single_char_key(ch: char) -> Option<VIRTUAL_KEY> {
    match ch {
        'a' => Some(VK_A),
        'b' => Some(VK_B),
        'c' => Some(VK_C),
        'd' => Some(VK_D),
        'e' => Some(VK_E),
        'f' => Some(VK_F),
        'g' => Some(VK_G),
        'h' => Some(VK_H),
        'i' => Some(VK_I),
        'j' => Some(VK_J),
        'k' => Some(VK_K),
        'l' => Some(VK_L),
        'm' => Some(VK_M),
        'n' => Some(VK_N),
        'o' => Some(VK_O),
        'p' => Some(VK_P),
        'q' => Some(VK_Q),
        'r' => Some(VK_R),
        's' => Some(VK_S),
        't' => Some(VK_T),
        'u' => Some(VK_U),
        'v' => Some(VK_V),
        'w' => Some(VK_W),
        'x' => Some(VK_X),
        'y' => Some(VK_Y),
        'z' => Some(VK_Z),
        '0' => Some(VK_0),
        '1' => Some(VK_1),
        '2' => Some(VK_2),
        '3' => Some(VK_3),
        '4' => Some(VK_4),
        '5' => Some(VK_5),
        '6' => Some(VK_6),
        '7' => Some(VK_7),
        '8' => Some(VK_8),
        '9' => Some(VK_9),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_bare_key_parses_with_no_modifiers() {
        let chords = parse_sequence("a").unwrap();
        assert_eq!(chords.len(), 1);
        assert!(chords[0].modifiers.is_empty());
        assert_eq!(chords[0].key, VK_A);
        assert!(!chords[0].extended);
    }

    #[test]
    fn modifiers_parse_in_order_and_are_case_insensitive() {
        let chords = parse_sequence("Ctrl+SHIFT+a").unwrap();
        assert_eq!(chords[0].modifiers, vec![VK_CONTROL, VK_SHIFT]);
        assert_eq!(chords[0].key, VK_A);
    }

    #[test]
    fn named_keys_parse() {
        assert_eq!(parse_sequence("Return").unwrap()[0].key, VK_RETURN);
        assert_eq!(parse_sequence("esc").unwrap()[0].key, VK_ESCAPE);
        assert_eq!(parse_sequence("pagedown").unwrap()[0].key, VK_NEXT);
        assert_eq!(parse_sequence("f12").unwrap()[0].key, VK_F12);
    }

    #[test]
    fn navigation_keys_are_marked_extended_and_letters_are_not() {
        assert!(parse_sequence("left").unwrap()[0].extended);
        assert!(parse_sequence("delete").unwrap()[0].extended);
        assert!(parse_sequence("home").unwrap()[0].extended);
        assert!(!parse_sequence("f1").unwrap()[0].extended);
        assert!(!parse_sequence("z").unwrap()[0].extended);
    }

    #[test]
    fn whitespace_separates_a_sequence_of_chords() {
        let chords = parse_sequence("ctrl+a delete").unwrap();
        assert_eq!(chords.len(), 2);
        assert_eq!(chords[0].key, VK_A);
        assert_eq!(chords[1].key, VK_DELETE);
        assert!(chords[1].modifiers.is_empty());
    }

    #[test]
    fn an_unknown_modifier_is_rejected_rather_than_ignored() {
        let err = parse_sequence("hyper+a").unwrap_err();
        assert!(err.contains("hyper"), "error should name the offending modifier: {err}");
    }

    #[test]
    fn an_unknown_key_is_rejected() {
        assert!(parse_sequence("ctrl+nosuchkey").is_err());
    }

    #[test]
    fn a_modifier_in_the_key_position_is_rejected() {
        assert!(parse_sequence("ctrl+ctrl").is_err());
        assert!(parse_sequence("a+ctrl").is_err());
    }

    #[test]
    fn an_empty_component_is_rejected_rather_than_silently_normalised() {
        // `ctrl++a` is a typo. Guessing that it meant `ctrl+a` and sending
        // real keystrokes on that guess is the wrong instinct.
        for spec in ["ctrl++a", "+ctrl+a", "ctrl+a+", "+"] {
            assert!(parse_sequence(spec).is_err(), "{spec:?} should be rejected");
        }
    }

    #[test]
    fn an_empty_spec_is_rejected_rather_than_sending_nothing_silently() {
        assert!(parse_sequence("   ").is_err());
        assert!(parse_sequence("").is_err());
    }

    #[test]
    fn a_malformed_chord_rejects_the_whole_sequence() {
        assert!(parse_sequence("ctrl+a hyper+b").is_err());
    }
}
