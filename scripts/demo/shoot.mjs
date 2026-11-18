/**
 * Dev helper: load the built app (dist-desktop/index.html) in headless Edge, run a script against
 * window.__jelly, and save screenshots it asks for.
 *   node scripts/demo/shoot.mjs <script.js> <out-dir>
 * The script is evaluated as an async function body with `app` and `shot(name)` available;
 * whatever it returns is printed as JSON.
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { launchEdge } from './cdp.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [scriptFile, outDir = join(tmpdir(), 'jelly-shots')] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const html = readFileSync(join(root, 'dist-desktop', 'index.html'));
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}).listen(5396, '127.0.0.1');
const edge = await launchEdge({ profileDir: join(tmpdir(), 'jelly-shoot-profile'), port: 9336, width: 1600, height: 900 });
try {
  await edge.send('Page.navigate', { url: 'http://127.0.0.1:5396/?panel=0&mode=play&time=14' });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await edge.evaluate('!!window.__jelly').catch(() => false)) break;
  }
  const body = readFileSync(resolve(scriptFile), 'utf8');
  await edge.evaluate(`window.__shots = []; window.__shot = (n) => window.__shots.push(n); 0`);
  // run step by step: the script calls shot(name); after each call we capture
  const result = await edge.evaluate(`(async () => { const app = window.__jelly; const shots = []; const shot = async (n) => { shots.push(n); await new Promise((r) => (window.__resume = r)); }; const run = (async () => { ${body} })(); window.__run = run; window.__pending = shots; return 'started'; })()`);
  void result;
  let taken = 0;
  for (let guard = 0; guard < 400; guard++) {
    const st = await edge.evaluate(`({ n: window.__pending.length, done: !!window.__done })`);
    if (st.n > taken) {
      const name = await edge.evaluate(`window.__pending[${taken}]`);
      const s = await edge.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
      writeFileSync(join(outDir, `${name}.jpg`), Buffer.from(s.data, 'base64'));
      taken++;
      await edge.evaluate(`window.__resume && window.__resume(); 0`);
      continue;
    }
    const fin = await edge
      .evaluate(`Promise.race([window.__run.then((v) => ({ done: true, v }), (e) => ({ done: true, err: String(e) })), new Promise((r) => setTimeout(() => r(null), 150))])`)
      .catch(() => null);
    if (fin && fin.done) {
      console.log(JSON.stringify(fin));
      break;
    }
  }
} finally {
  edge.close();
  server.close();
}
