// Prepare the web files for the native app: dist/ → dist-native/, without what the app doesn't
// bundle (the offline data packs, which download from the published site).
import { cpSync, rmSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(ROOT, 'dist');
const out = join(ROOT, 'dist-native');
const SKIP = ['data'];
rmSync(out, { recursive: true, force: true });
cpSync(src, out, {
  recursive: true,
  filter: (p) => {
    const rel = relative(src, p).split(sep);
    if (SKIP.includes(rel[0])) return false;
    return true;
  },
});
console.log('dist-native/ ready for the native app');
