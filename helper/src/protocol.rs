//! Request/response types for the line-delimited JSON-RPC-ish wire protocol
//! spoken over stdin/stdout. One JSON object per line:
//!
//! - Request: `{"id":<number>,"method":"<string>","params":<object>}`
//! - Success: `{"id":<number>,"result":<value>}`
//! - Error:   `{"id":<number>,"error":"<message>"}`
//!
//! This must be a drop-in match for `packages/desktop/test/fake-helper.ts`
//! (driver mode) and what `packages/desktop/src/helper-process.ts` parses.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
pub struct Request {
    pub id: i64,
    pub method: String,
    #[serde(default)]
    #[allow(dead_code)]
    pub params: Value,
}

#[derive(Debug, Serialize)]
pub struct SuccessReply {
    pub id: i64,
    pub result: Value,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct ErrorReply {
    pub id: i64,
    pub error: Value,
}

/// Parses one input line into a `Request`. A line that is not valid JSON, or
/// is valid JSON missing the required fields, never panics and never is
/// silently dropped: it comes back as an `ErrorReply` the caller can write
/// straight to stdout. When the malformed input still has a readable `id`
/// field, that id is preserved so the caller on the other end (which matches
/// replies by id) has a chance to see it; otherwise `id` falls back to `0`,
/// which cannot match any real pending call and is therefore safely ignored
/// by `HelperProcess` rather than corrupting an unrelated pending promise.
pub fn parse_request(line: &str) -> Result<Request, ErrorReply> {
    match serde_json::from_str::<Request>(line) {
        Ok(request) => Ok(request),
        Err(err) => {
            let id = serde_json::from_str::<Value>(line)
                .ok()
                .and_then(|value| value.get("id").and_then(Value::as_i64))
                .unwrap_or(0);
            Err(ErrorReply {
                id,
                error: Value::String(format!("invalid request: {err}")),
            })
        }
    }
}

pub fn success_line(id: i64, result: Value) -> String {
    let reply = SuccessReply { id, result };
    serde_json::to_string(&reply).unwrap_or_else(|_| format!("{{\"id\":{id},\"error\":\"failed to serialise result\"}}"))
}

pub fn error_line(id: i64, message: impl Into<String>) -> String {
    let reply = ErrorReply { id, error: Value::String(message.into()) };
    serde_json::to_string(&reply).unwrap_or_else(|_| format!("{{\"id\":{id},\"error\":\"failed to serialise error\"}}"))
}

pub fn structured_error_line(id: i64, code: &str, message: &str, details: Option<Value>) -> String {
    let mut map = serde_json::Map::new();
    map.insert("code".to_string(), Value::String(code.to_string()));
    map.insert("message".to_string(), Value::String(message.to_string()));
    if let Some(d) = details {
        map.insert("details".to_string(), d);
    }
    let reply = ErrorReply { id, error: Value::Object(map) };
    serde_json::to_string(&reply).unwrap_or_else(|_| format!("{{\"id\":{id},\"error\":\"failed to serialise error\"}}"))
}

impl std::fmt::Display for ErrorReply {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", serde_json::to_string(self).unwrap_or_default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_line_parses() {
        let request = parse_request(r#"{"id":1,"method":"connect","params":{}}"#).unwrap();
        assert_eq!(request.id, 1);
        assert_eq!(request.method, "connect");
    }

    #[test]
    fn request_line_parses_without_params() {
        let request = parse_request(r#"{"id":7,"method":"windows"}"#).unwrap();
        assert_eq!(request.id, 7);
        assert_eq!(request.method, "windows");
    }

    #[test]
    fn success_reply_matches_exact_wire_shape() {
        let line = success_line(1, serde_json::json!({"ok": true}));
        assert_eq!(line, r#"{"id":1,"result":{"ok":true}}"#);
    }

    #[test]
    fn error_reply_matches_exact_wire_shape() {
        let line = error_line(2, "boom");
        assert_eq!(line, r#"{"id":2,"error":"boom"}"#);
    }

    #[test]
    fn structured_error_matches_wire_shape() {
        let line = structured_error_line(3, "DESKTOP_REF_STALE", "Expired", None);
        assert_eq!(line, r#"{"id":3,"error":{"code":"DESKTOP_REF_STALE","message":"Expired"}}"#);
    }

    #[test]
    fn malformed_line_produces_error_reply_not_panic_or_silent_drop() {
        let err = parse_request("this is not json").unwrap_err();
        assert_eq!(err.id, 0);
        assert!(!err.error.as_str().unwrap().is_empty());
    }

    #[test]
    fn malformed_line_preserves_a_readable_id() {
        let err = parse_request(r#"{"id":9,"method":123}"#).unwrap_err();
        assert_eq!(err.id, 9);
    }
}
