import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
const roots = ['apps','packages','scripts','README.md','package.json','.github'];
const bad=[];
function walk(p){
  let entries;
  try { entries=readdirSync(p,{withFileTypes:true}); } catch { return; }
  for(const e of entries){ const f=path.join(p,e.name); if(e.isDirectory()) walk(f); else check(f); }
}
function check(f){ if(!/\.(?:ts|tsx|js|mjs|json|md|yml|yaml)$/.test(f)) return; const s=readFileSync(f,'utf8'); if(/\r\n/.test(s)) bad.push(`${f}: CRLF`); if(s.length && !s.endsWith('\n')) bad.push(`${f}: missing final newline`); }
for(const r of roots){ try { const st=(await import('node:fs')).statSync(r); st.isDirectory()?walk(r):check(r); } catch {} }
if(bad.length){ console.error(bad.join('\n')); process.exit(1); }
console.log('format:check ok');
