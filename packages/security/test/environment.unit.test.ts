import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChildEnvironment } from '../src/environment.js';

test('Windows explicit PATH replaces differently-cased inherited Path', () => {
  const env = buildChildEnvironment(
    { PATH: 'C:\\override', PATHEXT: '.EXE' },
    { Path: 'C:\\base', PATHEXT: '.COM;.EXE', TEMP: 'C:\\Temp' },
    'win32',
  );

  assert.equal(env.PATH, 'C:\\override');
  assert.equal(env.PATHEXT, '.EXE');
  assert.equal(env.TEMP, 'C:\\Temp');
  assert.equal(Object.keys(env).filter((key) => key.toUpperCase() === 'PATH').length, 1);
});
