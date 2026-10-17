import assert from 'node:assert/strict';
import test from 'node:test';
import { StdioTransport } from '../src/stdio-transport.js';

test('stdio upstream inherits only safe base environment and explicit config', async () => {
  process.env.AEVRA_PRIVATE_CONTEXT = 'private daemon words';
  const script = `process.stdin.setEncoding('utf8');let b='';process.stdin.on('data',c=>{b+=c;let n;while((n=b.indexOf('\\n'))>=0){let r=JSON.parse(b.slice(0,n));b=b.slice(n+1);if(r.id)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result:r.method==='initialize'?{serverInfo:{name:'sample',version:'one'}}:{inherited:process.env.AEVRA_PRIVATE_CONTEXT??null,explicit:process.env.PROJECT_MODE}})+'\\n')}});`;
  const transport = new StdioTransport({
    command: process.execPath,
    args: ['-e', script],
    env: { PROJECT_MODE: 'ordinary words' },
    deadlineMs: 3000,
  });
  try {
    await transport.connect();
    assert.deepEqual(await transport.request('inspect'), {
      inherited: null,
      explicit: 'ordinary words',
    });
  } finally {
    await transport.close();
    delete process.env.AEVRA_PRIVATE_CONTEXT;
  }
});
