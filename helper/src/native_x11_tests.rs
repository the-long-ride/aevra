//! Real X server regression: isolated capture, actual XTest events and occlusion.
//! Explicit ignored run spawns a private Xvfb; it never connects to the user's desktop.
use crate::backend::ActRequest;
#[path = "native_x11_races.rs"]
mod races;
use crate::{portable_input, portable_pixels};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
use x11rb::connection::Connection;
use x11rb::protocol::{
    composite::{ConnectionExt as _, Redirect},
    xproto::*,
};
use x11rb::wrapper::ConnectionExt as _;
struct Server(Child);
impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
#[test]
#[ignore = "required native run: cargo test native_x11_capture_and_input -- --ignored --nocapture; needs Xvfb"]
fn native_x11_capture_and_input() {
    let display = format!(":{}", 15000 + std::process::id() % 10000);
    let program = std::env::var("AEVRA_XVFB_PATH").unwrap_or_else(|_| "Xvfb".into());
    let _server = Server(
        Command::new(program)
            .args([
                &display,
                "-screen",
                "0",
                "800x600x24",
                "-nolisten",
                "tcp",
                "-ac",
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("Required native prerequisite missing: Xvfb"),
    );
    let deadline = Instant::now() + Duration::from_secs(5);
    let (c, n) = loop {
        if let Ok(v) = x11rb::connect(Some(&display)) {
            break v;
        }
        assert!(Instant::now() < deadline, "private Xvfb did not start");
        std::thread::sleep(Duration::from_millis(25));
    };
    // This test is the only native test in the process; all others are pure.
    std::env::set_var("DISPLAY", &display);
    std::env::remove_var("WAYLAND_DISPLAY");
    std::env::set_var("XDG_SESSION_TYPE", "x11");
    let root = c.setup().roots[n].root;
    let a = c.generate_id().unwrap();
    let b = c.generate_id().unwrap();
    let gc = c.generate_id().unwrap();
    c.composite_redirect_subwindows(root, Redirect::AUTOMATIC)
        .unwrap()
        .check()
        .expect("Xvfb Composite extension");
    for (id, x, y, w, h, color) in [
        (a, 0, 0, 400, 200, 0x00aa44),
        (b, 60, 40, 200, 100, 0xaa00cc),
    ] {
        c.create_window(
            x11rb::COPY_DEPTH_FROM_PARENT,
            id,
            root,
            x,
            y,
            w,
            h,
            0,
            WindowClass::INPUT_OUTPUT,
            0,
            &CreateWindowAux::new()
                .background_pixel(color)
                .event_mask(EventMask::KEY_PRESS | EventMask::BUTTON_PRESS | EventMask::EXPOSURE),
        )
        .unwrap()
        .check()
        .unwrap();
        c.map_window(id).unwrap().check().unwrap();
        let pid = c
            .intern_atom(false, b"_NET_WM_PID")
            .unwrap()
            .reply()
            .unwrap()
            .atom;
        c.change_property32(
            PropMode::REPLACE,
            id,
            pid,
            AtomEnum::CARDINAL,
            &[std::process::id()],
        )
        .unwrap()
        .check()
        .unwrap();
    }
    c.create_gc(gc, a, &CreateGCAux::new().foreground(0x0000ff))
        .unwrap()
        .check()
        .unwrap();
    c.poly_fill_rectangle(
        a,
        gc,
        &[Rectangle {
            x: 5,
            y: 5,
            width: 10,
            height: 10,
        }],
    )
    .unwrap()
    .check()
    .unwrap();
    let stacking = c
        .intern_atom(false, b"_NET_CLIENT_LIST_STACKING")
        .unwrap()
        .reply()
        .unwrap()
        .atom;
    let active = c
        .intern_atom(false, b"_NET_ACTIVE_WINDOW")
        .unwrap()
        .reply()
        .unwrap()
        .atom;
    c.change_property32(PropMode::REPLACE, root, stacking, AtomEnum::WINDOW, &[a, b])
        .unwrap()
        .check()
        .unwrap();
    c.change_property32(PropMode::REPLACE, root, active, AtomEnum::WINDOW, &[a])
        .unwrap()
        .check()
        .unwrap();
    c.set_input_focus(InputFocus::PARENT, a, x11rb::CURRENT_TIME)
        .unwrap()
        .check()
        .unwrap();
    c.flush().unwrap();
    let compositor = c
        .intern_atom(false, format!("_NET_WM_CM_S{n}").as_bytes())
        .unwrap()
        .reply()
        .unwrap()
        .atom;
    c.set_selection_owner(a, compositor, x11rb::CURRENT_TIME)
        .unwrap()
        .check()
        .unwrap();
    assert!(portable_pixels::ready());
    let (frame, width) = portable_pixels::capture_window(a).expect("capture actual backing pixmap");
    assert_eq!((frame.width, frame.height, width), (400, 200, 400));
    assert_eq!(
        frame.pixel(100, 80),
        [0, 170, 68],
        "occluding sentinel pixels leaked into target capture"
    );
    assert_eq!(frame.pixel(7, 7), [0, 0, 255]);
    assert_eq!(
        portable_pixels::hit(100, 80).unwrap(),
        b,
        "occluder must be detected"
    );
    assert_eq!(portable_pixels::hit(20, 20).unwrap(), a);
    while c.poll_for_event().unwrap().is_some() {}
    let request = |op: &str| ActRequest {
        expected_target: None,
        op: op.into(),
        handle: None,
        x: None,
        y: None,
        text: None,
        keys: None,
        delta_y: None,
    };
    let mut click = request("click");
    click.x = Some(20);
    click.y = Some(20);
    portable_input::perform(&click, || Ok(())).unwrap();
    let mut key = request("key");
    key.keys = Some("ctrl+a".into());
    portable_input::perform(&key, || Ok(())).unwrap();
    let mut scroll = request("scroll");
    scroll.delta_y = Some(-120);
    portable_input::perform(&scroll, || Ok(())).unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    let (mut clicked, mut keyed, mut scrolled) = (false, false, false);
    while Instant::now() < deadline && !(clicked && keyed && scrolled) {
        if let Some(event) = c.poll_for_event().unwrap() {
            match event {
                x11rb::protocol::Event::ButtonPress(e) => {
                    clicked |= e.detail == 1;
                    scrolled |= e.detail == 5;
                }
                x11rb::protocol::Event::KeyPress(_) => keyed = true,
                _ => {}
            }
        } else {
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    assert!(
        clicked && keyed && scrolled,
        "native input outcomes missing: click={clicked} key={keyed} wheel={scrolled}"
    );
    assert_eq!(portable_pixels::focused().unwrap(), a);
}

struct GtkFixture(Child, std::path::PathBuf);
impl Drop for GtkFixture {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
        let _ = std::fs::remove_file(&self.1);
    }
}
#[test]
#[ignore = "required backend run needs private D-Bus, GTK3/PyGObject, AT-SPI and Xvfb"]
fn native_x11_backend_capture_and_unicode() {
    use crate::backend::{CaptureRequest, DescribeRequest, DesktopBackend};
    assert!(
        std::env::var_os("DBUS_SESSION_BUS_ADDRESS").is_some(),
        "run under dbus-run-session"
    );
    let display = format!(":{}", 15000 + std::process::id() % 10000);
    let _server = Server(
        Command::new("Xvfb")
            .args([
                &display,
                "-screen",
                "0",
                "800x600x24",
                "-nolisten",
                "tcp",
                "-ac",
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("Required native prerequisite: Xvfb"),
    );
    let deadline = Instant::now() + Duration::from_secs(5);
    let (c, n) = loop {
        if let Ok(v) = x11rb::connect(Some(&display)) {
            break v;
        }
        assert!(Instant::now() < deadline, "private display startup");
        std::thread::sleep(Duration::from_millis(25));
    };
    std::env::set_var("DISPLAY", &display);
    std::env::remove_var("WAYLAND_DISPLAY");
    std::env::set_var("XDG_SESSION_TYPE", "x11");
    std::env::set_var("NO_AT_BRIDGE", "0");
    std::env::set_var("GTK_A11Y", "always");
    std::env::set_var("GDK_BACKEND", "x11");
    let root = c.setup().roots[n].root;
    c.composite_redirect_subwindows(root, Redirect::AUTOMATIC)
        .unwrap()
        .check()
        .unwrap();
    let compositor = c
        .intern_atom(false, format!("_NET_WM_CM_S{n}").as_bytes())
        .unwrap()
        .reply()
        .unwrap()
        .atom;
    c.set_selection_owner(root, compositor, x11rb::CURRENT_TIME)
        .unwrap()
        .check()
        .unwrap();
    let script = std::env::var_os("AEVRA_GTK_FIXTURE")
        .expect("set AEVRA_GTK_FIXTURE to helper/tests/fixtures/portable_gtk_fixture.py");
    let state = std::env::temp_dir().join(format!("aevra-gtk-fixture-{}.json", std::process::id()));
    let fixture = GtkFixture(
        Command::new("/usr/bin/python3")
            .arg(script)
            .arg(&state)
            .spawn()
            .expect("start accessible GTK fixture"),
        state,
    );
    let deadline = Instant::now() + Duration::from_secs(8);
    let read = || {
        std::fs::read(&fixture.1)
            .ok()
            .and_then(|s| serde_json::from_slice::<serde_json::Value>(&s).ok())
    };
    let xid = loop {
        if let Some(v) = read() {
            if let Some(id) = v["windowId"].as_u64() {
                break id as u32;
            }
        }
        assert!(Instant::now() < deadline, "GTK fixture startup");
        std::thread::sleep(Duration::from_millis(25));
    };
    for name in [
        b"_NET_CLIENT_LIST_STACKING".as_slice(),
        b"_NET_ACTIVE_WINDOW".as_slice(),
    ] {
        let atom = c.intern_atom(false, name).unwrap().reply().unwrap().atom;
        c.change_property32(PropMode::REPLACE, root, atom, AtomEnum::WINDOW, &[xid])
            .unwrap()
            .check()
            .unwrap();
    }
    c.set_input_focus(InputFocus::PARENT, xid, x11rb::CURRENT_TIME)
        .unwrap()
        .check()
        .unwrap();
    c.flush().unwrap();
    let backend = crate::portable::PortableBackend::new();
    let capabilities = backend.connect().expect("AX/AT-SPI provider connection");
    assert!(capabilities.capture && capabilities.input);
    let deadline = Instant::now() + Duration::from_secs(8);
    let target = loop {
        if let Ok(windows) = backend.windows() {
            if let Some(w) = windows.into_iter().find(|w| {
                w.executable_path
                    .as_deref()
                    .is_some_and(|p| p.contains("python"))
            }) {
                break w;
            }
        }
        assert!(Instant::now() < deadline, "AT-SPI fixture discovery failed");
        std::thread::sleep(Duration::from_millis(50));
    };
    let describe = || {
        backend
            .describe(DescribeRequest {
                expected_target: None,
                window_id: Some(target.window_id.clone()),
                max_nodes: 100,
                interactive_only: false,
                mode: Some("foreground".into()),
            })
            .unwrap()
    };
    let tree = describe();
    let notes = tree
        .nodes
        .iter()
        .find(|node| node.name == "Native notes")
        .expect("real accessible entry");
    let action = |op: &str| ActRequest {
        expected_target: Some(
            backend
                .target_identity(crate::backend::TargetIdentityRequest {
                    window_id: target.window_id.clone(),
                })
                .unwrap(),
        ),
        op: op.into(),
        handle: None,
        x: None,
        y: None,
        text: None,
        keys: None,
        delta_y: None,
    };
    let mut click = action("click");
    click.handle = Some(notes.handle.clone());
    backend.act(click).expect("fresh native ref click");
    let expected = "Aevra café 漢字 ".repeat(20);
    let mut typing = action("type");
    typing.text = Some(expected.clone());
    let started = Instant::now();
    backend.act(typing).expect("native Unicode text transport");
    eprintln!("280-character native typing: {:?}", started.elapsed());
    assert!(
        started.elapsed() < Duration::from_millis(7500),
        "typing must fit the production input budget"
    );
    let deadline = Instant::now() + Duration::from_secs(4);
    loop {
        if read().is_some_and(|v| v["text"] == expected) {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "exact Unicode input not observed: {:?}",
            read()
        );
        std::thread::sleep(Duration::from_millis(25));
    }
    let mut select = action("key");
    select.keys = Some("ctrl+a".into());
    backend.act(select).unwrap();
    let mut replace = action("type");
    replace.text = Some("Replaced".into());
    backend.act(replace).unwrap();
    let deadline = Instant::now() + Duration::from_secs(4);
    loop {
        if read().is_some_and(|v| v["text"] == "Replaced") {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "Ctrl+A did not select actual entry text: {:?}",
            read()
        );
        std::thread::sleep(Duration::from_millis(25));
    }
    let capture = backend
        .capture(CaptureRequest {
            expected_target: None,
            window_id: Some(target.window_id.clone()),
        })
        .expect("attributed backend capture");
    assert!(capture
        .image_data_uri
        .starts_with("data:image/jpeg;base64,"));
    assert_eq!(capture.window.unwrap().window_id, target.window_id);
    assert!(capture.device_pixel_ratio > 0.0);
    let tree = describe();
    let protected = tree
        .nodes
        .iter()
        .find(|node| node.name == "Protected value")
        .expect("protected entry");
    let mut click = action("click");
    click.handle = Some(protected.handle.clone());
    assert!(
        backend.act(click).is_err(),
        "protected native ref must be refused"
    );
    assert_eq!(read().unwrap()["password"], "");
    races::verify(&backend, &target, &display, xid, &fixture.1);
}
