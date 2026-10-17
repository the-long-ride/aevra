import assert from 'node:assert/strict';
import test from 'node:test';
import { configureMacBuild } from '../setup-macos.mjs';

test('selects installed Xcode with Metal 26 SDK and exports it for following jobs', () => {
  const calls = [],
    output = [];
  const run = (file, args, options) => {
    calls.push({ file, args, options });
    if (file.endsWith('xcodebuild'))
      return file.includes('26.3')
        ? 'Xcode 26.3\nBuild version test'
        : 'Xcode 16.4\nBuild version test';
    if (args.includes('--show-sdk-version')) return '26.3';
    if (args.includes('--show-sdk-path')) return '/SDKs/MacOSX26.sdk';
    return '';
  };
  const developer = configureMacBuild(
    ['/Applications/Xcode_16.4.app', '/Applications/Xcode_26.3.app'],
    run,
    (value) => output.push(value),
  );
  assert.equal(developer, '/Applications/Xcode_26.3.app/Contents/Developer');
  assert.equal(output[0], `DEVELOPER_DIR=${developer}\nSDKROOT=/SDKs/MacOSX26.sdk\n`);
  assert.ok(
    calls.some(
      (c) => c.args.includes('-typecheck') && c.options.input.includes('MTLTensorDescriptor'),
    ),
  );
});

test('old or missing SDK refuses before exporting a misleading build environment', () => {
  assert.throws(
    () =>
      configureMacBuild(
        [],
        () => '',
        () => assert.fail(),
      ),
    /Xcode 26/,
  );
  assert.throws(
    () =>
      configureMacBuild(
        ['/Applications/Xcode.app'],
        (_file, args) => (args.includes('-version') ? 'Xcode 26.3' : '15.5'),
        () => assert.fail(),
      ),
    /SDK 26/,
  );
});
