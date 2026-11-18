/**
 * Renders the demo soundtrack from a recorded audio log (audio.json) in headless Edge and prints
 * loudness per chapter, peak level and per-event transients — a quick objective check of the mix.
 *   node scripts/demo/check-soundtrack.mjs <audio.json> [out.wav]
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { launchEdge } from './cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const [logFile, wavOut] = process.argv.slice(2);
const log = readFileSync(resolve(logFile), 'utf8');
const synth = readFileSync(join(here, 'soundtrack.js'), 'utf8');
const enc = readFileSync(join(here, 'encode-page.js'), 'utf8'); // for toWav
let wav = null;
const server = createServer((req, res) => {
  if (req.method === 'POST') {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      wav = Buffer.concat(parts);
      res.end('ok');
    });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><script>${synth}\n${enc}</script>`);
}).listen(5395, '127.0.0.1');
const edge = await launchEdge({ profileDir: join(tmpdir(), 'jelly-audio-check'), port: 9337, width: 800, height: 600 });
try {
  await edge.send('Page.navigate', { url: 'http://127.0.0.1:5395/' });
  await new Promise((r) => setTimeout(r, 800));
  const r = await edge.evaluate(`(async () => {
    const audio = ${log};
    const t0 = performance.now();
    const buf = await renderSoundtrack(audio, 48000);
    const ms = performance.now() - t0;
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    const sr = buf.sampleRate;
    let peak = 0, nan = 0;
    for (let i = 0; i < L.length; i++) { const v = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (v > peak) peak = v; if (Number.isNaN(L[i])) nan++; }
    const rms = (a, b) => { let s = 0, n = 0; for (let i = Math.floor(a * sr); i < Math.min(L.length, b * sr); i++) { s += L[i] * L[i] + R[i] * R[i]; n += 2; } return n ? 20 * Math.log10(Math.sqrt(s / n) + 1e-9) : -99; };
    const T = audio.chapters, names = ['title', 'water', 'feed', 'current', 'island', 'mail', 'palm', 'skip', 'storm', 'night', 'outro'];
    const bounds = [0, ...T, audio.end];
    const sections = names.map((n, i) => n + ' ' + rms(bounds[i], bounds[i + 1]).toFixed(1) + ' dB');
    // transient check: level just after each effect vs just before
    const kinds = {};
    for (const e of audio.events) {
      const before = rms(e.t - 0.15, e.t), after = rms(e.t, e.t + 0.15);
      (kinds[e.type] ??= []).push(+(after - before).toFixed(1));
    }
    const lift = Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, { n: v.length, avgRiseDb: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) }]));
    ${wavOut ? "await fetch('/', { method: 'POST', body: toWav(buf) });" : ''}
    return { seconds: +(L.length / sr).toFixed(2), renderMs: Math.round(ms), peak: +peak.toFixed(3), nan, sections, events: lift };
  })()`);
  console.log(JSON.stringify(r, null, 1));
  if (wavOut && wav) writeFileSync(resolve(wavOut), wav);
} finally {
  edge.close();
  server.close();
}
