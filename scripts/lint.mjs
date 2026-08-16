import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
const bad=[];
function walk(dir){ for(const e of readdirSync(dir,{withFileTypes:true})){ const f=path.join(dir,e.name); if(e.isDirectory()) walk(f); else if(/\.(?:ts|tsx|js|mjs)$/.test(f)){ const s=readFileSync(f,'utf8'); if(/\beval\s*\(/.test(s)) bad.push(`${f}: eval is forbidden`); if(/child_process[^\n]*exec\s*\(/.test(s)) bad.push(`${f}: shell exec is forbidden; use spawn argv`); } } }
for(const r of ['apps','packages','scripts']){ try{walk(r)}catch{} }
if(bad.length){ console.error(bad.join('\n')); process.exit(1); }
console.log('lint ok');
