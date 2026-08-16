import {cpSync,mkdirSync,rmSync,existsSync} from 'node:fs';
mkdirSync('dist/apps',{recursive:true});
rmSync('dist/apps/web',{recursive:true,force:true});
if(existsSync('apps/web'))cpSync('apps/web','dist/apps/web',{recursive:true,filter:s=>!s.includes('/test')&&!s.endsWith('.test.ts')&&!s.endsWith('.test.tsx')});
if(existsSync('docs/user-manual'))cpSync('docs/user-manual','dist/apps/web/manual',{recursive:true});
