import { cpSync, existsSync, mkdirSync } from 'node:fs';

const source = 'docs/user-manual';
const destination = 'dist/apps/web/manual';

if (existsSync(source)) {
  mkdirSync('dist/apps/web', { recursive: true });
  cpSync(source, destination, { recursive: true });
}
