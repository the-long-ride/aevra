//! Runs inside the required native fixture against the same persistent backend.
use super::*;
pub fn verify_reconnect(backend: &PortableBackend) {
    let stale = WindowInstance::new("stale", 42, "old");
    for i in 0..4096 {
        backend
            .native_bindings
            .borrow_mut()
            .insert(format!("old-{i}"), (stale.clone(), i));
    }
    *backend.foreground.borrow_mut() = Some(foreground::Snapshot {
        instance: stale,
        elements: HashMap::new(),
    });
    backend.connect().unwrap();
    assert!(
        backend.native_bindings.borrow().is_empty(),
        "explicit reconnect must discard old compositor mappings and recover a full cache"
    );
    assert!(
        backend.foreground.borrow().is_none(),
        "old refs cannot survive reconnect"
    );
    assert!(backend.snapshots.borrow().is_empty());
}
