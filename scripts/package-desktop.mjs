/**
 * Desktop package: the same self-contained single-file build as the Lively wallpaper, plus an
 * app icon and a one-click shortcut creator that opens it in its own window.
 * Run after package-lively.mjs (npm run package:desktop does both).
 * Output: dist-desktop/ and JellyOcean-Desktop.zip
 */
import { readFileSync, writeFileSync, rmSync, mkdirSync, copyFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeZip } from './zip.mjs';
import { ico, png } from './icon.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'dist-lively', 'index.html');
if (!existsSync(src)) throw new Error('Run package-lively.mjs first (npm run package:desktop does both).');
const out = join(root, 'dist-desktop');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

copyFileSync(src, join(out, 'index.html'));
writeFileSync(join(out, 'JellyOcean.ico'), ico());
for (const f of ['create-shortcut.ps1', 'Create Desktop Shortcut.cmd', 'README.txt']) copyFileSync(join(root, 'desktop', f), join(out, f));
// the repo also keeps a PNG of the icon for the README / GitHub
writeFileSync(join(root, 'desktop', 'icon.png'), png(256));

const zip = join(root, 'JellyOcean-Desktop.zip');
rmSync(zip, { force: true });
writeFileSync(zip, makeZip(readdirSync(out).map((name) => ({ name, data: readFileSync(join(out, name)) }))));
console.log(`Desktop package: ${zip}`);
console.log(`Folder: ${out}`);
