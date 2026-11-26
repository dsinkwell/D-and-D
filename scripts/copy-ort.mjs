// Copy the ONNX Runtime WebAssembly files the Ask box needs into public/ort/ (git-ignored).
// They come from the onnxruntime-web version transformers.js resolves, so they always match.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(createRequire(join(ROOT, 'package.json')).resolve('@huggingface/transformers'));
const dist = dirname(req.resolve('onnxruntime-web/wasm')); // …/onnxruntime-web/dist
const out = join(ROOT, 'public', 'ort');
mkdirSync(out, { recursive: true });
for (const f of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']) copyFileSync(join(dist, f), join(out, f));
console.log('ONNX Runtime files copied to public/ort/');
