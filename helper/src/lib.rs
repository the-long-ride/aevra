//! Stdio JSON-RPC loop for the Aevra desktop-control helper.
//!
//! Line-delimited JSON on stdin/stdout, one object per line. Nothing but a
//! reply line ever goes to stdout: a stray `println!` would corrupt the
//! stream and make the TypeScript supervisor (`HelperProcess`) time out
//! waiting for a reply that never parses. All diagnostics go to stderr.

#[cfg(windows)]
mod act;
pub mod backend;
#[cfg(windows)]
mod background;
#[cfg(windows)]
mod background_snapshots;
mod capture;
#[cfg(windows)]
mod grab;
#[cfg(windows)]
mod handles;
#[cfg(windows)]
mod input;
#[cfg(any(test, target_os = "macos", target_os = "linux"))]
mod input_executor;
#[cfg(windows)]
mod keys;
#[cfg(all(test, target_os = "macos"))]
mod native_macos_tests;
#[cfg(all(test, target_os = "linux"))]
mod native_wayland_tests;
#[cfg(all(test, target_os = "linux"))]
mod native_x11_tests;
#[cfg(any(target_os = "macos", target_os = "linux"))]
mod portable;
#[cfg(any(test, target_os = "macos", target_os = "linux"))]
mod portable_action;
#[cfg(any(test, target_os = "macos", target_os = "linux"))]
mod portable_contract;
#[cfg(any(target_os = "macos", target_os = "linux"))]
mod portable_input;
#[cfg(target_os = "linux")]
#[path = "portable_x11.rs"]
mod portable_pixels;
#[cfg(target_os = "macos")]
#[path = "portable_macos.rs"]
mod portable_pixels;
mod protocol;
pub mod target_guard;
#[cfg(windows)]
mod uia;
#[cfg(target_os = "linux")]
mod wayland;
#[cfg(any(test, target_os = "linux"))]
mod wayland_contract;
#[cfg(target_os = "linux")]
mod wayland_input;
#[cfg(windows)]
mod window_host;
#[cfg(windows)]
#[path = "windows.rs"]
mod windows_backend;

use backend::{
    ActRequest, BackgroundActRequest, CaptureRequest, DescribeBackgroundRequest, DescribeRequest,
    DesktopBackend, ReleaseBackgroundSnapshotRequest, TargetIdentityRequest,
};
use protocol::{error_line, parse_request, structured_error_line, success_line, Request};
use std::io::{self, BufRead, Write};

pub fn serve_stdio() {
    let backend = new_native_backend();
    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(err) => {
                eprintln!("stdin read error: {err}");
                break;
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        let reply = match parse_request(&line) {
            Ok(request) => handle(&backend, request),
            Err(err) => err.to_string(),
        };
        if writeln!(stdout, "{reply}").is_err() {
            break;
        }
        let _ = stdout.flush();
    }
}

fn map_err_line(id: i64, err: String) -> String {
    if let Some((code, msg)) = err.split_once(':') {
        let code = code.trim();
        if code.starts_with("DESKTOP_") {
            return structured_error_line(id, code, msg.trim(), None);
        }
    }
    if err.starts_with("DESKTOP_") {
        return structured_error_line(id, &err, &err, None);
    }
    error_line(id, err)
}

fn result_line<T: serde::Serialize>(id: i64, result: Result<T, String>, label: &str) -> String {
    match result {
        Ok(value) => match serde_json::to_value(value) {
            Ok(value) => success_line(id, value),
            Err(err) => error_line(id, format!("failed to serialise {label} result: {err}")),
        },
        Err(err) => map_err_line(id, err),
    }
}

