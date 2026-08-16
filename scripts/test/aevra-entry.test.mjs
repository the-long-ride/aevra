import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
test('aevra entrypoint dispatches gateway lifecycle commands',async()=>{const source=(await readFile('apps/cli/src/cli.ts','utf8')).replace(/\r\n/g,'\n');assert.equal(source.startsWith('#!/usr/bin/env node\n'),true);assert.match(source,/parseAevraArgs/);assert.match(source,/runStart/);assert.match(source,/createUserServiceAdapter/);assert.doesNotMatch(source,/spawn.*provider|browser.*relay/i);});
