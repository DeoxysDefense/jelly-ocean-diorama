/**
 * Procedural app icon (no image assets): a rounded tile with sky, sun, a tiny palm island and
 * jelly-blue water. Rendered with 4×4 supersampling and written as PNG / multi-size ICO.
 */
import { deflateSync } from 'node:zlib';
import { crc32 } from './zip.mjs';

const mix = (a, b, t) => a + (b - a) * t;
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Colour (r, g, b, a in 0..255) of the icon at normalised coords (u, v), v down. */
function shade(u, v) {
  // rounded square mask
  const r = 0.2,
    m = 0.03;
  const qx = Math.max(Math.abs(u - 0.5) - (0.5 - m - r), 0),
    qy = Math.max(Math.abs(v - 0.5) - (0.5 - m - r), 0);
  if (Math.hypot(qx, qy) > r) return null;
  const water = 0.56 + 0.018 * Math.sin(u * 18);
  let c;
  if (v < water) {
    // sky
    c = [0, 1, 2].map((i) => mix(hex(0x6fc3ee)[i], hex(0xd6f0fa)[i], v / water));
    // sun with a soft glow
    const ds = Math.hypot(u - 0.73, v - 0.24);
    if (ds < 0.085) c = hex(0xfff1b8);
    else {
      const g = Math.exp(-((ds - 0.085) ** 2) / 0.004) * 0.6;
      c = c.map((x, i) => mix(x, hex(0xfff6d0)[i], g));
    }
    // island: sand mound
    const ix = (u - 0.36) / 0.21,
      iy = (v - water) / 0.075;
    if (ix * ix + iy * iy < 1 && v < water + 0.01) c = hex(0xf0d39a);
    // palm trunk (a gentle curve)
    const t = (0.5 - v) / 0.24;
    if (t > 0 && t < 1) {
      const tx = 0.34 + 0.07 * t * t;
      if (Math.abs(u - tx) < 0.016 * (1 - 0.35 * t)) c = hex(0x7a5532);
    }
    // fronds: five drooping arcs from the crown
    const cx = 0.41,
      cy = 0.255;
    for (let k = 0; k < 5; k++) {
      const a0 = -2.6 + k * 1.05;
      for (let s = 0; s <= 1; s += 0.05) {
        const px = cx + Math.cos(a0) * 0.16 * s,
          py = cy + Math.sin(a0) * 0.07 * s + 0.09 * s * s;
        if (Math.hypot(u - px, v - py) < 0.028 * (1 - s * 0.7)) c = hex(k % 2 ? 0x3f9a46 : 0x2f8a3c);
      }
    }
  } else {
    // jelly water: turquoise to deep blue, a bright rim at the surface, soft caustic bands
    const d = (v - water) / (1 - water);
    c = [0, 1, 2].map((i) => mix(hex(0x29c4cf)[i], hex(0x0b5e86)[i], Math.pow(d, 0.8)));
    const rim = Math.exp(-(((v - water) / 0.02) ** 2));
    c = c.map((x) => mix(x, 255, rim * 0.75));
    const ca = Math.pow(0.5 + 0.5 * Math.sin(u * 30 + Math.sin(v * 25) * 2), 8) * (1 - d) * 0.25;
    c = c.map((x) => mix(x, 255, ca));
    // a little fish
    const fx = (u - 0.62) / 0.07,
      fy = (v - 0.76) / 0.035;
    if (fx * fx + fy * fy < 1) c = hex(0xff9a3c);
    if (u > 0.68 && u < 0.73 && Math.abs(v - 0.76) < (u - 0.68) * 0.8) c = hex(0xff9a3c);
  }
  // glassy top highlight
  const hl = smooth(0.25, 0.0, v) * 0.18;
  c = c.map((x) => mix(x, 255, hl));
  return [...c, 255];
}

export function renderIcon(size) {
  const ss = 4;
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const c = shade((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          a += 255;
        }
      const n = ss * ss;
      const k = (y * size + x) * 4;
      const cov = a / 255;
      px[k] = cov ? Math.round(r / cov) : 0;
      px[k + 1] = cov ? Math.round(g / cov) : 0;
      px[k + 2] = cov ? Math.round(b / cov) : 0;
      px[k + 3] = Math.round(a / n);
    }
  return px;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function png(size) {
  const px = renderIcon(size);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Windows .ico holding PNG images (supported since Vista). */
export function ico(sizes = [256, 64, 48, 32, 16]) {
  const imgs = sizes.map((s) => png(s));
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(sizes.length, 4);
  let off = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + i * 16;
    head[e] = s >= 256 ? 0 : s;
    head[e + 1] = s >= 256 ? 0 : s;
    head.writeUInt16LE(1, e + 4); // planes
    head.writeUInt16LE(32, e + 6); // bpp
    head.writeUInt32LE(imgs[i].length, e + 8);
    head.writeUInt32LE(off, e + 12);
    off += imgs[i].length;
  });
  return Buffer.concat([head, ...imgs]);
}
