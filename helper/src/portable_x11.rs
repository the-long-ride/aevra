//! X11 capture uses a named Composite pixmap, never crops another app's screen pixels.
use crate::capture::Frame;
use crate::portable_contract::{NativeWindow, Rect};
use x11rb::connection::Connection;
use x11rb::protocol::{composite::ConnectionExt as _, randr::ConnectionExt as _, xproto::*};
use x11rb::rust_connection::RustConnection;

fn error(e: impl std::fmt::Display) -> String {
    format!("DESKTOP_PROVIDER_UNAVAILABLE: X11: {e}")
}

pub fn ensure_session() -> Result<(), String> {
    if crate::wayland::active() {
        return crate::wayland::ensure_session();
    }
    if std::env::var_os("WAYLAND_DISPLAY").is_some()
        || std::env::var("XDG_SESSION_TYPE").is_ok_and(|s| s == "wayland")
    {
        return Err("DESKTOP_PERMISSION_REQUIRED: native Wayland needs a consent-scoped RemoteDesktop/ScreenCast portal session; XWayland and uinput fallback are refused".into());
    }
    Ok(())
}
fn connection() -> Result<(RustConnection, usize), String> {
    ensure_session()?;
    x11rb::connect(None).map_err(error)
}
fn atom(c: &RustConnection, name: &[u8]) -> Result<u32, String> {
    Ok(c.intern_atom(false, name)
        .map_err(error)?
        .reply()
        .map_err(error)?
        .atom)
}
fn property(c: &RustConnection, window: u32, name: &[u8]) -> Result<Vec<u32>, String> {
    let p = c
        .get_property(false, window, atom(c, name)?, AtomEnum::ANY, 0, 65536)
        .map_err(error)?
        .reply()
        .map_err(error)?;
    Ok(p.value32().map(|v| v.collect()).unwrap_or_default())
}
fn root(c: &RustConnection, n: usize) -> u32 {
    c.setup().roots[n].root
}
fn rect(c: &RustConnection, w: u32, root: u32) -> Result<Rect, String> {
    let g = c.get_geometry(w).map_err(error)?.reply().map_err(error)?;
    let p = c
        .translate_coordinates(w, root, 0, 0)
        .map_err(error)?
        .reply()
        .map_err(error)?;
    Ok(Rect {
        x: i32::from(p.dst_x),
        y: i32::from(p.dst_y),
        width: u32::from(g.width),
        height: u32::from(g.height),
    })
}
fn stacking(c: &RustConnection, n: usize) -> Result<Vec<u32>, String> {
    let mut ids = property(c, root(c, n), b"_NET_CLIENT_LIST_STACKING")?;
    if ids.is_empty() {
        return Err(
            "DESKTOP_PROVIDER_UNAVAILABLE: EWMH window manager is required for verified stacking"
                .into(),
        );
    }
    ids.reverse(); // EWMH is bottom to top.
    Ok(ids)
}
pub fn windows() -> Result<Vec<NativeWindow>, String> {
    if crate::wayland::active() {
        return crate::wayland::windows();
    }
    let (c, n) = connection()?;
    let mut result = Vec::new();
    for id in stacking(&c, n)? {
        let Ok(attrs) = c.get_window_attributes(id).map_err(error)?.reply() else {
            continue;
        };
        if attrs.map_state != MapState::VIEWABLE {
            continue;
        }
        let Some(pid) = property(&c, id, b"_NET_WM_PID")?.first().copied() else {
            continue;
        };
        if let Ok(rect) = rect(&c, id, root(&c, n)) {
            result.push(NativeWindow {
                buffer: None,
                id,
                pid,
                rect,
            });
        }
    }
    Ok(result)
}
pub fn focused() -> Result<u32, String> {
    if crate::wayland::active() {
        return crate::wayland::focused();
    }
    let (c, n) = connection()?;
    property(&c, root(&c, n), b"_NET_ACTIVE_WINDOW")?
        .first()
        .copied()
        .filter(|v| *v != 0)
        .ok_or_else(|| "DESKTOP_TARGET_CHANGED: no verified X11 foreground window".into())
}