fn handle(backend: &impl DesktopBackend, request: Request) -> String {
    match request.method.as_str() {
        "connect" => result_line(request.id, backend.connect(), "connect"),
        "windows" => result_line(request.id, backend.windows(), "windows"),
        "focusedWindow" => result_line(request.id, backend.focused_window(), "focusedWindow"),
        "screenState" => result_line(request.id, backend.screen_state(), "screenState"),
        "describe" => match serde_json::from_value::<DescribeRequest>(request.params.clone()) {
            Ok(describe_request) => match backend.describe(describe_request) {
                Ok(result) => match serde_json::to_value(result) {
                    Ok(value) => success_line(request.id, value),
                    Err(err) => error_line(
                        request.id,
                        format!("failed to serialise describe result: {err}"),
                    ),
                },
                Err(err) => map_err_line(request.id, err),
            },
            Err(err) => error_line(request.id, format!("invalid describe params: {err}")),
        },
        "act" => match serde_json::from_value::<ActRequest>(request.params.clone()) {
            Ok(act_request) => match backend.act(act_request) {
                Ok(ok) => success_line(request.id, serde_json::Value::Bool(ok)),
                Err(err) => map_err_line(request.id, err),
            },
            Err(err) => error_line(request.id, format!("invalid act params: {err}")),
        },
        "capture" => match serde_json::from_value::<CaptureRequest>(request.params.clone()) {
            Ok(capture_request) => match backend.capture(capture_request) {
                Ok(result) => match serde_json::to_value(result) {
                    Ok(value) => success_line(request.id, value),
                    Err(err) => error_line(
                        request.id,
                        format!("failed to serialise capture result: {err}"),
                    ),
                },
                Err(err) => map_err_line(request.id, err),
            },
            Err(err) => error_line(request.id, format!("invalid capture params: {err}")),
        },
        "targetIdentity" => {
            match serde_json::from_value::<TargetIdentityRequest>(request.params.clone()) {
                Ok(req) => match backend.target_identity(req) {
                    Ok(result) => match serde_json::to_value(result) {
                        Ok(value) => success_line(request.id, value),
                        Err(err) => error_line(
                            request.id,
                            format!("failed to serialise targetIdentity result: {err}"),
                        ),
                    },
                    Err(err) => map_err_line(request.id, err),
                },
                Err(err) => error_line(request.id, format!("invalid targetIdentity params: {err}")),
            }
        }
        "describeBackground" => {
            match serde_json::from_value::<DescribeBackgroundRequest>(request.params.clone()) {
                Ok(req) => match backend.describe_background(req) {
                    Ok(result) => match serde_json::to_value(result) {
                        Ok(value) => success_line(request.id, value),
                        Err(err) => error_line(
                            request.id,
                            format!("failed to serialise describeBackground result: {err}"),
                        ),
                    },
                    Err(err) => map_err_line(request.id, err),
                },
                Err(err) => error_line(
                    request.id,
                    format!("invalid describeBackground params: {err}"),
                ),
            }
        }
        "releaseBackgroundSnapshot" => {
            match serde_json::from_value::<ReleaseBackgroundSnapshotRequest>(request.params.clone())
            {
                Ok(req) => match backend.release_background_snapshot(req) {
                    Ok(ok) => success_line(request.id, serde_json::Value::Bool(ok)),
                    Err(err) => map_err_line(request.id, err),
                },
                Err(err) => error_line(
                    request.id,
                    format!("invalid releaseBackgroundSnapshot params: {err}"),
                ),
            }
        }
        "backgroundAct" => {
            match serde_json::from_value::<BackgroundActRequest>(request.params.clone()) {
                Ok(req) => match backend.background_act(req) {
                    Ok(result) => match serde_json::to_value(result) {
                        Ok(value) => success_line(request.id, value),
                        Err(err) => map_err_line(
                            request.id,
                            format!("failed to serialise backgroundAct result: {err}"),
                        ),
                    },
                    Err(err) => map_err_line(request.id, err),
                },
                Err(err) => error_line(request.id, format!("invalid backgroundAct params: {err}")),
            }
        }
        other => error_line(request.id, format!("unknown method: {other}")),
    }
}

/// Construct on its owning actor thread; native accessibility handles are !Send.
#[cfg(windows)]
pub fn new_native_backend() -> impl backend::DesktopBackend {
    windows_backend::WindowsBackend::new()
}
#[cfg(any(target_os = "macos", target_os = "linux"))]
pub fn new_native_backend() -> impl backend::DesktopBackend {
    portable::PortableBackend::new()
}
