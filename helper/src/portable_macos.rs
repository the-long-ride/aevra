//! ScreenCaptureKit isolated-window streams. Never substitute a display crop.
use crate::capture::Frame;
use crate::portable_contract::{rgba_to_rgb, NativeWindow, Rect};
use screencapturekit::cm::CMSampleBufferExt;
use screencapturekit::cv::CVPixelBufferLockFlags;
use screencapturekit::prelude::*;
use std::sync::mpsc::{sync_channel, SyncSender};
use std::time::Duration;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
}
fn error(e: impl std::fmt::Display) -> String {
    format!("DESKTOP_PROVIDER_UNAVAILABLE: ScreenCaptureKit: {e}")
}
pub fn ensure_session() -> Result<(), String> {
    Ok(())
}
pub fn ready() -> bool {
    // A capability probe must never itself open a consent prompt.
    unsafe { CGPreflightScreenCaptureAccess() }
}
fn content() -> Result<SCShareableContent, String> {
    if !ready() {
        return Err("DESKTOP_PERMISSION_REQUIRED: enable Screen Recording for this binary in System Settings > Privacy & Security, then reconnect".into());
    }
    SCShareableContent::get().map_err(error)
}
pub fn windows() -> Result<Vec<NativeWindow>, String> {
    let mut result = Vec::new();
    for w in xcap::Window::all().map_err(error)? {
        if w.is_minimized().map_err(error)? {
            continue;
        }
        result.push(NativeWindow {
            #[cfg(test)]
            buffer: None,
            id: w.id().map_err(error)?,
            pid: w.pid().map_err(error)?,
            rect: Rect {
                x: w.x().map_err(error)?,
                y: w.y().map_err(error)?,
                width: w.width().map_err(error)?,
                height: w.height().map_err(error)?,
            },
        });
    }
    Ok(result)
}
pub fn focused() -> Result<u32, String> {
    let provider = xa11y::provider().map_err(error)?;
    let app = provider.focused_app().map_err(error)?;
    let ax = provider
        .get_children(Some(&app))
        .map_err(error)?
        .into_iter()
        .filter(|w| matches!(w.role, xa11y::Role::Window | xa11y::Role::Dialog))
        .filter_map(|w| {
            w.pid.zip(w.bounds).map(|(pid, r)| {
                (
                    pid,
                    Rect {
                        x: r.x,
                        y: r.y,
                        width: r.width,
                        height: r.height,
                    },
                    w.states.active,
                )
            })
        })
        .collect::<Vec<_>>();
    crate::portable_contract::bind_focused_window(&ax, &windows()?)
}

