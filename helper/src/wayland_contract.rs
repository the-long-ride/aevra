//! Host-independent Wayland compositor contract and key planning.
use crate::portable_contract::Rect;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Window {
    pub id: u32,
    pub pid: u32,
    pub rect: Bounds,
    #[serde(default)]
    pub buffer: Option<Bounds>,
    pub focused: bool,
}
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}
impl From<Bounds> for Rect {
    fn from(r: Bounds) -> Self {
        Self {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
        }
    }
}

pub fn bind_accessible(
    pid: u32,
    width: u32,
    height: u32,
    native: &[crate::portable_contract::NativeWindow],
    accessible_matches: usize,
) -> Result<u32, String> {
    if accessible_matches != 1 {
        return Err("DESKTOP_TARGET_CHANGED: ambiguous accessible Wayland window".into());
    }
    let mut candidates = native
        .iter()
        .filter(|w| w.pid == pid && accessibility_rect(w, width, height).is_ok());
    match (candidates.next(), candidates.next()) {
        (Some(w), None) => Ok(w.id),
        _ => Err("DESKTOP_TARGET_CHANGED: ambiguous compositor Wayland window".into()),
    }
}

pub fn decode_windows(data: &str) -> Result<Vec<Window>, String> {
    if data.len() > 1024 * 1024 {
        return Err("DESKTOP_PROVIDER_UNAVAILABLE: oversized compositor metadata".into());
    }
    let windows: Vec<Window> = serde_json::from_str(data)
        .map_err(|_| "DESKTOP_PROVIDER_UNAVAILABLE: invalid compositor window metadata")?;
    let mut ids = std::collections::HashSet::new();
    if windows.len() > 4096
        || windows.iter().any(|w| {
            w.id == 0 || w.pid == 0 || w.rect.width == 0 || w.rect.height == 0 || !ids.insert(w.id)
        })
    {
        return Err(
            "DESKTOP_PROVIDER_UNAVAILABLE: unattributable or ambiguous compositor window".into(),
        );
    }
    Ok(windows)
}
pub fn unicode_keysym(ch: char) -> u32 {
    let value = u32::from(ch);
    if value <= 255 {
        value
    } else {
        0x01000000 | value
    }
}
pub fn key(name: &str) -> Result<u32, String> {
    Ok(match name {
        "ctrl" => 0xffe3,
        "shift" => 0xffe1,
        "alt" => 0xffe9,
        "meta" => 0xffeb,
        "enter" | "return" => 0xff0d,
        "escape" | "esc" => 0xff1b,
        "tab" => 0xff09,
        "space" => 0x20,
        "backspace" => 0xff08,
        "delete" | "del" => 0xffff,
        "insert" => 0xff63,
        "home" => 0xff50,
        "end" => 0xff57,
        "pageup" => 0xff55,
        "pagedown" => 0xff56,
        "left" => 0xff51,
        "up" => 0xff52,
        "right" => 0xff53,
        "down" => 0xff54,
        _ if name
            .strip_prefix('f')
            .and_then(|v| v.parse::<u32>().ok())
            .is_some_and(|v| (1..=24).contains(&v)) =>
        {
            0xffbd + name[1..].parse::<u32>().unwrap()
        }
        _ if name.len() == 1 && name.as_bytes()[0].is_ascii_alphanumeric() => {
            unicode_keysym(name.chars().next().unwrap())
        }
        _ => return Err("DESKTOP_INPUT_REFUSED: unsupported Wayland key".into()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn compositor_windows_and_unicode_keys_are_validated_without_title_matching() {
        let windows = decode_windows(
            r#"[{"id":1,"pid":42,"rect":{"x":-30,"y":0,"width":400,"height":200},"focused":true}]"#,
        )
        .unwrap();
        assert_eq!(windows[0].id, 1);
        assert!(windows[0].focused);
        assert!(windows[0].buffer.is_none());
        assert_eq!(unicode_keysym('漢'), 0x01006f22);
        assert_eq!(unicode_keysym('é'), 0xe9);
        assert_eq!(key("ctrl").unwrap(), 0xffe3);
        assert_eq!(key("f24").unwrap(), 0xffd5);
        assert!(key("unknown").is_err());
        for data in [
            r#"[{"id":0,"pid":42,"rect":{"x":0,"y":0,"width":10,"height":10},"focused":true}]"#,
            r#"[{"id":1,"pid":0,"rect":{"x":0,"y":0,"width":10,"height":10},"focused":true}]"#,
            r#"[{"id":1,"pid":42,"rect":{"x":0,"y":0,"width":0,"height":10},"focused":true}]"#,
        ] {
            assert!(decode_windows(data).is_err());
        }
    }

    #[test]
    fn binds_window_relative_accessibility_only_when_both_sides_are_unique() {
        let r = Rect {
            x: 100,
            y: 400,
            width: 400,
            height: 240,
        };
        let native = [crate::portable_contract::NativeWindow {
            buffer: None,
            id: 7,
            pid: 42,
            rect: r,
        }];
        assert_eq!(bind_accessible(42, 400, 240, &native, 1).unwrap(), 7);
        assert!(bind_accessible(42, 400, 240, &native, 2).is_err());
        assert!(bind_accessible(43, 400, 240, &native, 1).is_err());
        assert!(bind_accessible(42, 400, 241, &native, 1).is_err());
        let duplicate = [
            native[0],
            crate::portable_contract::NativeWindow {
                buffer: None,
                id: 8,
                rect: Rect { x: 600, ..r },
                ..native[0]
            },
        ];
        assert!(bind_accessible(42, 400, 240, &duplicate, 1).is_err());
    }
}

#[test]
fn compositor_selection_requires_supported_explicit_desktop() {
    assert_eq!(
        compositor("ubuntu:GNOME"),
        Some(("org.gnome.Shell", "gnome-shell"))
    );
    assert_eq!(compositor("KDE"), Some(("org.kde.KWin", "kwin_wayland")));
    assert_eq!(compositor("sway"), None);
}

/// Select only explicitly supported compositor sessions at the connect boundary.
pub fn compositor(desktop: &str) -> Option<(&'static str, &'static str)> {
    let names: Vec<_> = desktop.split(':').collect();
    if names.iter().any(|v| v.eq_ignore_ascii_case("KDE")) {
        Some(("org.kde.KWin", "kwin_wayland"))
    } else if names.iter().any(|v| v.eq_ignore_ascii_case("GNOME")) {
        Some(("org.gnome.Shell", "gnome-shell"))
    } else {
        None
    }
}

#[test]
fn decorated_accessibility_binds_buffer_geometry_and_uses_its_origin() {
    let frame = Rect {
        x: 440,
        y: 278,
        width: 400,
        height: 277,
    };
    let buffer = Rect {
        x: 414,
        y: 255,
        width: 452,
        height: 329,
    };
    let native = crate::portable_contract::NativeWindow {
        id: 1,
        pid: 42,
        rect: frame,
        buffer: Some(buffer),
    };
    assert_eq!(accessibility_rect(&native, 452, 329).unwrap(), buffer);
    assert_eq!(accessibility_rect(&native, 400, 277).unwrap(), frame);
    assert!(accessibility_rect(&native, 451, 329).is_err());
    assert_eq!(bind_accessible(42, 452, 329, &[native], 1).unwrap(), 1);
    assert!(bind_accessible(42, 452, 329, &[native, native], 1).is_err());
}

/// AX may describe the frame or the native client buffer including CSD padding.
/// Both are compositor-attested; arbitrary size tolerances are never accepted.
pub fn accessibility_rect(
    window: &crate::portable_contract::NativeWindow,
    width: u32,
    height: u32,
) -> Result<Rect, String> {
    let matches = |r: Rect| r.width == width && r.height == height;
    let frame = matches(window.rect).then_some(window.rect);
    let buffer = window.buffer.filter(|r| matches(*r));
    match (frame, buffer) {
        (Some(f), Some(b)) if f != b => {
            Err("DESKTOP_TARGET_CHANGED: ambiguous accessible geometry".into())
        }
        (_, Some(b)) => Ok(b),
        (Some(f), None) => Ok(f),
        _ => Err("DESKTOP_TARGET_CHANGED: no exact compositor accessibility geometry".into()),
    }
}
