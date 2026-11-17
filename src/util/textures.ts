import * as THREE from 'three';
import { Rng } from './math';

/**
 * Procedural canvas textures. Everything is generated at start-up so the project has
 * no binary asset dependencies; see ASSETS.md for how to swap in authored textures.
 */

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return { c, ctx };
}

function toTexture(c: HTMLCanvasElement, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Converts a grayscale height canvas into a tangent-space normal map. */
export function heightToNormal(src: HTMLCanvasElement, strength = 2): THREE.Texture {
  const w = src.width,
    h = src.height;
  const sctx = src.getContext('2d')!;
  const data = sctx.getImageData(0, 0, w, h).data;
  const { c, ctx } = canvas(w, h);
  const out = ctx.createImageData(w, h);
  const H = (x: number, y: number) => data[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      out.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      out.data[i + 2] = (1 / len) * 255;
      out.data[i + 3] = 255;
    }
  ctx.putImageData(out, 0, 0);
  return toTexture(c, false);
}

/** Weathered vertical wooden planks with grain, knots and gaps. */
export function makeWoodTextures(seed = 7, tint: [number, number, number] = [138, 92, 56]) {
  const rng = new Rng(seed);
  const W = 512,
    Hh = 512;
  const { c, ctx } = canvas(W, Hh);
  const { c: hc, ctx: hctx } = canvas(W, Hh);
  const planks = 6;
  const pw = W / planks;
  for (let i = 0; i < planks; i++) {
    const k = rng.range(0.82, 1.12);
    const r = tint[0] * k,
      g = tint[1] * k,
      b = tint[2] * k * rng.range(0.9, 1.05);
    ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
    ctx.fillRect(i * pw, 0, pw, Hh);
    hctx.fillStyle = '#9a9a9a';
    hctx.fillRect(i * pw, 0, pw, Hh);
    // grain lines
    for (let l = 0; l < 26; l++) {
      const x0 = i * pw + rng.range(3, pw - 3);
      const dark = rng.next() < 0.6;
      ctx.strokeStyle = dark ? `rgba(60,36,18,${rng.range(0.12, 0.35)})` : `rgba(230,190,140,${rng.range(0.06, 0.16)})`;
      hctx.strokeStyle = dark ? 'rgba(40,40,40,0.35)' : 'rgba(200,200,200,0.2)';
      ctx.lineWidth = hctx.lineWidth = rng.range(0.6, 2.0);
      ctx.beginPath();
      hctx.beginPath();
      const amp = rng.range(0.5, 3),
        fr = rng.range(0.01, 0.04),
        ph = rng.range(0, 6);
      for (let y = 0; y <= Hh; y += 8) {
        const x = x0 + Math.sin(y * fr + ph) * amp;
        if (y === 0) {
          ctx.moveTo(x, y);
          hctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
          hctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      hctx.stroke();
    }
    // knots
    const knots = rng.int(0, 2);
    for (let n = 0; n < knots; n++) {
      const kx = i * pw + rng.range(12, pw - 12),
        ky = rng.range(20, Hh - 20);
      const rr = rng.range(4, 9);
      const grd = ctx.createRadialGradient(kx, ky, 0, kx, ky, rr * 2);
      grd.addColorStop(0, 'rgba(50,28,12,0.85)');
      grd.addColorStop(0.5, 'rgba(80,48,24,0.4)');
      grd.addColorStop(1, 'rgba(80,48,24,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.ellipse(kx, ky, rr * 1.4, rr * 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // plank gap
    ctx.fillStyle = 'rgba(30,18,10,0.85)';
    ctx.fillRect(i * pw, 0, 2.5, Hh);
    hctx.fillStyle = '#101010';
    hctx.fillRect(i * pw, 0, 3, Hh);
    // weathering at ends
    const grd = ctx.createLinearGradient(0, 0, 0, Hh);
    grd.addColorStop(0, 'rgba(255,255,255,0.05)');
    grd.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = grd;
    ctx.fillRect(i * pw, 0, pw, Hh);
  }
  // fine noise
  const img = ctx.getImageData(0, 0, W, Hh);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rng.next() - 0.5) * 14;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  return { map: toTexture(c), normalMap: heightToNormal(hc, 3) };
}

/** Layered straw thatch for the hut roof. */
export function makeThatchTextures(seed = 11) {
  const rng = new Rng(seed);
  const W = 512,
    Hh = 512;
  const { c, ctx } = canvas(W, Hh);
  const { c: hc, ctx: hctx } = canvas(W, Hh);
  ctx.fillStyle = '#8a6a3c';
  ctx.fillRect(0, 0, W, Hh);
  hctx.fillStyle = '#404040';
  hctx.fillRect(0, 0, W, Hh);
  const rows = 6;
  const rh = Hh / rows;
  for (let r = 0; r < rows; r++) {
    const y0 = r * rh;
    for (let s = 0; s < 900; s++) {
      const x = rng.range(-10, W + 10);
      const len = rng.range(rh * 0.7, rh * 1.35);
      const y = y0 + rng.range(-rh * 0.25, rh * 0.15);
      const ang = rng.range(-0.08, 0.08);
      const tone = rng.range(0, 1);
      const col =
        tone < 0.3
          ? [214, 178, 112]
          : tone < 0.6
            ? [190, 150, 88]
            : tone < 0.85
              ? [160, 120, 66]
              : [232, 204, 140];
      ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${rng.range(0.55, 0.95)})`;
      ctx.lineWidth = rng.range(1, 2.6);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.sin(ang) * len, y + len);
      ctx.stroke();
      const hv = (110 + tone * 120) | 0;
      hctx.strokeStyle = `rgba(${hv},${hv},${hv},0.8)`;
      hctx.lineWidth = ctx.lineWidth;
      hctx.beginPath();
      hctx.moveTo(x, y);
      hctx.lineTo(x + Math.sin(ang) * len, y + len);
      hctx.stroke();
    }
    // shadow line under each tier
    const g = ctx.createLinearGradient(0, y0 + rh * 0.75, 0, y0 + rh * 1.05);
    g.addColorStop(0, 'rgba(40,25,10,0)');
    g.addColorStop(1, 'rgba(40,25,10,0.45)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y0 + rh * 0.75, W, rh * 0.3);
    hctx.fillStyle = 'rgba(0,0,0,0.5)';
    hctx.fillRect(0, y0 + rh * 0.95, W, rh * 0.08);
  }
  return { map: toTexture(c), normalMap: heightToNormal(hc, 2.5) };
}

/** Palm trunk bark: stacked rings with fibrous texture. */
export function makeBarkTextures(seed = 21) {
  const rng = new Rng(seed);
  const W = 256,
    Hh = 512;
  const { c, ctx } = canvas(W, Hh);
  const { c: hc, ctx: hctx } = canvas(W, Hh);
  ctx.fillStyle = '#8a7258';
  ctx.fillRect(0, 0, W, Hh);
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, W, Hh);
  const rings = 16;
  const rh = Hh / rings;
  for (let r = 0; r < rings; r++) {
    const y = r * rh;
    const g = ctx.createLinearGradient(0, y, 0, y + rh);
    const k = rng.range(0.85, 1.1);
    g.addColorStop(0, `rgb(${(150 * k) | 0},${(128 * k) | 0},${(100 * k) | 0})`);
    g.addColorStop(0.65, `rgb(${(122 * k) | 0},${(100 * k) | 0},${(76 * k) | 0})`);
    g.addColorStop(1, `rgb(${(70 * k) | 0},${(54 * k) | 0},${(40 * k) | 0})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, y, W, rh);
    const hg = hctx.createLinearGradient(0, y, 0, y + rh);
    hg.addColorStop(0, '#d0d0d0');
    hg.addColorStop(0.7, '#909090');
    hg.addColorStop(1, '#202020');
    hctx.fillStyle = hg;
    hctx.fillRect(0, y, W, rh);
  }
  for (let i = 0; i < 1400; i++) {
    const x = rng.range(0, W),
      y = rng.range(0, Hh);
    ctx.strokeStyle = `rgba(${rng.next() < 0.5 ? '60,45,30' : '190,170,140'},${rng.range(0.08, 0.25)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + rng.range(-1, 1), y + rng.range(4, 12));
    ctx.stroke();
  }
  return { map: toTexture(c), normalMap: heightToNormal(hc, 3) };
}

/** Soft round sprite used by particles. */
export function makeSoftDot(size = 64) {
  const { c, ctx } = canvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return toTexture(c, true, false);
}

/** Bubble sprite: thin bright rim with a small highlight. */
export function makeBubbleSprite(size = 64) {
  const { c, ctx } = canvas(size, size);
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, r * 0.55, r, r, r * 0.95);
  g.addColorStop(0, 'rgba(255,255,255,0.05)');
  g.addColorStop(0.8, 'rgba(230,250,255,0.75)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.ellipse(r * 0.68, r * 0.62, r * 0.16, r * 0.1, -0.6, 0, Math.PI * 2);
  ctx.fill();
  return toTexture(c, true, false);
}

export { canvas as makeCanvas, toTexture };
