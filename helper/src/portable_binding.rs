//! Process ownership and persistent native binding for foreground/capture.
use super::*;
impl PortableBackend {
    pub(super) fn require_native_owner(&self, pid: u32) -> Result<(), String> {
        let helper_pid = sysinfo::get_current_pid()
            .map_err(|_| "DESKTOP_INPUT_REFUSED: helper PID unavailable")?;
        let system = process_system(&[helper_pid, Pid::from_u32(pid)]);
        let helper = sysinfo::get_current_pid()
            .ok()
            .and_then(|p| system.process(p));
        let target = system.process(Pid::from_u32(pid));
        let valid = helper.zip(target).is_some_and(|(h, t)| {
            h.user_id().is_some()
                && h.user_id() == t.user_id()
                && h.effective_user_id() == h.user_id()
                && t.effective_user_id() == t.user_id()
                && h.user_id().is_some_and(|uid| **uid != 0)
        });
        if !valid {
            return Err("DESKTOP_INPUT_REFUSED: native target has elevated, different or unverifiable process ownership".into());
        }
        Ok(())
    }
    pub(super) fn bind_native(
        &self,
        window: &Element,
        instance: &WindowInstance,
    ) -> Result<u32, String> {
        self.require_native_owner(instance.process_id)?;
        #[cfg(target_os = "linux")]
        let wayland_id = if crate::wayland::active() {
            let r = bounds(window)?;
            let native = crate::wayland::windows()?;
            let provider = self.provider()?;
            let app = App::from_data(
                provider.clone(),
                provider.app_by_pid(instance.process_id).map_err(map_a11y)?,
            );
            let accessible_matches = app
                .windows()
                .map_err(map_a11y)?
                .iter()
                .filter(|w| {
                    w.bounds
                        .is_some_and(|b| b.width == r.width && b.height == r.height)
                })
                .count();
            let id = crate::wayland_contract::bind_accessible(
                instance.process_id,
                r.width,
                r.height,
                &native,
                accessible_matches,
            )?;
            Some(id)
        } else {
            None
        };
        #[cfg(not(target_os = "linux"))]
        let wayland_id: Option<u32> = None;
        let id = if let Some(id) = wayland_id {
            id
        } else {
            bind_window(
                instance.process_id,
                bounds(window)?,
                &portable_pixels::windows()?,
            )?
        };
        let mut bindings = self.native_bindings.borrow_mut();
        if let Some((previous, native)) = bindings.get(&instance.window_id) {
            if previous != instance || *native != id {
                return Err("DESKTOP_TARGET_CHANGED: native window binding changed; reconnect and observe again".into());
            }
        }
        if bindings.len() >= 4096 && !bindings.contains_key(&instance.window_id) {
            return Err(
                "DESKTOP_PROVIDER_UNAVAILABLE: native binding limit reached; reconnect".into(),
            );
        }
        bindings.insert(instance.window_id.clone(), (instance.clone(), id));
        Ok(id)
    }
}
