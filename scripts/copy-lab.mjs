// Files for the hidden written-answers test page (#/lab): transformers.js v4 (self-contained
// browser build with WebGPU) and the matching ONNX Runtime WebAssembly files → public/lab/
// (git-ignored). Hosting our own copies means the page needs only Hugging Face for the model.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(join(ROOT, 'package.json'));
const tjs = dirname(dirname(req.resolve('tjs4'))); // node_modules/tjs4
const ort = dirname(createRequire(join(tjs, 'package.json')).resolve('onnxruntime-web/wasm'));
const out = join(ROOT, 'public', 'lab');
mkdirSync(out, { recursive: true });
copyFileSync(join(tjs, 'dist', 'transformers.min.js'), join(out, 'transformers.min.js'));
for (const f of ['ort-wasm-simd-threaded.asyncify.wasm', 'ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs'])
  copyFileSync(join(ort, f), join(out, f));
console.log('Lab files copied to public/lab/');
