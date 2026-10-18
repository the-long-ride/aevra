//! Retain a provider identity path, then refresh only that path per effect.
use super::*;

pub(super) fn focused_path(window: &Element) -> Result<Vec<String>, String> {
    let mut queue = VecDeque::from([(window.clone(), Vec::new())]);
    let mut found = None;
    let mut visited = 0;
    while let Some((element, path)) = queue.pop_front() {
        visited += 1;
        if visited > 5000 || path.len() > 64 {
            return Err("DESKTOP_INPUT_REFUSED: focused field exceeds bounded traversal".into());
        }
        if element.states.focused && !matches!(element.role, Role::Window | Role::Dialog) {
            if found.is_some() || protected_field(&element) || !element.states.enabled {
                return Err(
                    "DESKTOP_INPUT_REFUSED: focused field is protected or ambiguous".into(),
                );
            }
            found = Some(path.clone());
        }
        for child in element.children().map_err(map_a11y)? {
            let mut next = path.clone();
            next.push(window_id_for(&child));
            queue.push_back((child, next));
        }
    }
    found.ok_or("DESKTOP_INPUT_REFUSED: focused field cannot be verified".into())
}

pub(super) fn verify_field(window: &Element, path: &[String]) -> Result<(), String> {
    let mut current = window.clone();
    for id in path {
        current = current
            .children()
            .map_err(map_a11y)?
            .into_iter()
            .find(|e| window_id_for(e) == *id && e.pid == window.pid)
            .ok_or("DESKTOP_INPUT_REFUSED: focused field path changed; observe again")?;
    }
    if !current.states.focused || !current.states.enabled || protected_field(&current) {
        return Err(
            "DESKTOP_INPUT_REFUSED: focused field changed or is protected; observe again".into(),
        );
    }
    Ok(())
}
