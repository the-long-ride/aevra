import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import { frameCrop } from './policy.js';
Gio._promisify(Shell.Screenshot, 'composite_to_stream');

export async function capture(actor) {
  const content = actor.paint_to_content(null);
  const texture = content.get_texture();
  const width = texture.get_width();
  const height = texture.get_height();
  if (width <= 0 || height <= 0 || width * height > 32 * 1024 * 1024)
    throw Error('DESKTOP_INPUT_REFUSED');
  const crop = frameCrop(
    actor.meta_window.get_frame_rect(),
    actor.meta_window.get_buffer_rect(),
    width,
    height,
  );
  const stream = Gio.MemoryOutputStream.new_resizable();
  try {
    await Shell.Screenshot.composite_to_stream(
      texture,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      1,
      null,
      0,
      0,
      1,
      stream,
    );
    stream.close(null);
    const bytes = stream.steal_as_bytes().get_data();
    if (bytes.length > 128 * 1024 * 1024) throw Error('DESKTOP_INPUT_REFUSED');
    return bytes;
  } finally {
    if (!stream.is_closed()) stream.close(null);
  }
}
