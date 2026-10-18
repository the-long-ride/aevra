//! Native effects behind process-instance, focus, field and occlusion guards.
use super::*;
use crate::portable_contract::{bind_window, capture_scale, guard_point, Rect};
use crate::{capture, portable_input, portable_pixels};
#[path = "portable_binding.rs"]
mod binding;
#[path = "portable_focus.rs"]
mod focus;

pub(super) struct Snapshot {
    pub instance: WindowInstance,
    pub elements: HashMap<String, Element>,
}
fn bounds(element: &Element) -> Result<Rect, String> {
    element
        .bounds
        .map(|r| Rect {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
        })
        .filter(|r| r.width > 0 && r.height > 0)
        .ok_or_else(|| "DESKTOP_INPUT_REFUSED: target has no visible bounds".into())
}
impl PortableBackend {
    fn require_foreground(
        &self,
        instance: &WindowInstance,
        native: u32,
    ) -> Result<Element, String> {
        let window = self.verify_instance(instance)?;
        let focused = self.focused_window_element()?;
        if window_id_for(&focused) != instance.window_id
            || portable_pixels::focused()? != native
            || self.bind_native(&window, instance)? != native
        {
            return Err("DESKTOP_TARGET_CHANGED: verified window is no longer foreground".into());
        }
        if self.identity(&window).executable_path.is_none() {
            return Err("DESKTOP_INPUT_REFUSED: target executable is unattributable".into());
        }
        Ok(window)
    }
    fn fresh_elements(&self, window: &Element) -> Result<Vec<Element>, String> {
        let mut queue = VecDeque::from([window.clone()]);
        let mut elements = Vec::new();
        while let Some(element) = queue.pop_front() {
            if elements.len() >= 5000 {
                return Err(
                    "DESKTOP_INPUT_REFUSED: cannot verify focused field within bounded tree".into(),
                );
            }
            queue.extend(element.children().map_err(map_a11y)?);
            elements.push(element);
        }
        Ok(elements)
    }
    pub(super) fn capture_pixels(&self, request: CaptureRequest) -> Result<CaptureResult, String> {
        portable_pixels::ensure_session()?;
        crate::backend::verify_read_target(
            self,
            request.expected_target.as_ref(),
            request.window_id.as_deref(),
        )?;
        let (frame, logical_width, identity) = if let Some(ref id) = request.window_id {
            let window = self.resolve_window(id)?;
            let instance = self.process_instance(&window)?;
            let identity = self.identity(&window);
            if identity.executable_path.is_none() {
                return Err("DESKTOP_INPUT_REFUSED: capture target is unattributable".into());
            }
            let native = self.bind_native(&window, &instance)?;
            let (frame, width) = portable_pixels::capture_window(native)?;
            let after = self.verify_instance(&instance)?;
            if self.bind_native(&after, &instance)? != native {
                return Err("DESKTOP_TARGET_CHANGED: capture target changed".into());
            }
            (frame, width, Some(identity))
        } else {
            let (frame, width) = portable_pixels::capture_primary()?;
            (frame, width, None)
        };
        crate::backend::verify_read_target(
            self,
            request.expected_target.as_ref(),
            request.window_id.as_deref(),
        )?;
        let raw_width = frame.width;
        let (image_data_uri, resize_ratio) = capture::encode_frame(frame)?;
        Ok(CaptureResult {
            image_data_uri,
            device_pixel_ratio: capture_scale(raw_width, logical_width)? * resize_ratio,
            window: identity,
        })
    }
    pub(super) fn act_foreground(&self, mut request: ActRequest) -> Result<bool, String> {
        let budget = crate::portable_contract::InputBudget::new();
        portable_pixels::ensure_session()?;
        let window = self.focused_window_element()?;
        let instance = self.process_instance(&window)?;
        let authorized = request.expected_target.as_ref();
        crate::backend::require_authorized_target(
            authorized,
            &TargetIdentityResult {
                window: self.identity(&window),
                window_instance: instance.clone(),
                host_application: None,
            },
        )?;
        let native = self.bind_native(&window, &instance)?;
        self.require_foreground(&instance, native)?;
        #[cfg(target_os = "linux")]
        if crate::wayland::active() {
            crate::wayland::bind(native)?;
        }
        let provider = self.provider()?;
        #[cfg(target_os = "linux")]
        let app_data = if crate::wayland::active() {
            provider.app_by_pid(instance.process_id)
        } else {
            provider.focused_app()
        };
        #[cfg(not(target_os = "linux"))]
        let app_data = provider.focused_app();
        let app = Element::new(app_data.map_err(map_a11y)?, provider);
        if let Some(handle) = request.handle.take() {
            let snapshots = self.foreground.borrow();
            let snapshot = snapshots
                .as_ref()
                .ok_or("DESKTOP_REF_STALE: describe the foreground window first")?;
            if snapshot.instance != instance {
                return Err("DESKTOP_REF_STALE: foreground process instance changed".into());
            }
            let old = snapshot
                .elements
                .get(&handle)
                .ok_or("DESKTOP_REF_STALE: unknown foreground handle")?;
            let elements = self.fresh_elements(&window)?;
            let fresh = elements
                .iter()
                .find(|e| {
                    window_id_for(e) == window_id_for(old) && e.pid == old.pid && e.role == old.role
                })
                .ok_or("DESKTOP_REF_STALE: element no longer exists")?;
            if !fresh.states.enabled || protected_field(fresh) {
                return Err("DESKTOP_INPUT_REFUSED: disabled or protected element".into());
            }
            let r = bounds(fresh)?;
            let x =
                r.x.saturating_add((r.width / 2).min(i32::MAX as u32) as i32);
            let y =
                r.y.saturating_add((r.height / 2).min(i32::MAX as u32) as i32);
            #[cfg(target_os = "linux")]
            let (x, y) = if crate::wayland::active() {
                let ax = bounds(&window)?;
                let native = crate::wayland::window(native)?;
                let native =
                    crate::wayland_contract::accessibility_rect(&native, ax.width, ax.height)?;
                (
                    x.saturating_add(native.x.saturating_sub(ax.x)),
                    y.saturating_add(native.y.saturating_sub(ax.y)),
                )
            } else {
                (x, y)
            };
            request.x = Some(x);
            request.y = Some(y);
        }
        // Discover the focused field once. Subsequent checks refresh only its
        // parent/identity, refusing if focus moves rather than adopting a new field.
        let field = if request.op == "type" || request.op == "key" {
            Some(focus::focused_path(&window)?)
        } else {
            None
        };
        let guard = || {
            budget.check()?;
            let fresh = app
                .children()
                .map_err(map_a11y)?
                .into_iter()
                .find(|w| window_id_for(w) == instance.window_id)
                .ok_or("DESKTOP_TARGET_CHANGED: authorized window no longer exists")?;
            crate::backend::require_authorized_target(
                authorized,
                &TargetIdentityResult {
                    window: self.identity(&fresh),
                    window_instance: self.process_instance(&fresh)?,
                    host_application: None,
                },
            )?;
            self.require_native_owner(instance.process_id)?;
            let current = portable_pixels::window(native)?;
            let expected_rect = bounds(&fresh)?;
            #[cfg(target_os = "linux")]
            let expected_rect = if crate::wayland::active() {
                crate::wayland_contract::accessibility_rect(
                    &current,
                    expected_rect.width,
                    expected_rect.height,
                )?;
                current.rect
            } else {
                expected_rect
            };
            if portable_pixels::focused()? != native
                || bind_window(instance.process_id, expected_rect, &[current])? != native
            {
                return Err(
                    "DESKTOP_TARGET_CHANGED: authorized window is no longer foreground".into(),
                );
            }
            if request.op == "type" || request.op == "key" {
                focus::verify_field(&fresh, field.as_ref().expect("prepared focused field"))?;
            }
            if request.op == "scroll" {
                let (x, y) = portable_input::pointer()?;
                guard_point(expected_rect, x, y, native, portable_pixels::hit(x, y)?)?;
            }
            if request.op == "click" {
                let (x, y) = request
                    .x
                    .zip(request.y)
                    .ok_or("DESKTOP_INPUT_REFUSED: click requires coordinates or a live ref")?;
                guard_point(expected_rect, x, y, native, portable_pixels::hit(x, y)?)?;
            }
            // AX reads can block; recheck focus and budget at the effect boundary.
            if portable_pixels::focused()? != native {
                return Err(
                    "DESKTOP_TARGET_CHANGED: foreground changed during guard refresh".into(),
                );
            }
            budget.check()
        };
        let result = portable_input::perform(&request, guard)?;
        self.require_foreground(&instance,native).map_err(|_|"DESKTOP_OUTCOME_UNKNOWN: input completed but foreground target changed; observe again".to_string())?;
        Ok(result)
    }
}
