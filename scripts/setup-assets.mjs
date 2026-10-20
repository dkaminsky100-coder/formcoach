// One-time setup: makes the app fully offline by putting the MediaPipe WASM
// runtime and pose models under public/, so nothing is fetched from a CDN at runtime.
import { cp, mkdir, stat, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmDst = path.join(root, 'public', 'wasm');
const modelDir = path.join(root, 'public', 'models');

const MODELS = ['lite', 'full'].map((v) => ({
  file: `pose_landmarker_${v}.task`,
  url: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${v}/float16/latest/pose_landmarker_${v}.task`,
}));

const exists = async (p) => stat(p).then((s) => s.isDirectory() || s.size > 0, () => false);

async function copyWasm() {
  if (!(await exists(wasmSrc))) {
    throw new Error('MediaPipe wasm not found - run `npm install` first.');
  }
  await mkdir(wasmDst, { recursive: true });
  await cp(wasmSrc, wasmDst, { recursive: true });
  console.log(`✔ wasm runtime copied (${(await readdir(wasmDst)).length} files)`);
}

async function downloadModels() {
  await mkdir(modelDir, { recursive: true });
  for (const { file, url } of MODELS) {
    const dst = path.join(modelDir, file);
    if (await exists(dst)) {
      console.log(`✔ ${file} already present`);
      continue;
    }
    process.stdout.write(`↓ downloading ${file} … `);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(dst, buf);
    console.log(`${(buf.length / 1e6).toFixed(1)} MB`);
  }
}

try {
  await copyWasm();
  await downloadModels();
  console.log('\nSetup complete - the app now runs fully offline. Start it with `npm run dev`.');
} catch (err) {
  console.error(`\n✘ Setup failed: ${err.message}`);
  process.exit(1);
}
