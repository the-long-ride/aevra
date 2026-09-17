//! The pure half of `capture`: BGRA-to-RGB conversion, area-average
//! downscaling, JPEG encoding, and the base64 data URI. No Windows API and
//! no COM, so all of it is directly unit-testable; the GDI screen grab lives
//! in `grab.rs`.
//!
//! WHY JPEG AND NOT PNG. The data URI produced here is returned to the model
//! as a STRING inside the tool result (`packages/mcp-tools/src/desktop-tools.ts`
//! passes `imageDataUri` straight through as JSON; nothing in this repo turns
//! it into an MCP image content block). So the base64 payload is billed as
//! text: its byte count IS roughly its token count. A real desktop with a
//! photographic wallpaper encodes to five to ten times more bytes as a
//! lossless PNG than as a quality-60 JPEG, and this subsystem's whole design
//! argument is that the accessibility tree, not pixels, carries the text. So
//! the pixels are allowed to be lossy: anything whose exact glyphs matter
//! should be read with `describe`, and `capture` exists for layout, canvas,
//! and game surfaces where an approximate image is the point.
//!
//! The same reasoning sets `MAX_EDGE`. An uncapped 4K screenshot is several
//! hundred kilobytes of base64 however it is compressed, which is a
//! six-figure token bill for one look at the screen.

use jpeg_encoder::{ColorType, Encoder};

/// Top-down, tightly packed RGB8. Rows have no padding: `rgb.len()` is
/// exactly `width * height * 3`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub rgb: Vec<u8>,
}

/// Longest edge of the returned image, in pixels. See the module comment for
/// why this is small.
pub const MAX_EDGE: u32 = 1024;

/// JPEG quality. 60 keeps large flat UI areas clean while cutting a
/// wallpaper down to a few tens of kilobytes.
pub const QUALITY: u8 = 60;

impl Frame {
    pub fn pixel(&self, x: u32, y: u32) -> [u8; 3] {
        let offset = ((y as usize * self.width as usize) + x as usize) * 3;
        [self.rgb[offset], self.rgb[offset + 1], self.rgb[offset + 2]]
    }
}

/// Converts the top-down BGRA bytes a DIB section hands back into RGB,
/// dropping the alpha channel -- a screen grab has no meaningful
/// transparency, and carrying a fourth channel into the encoder would only
/// cost bytes.
pub fn from_bgra_top_down(width: u32, height: u32, bgra: &[u8]) -> Result<Frame, String> {
    if width == 0 || height == 0 {
        return Err(format!("cannot build a frame from a {width}x{height} region"));
    }
    let expected = width as usize * height as usize * 4;
    if bgra.len() < expected {
        return Err(format!(
            "BGRA buffer is {} bytes, expected at least {expected} for {width}x{height}",
            bgra.len()
        ));
    }
    let mut rgb = Vec::with_capacity(width as usize * height as usize * 3);
    for pixel in bgra[..expected].chunks_exact(4) {
        rgb.push(pixel[2]);
        rgb.push(pixel[1]);
        rgb.push(pixel[0]);
    }
    Ok(Frame { width, height, rgb })
}

/// Area-average downscale so the longest edge is at most `max_edge`.
/// Returns the frame unchanged when it already fits -- capture NEVER
/// upscales, because that would inflate the payload while adding no
/// information, and would make `devicePixelRatio` claim a precision the
/// image does not have.
///
/// Averaging rather than nearest-neighbour sampling: a screenshot is mostly
/// one-pixel-wide text and borders, and point sampling drops whole strokes,
/// which turns a readable button label into noise.
pub fn downscale_to_max(frame: Frame, max_edge: u32) -> Frame {
    let longest = frame.width.max(frame.height);
    if max_edge == 0 || longest <= max_edge {
        return frame;
    }
    let target_width = scaled_edge(frame.width, longest, max_edge);
    let target_height = scaled_edge(frame.height, longest, max_edge);
    let mut rgb = Vec::with_capacity(target_width as usize * target_height as usize * 3);
    for ty in 0..target_height {
        let y0 = source_start(ty, target_height, frame.height);
        let y1 = source_end(ty, target_height, frame.height, y0);
        for tx in 0..target_width {
            let x0 = source_start(tx, target_width, frame.width);
            let x1 = source_end(tx, target_width, frame.width, x0);
            let mut totals = [0u32; 3];
            let mut count = 0u32;
            for y in y0..y1 {
                for x in x0..x1 {
                    let pixel = frame.pixel(x, y);
                    totals[0] += pixel[0] as u32;
                    totals[1] += pixel[1] as u32;
                    totals[2] += pixel[2] as u32;
                    count += 1;
                }
            }
            // `count` cannot be zero: `source_end` always returns at least
            // `y0 + 1` / `x0 + 1`.
            rgb.push((totals[0] / count) as u8);
            rgb.push((totals[1] / count) as u8);
            rgb.push((totals[2] / count) as u8);
        }
    }
    Frame { width: target_width, height: target_height, rgb }
}

