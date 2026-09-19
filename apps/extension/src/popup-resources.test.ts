import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkExtensionUpdate,
  getExtensionVersion,
  isVersionOutdated,
  openExternalUrl,
  initPopupResources,
} from './popup-resources.js';

function renderResourcesDOM() {
  document.body.innerHTML = `
    <div class="resources-card">
      <span id="extension-version">v0.1.0</span>
      <a href="https://www.npmjs.com/package/@the-long-ride/aevra" class="resource-link" id="link-npm">npm</a>
      <a href="https://github.com/the-long-ride/aevra" class="resource-link" id="link-repo">GitHub</a>
      <a href="https://github.com/the-long-ride/aevra/releases" class="resource-link" id="link-releases">Releases</a>
      <a href="https://github.com/the-long-ride/aevra/blob/main/CHANGELOG.md" class="resource-link" id="link-changelog">Changelog</a>
      <button type="button" id="check-update-btn">
        <span id="check-update-text">Check for update</span>
      </button>
      <div id="update-status" hidden></div>
    </div>
  `;
}

beforeEach(() => {
  vi.resetModules();
  renderResourcesDOM();

  (globalThis as any).chrome = {
    tabs: {
      create: vi.fn(),
    },
    runtime: {
      id: 'mock-ext-id',
      getManifest: () => ({ version: '0.1.0' }),
    },
  };
});

afterEach(() => {
  delete (globalThis as any).chrome;
  delete (globalThis as any).fetch;
  vi.useRealTimers();
});

