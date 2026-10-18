import assert from 'node:assert/strict';
import test from 'node:test';
import { recommendTunnelTool } from '../src/tunnel-tools.js';

function tools(cloudflared: boolean, ngrok: boolean) {
  return { cloudflared: { available: cloudflared }, ngrok: { available: ngrok } };
}

test('cloudflared wins when both tunnel tools are ready', () => {
  assert.equal(recommendTunnelTool(tools(true, true)), 'cloudflared');
});

test('the only ready tunnel tool is recommended', () => {
  assert.equal(recommendTunnelTool(tools(true, false)), 'cloudflared');
  assert.equal(recommendTunnelTool(tools(false, true)), 'ngrok');
});

test('no tunnel tool is recommended when neither is ready', () => {
  assert.equal(recommendTunnelTool(tools(false, false)), null);
});
