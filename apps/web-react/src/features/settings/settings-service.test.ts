import { beforeEach, expect, test, vi } from 'vitest';
import { loadSettings } from './settings-service';

const requestJson = vi.fn();

vi.mock('../../services/api-client', () => ({
  requestJson: (path: string, init?: RequestInit) => requestJson(path, init),
}));

beforeEach(() => requestJson.mockReset().mockResolvedValue(undefined));

test('settings loading uses empty options without a signal and forwards one when provided', async () => {
  await loadSettings();
  expect(requestJson).toHaveBeenCalledTimes(10);
  for (const [, init] of requestJson.mock.calls) expect(init).toEqual({});

  requestJson.mockClear();
  const controller = new AbortController();
  await loadSettings(controller.signal);
  expect(requestJson).toHaveBeenCalledTimes(10);
  for (const [, init] of requestJson.mock.calls) expect(init?.signal).toBe(controller.signal);
});
