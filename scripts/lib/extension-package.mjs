// Assembles the file list that goes into the packed extension. Kept free of IO
// so the layout rules - which files ship, where the manifest points, what the
// version becomes - are testable without running the compiler.

export const EXTENSION_ROOT = 'apps/extension/src';

/**
 * Chrome accepts one to four dot-separated integers and nothing else, so a
 * prerelease or build suffix has to be dropped rather than passed through: the
 * browser refuses to load the extension otherwise.
 */
export function normalizeVersion(raw) {
  const parts = String(raw ?? '')
    .split('+')[0]
    .split('-')[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isInteger(part) && part >= 0)
    .slice(0, 4);
  return parts.length > 0 ? parts.join('.') : '0.0.0';
}

/**
 * The compiler emits into a repo-shaped tree because the extension imports
 * shared source from `packages/`, and those relative imports have to keep
 * resolving inside the packed extension. So the tree is preserved and the
 * manifest's own paths are rewritten to point into it rather than flattening
 * everything and breaking every import.
 */
export function packagedManifest(manifest, version) {
  const packaged = {
    ...manifest,
    version: normalizeVersion(version),
    background: { ...manifest.background, service_worker: `${EXTENSION_ROOT}/service-worker.js` },
    options_page: `${EXTENSION_ROOT}/options.html`,
  };
  if (manifest.action) {
    packaged.action = { ...manifest.action };
    if (manifest.action.default_popup) {
      const popup = manifest.action.default_popup;
      packaged.action.default_popup = popup.startsWith(EXTENSION_ROOT)
        ? popup
        : `${EXTENSION_ROOT}/${popup}`;
    }
  }
  if (manifest.content_scripts) {
    packaged.content_scripts = manifest.content_scripts.map((cs) => ({
      ...cs,
      js: cs.js?.map((file) =>
        file.startsWith(EXTENSION_ROOT) ? file : `${EXTENSION_ROOT}/${file}`,
      ),
    }));
  }
  return packaged;
}

/** Test builds must never ship: they carry the fixtures and the assertions. */
export function shipsInExtension(name) {
  return name.endsWith('.js') && !name.endsWith('.test.js');
}

export function extensionEntries({
  emitted,
  manifest,
  optionsHtml,
  popupHtml,
  version,
  icons = [],
}) {
  const entries = emitted.filter((entry) => shipsInExtension(entry.name));
  entries.push({
    name: 'manifest.json',
    data: Buffer.from(`${JSON.stringify(packagedManifest(manifest, version), null, 2)}\n`, 'utf8'),
  });
  entries.push({
    name: `${EXTENSION_ROOT}/options.html`,
    data: Buffer.from(optionsHtml, 'utf8'),
  });
  if (popupHtml) {
    entries.push({
      name: `${EXTENSION_ROOT}/popup.html`,
      data: Buffer.from(popupHtml, 'utf8'),
    });
  }
  for (const icon of icons) {
    entries.push(icon);
  }
  return entries;
}