pub fn window(id: u32) -> Result<NativeWindow, String> {
    windows()?
        .into_iter()
        .find(|w| w.id == id)
        .ok_or("DESKTOP_TARGET_CHANGED: native window disappeared".into())
}
pub fn hit(x: i32, y: i32) -> Result<u32, String> {
    use core_foundation::{
        base::CFType, dictionary::CFDictionary, number::CFNumber, string::CFString,
    };
    use core_graphics::{geometry::CGRect, window::*};
    // This list is deliberately UNFILTERED: sharing-disabled and unnamed windows
    // must still block pointer input into any surface underneath them.
    let ids = create_window_list(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
        0,
    )
    .ok_or("DESKTOP_INPUT_REFUSED: native surface list unavailable")?;
    let descriptions = create_description_from_array(ids)
        .ok_or("DESKTOP_INPUT_REFUSED: native surface metadata unavailable")?;
    for entry in descriptions.iter() {
        let dict: &CFDictionary<CFString, CFType> = &entry;
        let value = dict
            .find(CFString::new("kCGWindowBounds"))
            .and_then(|v| v.downcast::<CFDictionary>())
            .ok_or("DESKTOP_INPUT_REFUSED: an occluding surface has unverifiable bounds")?;
        let r = CGRect::from_dict_representation(&value)
            .ok_or("DESKTOP_INPUT_REFUSED: native surface bounds unavailable")?;
        if f64::from(x) >= r.origin.x
            && f64::from(y) >= r.origin.y
            && f64::from(x) < r.origin.x + r.size.width
            && f64::from(y) < r.origin.y + r.size.height
        {
            return dict
                .find(CFString::new("kCGWindowNumber"))
                .and_then(|v| v.downcast::<CFNumber>())
                .and_then(|v| v.to_i64())
                .and_then(|v| u32::try_from(v).ok())
                .filter(|v| *v != 0)
                .ok_or_else(|| {
                    "DESKTOP_INPUT_REFUSED: top native surface has no verified identity".into()
                });
        }
    }
    Err("DESKTOP_INPUT_REFUSED: pointer has no verified native target".into())
}
struct OneFrame(SyncSender<Result<Frame, String>>);
impl SCStreamOutputTrait for OneFrame {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, kind: SCStreamOutputType) {
        if !matches!(kind, SCStreamOutputType::Screen) {
            return;
        }
        let Some(buffer) = sample.pixel_buffer() else {
            return;
        };
        let Ok(locked) = buffer.lock(CVPixelBufferLockFlags::READ_ONLY) else {
            return;
        };
        // SAFETY: the CVPixelBuffer remains locked for the entire borrowed slice.
        let Some(bytes) = (unsafe { locked.as_slice() }) else {
            return;
        };
        let width = locked.width() as u32;
        let height = locked.height() as u32;
        let result = rgba_to_rgb(width, height, locked.bytes_per_row(), bytes, true)
            .map(|rgb| Frame { width, height, rgb });
        // Bounded channel: capture callbacks must never wait for the actor.
        let _ = self.0.try_send(result);
    }
}
fn grab(filter: SCContentFilter, width: u32, height: u32) -> Result<Frame, String> {
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > 32 * 1024 * 1024 {
        return Err("DESKTOP_PROVIDER_UNAVAILABLE: empty or oversized native capture".into());
    }
    let config = SCStreamConfiguration::new()
        .with_width(width)
        .with_height(height)
        .with_pixel_format(PixelFormat::BGRA)
        .with_shows_cursor(false)
        .with_queue_depth(1);
    let (tx, rx) = sync_channel(1);
    let mut stream = SCStream::new(&filter, &config).map_err(error)?;
    stream
        .add_output_handler(OneFrame(tx), SCStreamOutputType::Screen)
        .map_err(error)?;
    stream.start_capture().map_err(error)?;
    let frame = rx
        .recv_timeout(Duration::from_secs(4))
        .map_err(|_| "DESKTOP_PROVIDER_UNAVAILABLE: ScreenCaptureKit frame timed out".to_string())
        .and_then(|v| v);
    // Stop even after timeout/error; never leak an active capture session.
    let stopped = stream.stop_capture().map_err(error);
    stopped?;
    frame
}
pub fn capture_window(id: u32) -> Result<(Frame, u32), String> {
    let window = content()?
        .windows()
        .into_iter()
        .find(|w| w.window_id() == id)
        .ok_or_else(|| {
            "DESKTOP_TARGET_CHANGED: native macOS window no longer exists".to_string()
        })?;
    let rect = window.frame();
    let width = rect.size.width.round() as u32;
    let height = rect.size.height.round() as u32;
    let filter = SCContentFilter::create()
        .with_window(&window)
        .build()
        .map_err(error)?;
    grab(filter, width, height).map(|f| (f, width))
}
pub fn capture_primary() -> Result<(Frame, u32), String> {
    let display = content()?
        .displays()
        .into_iter()
        .find(|d| {
            let r = d.frame();
            r.origin.x == 0.0 && r.origin.y == 0.0
        })
        .ok_or_else(|| {
            "DESKTOP_PROVIDER_UNAVAILABLE: no display at coordinate origin".to_string()
        })?;
    let logical_width = display.frame().size.width.round() as u32;
    let width = display.width();
    let height = display.height();
    let filter = SCContentFilter::create()
        .with_display(&display)
        .with_excluding_windows(&[])
        .build()
        .map_err(error)?;
    grab(filter, width, height).map(|f| (f, logical_width))
}
