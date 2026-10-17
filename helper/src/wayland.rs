//! Native compositor transport. One bus owner/connection per backend thread;
//! never reconnect inside an already authorized operation.
#[path = "wayland_peer.rs"]
mod peer;
use crate::capture::Frame;
use crate::portable_contract::NativeWindow;
use serde_json::{json, Value};
use std::cell::RefCell;
use zbus::blocking::{Connection, Proxy};

thread_local! { static CLIENT: RefCell<Option<Client>> = const { RefCell::new(None) }; }
struct Client {
    bus: Connection,
    owner: String,
    target: Option<(u32, u32)>,
}
const PATH: &str = "/org/aevra/Desktop";
const IFACE: &str = "org.aevra.Desktop1";

pub fn active() -> bool {
    std::env::var_os("WAYLAND_DISPLAY").is_some()
        || std::env::var("XDG_SESSION_TYPE").is_ok_and(|v| v == "wayland")
}
fn unavailable(cause: impl std::fmt::Display) -> String {
    #[cfg(test)]
    eprintln!("Wayland fixture transport error: {cause}");
    #[cfg(not(test))]
    let _ = cause;
    "DESKTOP_PROVIDER_UNAVAILABLE: Wayland companion unavailable or disconnected; follow GNOME/KDE companion setup, explicitly grant the actual helper path, then reconnect".into()
}
impl Client {
    fn new() -> Result<Self, String> {
        let bus = zbus::blocking::connection::Builder::session()
            .map_err(unavailable)?
            .method_timeout(std::time::Duration::from_secs(4))
            .build()
            .map_err(unavailable)?;
        let (service, executable) = crate::wayland_contract::compositor(
            &std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default(),
        )
        .ok_or_else(|| unavailable("unsupported compositor"))?;
        let owner: String = Proxy::new(
            &bus,
            "org.freedesktop.DBus",
            "/org/freedesktop/DBus",
            "org.freedesktop.DBus",
        )
        .map_err(unavailable)?
        .call("GetNameOwner", &(service,))
        .map_err(unavailable)?;
        let pid: u32 = Proxy::new(
            &bus,
            "org.freedesktop.DBus",
            "/org/freedesktop/DBus",
            "org.freedesktop.DBus",
        )
        .map_err(unavailable)?
        .call("GetConnectionUnixProcessID", &(owner.as_str(),))
        .map_err(unavailable)?;
        let mut system = sysinfo::System::new();
        let own = sysinfo::get_current_pid().map_err(unavailable)?;
        system.refresh_processes_specifics(
            sysinfo::ProcessesToUpdate::Some(&[own, sysinfo::Pid::from_u32(pid)]),
            true,
            sysinfo::ProcessRefreshKind::nothing()
                .with_exe(sysinfo::UpdateKind::Always)
                .with_user(sysinfo::UpdateKind::Always),
        );
        let trusted = system
            .process(own)
            .zip(system.process(sysinfo::Pid::from_u32(pid)))
            .is_some_and(|(helper, shell)| {
                helper.user_id().is_some()
                    && helper.user_id() == shell.user_id()
                    && shell.effective_user_id() == shell.user_id()
                    && shell
                        .exe()
                        .and_then(|p| p.file_name())
                        .is_some_and(|name| name == executable)
            });
        // File capabilities make hardened KWin /proc/exe unreadable to peers.
        // Authenticate it against the kernel peer of the actual Wayland socket;
        // matching only a process name or a D-Bus self-report is insufficient.
        let hardened_kwin = executable == "kwin_wayland"
            && system
                .process(sysinfo::Pid::from_u32(pid))
                .is_some_and(|p| p.exe().is_none())
            && peer::socket_peer(pid);
        if !trusted && !hardened_kwin {
            return Err(unavailable("unverified compositor owner"));
        }
        let client = Self {
            bus,
            owner,
            target: None,
        };
        let value = client.call("Open", json!({"version":1}))?;
        if value.get("version").and_then(Value::as_u64) != Some(1) {
            return Err(unavailable("version"));
        }
        Ok(client)
    }
    fn proxy(&self) -> Result<Proxy<'_>, String> {
        Proxy::new(&self.bus, self.owner.as_str(), PATH, IFACE).map_err(unavailable)
    }
    fn call(&self, method: &str, args: Value) -> Result<Value, String> {
        let result: String = self
            .proxy()?
            .call("Call", &(method, args.to_string()))
            .map_err(unavailable)?;
        if result.len() > 1024 * 1024 {
            return Err(unavailable("oversized metadata"));
        }
        let value: Value = serde_json::from_str(&result).map_err(unavailable)?;
        if let Some(error) = value.get("error").and_then(Value::as_str) {
            return Err(match error {
                "DESKTOP_PERMISSION_REQUIRED"=>"DESKTOP_PERMISSION_REQUIRED: grant the actual helper path in the compositor companion, then explicitly reconnect",
                "DESKTOP_TARGET_CHANGED"=>"DESKTOP_TARGET_CHANGED: Wayland target changed; observe again",
                "DESKTOP_INPUT_REFUSED"=>"DESKTOP_INPUT_REFUSED: Compositor refused the protected or occluded target",
                _=>"DESKTOP_PROVIDER_UNAVAILABLE: Compositor operation failed",
            }.into());
        }
        Ok(value)
    }
}
fn with<T>(f: impl FnOnce(&mut Client) -> Result<T, String>) -> Result<T, String> {
    CLIENT.with(|slot| {
        let mut client = slot.borrow_mut();
        f(client
            .as_mut()
            .ok_or_else(|| unavailable("connect required"))?)
    })
}
/// Only the explicit backend connect boundary may create/recreate authority.
pub fn reconnect() -> Result<(), String> {
    CLIENT.with(|slot| {
        let mut client = slot.borrow_mut();
        *client = None;
        *client = Some(Client::new()?);
        Ok(())
    })
}
pub fn ready() -> bool {
    with(|c| c.call("Probe", json!({})).map(|_| true)).unwrap_or(false)
}
pub fn ensure_session() -> Result<(), String> {
    with(|c| c.call("Probe", json!({})).map(|_| ()))
}
pub fn windows() -> Result<Vec<NativeWindow>, String> {
    with(|c| {
        let windows = c.call("Windows", json!({}))?;
        crate::wayland_contract::decode_windows(&windows.to_string()).map(|v| {
            v.into_iter()
                .map(|w| NativeWindow {
                    buffer: w.buffer.map(Into::into),
                    id: w.id,
                    pid: w.pid,
                    rect: w.rect.into(),
                })
                .collect()
        })
    })
}
pub fn focused() -> Result<u32, String> {
    with(|c| {
        let windows = c.call("Windows", json!({}))?;
        let windows = crate::wayland_contract::decode_windows(&windows.to_string())?;
        let mut focused = windows.iter().filter(|w| w.focused);
        match (focused.next(), focused.next()) {
            (Some(w), None) => Ok(w.id),
            _ => Err("DESKTOP_TARGET_CHANGED: no unique focused Wayland window".into()),
        }
    })
}
pub fn window(id: u32) -> Result<NativeWindow, String> {
    windows()?
        .into_iter()
        .find(|w| w.id == id)
        .ok_or("DESKTOP_TARGET_CHANGED: Wayland window disappeared".into())
}
pub fn hit(x: i32, y: i32) -> Result<u32, String> {
    with(|c| {
        c.call("Hit", json!({"x":x,"y":y})).and_then(|v| {
            v.as_u64()
                .and_then(|n| u32::try_from(n).ok())
                .ok_or("DESKTOP_INPUT_REFUSED: Wayland pointer hits an unverified surface".into())
        })
    })
}
pub fn pointer() -> Result<(i32, i32), String> {
    with(|c| serde_json::from_value(c.call("Pointer", json!({}))?).map_err(unavailable))
}
pub fn bind(id: u32) -> Result<(), String> {
    let window = window(id)?;
    with(|c| {
        c.target = Some((id, window.pid));
        Ok(())
    })
}
pub fn input(mut value: Value) -> Result<(), String> {
    with(|c| {
        let (id, pid) = c
            .target
            .ok_or("DESKTOP_INPUT_REFUSED: no bound Wayland target")?;
        value["id"] = json!(id);
        value["pid"] = json!(pid);
        c.call("Input", value).map(|_| ())
    })
}
pub fn capture_window(id: u32) -> Result<(Frame, u32), String> {
    let target = window(id)?;
    let bytes: Vec<u8> = with(|c| c.proxy()?.call("Capture", &(id,)).map_err(unavailable))?;
    decode_frame(&bytes).map(|frame| (frame, target.rect.width))
}
fn decode_frame(bytes: &[u8]) -> Result<Frame, String> {
    if bytes.len() > 128 * 1024 * 1024 {
        return Err(unavailable("oversized PNG"));
    }
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_limits(png::Limits {
        bytes: 128 * 1024 * 1024,
    });
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().map_err(unavailable)?;
    let info = reader.info();
    if info.width == 0
        || info.height == 0
        || u64::from(info.width) * u64::from(info.height) > 32 * 1024 * 1024
    {
        return Err(unavailable("invalid frame"));
    }
    let mut buffer = vec![
        0;
        reader
            .output_buffer_size()
            .ok_or_else(|| unavailable("frame size"))?
    ];
    let info = reader.next_frame(&mut buffer).map_err(unavailable)?;
    let data = &buffer[..info.buffer_size()];
    let rgb = match info.color_type {
        png::ColorType::Rgb => data.to_vec(),
        png::ColorType::Rgba => data
            .as_chunks::<4>()
            .0
            .iter()
            .flat_map(|p| p[..3].iter().copied())
            .collect(),
        _ => return Err(unavailable("unsupported frame format")),
    };
    Ok(Frame {
        width: info.width,
        height: info.height,
        rgb,
    })
}
pub fn capture_primary() -> Result<(Frame, u32), String> {
    Err("DESKTOP_CAPTURE_UNSUPPORTED: Wayland requires an explicitly authorized window; monitor fallback is refused".into())
}
