//! Effect-boundary regression; fixture opens Shell after the app was authorized.
pub fn verify(service: &str, pid: u32) {
    if service != "org.gnome.Shell" {
        return;
    }
    let bus = zbus::blocking::Connection::session().unwrap();
    let proxy =
        zbus::blocking::Proxy::new(&bus, service, "/org/aevra/Desktop", "org.aevra.Desktop1")
            .unwrap();
    let call = |method: &str, args: serde_json::Value| -> serde_json::Value {
        let value: String = proxy.call("Call", &(method, args.to_string())).unwrap();
        serde_json::from_str(&value).unwrap()
    };
    assert!(call("Open", serde_json::json!({"version":1}))
        .get("error")
        .is_none());
    let windows = call("Windows", serde_json::json!({}));
    let window = windows
        .as_array()
        .unwrap()
        .iter()
        .find(|w| w["pid"] == pid)
        .unwrap();
    call("Fixture", serde_json::json!({"op":"run"}));
    let state = call("Fixture", serde_json::json!({"op":"shell-state"}));
    assert!(state["modal"].as_u64().unwrap() > 0);
    for args in [
        serde_json::json!({"op":"key","key":120,"down":true}),
        serde_json::json!({"op":"text","text":"Z"}),
    ] {
        let mut args = args;
        args["id"] = window["id"].clone();
        args["pid"] = serde_json::json!(pid);
        let result = call("Input", args);
        assert!(
            result.get("error").is_some(),
            "Shell received authorized-app input: {result}"
        );
    }
    let state = call("Fixture", serde_json::json!({"op":"shell-state"}));
    assert_eq!(state["text"], "");
    call("Fixture", serde_json::json!({"op":"dismiss"}));
    call("Fixture", serde_json::json!({"op":"focus","pid":pid}));
}
