//! The GDI half of `capture`: getting real pixels off the screen into a
//! top-down BGRA buffer. Everything image-shaped happens in `capture.rs`.
//!
//! Every GDI object acquired here is released by a `Drop` guard rather than
//! by a matching call at each return path. That is deliberate and follows
//! the same rule 9c's input code arrived at the hard way: a leak or a
//! double-free on an error path is exactly the bug that never shows up in a
//! test, and the error paths here are the COMMON case (a window closing
//! mid-capture). A bitmap still selected into a DC cannot be deleted, so the
//! selection is a guard too, and it must drop before the bitmap does --
//! which is why the declaration order below matters.

use crate::capture::{self, Frame};

use ::windows::Win32::Foundation::{HWND, RECT};
use ::windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GdiFlush, GetDC,
    ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HDC,
    HGDIOBJ, SRCCOPY,
};
use ::windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
use ::windows::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, GetWindowRect, SM_CXSCREEN, SM_CYSCREEN,
};

/// Refuse absurd regions before allocating for them. 40 megapixels is more
/// than an 8K display; anything larger is a bad rectangle, not a screen.
const MAX_PIXELS: u64 = 40_000_000;

/// `PW_RENDERFULLCONTENT`. Written as a literal because the named constant's
/// path moved between `windows` crate releases; the value is stable ABI.
const PW_RENDERFULLCONTENT: PRINT_WINDOW_FLAGS = PRINT_WINDOW_FLAGS(2);

struct ScreenDc(HDC);

impl ScreenDc {
    fn acquire() -> Result<Self, String> {
        // SAFETY: a null window handle asks for a DC covering the screen,
        // which is exactly what is wanted; failure is reported as a null HDC.
        let hdc = unsafe { GetDC(HWND(std::ptr::null_mut())) };
        if hdc.is_invalid() {
            return Err("GetDC for the screen failed".to_string());
        }
        Ok(ScreenDc(hdc))
    }
}

impl Drop for ScreenDc {
    fn drop(&mut self) {
        // SAFETY: releasing a DC this guard acquired and has not released.
        unsafe { ReleaseDC(HWND(std::ptr::null_mut()), self.0) };
    }
}

struct MemoryDc(HDC);

impl MemoryDc {
    fn create(reference: HDC) -> Result<Self, String> {
        // SAFETY: takes a live DC and reports failure as a null HDC.
        let hdc = unsafe { CreateCompatibleDC(reference) };
        if hdc.is_invalid() {
            return Err("CreateCompatibleDC failed".to_string());
        }
        Ok(MemoryDc(hdc))
    }
}

impl Drop for MemoryDc {
    fn drop(&mut self) {
        // SAFETY: deleting a DC this guard created; any bitmap selected into
        // it has already been deselected by `Selection`'s Drop, which runs
        // first because it is declared later in `capture_region`.
        unsafe { let _ = DeleteDC(self.0); };
    }
}

/// A device-independent bitmap plus a pointer to its pixel bytes. The bytes
/// are owned by GDI and valid until the bitmap is deleted, which this guard
/// does.
struct Dib {
    bitmap: HBITMAP,
    bits: *const u8,
    len: usize,
}

impl Dib {
    fn create(reference: HDC, width: i32, height: i32) -> Result<Self, String> {
        let mut info = BITMAPINFO::default();
        info.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        info.bmiHeader.biWidth = width;
        // Negative height requests a TOP-DOWN bitmap. A positive height
        // gives the traditional bottom-up DIB, and every row of the image
        // would then be vertically mirrored relative to what `capture.rs`
        // expects.
        info.bmiHeader.biHeight = -height;
        info.bmiHeader.biPlanes = 1;
        info.bmiHeader.biBitCount = 32;
        info.bmiHeader.biCompression = BI_RGB.0;
        let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
        // SAFETY: `info` is fully initialised above and outlives the call;
        // `bits` receives a pointer GDI owns until the bitmap is deleted.
        let bitmap = unsafe {
            CreateDIBSection(reference, &info, DIB_RGB_COLORS, &mut bits, None, 0)
        }
        .map_err(|err| format!("CreateDIBSection failed: {err:?}"))?;
        if bits.is_null() {
            // SAFETY: deleting the bitmap we just created, before returning.
            unsafe { let _ = DeleteObject(HGDIOBJ(bitmap.0)); };
            return Err("CreateDIBSection returned no pixel buffer".to_string());
        }
        Ok(Dib {
            bitmap,
            bits: bits as *const u8,
            len: width as usize * height as usize * 4,
        })
    }

    /// Copies the pixel bytes out of GDI's buffer while this guard still
    /// holds the bitmap alive.
    fn to_vec(&self) -> Vec<u8> {
        // SAFETY: `bits` points at `len` bytes GDI allocated for this
        // bitmap, which is still alive because `self` is.
        unsafe { std::slice::from_raw_parts(self.bits, self.len) }.to_vec()
    }
}

impl Drop for Dib {
    fn drop(&mut self) {
        // SAFETY: deleting a bitmap this guard created and has not deleted.
        unsafe { let _ = DeleteObject(HGDIOBJ(self.bitmap.0)); };
    }
}

/// Selects `bitmap` into `hdc` and restores the previous object on drop.
/// Without this, an error return between selection and deletion would leave
/// the bitmap selected -- and `DeleteObject` on a selected bitmap fails,
/// leaking a screen-sized allocation per failed capture.
struct Selection {
    hdc: HDC,
    previous: HGDIOBJ,
}

impl Selection {
    fn select(hdc: HDC, bitmap: HBITMAP) -> Self {
        // SAFETY: both handles are live; the returned previous object is
        // restored on drop.
        let previous = unsafe { SelectObject(hdc, HGDIOBJ(bitmap.0)) };
        Selection { hdc, previous }
    }
}

