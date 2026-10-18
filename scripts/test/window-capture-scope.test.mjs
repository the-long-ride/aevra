import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('native window capture cannot fall back to a screen rectangle under a window identity', () => {
  const source = readFileSync(new URL('../../helper/src/grab.rs', import.meta.url), 'utf8');
  const windowCapture = source.slice(
    source.indexOf('pub fn grab_window'),
    source.indexOf('#[cfg(test)]'),
  );
  assert.doesNotMatch(windowCapture, /blit_window_rect|BitBlt/);
  assert.match(windowCapture, /PrintWindow/);
});