describe('popup resources and update checking', () => {
  it('isVersionOutdated correctly compares semantic versions', () => {
    expect(isVersionOutdated('0.1.0', '0.1.1')).toBe(true);
    expect(isVersionOutdated('0.1.0', '0.2.0')).toBe(true);
    expect(isVersionOutdated('0.1.0', '1.0.0')).toBe(true);
    expect(isVersionOutdated('v0.1.0', '0.1.1')).toBe(true);
    expect(isVersionOutdated('0.1.0', 'v0.1.1')).toBe(true);
    expect(isVersionOutdated('1.0.5', '1.0.5')).toBe(false);
    expect(isVersionOutdated('1.0.5', '1.0.4')).toBe(false);
    expect(isVersionOutdated('1.0.5', '0.9.9')).toBe(false);
    expect(isVersionOutdated(undefined, '1.0.0')).toBe(false);
    expect(isVersionOutdated('1.0.0', undefined)).toBe(false);
  });

  it('getExtensionVersion reads from manifest or falls back', () => {
    expect(getExtensionVersion()).toBe('0.1.0');

    (globalThis as any).chrome.runtime.getManifest = () => ({ version: '1.2.3' });
    expect(getExtensionVersion()).toBe('1.2.3');

    (globalThis as any).chrome.runtime.getManifest = () => {
      throw new Error('boom');
    };
    expect(getExtensionVersion()).toBe('0.1.0');
  });

  it('openExternalUrl delegates to chrome.tabs.create or window.open', () => {
    const createSpy = (globalThis as any).chrome.tabs.create;
    openExternalUrl('https://example.com/test');
    expect(createSpy).toHaveBeenCalledWith({ url: 'https://example.com/test' });

    // Fallback when chrome.tabs.create throws
    createSpy.mockImplementationOnce(() => {
      throw new Error('not available');
    });
    const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    openExternalUrl('https://example.com/fallback');
    expect(windowOpenSpy).toHaveBeenCalledWith(
      'https://example.com/fallback',
      '_blank',
      'noopener,noreferrer',
    );
    windowOpenSpy.mockRestore();
  });

  it('checkExtensionUpdate reports update-available when tag is higher', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: 'v1.0.0',
        html_url: 'https://github.com/the-long-ride/aevra/releases/tag/v1.0.0',
      }),
    } as Response);

    const result = await checkExtensionUpdate('0.1.0', fakeFetch as any);
    expect(result.status).toBe('update-available');
    expect(result.message).toBe('Update available: v1.0.0');
    expect(result.releaseUrl).toBe('https://github.com/the-long-ride/aevra/releases/tag/v1.0.0');
  });

  it('checkExtensionUpdate reports latest when current matches or exceeds tag', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: 'v0.1.0',
        html_url: 'https://github.com/the-long-ride/aevra/releases/tag/v0.1.0',
      }),
    } as Response);

    const result = await checkExtensionUpdate('0.1.0', fakeFetch as any);
    expect(result.status).toBe('latest');
    expect(result.message).toContain('Up to date');
  });

  it('checkExtensionUpdate handles HTTP errors', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
    } as Response);

    const result = await checkExtensionUpdate('0.1.0', fakeFetch as any);
    expect(result.status).toBe('error');
    expect(result.message).toContain('HTTP 403');
  });

  it('checkExtensionUpdate handles network exception and missing tag', async () => {
    const rejectingFetch = vi.fn().mockRejectedValue(new Error('offline'));
    const netResult = await checkExtensionUpdate('0.1.0', rejectingFetch as any);
    expect(netResult.status).toBe('error');
    expect(netResult.message).toContain('Network error');

    const noTagFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);
    const noTagResult = await checkExtensionUpdate('0.1.0', noTagFetch as any);
    expect(noTagResult.status).toBe('error');
    expect(noTagResult.message).toContain('No release tag found');
  });

  it('initPopupResources sets version and wires clicking on resource links', () => {
    initPopupResources();

    const versionEl = document.getElementById('extension-version')!;
    expect(versionEl.textContent).toBe('v0.1.0');

    const createSpy = (globalThis as any).chrome.tabs.create;
    const npmLink = document.getElementById('link-npm')!;
    npmLink.click();
    expect(createSpy).toHaveBeenCalledWith({
      url: 'https://www.npmjs.com/package/@the-long-ride/aevra',
    });

    const repoLink = document.getElementById('link-repo')!;
    repoLink.click();
    expect(createSpy).toHaveBeenCalledWith({
      url: 'https://github.com/the-long-ride/aevra',
    });
  });

  it('clicking check for updates button renders update available status and link', async () => {
    (globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: 'v2.0.0',
        html_url: 'https://github.com/the-long-ride/aevra/releases/tag/v2.0.0',
      }),
    });

    initPopupResources();

    const checkBtn = document.getElementById('check-update-btn') as HTMLButtonElement;
    const statusEl = document.getElementById('update-status')!;

    checkBtn.click();
    await vi.waitFor(() => expect(statusEl.className).toContain('available'));

    expect(statusEl.textContent).toContain('Update available: v2.0.0');
    const link = statusEl.querySelector('a')!;
    expect(link).not.toBeNull();
    expect(link.textContent).toContain('Get update');

    const createSpy = (globalThis as any).chrome.tabs.create;
    link.click();
    expect(createSpy).toHaveBeenCalledWith({
      url: 'https://github.com/the-long-ride/aevra/releases/tag/v2.0.0',
    });
  });

  it('clicking check for updates button renders up-to-date status', async () => {
    (globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: 'v0.1.0',
        html_url: 'https://github.com/the-long-ride/aevra/releases/tag/v0.1.0',
      }),
    });

    initPopupResources();

    const checkBtn = document.getElementById('check-update-btn') as HTMLButtonElement;
    const statusEl = document.getElementById('update-status')!;

    checkBtn.click();
    await vi.waitFor(() => expect(statusEl.className).toContain('latest'));
    expect(statusEl.textContent).toContain('Up to date');
  });

  it('clicking check for updates button renders error status and view releases link on failure', async () => {
    (globalThis as any).fetch = vi.fn().mockRejectedValue(new Error('network fail'));

    initPopupResources();

    const checkBtn = document.getElementById('check-update-btn') as HTMLButtonElement;
    const statusEl = document.getElementById('update-status')!;

    checkBtn.click();
    await vi.waitFor(() => expect(statusEl.className).toContain('error'));
    expect(statusEl.textContent).toContain('Network error');

    const link = statusEl.querySelector('a')!;
    expect(link).not.toBeNull();
    expect(link.textContent).toContain('View releases');

    const createSpy = (globalThis as any).chrome.tabs.create;
    link.click();
    expect(createSpy).toHaveBeenCalledWith({
      url: 'https://github.com/the-long-ride/aevra/releases',
    });
  });
});
