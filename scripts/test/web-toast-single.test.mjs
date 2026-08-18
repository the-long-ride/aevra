import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

test('admin enhancements do not ship a second toast implementation',()=>{const source=readFileSync('apps/web/admin-enhancements.js','utf8');const css=readFileSync('apps/web/admin-enhancements.css','utf8');assert.doesNotMatch(source,/function toast\(/);assert.doesNotMatch(source,/enh-toast-host|enh-toast/);assert.doesNotMatch(css,/enh-toast-host|enh-toast/);});

test('global toast stack is bottom-right and permission deletion is contextual',()=>{const runtime=readFileSync('apps/web/ui-runtime.js','utf8');const css=readFileSync('apps/web/app.css','utf8');assert.match(runtime,/Permission removed from/);assert.match(runtime,/removed.*actor/s);assert.match(css,/\.toast-stack\{[^}]*bottom:/);assert.match(css,/\.toast-stack\{[^}]*right:/);assert.doesNotMatch(css,/\.toast-stack\{[^}]*top:/);});
