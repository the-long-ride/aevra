//! Native protocol regression: disconnect must flush a held pointer release.
use serde_json::json;
use std::time::{Duration, Instant};
pub fn verify_button_release(service: &str, state: &str) {
    let read =
        || serde_json::from_slice::<serde_json::Value>(&std::fs::read(state).unwrap()).unwrap();
    let native = crate::wayland::window(crate::wayland::focused().unwrap()).unwrap();
    let releases = read()["releases"].as_u64().unwrap();
    let presses = read()["presses"].as_u64().unwrap();
    let holder = zbus::blocking::Connection::session().unwrap();
    {
        let proxy = zbus::blocking::Proxy::new(
            &holder,
            service,
            "/org/aevra/Desktop",
            "org.aevra.Desktop1",
        )
        .unwrap();
        let open: String = proxy
            .call("Call", &("Open", json!({"version":1}).to_string()))
            .unwrap();
        assert!(!open.contains("error"), "{open}");
        let down: String = proxy
            .call(
                "Call",
                &(
                    "Input",
                    json!({"op":"button","down":true,"id":native.id,"pid":native.pid}).to_string(),
                ),
            )
            .unwrap();
        assert_eq!(down, "true");
        let deadline = Instant::now() + Duration::from_secs(4);
        while read()["presses"].as_u64().unwrap() <= presses {
            assert!(Instant::now() < deadline, "held native press missing");
            std::thread::sleep(Duration::from_millis(25));
        }
    }
    holder.close().unwrap();
    let deadline = Instant::now() + Duration::from_secs(4);
    while read()["releases"].as_u64().unwrap() <= releases {
        assert!(
            Instant::now() < deadline,
            "disconnect must flush native button release without later input"
        );
        std::thread::sleep(Duration::from_millis(25));
    }
}
