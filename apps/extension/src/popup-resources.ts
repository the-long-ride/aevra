export const NPM_PACKAGE_URL = 'https://www.npmjs.com/package/@the-long-ride/aevra';
export const GITHUB_REPO_URL = 'https://github.com/the-long-ride/aevra';
export const GITHUB_RELEASES_URL = 'https://github.com/the-long-ride/aevra/releases';
export const GITHUB_CHANGELOG_URL = 'https://github.com/the-long-ride/aevra/blob/main/CHANGELOG.md';
export const GITHUB_LATEST_RELEASE_API =
  'https://api.github.com/repos/the-long-ride/aevra/releases/latest';

export function getExtensionVersion(): string {
  try {
    return chrome.runtime?.getManifest?.()?.version ?? '0.1.0';
  } catch {
    return '0.1.0';
  }
}

export function openExternalUrl(url: string): void {
  try {
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      void chrome.tabs.create({ url });
      return;
    }
  } catch {
    // Fall through to window.open
  }
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export function isVersionOutdated(current?: string, latest?: string): boolean {
  if (!current || !latest) return false;
  const clean = (v: string) =>
    v
      .replace(/^v/, '')
      .trim()
      .split('.')
      .map((x) => parseInt(x, 10) || 0);
  const [cMaj = 0, cMin = 0, cPatch = 0] = clean(current);
  const [lMaj = 0, lMin = 0, lPatch = 0] = clean(latest);
  if (lMaj > cMaj) return true;
  if (lMaj === cMaj && lMin > cMin) return true;
  if (lMaj === cMaj && lMin === cMin && lPatch > cPatch) return true;
  return false;
}

export interface UpdateCheckResult {
  status: 'latest' | 'update-available' | 'error';
  currentVersion: string;
  latestVersion?: string;
  releaseUrl: string;
  message: string;
}

export async function checkExtensionUpdate(
  currentVersion: string,
  fetchFn: typeof fetch = fetch,
): Promise<UpdateCheckResult> {
  try {
    const res = await fetchFn(GITHUB_LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });

    if (!res.ok) {
      return {
        status: 'error',
        currentVersion,
        releaseUrl: GITHUB_RELEASES_URL,
        message: `Check failed (HTTP ${res.status}).`,
      };
    }

    const payload = (await res.json()) as { tag_name?: string; html_url?: string };
    const latestTag = payload?.tag_name || '';
    const releaseUrl = payload?.html_url || GITHUB_RELEASES_URL;

    if (!latestTag) {
      return {
        status: 'error',
        currentVersion,
        releaseUrl,
        message: 'No release tag found.',
      };
    }

    if (isVersionOutdated(currentVersion, latestTag)) {
      return {
        status: 'update-available',
        currentVersion,
        latestVersion: latestTag,
        releaseUrl,
        message: `Update available: ${latestTag}`,
      };
    }

    return {
      status: 'latest',
      currentVersion,
      latestVersion: latestTag,
      releaseUrl,
      message: `Up to date (${latestTag || 'v' + currentVersion})`,
    };
  } catch {
    return {
      status: 'error',
      currentVersion,
      releaseUrl: GITHUB_RELEASES_URL,
      message: 'Network error checking updates.',
    };
  }
}

export function initPopupResources(versionOverride?: string): void {
  const versionBadge = document.getElementById('extension-version');
  const currentVersion = versionOverride ?? getExtensionVersion();
  if (versionBadge) {
    versionBadge.textContent = `v${currentVersion}`;
  }

  const resourceLinks = document.querySelectorAll<HTMLAnchorElement>('.resource-link');
  resourceLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      if (link.href) {
        openExternalUrl(link.href);
      }
    });
  });

  const checkUpdateBtn = document.getElementById('check-update-btn') as HTMLButtonElement | null;
  const checkUpdateText = document.getElementById('check-update-text');
  const updateStatus = document.getElementById('update-status');

  if (checkUpdateBtn && updateStatus) {
    checkUpdateBtn.addEventListener('click', () => {
      checkUpdateBtn.disabled = true;
      if (checkUpdateText) checkUpdateText.textContent = 'Checking…';
      updateStatus.removeAttribute('hidden');
      updateStatus.className = 'update-status';
      updateStatus.textContent = 'Checking releases…';

      void checkExtensionUpdate(currentVersion).then((result) => {
        checkUpdateBtn.disabled = false;
        if (checkUpdateText) checkUpdateText.textContent = 'Check for update';

        updateStatus.removeAttribute('hidden');
        if (result.status === 'update-available') {
          updateStatus.className = 'update-status available';
          updateStatus.textContent = '';
          const msgSpan = document.createElement('span');
          msgSpan.textContent = `${result.message} `;
          const actionLink = document.createElement('a');
          actionLink.href = result.releaseUrl;
          actionLink.textContent = 'Get update ↗';
          actionLink.addEventListener('click', (e) => {
            e.preventDefault();
            openExternalUrl(result.releaseUrl);
          });
          updateStatus.appendChild(msgSpan);
          updateStatus.appendChild(actionLink);
        } else if (result.status === 'latest') {
          updateStatus.className = 'update-status latest';
          updateStatus.textContent = result.message;
        } else {
          updateStatus.className = 'update-status error';
          updateStatus.textContent = '';
          const msgSpan = document.createElement('span');
          msgSpan.textContent = `${result.message} `;
          const actionLink = document.createElement('a');
          actionLink.href = result.releaseUrl;
          actionLink.textContent = 'View releases ↗';
          actionLink.addEventListener('click', (e) => {
            e.preventDefault();
            openExternalUrl(result.releaseUrl);
          });
          updateStatus.appendChild(msgSpan);
          updateStatus.appendChild(actionLink);
        }
      });
    });
  }
}
