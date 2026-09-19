// Signals extension presence and version to web pages and the Aevra Web Admin
(function () {
  try {
    const manifest = chrome.runtime.getManifest();
    const version = manifest.version;
    const extensionId = chrome.runtime.id;

    const advertise = () => {
      document.documentElement.setAttribute('data-aevra-extension-installed', 'true');
      document.documentElement.setAttribute('data-aevra-extension-version', version);
      document.documentElement.setAttribute('data-aevra-extension-id', extensionId);
      window.dispatchEvent(
        new CustomEvent('aevra:extension-detected', {
          detail: { installed: true, version, extensionId },
        }),
      );
    };

    advertise();

    window.addEventListener('message', (event) => {
      if (event.data?.type === 'aevra:ping-extension') {
        window.postMessage(
          {
            type: 'aevra:pong-extension',
            installed: true,
            version,
            extensionId,
          },
          '*',
        );
        advertise();
      }
    });
  } catch {
    // Context invalidated or runtime unavailable
  }
})();
