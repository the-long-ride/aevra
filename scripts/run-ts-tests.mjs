import { rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const files=process.argv.slice(2);
const out='.test-dist'; rmSync(out,{recursive:true,force:true});
const compile=spawnSync('tsc',['-p','tsconfig.json','--noCheck','--noEmit','false','--outDir',out],{stdio:'inherit',shell:process.platform==='win32'});
if(compile.status!==0) process.exit(compile.status??1);
const mapped=files.map(f=>path.join(out,f).replace(/\.ts$/,'.js')).filter(existsSync);
const run=spawnSync(process.execPath,['--test',...mapped],{stdio:'inherit'}); process.exit(run.status??1);
