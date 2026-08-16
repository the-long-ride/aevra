import assert from 'node:assert/strict'; import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs'; import {tmpdir} from 'node:os'; import path from 'node:path';
import {SkillsService} from '../src/skills/skills-service.js';
test('absolute and traversal paths are rejected',()=>{
  const base=mkdtempSync(path.join(tmpdir(),'aevra-sec-'));
  mkdirSync(path.join(base,'.agents','skills','s'),{recursive:true});
  writeFileSync(path.join(base,'.agents','skills','s','SKILL.md'),'x');
  writeFileSync(path.join(base,'outside.txt'),'secret-outside'); // exists OUTSIDE the skill dir, three levels up from s
  const svc=new SkillsService(base);
  const codes:string[]=[];
  for(const probe of ['../../../outside.txt','..\\..\\..\\outside.txt','/etc/passwd','sub/../../escape']){
    try{svc.read('user','s',null,probe);}catch(e:any){codes.push(e.code);}
  }
  assert.ok(codes.every(c=>c==='SKILL_PATH_ESCAPE'||c==='SKILL_NOT_FOUND'));
  assert.ok(codes.includes('SKILL_PATH_ESCAPE'));
});
test('secret-classified skill files are masked',()=>{
  const base=mkdtempSync(path.join(tmpdir(),'aevra-sec-'));
  mkdirSync(path.join(base,'.agents','skills','s'),{recursive:true});
  writeFileSync(path.join(base,'.agents','skills','s','SKILL.md'),'x');
  writeFileSync(path.join(base,'.agents','skills','s','.env'),'API_KEY=abcdefgh');
  const svc=new SkillsService(base);
  const r=svc.read('user','s',null,'.env');
  assert.equal(r.sensitivity,'SECRET');assert.notEqual(r.content,'API_KEY=abcdefgh');
});