fn scaled_edge(edge: u32, longest: u32, max_edge: u32) -> u32 {
    let scaled = (edge as u64 * max_edge as u64) / longest as u64;
    scaled.max(1) as u32
}

fn source_start(target_index: u32, target_edge: u32, source_edge: u32) -> u32 {
    ((target_index as u64 * source_edge as u64) / target_edge as u64) as u32
}

fn source_end(target_index: u32, target_edge: u32, source_edge: u32, start: u32) -> u32 {
    let end = (((target_index as u64 + 1) * source_edge as u64) / target_edge as u64) as u32;
    end.max(start + 1).min(source_edge)
}

/// True when every pixel is identical. This is how `grab.rs` detects the
/// classic Windows all-black window capture (`PrintWindow` against a
/// GPU-composited surface) so it can fall back rather than hand back a black
/// rectangle that looks like a successful screenshot.
pub fn is_uniform(frame: &Frame) -> bool {
    let mut pixels = frame.rgb.chunks_exact(3);
    let Some(first) = pixels.next() else {
        return true;
    };
    pixels.all(|pixel| pixel == first)
}

pub fn encode_jpeg(frame: &Frame, quality: u8) -> Result<Vec<u8>, String> {
    if frame.width > u16::MAX as u32 || frame.height > u16::MAX as u32 {
        return Err(format!(
            "{}x{} exceeds the JPEG dimension limit",
            frame.width, frame.height
        ));
    }
    let mut out = Vec::new();
    Encoder::new(&mut out, quality)
        .encode(&frame.rgb, frame.width as u16, frame.height as u16, ColorType::Rgb)
        .map_err(|err| format!("JPEG encoding failed: {err}"))?;
    Ok(out)
}

