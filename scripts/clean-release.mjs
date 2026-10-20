// After `electron-builder`, keep only the installer in installer/.
// The unpacked app (installer/win-unpacked/FormCoach.exe) and build metadata are removed:
// people get the app by running the installer.
import { readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'installer');
const isInstaller = (name) => /^FormCoach-Setup-.*\.exe$/.test(name);

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
