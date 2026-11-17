/**
 * Builds a self-contained Lively Wallpaper package.
 *
 * Lively (WebView2) loads wallpapers from file://, where ES module scripts are blocked by
 * CORS, so this script builds a classic IIFE bundle and inlines JS + CSS into one index.html.
 * Output: dist-lively/ (folder) and JellyOcean-Lively.zip (import via Lively "+ Add Wallpaper").
 */
import { build } from 'vite';
import { readFileSync, writeFileSync, rmSync, readdirSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeZip } from './zip.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist-lively');
rmSync(out, { recursive: true, force: true });

await build({
  root,
  configFile: false,
  base: './',
  logLevel: 'warn',
  build: {
    outDir: out,
    emptyOutDir: true,
    target: 'es2020',
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 2000,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      output: { format: 'iife', inlineDynamicImports: true, entryFileNames: 'app.js', assetFileNames: '[name][extname]' },
    },
  },
});

let html = readFileSync(join(out, 'index.html'), 'utf8');
const js = readFileSync(join(out, 'app.js'), 'utf8').replace(/<\/script/gi, '<\/script');
const cssFile = readdirSync(out).find((f) => f.endsWith('.css'));
const css = cssFile ? readFileSync(join(out, cssFile), 'utf8') : '';
html = html
  .replace(/<script[^>]*src="\.\/app\.js"[^>]*><\/script>/, '')
  .replace(/<link[^>]*rel="stylesheet"[^>]*>/, '')
  // replacer functions: the minified bundle contains "$&"-like sequences
  .replace('</head>', () => `<style>${css}</style>\n</head>`)
  .replace('</body>', () => `<script>${js}</script>\n</body>`);
writeFileSync(join(out, 'index.html'), html);
for (const f of readdirSync(out)) if (f !== 'index.html') rmSync(join(out, f), { recursive: true, force: true });
copyFileSync(join(root, 'lively', 'LivelyProperties.json'), join(out, 'LivelyProperties.json'));
const thumb = join(root, 'lively', 'thumbnail.jpg');
const hasThumb = existsSync(thumb);
if (hasThumb) copyFileSync(thumb, join(out, 'thumbnail.jpg'));
// LivelyInfo: only reference a thumbnail that is actually in the package
const info = JSON.parse(readFileSync(join(root, 'lively', 'LivelyInfo.json'), 'utf8'));
info.Thumbnail = hasThumb ? 'thumbnail.jpg' : null;
writeFileSync(join(out, 'LivelyInfo.json'), JSON.stringify(info, null, 2));

// Lively requires LivelyInfo.json at the ROOT of the zip (no enclosing folder), so the archive is
// written here directly instead of relying on platform zip tools.
const zip = join(root, 'JellyOcean-Lively.zip');
rmSync(zip, { force: true });
writeFileSync(zip, makeZip(readdirSync(out).map((name) => ({ name, data: readFileSync(join(out, name)) }))));
console.log(`Lively package: ${zip}`);
console.log(`Single-file wallpaper written to ${join(out, 'index.html')} (${(html.length / 1024).toFixed(0)} KB)`);