pub fn window(id: u32) -> Result<NativeWindow, String> {
    if crate::wayland::active() {
        return crate::wayland::window(id);
    }
    let (c, n) = connection()?;
    if c.get_window_attributes(id)
        .map_err(error)?
        .reply()
        .map_err(error)?
        .map_state
        != MapState::VIEWABLE
    {
        return Err("DESKTOP_TARGET_CHANGED: native target is no longer visible".into());
    }
    let pid = property(&c, id, b"_NET_WM_PID")?
        .first()
        .copied()
        .ok_or("DESKTOP_TARGET_CHANGED: native target lost PID attribution")?;
    Ok(NativeWindow {
        buffer: None,
        id,
        pid,
        rect: rect(&c, id, root(&c, n))?,
    })
}
pub fn hit(x: i32, y: i32) -> Result<u32, String> {
    if crate::wayland::active() {
        return crate::wayland::hit(x, y);
    }
    let (c, n) = connection()?;
    // TranslateCoordinates descends through the actual native child hierarchy,
    // including override-redirect popups omitted by EWMH stacking lists.
    let x = i16::try_from(x).map_err(error)?;
    let y = i16::try_from(y).map_err(error)?;
    let top = c
        .translate_coordinates(root(&c, n), root(&c, n), x, y)
        .map_err(error)?
        .reply()
        .map_err(error)?
        .child;
    let ids = stacking(&c, n)?;
    if ids.contains(&top) {
        return Ok(top);
    }
    // A reparenting WM has a decoration frame as the root child.
    for id in ids {
        let tree = c.query_tree(id).map_err(error)?.reply().map_err(error)?;
        if tree.parent == top {
            return Ok(id);
        }
    }
    Err("DESKTOP_INPUT_REFUSED: pointer hits an unverified native surface".into())
}
pub fn ready() -> bool {
    if crate::wayland::active() {
        return crate::wayland::ready();
    }
    let Ok((c, n)) = connection() else {
        return false;
    };
    let composite = c
        .composite_query_version(0, 4)
        .ok()
        .and_then(|v| v.reply().ok())
        .is_some();
    let selection = format!("_NET_WM_CM_S{n}");
    let compositor = atom(&c, selection.as_bytes())
        .ok()
        .and_then(|a| c.get_selection_owner(a).ok())
        .and_then(|cookie| cookie.reply().ok())
        .is_some_and(|r| r.owner != 0);
    composite && compositor
}
fn capture_drawable(
    c: &RustConnection,
    n: usize,
    drawable: u32,
    width: u32,
    height: u32,
) -> Result<Frame, String> {
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > 32 * 1024 * 1024 {
        return Err("DESKTOP_PROVIDER_UNAVAILABLE: empty or oversized native frame".into());
    }
    let (image, visual) = x11rb::image::Image::get(
        c,
        drawable,
        0,
        0,
        u16::try_from(width).map_err(error)?,
        u16::try_from(height).map_err(error)?,
    )
    .map_err(error)?;
    let visual = c.setup().roots[n]
        .allowed_depths
        .iter()
        .flat_map(|d| &d.visuals)
        .find(|v| v.visual_id == visual)
        .or_else(|| {
            c.setup().roots[n]
                .allowed_depths
                .iter()
                .flat_map(|d| &d.visuals)
                .find(|v| v.visual_id == c.setup().roots[n].root_visual)
        })
        .ok_or_else(|| "DESKTOP_PROVIDER_UNAVAILABLE: unknown X11 visual".to_string())?;
    let channel = |pixel: u32, mask: u32| -> u8 {
        if mask == 0 {
            0
        } else {
            let v = (pixel & mask) >> mask.trailing_zeros();
            let max = mask >> mask.trailing_zeros();
            ((u64::from(v) * 255) / u64::from(max)) as u8
        }
    };
    let mut rgb = Vec::with_capacity(width as usize * height as usize * 3);
    for y in 0..height {
        for x in 0..width {
            let p = image.get_pixel(x as u16, y as u16);
            rgb.extend_from_slice(&[
                channel(p, visual.red_mask),
                channel(p, visual.green_mask),
                channel(p, visual.blue_mask),
            ]);
        }
    }
    Ok(Frame { width, height, rgb })
}
pub fn capture_window(id: u32) -> Result<(Frame, u32), String> {
    if crate::wayland::active() {
        return crate::wayland::capture_window(id);
    }
    let (c, n) = connection()?;
    let r = rect(&c, id, root(&c, n))?;
    let pixmap = c.generate_id().map_err(error)?;
    c.composite_name_window_pixmap(id,pixmap).map_err(error)?.check().map_err(|_|"DESKTOP_PROVIDER_UNAVAILABLE: window has no Composite backing pixmap; enable a compositing window manager".to_string())?;
    let result = capture_drawable(&c, n, pixmap, r.width, r.height);
    let _ = c.free_pixmap(pixmap);
    result.map(|frame| (frame, r.width))
}
pub fn capture_primary() -> Result<(Frame, u32), String> {
    if crate::wayland::active() {
        return crate::wayland::capture_primary();
    }
    let (c, n) = connection()?;
    let primary = c
        .randr_get_output_primary(root(&c, n))
        .map_err(error)?
        .reply()
        .map_err(error)?
        .output;
    let outputs = c
        .randr_get_screen_resources_current(root(&c, n))
        .map_err(error)?
        .reply()
        .map_err(error)?;
    let info = c
        .randr_get_output_info(primary, outputs.config_timestamp)
        .map_err(error)?
        .reply()
        .map_err(error)?;
    let crtc = c
        .randr_get_crtc_info(info.crtc, outputs.config_timestamp)
        .map_err(error)?
        .reply()
        .map_err(error)?;
    if crtc.x != 0 || crtc.y != 0 {
        return Err(
            "DESKTOP_PROVIDER_UNAVAILABLE: primary display origin is not (0,0); use window capture"
                .into(),
        );
    }
    capture_drawable(
        &c,
        n,
        root(&c, n),
        u32::from(crtc.width),
        u32::from(crtc.height),
    )
    .map(|f| (f, u32::from(crtc.width)))
}