pub fn to_data_uri(jpeg: &[u8]) -> String {
    format!("data:image/jpeg;base64,{}", base64(jpeg))
}

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standard base64 with padding -- the alphabet a `data:` URI requires.
/// Hand-rolled rather than pulled in as a dependency: it is twelve lines and
/// exactly specified.
pub fn base64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let packed = (b0 << 16) | (b1 << 8) | b2;
        out.push(ALPHABET[((packed >> 18) & 63) as usize] as char);
        out.push(ALPHABET[((packed >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { ALPHABET[((packed >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { ALPHABET[(packed & 63) as usize] as char } else { '=' });
    }
    out
}

/// The rest of the pipeline after the grab: downscale, refuse a blank
/// result, encode, and report the ratio of returned image pixels to source
/// pixels.
///
/// That ratio is what the wire calls `devicePixelRatio`, and it is the only
/// thing that lets a caller turn a pixel it saw in the image into a
/// coordinate it can click: `clickX = imageX / devicePixelRatio`. It is
/// therefore computed from the width actually returned, never from the
/// requested cap.
///
/// A uniform frame is an ERROR, not a result. It is what a locked or asleep
/// display, a capture-protected window, or a `PrintWindow` that gave up
/// produces, and handing it back as a successful screenshot would have the
/// model reason confidently about a screen nobody ever saw. The check runs
/// after downscaling so that averaging cannot turn a nearly-blank frame into
/// a provably blank one behind our back.
pub fn encode_frame(frame: Frame) -> Result<(String, f64), String> {
    let (source_width, source_height) = (frame.width, frame.height);
    let scaled = downscale_to_max(frame, MAX_EDGE);
    let ratio = scaled.width as f64 / source_width as f64;
    if is_uniform(&scaled) {
        return Err(format!(
            "captured a uniform {source_width}x{source_height} image: the display is likely locked, asleep, or protected against capture"
        ));
    }
    let jpeg = encode_jpeg(&scaled, QUALITY)?;
    Ok((to_data_uri(&jpeg), ratio))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid(width: u32, height: u32, pixel: [u8; 3]) -> Frame {
        let mut rgb = Vec::new();
        for _ in 0..(width * height) {
            rgb.extend_from_slice(&pixel);
        }
        Frame { width, height, rgb }
    }

    #[test]
    fn base64_matches_the_standard_vectors() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn bgra_is_reordered_to_rgb_and_alpha_dropped() {
        // One pixel, B=1 G=2 R=3, alpha ignored.
        let frame = from_bgra_top_down(1, 1, &[1, 2, 3, 255]).unwrap();
        assert_eq!(frame.rgb, vec![3, 2, 1]);
    }

    #[test]
    fn a_short_bgra_buffer_is_an_error_rather_than_a_partial_image() {
        let err = from_bgra_top_down(2, 2, &[0; 8]).unwrap_err();
        assert!(err.contains("expected at least 16"), "unexpected message: {err}");
    }

    #[test]
    fn a_zero_sized_region_is_an_error() {
        assert!(from_bgra_top_down(0, 10, &[]).is_err());
        assert!(from_bgra_top_down(10, 0, &[]).is_err());
    }

    #[test]
    fn downscale_caps_the_longest_edge_and_keeps_the_aspect_ratio() {
        let frame = solid(1920, 1080, [10, 20, 30]);
        let scaled = downscale_to_max(frame, 1024);
        assert_eq!(scaled.width, 1024);
        assert_eq!(scaled.height, 576);
        assert_eq!(scaled.rgb.len(), 1024 * 576 * 3);
        // A solid source must survive averaging unchanged.
        assert_eq!(scaled.pixel(500, 300), [10, 20, 30]);
    }

    #[test]
    fn downscale_never_upscales_a_small_frame() {
        let frame = solid(64, 32, [1, 2, 3]);
        let scaled = downscale_to_max(frame.clone(), 1024);
        assert_eq!(scaled, frame, "a frame within the cap must be returned untouched");
    }

    #[test]
    fn downscale_caps_the_taller_edge_of_a_portrait_frame() {
        let scaled = downscale_to_max(solid(600, 2000, [0, 0, 0]), 1000);
        assert_eq!(scaled.height, 1000);
        assert_eq!(scaled.width, 300);
    }

    #[test]
    fn downscale_averages_rather_than_point_sampling() {
        // 2x1: black then white. A nearest-neighbour 1x1 would return one of
        // the two; the average is mid grey. This is the property that keeps
        // one-pixel text strokes from vanishing entirely.
        let frame = Frame { width: 2, height: 1, rgb: vec![0, 0, 0, 255, 255, 255] };
        let scaled = downscale_to_max(frame, 1);
        assert_eq!(scaled.width, 1);
        assert_eq!(scaled.pixel(0, 0), [127, 127, 127]);
    }

    #[test]
    fn a_one_pixel_edge_never_collapses_to_zero() {
        // 4000x1 scaled to 1000: the height must stay 1, not round to 0.
        let scaled = downscale_to_max(solid(4000, 1, [5, 5, 5]), 1000);
        assert_eq!((scaled.width, scaled.height), (1000, 1));
        assert_eq!(scaled.rgb.len(), 1000 * 3);
    }

    #[test]
    fn uniform_detects_the_all_black_capture_failure() {
        assert!(is_uniform(&solid(4, 4, [0, 0, 0])));
        let mut frame = solid(4, 4, [0, 0, 0]);
        frame.rgb[7] = 9;
        assert!(!is_uniform(&frame), "a single differing pixel means real content");
    }

    #[test]
    fn jpeg_encoding_produces_a_real_jfif_stream() {
        let jpeg = encode_jpeg(&solid(16, 16, [200, 100, 50]), QUALITY).unwrap();
        assert_eq!(&jpeg[..3], &[0xff, 0xd8, 0xff], "missing the SOI marker");
        assert_eq!(&jpeg[jpeg.len() - 2..], &[0xff, 0xd9], "missing the EOI marker");
    }

    /// A frame with varying content, so it survives the blank-frame refusal.
    fn gradient(width: u32, height: u32) -> Frame {
        let mut rgb = Vec::with_capacity(width as usize * height as usize * 3);
        for y in 0..height {
            for x in 0..width {
                rgb.push((x % 251) as u8);
                rgb.push((y % 241) as u8);
                rgb.push(((x + y) % 239) as u8);
            }
        }
        Frame { width, height, rgb }
    }

    #[test]
    fn encode_frame_reports_the_ratio_of_returned_to_source_pixels() {
        let (uri, ratio) = encode_frame(gradient(1920, 1080)).unwrap();
        assert!(uri.starts_with("data:image/jpeg;base64,"));
        // 1024/1920. A caller divides an image coordinate by this to get a
        // clickable screen coordinate, so it must describe the image it
        // actually got.
        assert!((ratio - (1024.0 / 1920.0)).abs() < 1e-9, "ratio was {ratio}");
        let payload = uri.trim_start_matches("data:image/jpeg;base64,");
        assert!(payload.len() > 32, "payload was {} chars", payload.len());
        assert!(payload.chars().all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '='));
    }

    #[test]
    fn encode_frame_of_a_small_region_reports_ratio_one() {
        let (_, ratio) = encode_frame(gradient(32, 32)).unwrap();
        assert_eq!(ratio, 1.0);
    }

    #[test]
    fn encode_frame_refuses_a_blank_capture_rather_than_returning_it() {
        // The all-black outcome of a locked display or a capture-protected
        // window. This must be an error: a black image returned as a
        // successful screenshot is worse than no screenshot at all.
        let err = encode_frame(solid(800, 600, [0, 0, 0])).unwrap_err();
        assert!(err.contains("uniform 800x600"), "unexpected message: {err}");
    }
}
