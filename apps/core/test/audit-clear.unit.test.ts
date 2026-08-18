import assert from 'node:assert/strict';
import test from 'node:test';
import {AevraDatabase} from '../../../packages/store/src/database.js';
import {AuditRepository} from '../../../packages/store/src/audit.js';
import {AuditService} from '../src/audit/audit-service.js';

test('audit clear removes events but preserves a valid chain checkpoint',()=>{
  const db=AevraDatabase.open(':memory:');
  const audit=new AuditService(new AuditRepository(db.raw()));
  audit.append({actor:'admin',operation:'one',result:'ok',redactionCount:0});
  audit.append({actor:'admin',operation:'two',result:'ok',redactionCount:0});
  assert.equal(audit.clear(),2);
  assert.deepEqual(JSON.parse(audit.exportJson()),[]);
  assert.deepEqual(audit.verify(),{valid:true});
  audit.append({actor:'admin',operation:'after-clear',result:'ok',redactionCount:0});
  assert.deepEqual(audit.verify(),{valid:true});
  db.close();
});
