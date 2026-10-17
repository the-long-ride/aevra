//! Complete, validated payloads. Native key resolution happens before effects.
use crate::backend::ActRequest;
use crate::portable_contract::parse_keys;

#[derive(Debug)]
#[cfg_attr(windows, allow(dead_code))]
pub enum PreparedAction<'a, K> {
    Click(i32, i32),
    Text(&'a str),
    Chords(Vec<Vec<K>>),
    Scroll(i32),
}

pub fn prepare<K>(
    request: &ActRequest,
    mut resolve: impl FnMut(&str) -> Result<K, String>,
) -> Result<PreparedAction<'_, K>, String> {
    Ok(match request.op.as_str() {
        "click" => {
            let (x, y) = request
                .x
                .zip(request.y)
                .ok_or("DESKTOP_INPUT_REFUSED: click requires x and y")?;
            PreparedAction::Click(x, y)
        }
        "type" => {
            let text = request.text.as_deref().filter(|s| !s.contains('\0') && s.encode_utf16().count() <= 4096)
                .ok_or("DESKTOP_INPUT_REFUSED: type requires text without NUL, at most 4096 UTF-16 units")?;
            PreparedAction::Text(text)
        }
        "key" => {
            let parsed = parse_keys(
                request
                    .keys
                    .as_deref()
                    .ok_or("DESKTOP_INPUT_REFUSED: key requires keys")?,
            )?;
            let chords = parsed
                .into_iter()
                .map(|chord| {
                    chord
                        .into_iter()
                        .map(|name| resolve(&name))
                        .collect::<Result<Vec<_>, _>>()
                })
                .collect::<Result<Vec<_>, _>>()?;
            PreparedAction::Chords(chords)
        }
        "scroll" => {
            let delta = request
                .delta_y
                .ok_or("DESKTOP_INPUT_REFUSED: scroll requires deltaY")?;
            let steps = -(delta / 120).clamp(-100, 100);
            if steps == 0 && delta != 0 {
                return Err(
                    "DESKTOP_INPUT_REFUSED: scroll deltaY must be at least one 120-unit wheel tick"
                        .into(),
                );
            }
            PreparedAction::Scroll(steps)
        }
        _ => return Err("DESKTOP_INPUT_REFUSED: unsupported raw input operation".into()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_every_payload_and_resolves_keys_once() {
        let request = |value| serde_json::from_value::<ActRequest>(value).unwrap();
        let mut count = 0;
        let key = request(serde_json::json!({"op":"key","keys":"ctrl+a enter"}));
        let action = prepare(&key, |name| {
            count += 1;
            Ok(name.to_owned())
        })
        .unwrap();
        assert!(matches!(action, PreparedAction::Chords(chords) if chords.len() == 2));
        assert_eq!(count, 3);
        for value in [
            serde_json::json!({"op":"click","x":1}),
            serde_json::json!({"op":"type","text":"a\u{0000}b"}),
            serde_json::json!({"op":"scroll","deltaY":1}),
            serde_json::json!({"op":"unknown"}),
        ] {
            assert!(prepare(&request(value), |_| Ok(())).is_err());
        }
        let malformed = request(serde_json::json!({"op":"key","keys":"ctrl+a unknown"}));
        assert!(prepare(&malformed, |_| -> Result<(), String> {
            panic!("resolve after malformed parse")
        })
        .is_err());
    }
}
