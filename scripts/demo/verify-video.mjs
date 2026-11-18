/**
 * Plays a rendered demo MP4 back in Microsoft Edge (headless) and reports its duration and size,
 * then grabs frames at the given seconds so the actual video file can be reviewed.
 *   node scripts/demo/verify-video.mjs demo/JellyOcean-Demo-1080p.mp4 out-dir 2,10,30
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { launchEdge } from './cdp.mjs';

const [file, outDir = join(tmpdir(), 'jelly-demo-verify'), times = '2,10'] = process.argv.slice(2);
const video = readFileSync(resolve(file));
mkdirSync(outDir, { recursive: true });
const server = createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<!doctype html><video id="v" muted playsinline preload="auto" src="/v.mp4"></video>');
  }
  if (req.url === '/v.mp4') {
    const range = req.headers.range;
    if (range) {
      const [a, b] = range.replace('bytes=', '').split('-');
      const start = Number(a),
        end = b ? Number(b) : video.length - 1;
      res.writeHead(206, { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${video.length}`, 'content-length': end - start + 1 });
      return res.end(video.subarray(start, end + 1));
    }
    res.writeHead(200, { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-length': video.length });
    return res.end(video);
  }
  const m = req.url.match(/^\/save\/(.+)$/);
  if (m && req.method === 'POST') {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      writeFileSync(join(outDir, m[1]), Buffer.concat(parts));
      res.end('ok');
    });
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => server.listen(5398, '127.0.0.1', r));
const edge = await launchEdge({ profileDir: join(tmpdir(), 'jelly-demo-verify-profile'), port: 9334, width: 1280, height: 720 });
try {
  await edge.send('Page.navigate', { url: 'http://127.0.0.1:5398/' });
  await new Promise((r) => setTimeout(r, 1500));
  const info = await edge.evaluate(`(async () => {
    const v = document.getElementById('v');
    if (v.readyState < 1) await new Promise((r, j) => { v.onloadedmetadata = r; v.onerror = () => j(new Error('video error ' + (v.error && v.error.code))); });
    const out = { duration: +v.duration.toFixed(2), width: v.videoWidth, height: v.videoHeight, frames: [] };
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    const ctx = c.getContext('2d');
    for (const t of [${times}]) {
      v.currentTime = t;
      await new Promise((r) => (v.onseeked = r));
      ctx.drawImage(v, 0, 0);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
      await fetch('/save/f' + String(t).replace('.', '_') + '.jpg', { method: 'POST', body: blob });
      out.frames.push(t);
    }
    return out;
  })()`);
  console.log(JSON.stringify(info));
} finally {
  edge.close();
  server.close();
}
