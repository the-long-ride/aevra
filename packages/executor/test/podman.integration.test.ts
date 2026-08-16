import test from 'node:test';import assert from 'node:assert/strict';import {PodmanBackend} from '../src/podman.js';
test('Podman backend availability is explicit',async(t)=>{const d=new PodmanBackend();const available=await d.available();if(!available){t.skip('podman unavailable');return;}assert.equal(available,true);});
