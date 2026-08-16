import test from 'node:test';import assert from 'node:assert/strict';import {DockerBackend} from '../src/docker.js';
test('Docker backend availability is explicit',async(t)=>{const d=new DockerBackend();const available=await d.available();if(!available){t.skip('docker unavailable');return;}assert.equal(available,true);});
