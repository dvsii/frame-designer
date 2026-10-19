// Assemble the web app into www/ for Capacitor (`npm run build`), so the repo root can stay the GitHub Pages site.
// sw.js is left out: the native app loads its files from the app bundle, so it has nothing to cache.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, 'www');
const files = ['index.html', 'manifest.webmanifest', 'js', 'icons', 'fonts'];

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const f of files) cpSync(join(root, f), join(out, f), { recursive: true });
console.log(`copied ${files.join(', ')} to www/`);
