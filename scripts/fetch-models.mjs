// Download the open-source models used by the Ask box into public/models/ (git-ignored).
// Each model is pinned to an exact Hugging Face commit and every file is checked against
// a recorded SHA-256, so the app always ships exactly these files.
//
//   node scripts/fetch-models.mjs            # download / verify
//   node scripts/fetch-models.mjs --pin      # (maintainers) record current commit + hashes
//
// The finished app hosts these copies itself; it never contacts Hugging Face.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'models');
const PIN_FILE = join(ROOT, 'scripts', 'models.lock.json');

export const MODELS = {
  // sentence embeddings for meaning search (384 dimensions)
  'Xenova/bge-small-en-v1.5': ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'onnx/model_quantized.onnx'],
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function get(url) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { redirect: 'follow' });
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    if (r.status === 404) throw new Error(`404 ${url}`);
    await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
  }
  throw new Error(`failed ${url}`);
}

async function main() {
  const pin = process.argv.includes('--pin');
  const lock = existsSync(PIN_FILE) ? JSON.parse(readFileSync(PIN_FILE, 'utf8')) : {};
  for (const [id, files] of Object.entries(MODELS)) {
    let rev = lock[id]?.revision;
    if (pin || !rev) {
      const info = JSON.parse((await get(`https://huggingface.co/api/models/${id}`)).toString());
      rev = info.sha;
      lock[id] = { revision: rev, files: {} };
    }
    for (const f of files) {
      const dest = join(OUT, id, f);
      const want = lock[id].files?.[f];
      if (existsSync(dest) && want && sha256(readFileSync(dest)) === want) continue;
      const buf = await get(`https://huggingface.co/${id}/resolve/${rev}/${f}`);
      const got = sha256(buf);
      if (want && got !== want) throw new Error(`checksum mismatch for ${id}/${f}`);
      lock[id].files[f] = got;
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, buf);
      console.log(`  ${id}/${f}  ${(buf.length / 1e6).toFixed(1)} MB`);
    }
  }
  writeFileSync(PIN_FILE, JSON.stringify(lock, null, 2) + '\n');
  console.log('models ready in public/models/');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