impl Drop for Selection {
    fn drop(&mut self) {
        // SAFETY: restoring the object that was selected before us.
        unsafe { SelectObject(self.hdc, self.previous) };
    }
}

fn check_size(width: i32, height: i32) -> Result<(u32, u32), String> {
    if width <= 0 || height <= 0 {
        return Err(format!("nothing to capture: the region is {width}x{height}"));
    }
    let pixels = width as u64 * height as u64;
    if pixels > MAX_PIXELS {
        return Err(format!("refusing to capture {width}x{height}: {pixels} pixels"));
    }
    Ok((width as u32, height as u32))
}

/// Runs `draw` against a memory DC backed by a fresh top-down 32-bit DIB and
/// returns the resulting frame.
fn capture_region(
    width: i32,
    height: i32,
    draw: impl FnOnce(HDC, HDC) -> Result<(), String>,
) -> Result<Frame, String> {
    let (w, h) = check_size(width, height)?;
    let screen = ScreenDc::acquire()?;
    let memory = MemoryDc::create(screen.0)?;
    let dib = Dib::create(screen.0, width, height)?;
    // Declared last so its Drop runs FIRST, deselecting the bitmap before
    // `dib` and `memory` are dropped.
    let _selection = Selection::select(memory.0, dib.bitmap);
    draw(memory.0, screen.0)?;
    // GDI batches drawing on the calling thread; without a flush the DIB
    // bytes can still be unwritten when they are read below.
    // SAFETY: takes no arguments.
    unsafe { let _ = GdiFlush(); };
    capture::from_bgra_top_down(w, h, &dib.to_vec())
}

/// The primary monitor, whose top-left is the origin of the coordinate space
/// `SetCursorPos` (and therefore `act`'s coordinate clicks) uses. This is
/// the ONLY capture whose pixels map back to clickable coordinates without
/// an origin offset the wire format has no field for -- see the report and
/// the user manual for that limitation.
pub fn grab_primary_screen() -> Result<Frame, String> {
    // SAFETY: `GetSystemMetrics` takes an index and returns a value; it
    // cannot fail in a way that needs handling beyond the size check.
    let width = unsafe { GetSystemMetrics(SM_CXSCREEN) };
    let height = unsafe { GetSystemMetrics(SM_CYSCREEN) };
    capture_region(width, height, |hdc, screen| {
        // SAFETY: both DCs are live for the duration of the call; the
        // source DC is owned by the ScreenDc guard inside capture_region.
        unsafe { BitBlt(hdc, 0, 0, width, height, screen, 0, 0, SRCCOPY) }
            .map_err(|err| format!("BitBlt of the primary screen failed: {err:?}"))
    })
}

/// One window's pixels.
///
/// `PrintWindow` with `PW_RENDERFULLCONTENT` first: it asks the window to
/// render itself, so it works even when the window is partially covered, and
/// it does not capture whatever happens to be on top of it -- which matters,
/// because capturing an overlapping window would put another application's
/// content into a frame labelled with this window's identity.
///
/// It also fails, silently, on some GPU-composited surfaces, returning an
/// all-black bitmap. That failure mode is the reason for the uniform-frame
/// check: a black rectangle returned as a successful screenshot is the worst
/// outcome available here, so a uniform result falls back to blitting the
/// window's rectangle straight off the screen. The fallback CAN include an
/// overlapping window, which is why it is second and why it says so on
/// stderr.
pub fn grab_window(hwnd: HWND) -> Result<Frame, String> {
    let mut rect = RECT::default();
    // SAFETY: `hwnd` was validated by the caller (`resolve_target_hwnd`);
    // `GetWindowRect` reports failure through its result.
    unsafe { GetWindowRect(hwnd, &mut rect) }
        .map_err(|err| format!("GetWindowRect failed: {err:?}"))?;
    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;
    let printed = capture_region(width, height, |hdc, _screen| {
        // SAFETY: both handles are live for the call.
        let ok = unsafe { PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT) }.as_bool();
        if ok {
            Ok(())
        } else {
            Err("PrintWindow refused to render the window".to_string())
        }
    });
    match printed {
        Ok(frame) if !capture::is_uniform(&frame) => Ok(frame),
        Ok(_) => {
            eprintln!(
                "PrintWindow returned a uniform (probably black) frame; falling back to a screen blit, which may include overlapping windows"
            );
            blit_window_rect(&rect, width, height)
        }
        Err(err) => {
            eprintln!("{err}; falling back to a screen blit, which may include overlapping windows");
            blit_window_rect(&rect, width, height)
        }
    }
}

fn blit_window_rect(rect: &RECT, width: i32, height: i32) -> Result<Frame, String> {
    let (left, top) = (rect.left, rect.top);
    capture_region(width, height, |hdc, screen| {
        // SAFETY: both DCs are live for the duration of the call. Source
        // coordinates are virtual-screen coordinates and may legitimately be
        // negative for a window on a monitor left of or above the primary.
        unsafe { BitBlt(hdc, 0, 0, width, height, screen, left, top, SRCCOPY) }
            .map_err(|err| format!("BitBlt of the window rectangle failed: {err:?}"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_zero_or_negative_region_is_refused_before_any_allocation() {
        assert!(check_size(0, 100).is_err());
        assert!(check_size(100, 0).is_err());
        assert!(check_size(-4, 10).is_err());
    }

    #[test]
    fn an_absurd_region_is_refused_rather_than_allocated() {
        let err = check_size(100_000, 100_000).unwrap_err();
        assert!(err.contains("refusing to capture"), "unexpected message: {err}");
    }

    #[test]
    fn a_plausible_screen_size_is_accepted() {
        assert_eq!(check_size(3840, 2160).unwrap(), (3840, 2160));
    }
}
