/** Navigation invalidates the entire native action, including same-URL reloads. */
export async function withNativeDocument<T>(
  tabId: number,
  cancelled: (() => boolean) | undefined,
  work: (isCancelled: () => boolean, isDocumentCurrent: () => boolean) => Promise<T>,
): Promise<T> {
  let changed = false;
  const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
    if (id === tabId && (info.status === 'loading' || info.url !== undefined)) changed = true;
  };
  chrome.tabs.onUpdated?.addListener(listener);
  try {
    return await work(
      () => changed || Boolean(cancelled?.()),
      () => !changed,
    );
  } finally {
    chrome.tabs.onUpdated?.removeListener(listener);
  }
}
