import assert from 'node:assert/strict';
import test from 'node:test';
import {AevraDatabase} from '../../../packages/store/src/database.js';
import {SessionRepository} from '../../../packages/store/src/sessions.js';
import {CapabilityProfileService} from '../src/policy/capabilities.js';
import {SessionManager} from '../src/sessions/session-manager.js';

test('OAuth auto-admission remembers workspace and profile across MCP reconnect',async()=>{
  const db=AevraDatabase.open(':memory:');const profiles=new CapabilityProfileService(db.raw());const sessions=new SessionManager(new SessionRepository(db.raw()),profiles);profiles.mapActor('oauth:ChatGPT','ws-a','read-only','auto');const identity={actor:'oauth:ChatGPT',subject:'grant-a',issuer:'i',audience:'a',expiresAt:'x'};const first=sessions.create(identity);const admitted=await sessions.switchWorkspace(first.id,'ws-a');assert.equal(admitted.status,'admitted');sessions.disconnect(first.id);const second=sessions.create(identity);assert.equal(sessions.activeLease(second.id)?.workspaceId,'ws-a');assert.deepEqual(sessions.activeLease(second.id)?.capabilities.sort(),['files.read','files.search','git.read'].sort());db.close();
});

test('connection coding profile wins over a lower persistent mapping on reconnect',async()=>{
  const db=AevraDatabase.open(':memory:');const profiles=new CapabilityProfileService(db.raw());const sessions=new SessionManager(new SessionRepository(db.raw()),profiles);profiles.mapActor('oauth:ChatGPT','ws-a','read-only','auto');const identity={actor:'oauth:ChatGPT',subject:'grant-b',issuer:'i',audience:'a',expiresAt:'x'};const first=sessions.create(identity);await sessions.switchWorkspace(first.id,'ws-a');sessions.grantConnectionWorkspace(first.id,'ws-a','coding-session');sessions.disconnect(first.id);const second=sessions.create(identity);const lease=sessions.activeLease(second.id)!;assert.ok(lease.capabilities.includes('files.write'));assert.ok(lease.capabilities.includes('commands.run'));db.close();
});
