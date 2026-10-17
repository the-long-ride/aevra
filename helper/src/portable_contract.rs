//! Validation with no OS effects; all input is planned before dispatch.
/// Leave time for the host's post-action observation within its 10s deadline.
pub struct InputBudget(std::time::Instant);
impl InputBudget {
    pub fn new() -> Self {
        Self(std::time::Instant::now())
    }
    pub fn check(&self) -> Result<(), String> {
        if self.0.elapsed() >= std::time::Duration::from_millis(7500) {
            return Err(
                "DESKTOP_TIMEOUT: native input budget exhausted; observe before continuing".into(),
            );
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy)]
pub struct NativeWindow {
    pub id: u32,
    pub pid: u32,
    pub rect: Rect,
    #[cfg(any(test, target_os = "linux"))]
    pub buffer: Option<Rect>,
}

pub fn bind_window(pid: u32, rect: Rect, windows: &[NativeWindow]) -> Result<u32, String> {
    if pid == 0 || rect.width == 0 || rect.height == 0 {
        return Err(
            "DESKTOP_TARGET_CHANGED: target has no verified process or visible bounds".into(),
        );
    }
    let mut candidates = windows.iter().filter(|w| w.pid == pid && w.rect == rect);
    match (candidates.next(), candidates.next()) {
        (Some(window), None) => Ok(window.id),
        _ => Err("DESKTOP_TARGET_CHANGED: no unique native window matches the process and bounds; observe again".into()),
    }
}

/// AX marks the actual key window active, including when a floating panel is
/// key and a document stays main. PID alone cannot disambiguate these windows.
#[cfg(any(test, target_os = "macos"))]
pub fn bind_focused_window(
    ax: &[(u32, Rect, bool)],
    native: &[NativeWindow],
) -> Result<u32, String> {
    let mut active = ax.iter().filter(|(_, _, active)| *active);
    match (active.next(), active.next()) {
        (Some((pid, rect, _)), None) => bind_window(*pid, *rect, native),
        _ => Err("DESKTOP_TARGET_CHANGED: no unique AX focused window".into()),
    }
}

pub fn guard_point(rect: Rect, x: i32, y: i32, expected: u32, hit: u32) -> Result<(), String> {
    let inside = i64::from(x) >= i64::from(rect.x)
        && i64::from(y) >= i64::from(rect.y)
        && i64::from(x) < i64::from(rect.x) + i64::from(rect.width)
        && i64::from(y) < i64::from(rect.y) + i64::from(rect.height);
    if !inside || expected != hit {
        return Err("DESKTOP_INPUT_REFUSED: pointer target is outside the verified foreground window or is occluded".into());
    }
    Ok(())
}

#[cfg(any(test, target_os = "macos"))]
pub fn rgba_to_rgb(
    width: u32,
    height: u32,
    stride: usize,
    bytes: &[u8],
    bgra: bool,
) -> Result<Vec<u8>, String> {
    let row = (width as usize)
        .checked_mul(4)
        .ok_or("DESKTOP_PROVIDER_UNAVAILABLE: invalid width")?;
    let size = stride
        .checked_mul(height as usize)
        .ok_or("DESKTOP_PROVIDER_UNAVAILABLE: frame size overflow")?;
    // Bound working memory before conversion, independently of native allocation.
    if width == 0 || height == 0 || stride < row || size > 128 * 1024 * 1024 || bytes.len() < size {
        return Err(
            "DESKTOP_PROVIDER_UNAVAILABLE: invalid, oversized or incomplete pixel buffer".into(),
        );
    }
    let mut rgb = Vec::with_capacity(width as usize * height as usize * 3);
    for line in bytes[..size].chunks_exact(stride) {
        for p in line[..row].as_chunks::<4>().0 {
            if bgra {
                rgb.extend_from_slice(&[p[2], p[1], p[0]]);
            } else {
                rgb.extend_from_slice(&p[..3]);
            }
        }
    }
    Ok(rgb)
}

pub fn capture_scale(output_width: u32, logical_width: u32) -> Result<f64, String> {
    if output_width == 0 || logical_width == 0 {
        return Err("DESKTOP_PROVIDER_UNAVAILABLE: empty capture dimensions".into());
    }
    Ok(f64::from(output_width) / f64::from(logical_width))
}

/// Canonical names; last key is the main key. Parse the entire sequence first.
pub fn parse_keys(spec: &str) -> Result<Vec<Vec<String>>, String> {
    let mut chords = Vec::new();
    for token in spec.split_whitespace() {
        let mut parts = token
            .split('+')
            .map(|s| match s.to_ascii_lowercase().as_str() {
                "control" => "ctrl".into(),
                "win" | "cmd" => "meta".into(),
                other => other.to_string(),
            })
            .collect::<Vec<_>>();
        let key = parts.pop().ok_or("DESKTOP_INPUT_REFUSED: missing key")?;
        let named = [
            "enter",
            "return",
            "escape",
            "esc",
            "tab",
            "space",
            "backspace",
            "delete",
            "del",
            "insert",
            "up",
            "down",
            "left",
            "right",
            "home",
            "end",
            "pageup",
            "pagedown",
        ];
        let function = key
            .strip_prefix('f')
            .and_then(|v| v.parse::<u8>().ok())
            .is_some_and(|v| (1..=24).contains(&v));
        let character = key.len() == 1 && key.as_bytes()[0].is_ascii_alphanumeric();
        if !(function || character || named.contains(&key.as_str())) {
            return Err("DESKTOP_INPUT_REFUSED: unsupported key name".into());
        }
        let mut seen = std::collections::HashSet::new();
        if parts
            .iter()
            .any(|p| !["ctrl", "alt", "shift", "meta"].contains(&p.as_str()) || !seen.insert(p))
        {
            return Err("DESKTOP_INPUT_REFUSED: malformed or repeated key modifier".into());
        }
        parts.push(key);
        chords.push(parts);
    }
    if chords.is_empty() {
        return Err("DESKTOP_INPUT_REFUSED: key sequence is empty".into());
    }
    Ok(chords)
}

#[cfg(test)]
#[path = "portable_contract_tests.rs"]
mod tests;

pub trait KeySink {
    type Key;
    fn key(&mut self, key: &Self::Key, down: bool) -> Result<(), String>;
}

/// Release every attempted press, including an OS call whose completion is uncertain.
pub fn execute_chords<S: KeySink>(
    sink: &mut S,
    chords: &[Vec<S::Key>],
    mut guard: impl FnMut() -> Result<(), String>,
) -> Result<(), String> {
    let mut sent = false;
    for chord in chords {
        let mut held = Vec::new();
        let result = (|| {
            for key in chord {
                guard()?;
                held.push(key);
                sent = true;
                sink.key(key, true)?;
            }
            Ok::<(), String>(())
        })();
        let mut release_error = false;
        for key in held.into_iter().rev() {
            release_error |= sink.key(key, false).is_err();
        }
        if result.is_err() || release_error {
            // Do not echo the text or native payload to diagnostics.
            return Err(if sent {
                "DESKTOP_OUTCOME_UNKNOWN: input may have been applied; held keys released where possible; observe again before any further input".into()
            } else {
                result.unwrap_err()
            });
        }
    }
    Ok(())
}

pub trait TextSink {
    fn text(&mut self, text: &str) -> Result<(), String>;
}
/// Text transport preserves Unicode independently of the keyboard layout.
pub fn execute_text(
    sink: &mut impl TextSink,
    text: &str,
    mut guard: impl FnMut() -> Result<(), String>,
) -> Result<(), String> {
    let mut sent = false;
    for ch in text.chars() {
        guard().map_err(|e|if sent{"DESKTOP_OUTCOME_UNKNOWN: text input stopped after partial effects; observe before further input".into()}else{e})?;
        sent = true;
        let mut bytes = [0; 4];
        sink.text(ch.encode_utf8(&mut bytes)).map_err(|_|"DESKTOP_OUTCOME_UNKNOWN: text input may have been applied; observe before further input".to_string())?;
    }
    Ok(())
}

pub fn provider_key(pid: u32, handle: &str, bus: Option<&str>, stable: Option<&str>) -> String {
    match (bus, stable) {
        (Some(bus), Some(path)) if !bus.is_empty() && !path.is_empty() => {
            format!("{pid}:atspi:{bus}:{path}")
        }
        _ => format!("{pid}:handle:{handle}"),
    }
}

#[cfg(any(test, target_os = "macos"))]
pub fn logical_pointer(x: f64, y: f64) -> Result<(i32, i32), String> {
    if [x, y]
        .iter()
        .any(|v| !v.is_finite() || *v < f64::from(i32::MIN) || *v > f64::from(i32::MAX))
    {
        return Err("DESKTOP_INPUT_REFUSED: native pointer coordinates are invalid".into());
    }
    Ok((x.round() as i32, y.round() as i32))
}
