// Shared build prerequisite for root helper and standalone Desktop consumers.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function configureMacBuild(apps, run = execFileSync, emit = () => {}) {
  const candidates = [];
  for (const app of apps) {
    const developer = `${app}/Contents/Developer`;
    try {
      const version = String(
        run(`${developer}/usr/bin/xcodebuild`, ['-version'], {
          encoding: 'utf8',
          env: { ...process.env, DEVELOPER_DIR: developer },
        }),
      ).match(/Xcode (\d+)(?:\.(\d+))?/);
      if (version && Number(version[1]) >= 26)
        candidates.push({ developer, major: Number(version[1]), minor: Number(version[2] ?? 0) });
    } catch {
      /* Ignore an incomplete installation; require a verified candidate. */
    }
  }
  candidates.sort((a, b) => b.major - a.major || b.minor - a.minor);
  if (!candidates.length) throw Error('Xcode 26 or newer is required by the native Metal bridge');
  const developer = candidates[0].developer;
  const options = { encoding: 'utf8', env: { ...process.env, DEVELOPER_DIR: developer } };
  const sdk = String(run('xcrun', ['--sdk', 'macosx', '--show-sdk-version'], options)).trim();
  if (Number(sdk.split('.')[0]) < 26 || !/^\d+\./.test(sdk))
    throw Error(`macOS SDK 26 or newer required; selected ${sdk}`);
  const sdkPath = String(run('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], options)).trim();
  if (!sdkPath.startsWith('/') || /[\r\n]/.test(sdkPath))
    throw Error('Invalid selected macOS SDK path');
  options.env.SDKROOT = sdkPath;
  // Availability checks cannot make SDK declarations appear in an older SDK.
  run('xcrun', ['--sdk', 'macosx', 'swiftc', '-typecheck', '-'], {
    ...options,
    input:
      'import Metal\nif #available(macOS 26.0, *) { _ = MTLTensorDescriptor(); _ = MTLSamplerReductionMode(rawValue: 0) }\n',
  });
  emit(`DEVELOPER_DIR=${developer}\nSDKROOT=${sdkPath}\n`);
  return developer;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.platform !== 'darwin') throw Error('Run this prerequisite only on macOS');
  const apps = readdirSync('/Applications')
    .filter((name) => /^Xcode.*\.app$/.test(name) && !/beta/i.test(name))
    .map((name) => `/Applications/${name}`);
  const developer = configureMacBuild(apps, execFileSync, (value) => {
    if (!process.env.GITHUB_ENV)
      throw Error('GITHUB_ENV is required to persist the selected Xcode');
    appendFileSync(process.env.GITHUB_ENV, value);
  });
  console.log(`Selected ${developer}; Metal SDK declarations verified`);
}
