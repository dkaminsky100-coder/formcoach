// After `electron-builder`, keep only the installer in installer/.
// The unpacked app (installer/win-unpacked/FormCoach.exe) and build metadata are removed:
// people get the app by running the installer.
// Older versions' installers are removed too: they stay available on the GitHub Releases page.
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'installer');
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const isInstaller = (name) => name === `FormCoach-Setup-${version}.exe`;

const kept = [];
for (const name of readdirSync(dir)) {
  if (isInstaller(name)) {
    kept.push(name);
    continue;
  }
  rmSync(path.join(dir, name), { recursive: true, force: true });
}

if (kept.length === 0) {
  console.error('✘ No installer found in installer/ - did electron-builder fail?');
  process.exit(1);
}
console.log(`✔ installer/ now contains only: ${kept.join(', ')}`);
