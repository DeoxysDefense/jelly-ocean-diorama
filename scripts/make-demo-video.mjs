/**
 * Renders the gameplay demo video (about 58 s, 1080p30 + a small 720p web version).
 *
 *   npm run package:desktop      # builds dist-desktop/index.html (single-file app)
 *   node scripts/make-demo-video.mjs
 *
 * How: a local server serves the app with scripts/demo/director.js injected. Microsoft Edge runs
 * headless (throwaway profile); Node steps the simulation exactly one 1/30 s frame at a time and
 * captures each frame including the HTML interface, so playback is perfectly smooth no matter how
 * long a frame takes to render. Then Edge encodes the frames to H.264 (WebCodecs) and
 * scripts/demo/encode-page.js writes a standard MP4. Output: demo/ (git-ignored).
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { launchEdge } from './demo/cdp.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appHtml = join(root, 'dist-desktop', 'index.html');
if (!existsSync(appHtml)) throw new Error('Build first: npm run package:desktop');
const outDir = join(root, 'demo');
const work = process.env.DEMO_WORK || join(tmpdir(), 'jelly-ocean-demo');
const frameDir = join(work, 'frames');
const onlyEncode = process.argv.includes('--encode-only');
// --stills=2,6.5,12 : run the whole storyboard but only save these moments (quick review)
const stillsArg = process.argv.find((a) => a.startsWith('--stills='));
const stillsSec = stillsArg ? stillsArg.slice(9).split(',').map(Number) : null;
let stills = null; // frame indices, resolved once the director's frame rate is known
if (!onlyEncode) rmSync(frameDir, { recursive: true, force: true });
mkdirSync(frameDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

const director = readFileSync(join(root, 'scripts', 'demo', 'director.js'), 'utf8');
const encoder = readFileSync(join(root, 'scripts', 'demo', 'encode-page.js'), 'utf8') + '\n' + readFileSync(join(root, 'scripts', 'demo', 'soundtrack.js'), 'utf8');
const page = readFileSync(appHtml, 'utf8').replace('</body>', () => `<script>${director}</script>\n</body>`);
const PORT = 5397;

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page);
  }
  if (url.pathname === '/encode') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><meta charset="utf-8"><title>encode</title><script>${encoder}</script>`);
  }
  const fm = url.pathname.match(/^\/frame\/(\d+)$/);
  if (fm) {
    try {
      const data = readFileSync(join(frameDir, `${fm[1].padStart(5, '0')}.jpg`));
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      return res.end(data);
    } catch {
      res.writeHead(404);
      return res.end();
    }
  }
  const om = url.pathname.match(/^\/out\/([\w.-]+)$/);
  if (om && req.method === 'POST') {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      writeFileSync(join(outDir, om[1]), Buffer.concat(parts));
      res.writeHead(200);
      res.end('ok');
    });
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const edge = await launchEdge({ profileDir: join(work, 'edge-profile'), width: 1920, height: 1080 });
let frames = 0;
let fps = 30;
try {
  if (!onlyEncode) {
    await edge.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?panel=0&mode=play&time=15` });
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 200));
      if (await edge.evaluate('!!(window.__jelly && window.__demo)').catch(() => false)) break;
    }
    await edge.evaluate('__demo.setup()');
    frames = await edge.evaluate('__demo.frames');
    fps = await edge.evaluate('__demo.fps');
    if (stillsSec) stills = stillsSec.map((v) => Math.round(v * fps));
    const t0 = Date.now();
    for (let i = 0; i < frames; i++) {
      await edge.evaluate(`__demo.frame(${i}, ${!stills || stills.includes(i)})`);
      if (process.argv.includes('--profile')) {
        if (i % 60 === 59) console.log(`t=${((i + 1) / fps).toFixed(0)}s`, JSON.stringify(await edge.evaluate('__demo.profile()')));
        if (i === frames - 1) process.exit(0);
        continue;
      }
      if (stills) {
        if (stills.includes(i)) {
          const st = await edge.send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
          mkdirSync(join(work, 'stills'), { recursive: true });
          writeFileSync(join(work, 'stills', `t${(i / fps).toFixed(1)}.jpg`), Buffer.from(st.data, 'base64'));
        }
        if (i > Math.max(...stills) && !process.argv.includes('--full-log')) break;
        continue;
      }
      const shot = await edge.send('Page.captureScreenshot', { format: 'jpeg', quality: 94, captureBeyondViewport: false });
      writeFileSync(join(frameDir, `${String(i).padStart(5, '0')}.jpg`), Buffer.from(shot.data, 'base64'));
      if (i % 300 === 0) console.log(`frame ${i}/${frames}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    // everything audible that happened on screen, for the soundtrack
    writeFileSync(join(work, 'audio.json'), JSON.stringify(await edge.evaluate('__demo.audio()')));
    if (stills) {
      writeFileSync(join(work, 'audio.json'), JSON.stringify(await edge.evaluate('__demo.audio()')));
      console.log('stills saved to', join(work, 'stills'));
      process.exit(0);
    }
    writeFileSync(join(work, 'frames.json'), JSON.stringify({ frames, fps }));
  } else ({ frames, fps } = JSON.parse(readFileSync(join(work, 'frames.json'), 'utf8')));
  const audio = readFileSync(join(work, 'audio.json'), 'utf8');

  await edge.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/encode` });
  await new Promise((r) => setTimeout(r, 1000));
  // full quality: 1080p at the capture frame rate (60), AAC 192 kbps + the soundtrack as WAV
  const hd = await edge.evaluate(
    `encodeVideo({ frames: ${frames}, fps: ${fps}, width: 1920, height: 1080, bitrate: 12000000, bitrateMode: 'variable', codec: 'avc1.64002a', name: 'JellyOcean-Demo-1080p60.mp4', audio: ${audio}, audioBitrate: 192000, wavName: 'JellyOcean-Demo-soundtrack.wav' })`,
  );
  console.log('encoded', JSON.stringify(hd));
  // web: 720p30, under 10 MB (GitHub's in-browser video upload limit)
  const web = await edge.evaluate(
    `encodeVideo({ frames: ${frames}, fps: ${fps}, frameStep: ${fps >= 60 ? 2 : 1}, width: 1280, height: 720, bitrate: 1100000, bitrateMode: 'constant', codec: 'avc1.64001f', name: 'JellyOcean-Demo-720p.mp4', audio: ${audio}, audioBitrate: 128000 })`,
  );
  console.log('encoded', JSON.stringify(web));
} finally {
  edge.close();
  server.close();
}
console.log(`Done: ${outDir}`);
