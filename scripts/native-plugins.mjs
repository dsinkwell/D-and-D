// After `npx cap sync ios`: also list the app's own native plugins in the generated
// capacitor.config.json, so Capacitor registers them when it starts (as it does for plugins
// installed from npm). MainViewController registers them too; doing both is harmless.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(ROOT, 'ios', 'App', 'App', 'capacitor.config.json');
const cfg = JSON.parse(readFileSync(file, 'utf8'));
const own = ['WriterPlugin'];
cfg.packageClassList = [...new Set([...(cfg.packageClassList || []), ...own])];
writeFileSync(file, JSON.stringify(cfg, null, '\t') + '\n');
console.log('native plugins listed:', cfg.packageClassList.join(', '));
