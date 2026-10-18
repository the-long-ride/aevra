import { describe, expect, it } from 'vitest';
import { lastUsedLabel } from './agent-time';

const now = Date.parse('2026-10-17T12:00:00Z');
const ago = (ms: number) => new Date(now - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('lastUsedLabel', () => {
  it('says Never used for null and missing values', () => {
    expect(lastUsedLabel(null, now)).toBe('Never used');
    expect(lastUsedLabel(undefined, now)).toBe('Never used');
  });

  it('shows a dash for an unparsable timestamp', () => {
    expect(lastUsedLabel('not-a-date', now)).toBe('-');
  });

  it('uses just now below one minute, including future timestamps', () => {
    expect(lastUsedLabel(ago(0), now)).toBe('just now');
    expect(lastUsedLabel(ago(59_999), now)).toBe('just now');
    expect(lastUsedLabel(ago(-5 * MIN), now)).toBe('just now');
  });

  it('uses minutes from one minute up to one hour', () => {
    expect(lastUsedLabel(ago(MIN), now)).toBe('1 min ago');
    expect(lastUsedLabel(ago(5 * MIN), now)).toBe('5 min ago');
    expect(lastUsedLabel(ago(HOUR - 1), now)).toBe('59 min ago');
  });

  it('uses hours from one hour up to one day', () => {
    expect(lastUsedLabel(ago(HOUR), now)).toBe('1 h ago');
    expect(lastUsedLabel(ago(3 * HOUR + 20 * MIN), now)).toBe('3 h ago');
    expect(lastUsedLabel(ago(DAY - 1), now)).toBe('23 h ago');
  });

  it('uses days from one day on', () => {
    expect(lastUsedLabel(ago(DAY), now)).toBe('1 d ago');
    expect(lastUsedLabel(ago(2 * DAY + HOUR), now)).toBe('2 d ago');
    expect(lastUsedLabel(ago(400 * DAY), now)).toBe('400 d ago');
  });

  it('defaults now to the current time', () => {
    expect(lastUsedLabel(new Date().toISOString())).toBe('just now');
  });
});
