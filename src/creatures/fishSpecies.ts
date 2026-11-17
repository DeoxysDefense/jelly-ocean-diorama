import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { heightToNormal } from '../util/textures';

/**
 * Procedural fish builder. A fish is authored in a unit space: nose at x = +0.5, tail base at
 * x = -0.5, up = +y, sides = ±z. Body is lofted from elliptical cross-sections; fins are thin
 * shaped surfaces. Texture is a painted *side view* (planar UVs) so both flanks share it.
 *
 * Texture atlas: u in [0, 0.72] = body side view, u in [0.74, 1] = fin colour strip,
 * small patch at u≈0.73 = glossy eye.
 */

export type TailShape = 'fork' | 'round' | 'truncate' | 'lunate';

export interface FishSpec {
  id: string;
  label: string;
  /** World length of the fish (nose to tail tip). */
  size: number;
  /** Body half-height at the deepest point (unit space). */
  height: number;
  /** Body half-width (thickness). */
  width: number;
  peakT: number;
  /** Fraction of height kept at the caudal peduncle. */
  peduncle: number;
  /** Belly sag (vertical offset of the cross-section centre). */
  sag: number;
  tail: { shape: TailShape; len: number; span: number };
  dorsal?: { t0: number; t1: number; h: number; trail?: number; peak?: number };
  anal?: { t0: number; t1: number; h: number; trail?: number };
  pectoral: { t: number; len: number };
  roughness: number;
  metalness: number;
  /** Iris colour for the 3D eye. */
  iris?: string;
  /** Thin-film shimmer (silvery fish). */
  iridescence?: number;
  /** Body loft resolution [lengthwise, around]; lower for tiny schooling fish. */
  segments?: [number, number];
  paint: (ctx: CanvasRenderingContext2D, W: number, H: number, sideY: (v: number) => number) => void;
  finColor: string;
  finEdge?: string;
}

const BODY_U = 0.72;
const FIN_U0 = 0.75;

function profile(spec: FishSpec, t: number) {
  const { peakT, height: H, peduncle } = spec;
  if (t <= peakT) {
    const k = (peakT - t) / peakT;
    return H * Math.pow(Math.max(0, 1 - k * k), 0.55) * (0.12 + 0.88 * (1 - Math.pow(k, 3) * 0.2)) + (t < 0.02 ? 0 : 0);
  }
  const k = (t - peakT) / (1 - peakT);
  return H * (1 - Math.pow(k, 1.5) * (1 - peduncle));
}

export function buildFish(spec: FishSpec): { geometry: THREE.BufferGeometry; texture: THREE.Texture; normalMap: THREE.Texture; eyeGeometry: THREE.BufferGeometry; eyeTexture: THREE.Texture } {
  const [N, M] = spec.segments ?? [28, 18];
  const pos: number[] = [],
    uv: number[] = [],
    idx: number[] = [];
  let hMax = 0;
  for (let i = 0; i <= N; i++) hMax = Math.max(hMax, profile(spec, i / N) + Math.abs(spec.sag));
  const vOf = (y: number) => 0.5 + (y / hMax) * 0.48;
  const widthAt = (t: number) => {
    const h = profile(spec, t) / spec.height;
    return spec.width * Math.pow(Math.max(0, h), 0.8) * (t < 0.2 ? 0.75 + t * 1.25 : 1);
  };
  // body loft
  for (let i = 0; i <= N; i++) {
    const t = Math.pow(i / N, 0.92);
    const x = 0.5 - t;
    const h = Math.max(0.004, profile(spec, t));
    const w = Math.max(0.003, widthAt(t));
    const cy = -spec.sag * Math.sin(Math.PI * t) * 0.6;
    for (let j = 0; j <= M; j++) {
      const a = (j / M) * Math.PI * 2;
      const y = cy + Math.sin(a) * h;
      const z = Math.cos(a) * w;
      pos.push(x, y, z);
      uv.push(t * BODY_U, vOf(y));
    }
  }
  for (let i = 0; i < N; i++)
    for (let j = 0; j < M; j++) {
      const a = i * (M + 1) + j,
        b = a + M + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  body.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  body.setIndex(idx);
  body.computeVertexNormals();

  const parts: THREE.BufferGeometry[] = [body.toNonIndexed()];
  const pedH = profile(spec, 1);
  // tail fin
  parts.push(tailGeometry(spec, pedH));
  // dorsal + anal
  if (spec.dorsal) parts.push(finStrip(spec, spec.dorsal, +1));
  if (spec.anal) parts.push(finStrip(spec, spec.anal, -1));
  // pectorals + pelvic fins
  for (const side of [-1, 1]) parts.push(pectoral(spec, side));
  for (const side of [-1, 1]) parts.push(pelvic(spec, side, widthAt));
  // eyes: separate mesh with a glossy painted iris (planar UVs facing outward)
  const eyeT = 0.11;
  const eyeR = Math.max(0.03, spec.height * 0.17);
  const eyes: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const e = new THREE.SphereGeometry(eyeR, 16, 12);
    const ep = e.attributes.position as THREE.BufferAttribute;
    const eu = e.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < ep.count; i++) eu.setXY(i, 0.5 + (ep.getX(i) / eyeR) * 0.5, 0.5 + (ep.getY(i) / eyeR) * 0.5);
    e.scale(1, 1, 0.6);
    const eyeY = profile(spec, eyeT) * 0.3;
    e.translate(0.5 - eyeT, eyeY, side * widthAt(eyeT) * 0.8);
    eyes.push(e.toNonIndexed());
  }
  const eyeGeometry = mergeGeometries(eyes)!;
  for (const p of parts) {
    if (!p.attributes.normal) p.computeVertexNormals();
    for (const k of Object.keys(p.attributes)) if (!['position', 'normal', 'uv'].includes(k)) p.deleteAttribute(k);
  }
  const geometry = mergeGeometries(parts)!;
  // scale to world size: unit length is body (1) + tail len
  const total = 1 + spec.tail.len;
  geometry.scale(spec.size / total, spec.size / total, spec.size / total);
  geometry.computeBoundingSphere();
  eyeGeometry.scale(spec.size / total, spec.size / total, spec.size / total);
  const { texture, normalMap } = paintTexture(spec, hMax);
  return { geometry, texture, normalMap, eyeGeometry, eyeTexture: makeEyeTexture(spec.iris ?? '#c9a43a') };
}

function tailGeometry(spec: FishSpec, ped: number) {
  const L = spec.tail.len,
    S = spec.tail.span;
  let outline: [number, number][];
  switch (spec.tail.shape) {
    case 'fork':
      outline = [[0, ped], [-L * 0.55, S * 0.75], [-L, S * 1.05], [-L * 0.92, S * 0.75], [-L * 0.5, 0], [-L * 0.92, -S * 0.75], [-L, -S * 1.05], [-L * 0.55, -S * 0.75], [0, -ped]];
      break;
    case 'lunate':
      outline = [[0, ped], [-L * 0.6, S * 0.8], [-L, S * 1.2], [-L * 0.82, S * 0.5], [-L * 0.72, 0], [-L * 0.82, -S * 0.5], [-L, -S * 1.2], [-L * 0.6, -S * 0.8], [0, -ped]];
      break;
    case 'truncate':
      outline = [[0, ped], [-L * 0.6, S * 0.85], [-L, S * 0.95], [-L * 1.02, 0], [-L, -S * 0.95], [-L * 0.6, -S * 0.85], [0, -ped]];
      break;
    default:
      outline = [];
      outline.push([0, ped]);
      for (let i = 0; i <= 8; i++) {
        const a = Math.PI / 2 - (i / 8) * Math.PI;
        outline.push([-L * 0.45 - Math.cos(a) * L * 0.55, Math.sin(a) * S]);
      }
      outline.push([0, -ped]);
  }
  const pos: number[] = [],
    uv: number[] = [];
  const cx = 0.5 - 1 + 0.02; // tail base x in unit space (slightly inside body)
  for (let i = 0; i < outline.length - 1; i++) {
    const a = outline[i],
      b = outline[i + 1];
    pos.push(cx, 0, 0, cx + a[0], a[1], 0, cx + b[0], b[1], 0);
    const ua = FIN_U0 + (-a[0] / L) * (1 - FIN_U0) * 0.98,
      ub = FIN_U0 + (-b[0] / L) * (1 - FIN_U0) * 0.98;
    uv.push(FIN_U0, 0.5, ua, 0.5 + a[1] / (S * 2.6), ub, 0.5 + b[1] / (S * 2.6));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function finStrip(spec: FishSpec, fin: { t0: number; t1: number; h: number; trail?: number; peak?: number }, dir: number) {
  const pos: number[] = [],
    uv: number[] = [];
  const n = 12;
  const peak = fin.peak ?? 0.3;
  const pts: { bx: number; by: number; tx: number; ty: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const t = fin.t0 + (fin.t1 - fin.t0) * u;
    const bx = 0.5 - t;
    const cy = -spec.sag * Math.sin(Math.PI * t) * 0.6;
    const by = cy + dir * profile(spec, t) * 0.92;
    const shape = u < peak ? Math.sin((u / peak) * Math.PI * 0.5) : 1 - Math.pow((u - peak) / (1 - peak), 1.8) * 0.75;
    const trail = (fin.trail ?? 0) * Math.pow(u, 3);
    pts.push({ bx, by, tx: bx - trail - fin.h * 0.35 * u, ty: by + dir * (fin.h * shape + trail * 0.5) });
  }
  for (let i = 0; i < n; i++) {
    const a = pts[i],
      b = pts[i + 1];
    const u0 = i / n,
      u1 = (i + 1) / n;
    const q = [
      [a.bx, a.by, FIN_U0, u0],
      [b.bx, b.by, FIN_U0, u1],
      [a.tx, a.ty, 0.99, u0],
      [b.tx, b.ty, 0.99, u1],
    ];
    const tri = (p: number[][]) => p.forEach((v) => (pos.push(v[0], v[1], 0), uv.push(v[2], v[3])));
    tri([q[0], q[1], q[2]]);
    tri([q[2], q[1], q[3]]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function pectoral(spec: FishSpec, side: number) {
  const L = spec.pectoral.len;
  const g = new THREE.CircleGeometry(L * 0.5, 10);
  g.scale(1, 0.45, 1);
  g.translate(-L * 0.45, 0, 0);
  g.rotateY(side * 0.55);
  g.rotateX(side * 0.35);
  const t = spec.pectoral.t;
  g.translate(0.5 - t, -profile(spec, t) * 0.35, side * spec.width * 0.85);
  const uvA = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uvA.count; i++) uvA.setXY(i, FIN_U0 + uvA.getX(i) * 0.2, 0.3 + uvA.getY(i) * 0.4);
  return g.toNonIndexed();
}

function pelvic(spec: FishSpec, side: number, widthAt: (t: number) => number) {
  const L = spec.pectoral.len * 0.7;
  const g = new THREE.CircleGeometry(L * 0.5, 8, 0, Math.PI);
  g.scale(1, 0.5, 1);
  g.rotateZ(Math.PI + 0.35);
  g.rotateX(side * 0.5);
  const t = spec.pectoral.t + 0.1;
  g.translate(0.5 - t, -profile(spec, t) * 0.85, side * widthAt(t) * 0.45);
  const uvA = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uvA.count; i++) uvA.setXY(i, FIN_U0 + uvA.getX(i) * 0.22, 0.3 + uvA.getY(i) * 0.4);
  return g.toNonIndexed();
}

/** Glossy eye: dark pupil, coloured iris with radial fibres, dark rim and a catch-light. */
function makeEyeTexture(iris: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1a1612';
  g.fillRect(0, 0, 128, 128);
  const grd = g.createRadialGradient(64, 64, 10, 64, 64, 46);
  grd.addColorStop(0, iris);
  grd.addColorStop(0.75, iris);
  grd.addColorStop(1, '#2a2116');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(64, 64, 46, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    g.beginPath();
    g.moveTo(64 + Math.cos(a) * 24, 64 + Math.sin(a) * 24);
    g.lineTo(64 + Math.cos(a) * 44, 64 + Math.sin(a) * 44);
    g.stroke();
  }
  g.fillStyle = '#050505';
  g.beginPath();
  g.arc(64, 64, 25, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath();
  g.ellipse(52, 50, 9, 6, -0.6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.beginPath();
  g.arc(76, 78, 3.5, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function paintTexture(spec: FishSpec, hMax: number) {
  const W = 512,
    H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  // sideY(v) maps texture v to canvas y
  const sideY = (v: number) => (1 - v) * H;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W * BODY_U + 4, H);
  ctx.clip();
  spec.paint(ctx, W * BODY_U, H, sideY);
  const BW = W * BODY_U;
  // height map canvas (for the normal map): scales, gill cover, fin rays
  const hc = document.createElement('canvas');
  hc.width = W;
  hc.height = H;
  const hx = hc.getContext('2d')!;
  hx.fillStyle = '#808080';
  hx.fillRect(0, 0, W, H);
  // countershading: darker back, brighter belly
  const shade = ctx.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, 'rgba(0,0,0,0.22)');
  shade.addColorStop(0.45, 'rgba(0,0,0,0)');
  shade.addColorStop(0.8, 'rgba(255,255,255,0.10)');
  shade.addColorStop(1, 'rgba(255,255,255,0.18)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, BW, H);
  // overlapping scales
  const sc = spec.size < 0.4 ? 7 : 10;
  for (let row = 0, y = 0; y < H + sc; row++, y += sc * 0.7) {
    for (let x = BW * 0.2 + (row % 2) * sc * 0.5; x < BW + sc; x += sc) {
      ctx.strokeStyle = 'rgba(0,0,0,0.10)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(x, y, sc * 0.55, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.beginPath();
      ctx.arc(x, y - 1.2, sc * 0.5, Math.PI * 0.2, Math.PI * 0.8);
      ctx.stroke();
      const hg = hx.createRadialGradient(x, y - sc * 0.2, 0, x, y, sc * 0.6);
      hg.addColorStop(0, '#b0b0b0');
      hg.addColorStop(1, '#707070');
      hx.fillStyle = hg;
      hx.beginPath();
      hx.arc(x, y, sc * 0.58, 0, Math.PI);
      hx.fill();
    }
  }
  // gill cover (operculum) arc and lateral line
  const gx = BW * 0.21;
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(gx - 6, H * 0.18);
  ctx.quadraticCurveTo(gx + 10, H * 0.5, gx - 4, H * 0.84);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(gx - 3, H * 0.2);
  ctx.quadraticCurveTo(gx + 13, H * 0.5, gx - 1, H * 0.82);
  ctx.stroke();
  hx.strokeStyle = '#303030';
  hx.lineWidth = 4;
  hx.beginPath();
  hx.moveTo(gx - 6, H * 0.18);
  hx.quadraticCurveTo(gx + 10, H * 0.5, gx - 4, H * 0.84);
  hx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  for (let x = gx + 8; x < BW * 0.95; x += 5) ctx.fillRect(x, H * 0.4 + Math.sin(x * 0.02) * 4, 2, 1.5);
  // mouth line + soft eye socket shadow
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, H * 0.53);
  ctx.lineTo(BW * 0.045, H * 0.55);
  ctx.stroke();
  const ex = 0.11 * BW,
    ey = sideY(0.5 + ((profile(spec, 0.11) * 0.3) / hMax) * 0.48);
  const sg = ctx.createRadialGradient(ex, ey, 2, ex, ey, 20);
  sg.addColorStop(0, 'rgba(0,0,0,0.25)');
  sg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(ex - 20, ey - 20, 40, 40);
  ctx.restore();
  // fins strip
  const fx = W * FIN_U0 - 6;
  const grd = ctx.createLinearGradient(fx, 0, W, 0);
  grd.addColorStop(0, spec.finColor);
  grd.addColorStop(0.75, spec.finColor);
  grd.addColorStop(1, spec.finEdge ?? spec.finColor);
  ctx.fillStyle = grd;
  ctx.fillRect(fx, 0, W - fx, H);
  // fin rays (colour + relief)
  for (let y = 4; y < H; y += 8) {
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(fx, y);
    ctx.lineTo(W, y + 2);
    ctx.stroke();
    hx.strokeStyle = '#b8b8b8';
    hx.lineWidth = 2;
    hx.beginPath();
    hx.moveTo(fx, y);
    hx.lineTo(W, y + 2);
    hx.stroke();
  }
  // fin membrane translucency: alpha fades toward the fin edge, rays stay more opaque
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  const fade = ctx.createLinearGradient(fx, 0, W, 0);
  fade.addColorStop(0, 'rgba(0,0,0,0.05)');
  fade.addColorStop(0.5, 'rgba(0,0,0,0.3)');
  fade.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = fade;
  ctx.fillRect(fx, 0, W - fx, H);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 0; y < H; y += 8) ctx.fillRect(fx + 20, y + 2, W - fx - 20, 4);
  ctx.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const normalMap = heightToNormal(hc, 2.2);
  return { texture: tex, normalMap };
}

// ---------------------------------------------------------------------------------- species
const grad = (ctx: CanvasRenderingContext2D, H: number, stops: [number, string][]) => {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  return g;
};

export const SPECIES: Record<string, FishSpec> = {
  silverside: {
    id: 'silverside',
    iris: '#d8d8c8',
    iridescence: 0.9,
    segments: [16, 10],
    label: 'Silverside',
    size: 0.34,
    height: 0.1,
    width: 0.065,
    peakT: 0.35,
    peduncle: 0.3,
    sag: 0.0,
    tail: { shape: 'fork', len: 0.3, span: 0.13 },
    dorsal: { t0: 0.45, t1: 0.62, h: 0.06 },
    anal: { t0: 0.62, t1: 0.78, h: 0.04 },
    pectoral: { t: 0.22, len: 0.12 },
    roughness: 0.3,
    metalness: 0.55,
    finColor: 'rgba(190,215,225,1)',
    paint(ctx, W, H) {
      ctx.fillStyle = grad(ctx, H, [
        [0, '#1d4a5e'],
        [0.38, '#3d8aa3'],
        [0.5, '#cfe8f0'],
        [1, '#f4f7f8'],
      ]);
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(160,240,255,0.85)';
      ctx.fillRect(0, H * 0.47, W, H * 0.045);
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = 'rgba(20,50,70,0.15)';
        ctx.fillRect(Math.random() * W, Math.random() * H * 0.35, 6, 3);
      }
    },
  },
  cardinal: {
    id: 'cardinal',
    iris: '#f0c040',
    segments: [16, 10],
    label: 'Cardinalfish',
    size: 0.3,
    height: 0.17,
    width: 0.07,
    peakT: 0.33,
    peduncle: 0.35,
    sag: 0.01,
    tail: { shape: 'fork', len: 0.28, span: 0.15 },
    dorsal: { t0: 0.3, t1: 0.68, h: 0.13, peak: 0.25 },
    anal: { t0: 0.58, t1: 0.82, h: 0.08 },
    pectoral: { t: 0.24, len: 0.13 },
    roughness: 0.45,
    metalness: 0.1,
    finColor: 'rgba(240,120,90,1)',
    finEdge: 'rgba(255,190,170,1)',
    paint(ctx, W, H) {
      ctx.fillStyle = grad(ctx, H, [
        [0, '#c8342a'],
        [0.5, '#f07a52'],
        [1, '#ffd0b0'],
      ]);
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(120,20,20,0.45)';
      ctx.lineWidth = 3;
      for (const y of [0.32, 0.5, 0.66]) {
        ctx.beginPath();
        ctx.moveTo(0, H * y);
        ctx.lineTo(W, H * (y + 0.04));
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(40,10,10,0.55)';
      ctx.beginPath();
      ctx.ellipse(W * 0.9, H * 0.5, W * 0.04, H * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
    },
  },
  clown: {
    id: 'clown',
    iris: '#d87020',
    label: 'Clownfish',
    size: 0.55,
    height: 0.2,
    width: 0.1,
    peakT: 0.35,
    peduncle: 0.45,
    sag: 0.015,
    tail: { shape: 'round', len: 0.26, span: 0.16 },
    dorsal: { t0: 0.25, t1: 0.82, h: 0.12, peak: 0.2 },
    anal: { t0: 0.6, t1: 0.85, h: 0.1 },
    pectoral: { t: 0.24, len: 0.16 },
    roughness: 0.38,
    metalness: 0.0,
    finColor: '#f2862a',
    finEdge: '#151010',
    paint(ctx, W, H) {
      ctx.fillStyle = grad(ctx, H, [
        [0, '#e8621a'],
        [0.5, '#f7892e'],
        [1, '#ffb066'],
      ]);
      ctx.fillRect(0, 0, W, H);
      const band = (x: number, w: number, curve: number) => {
        ctx.fillStyle = '#121010';
        ctx.beginPath();
        ctx.ellipse(x, H / 2, w + 6, H * 0.62, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fbfbf6';
        ctx.beginPath();
        ctx.ellipse(x + curve, H / 2, w, H * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
      };
      band(W * 0.2, W * 0.045, 0);
      band(W * 0.53, W * 0.05, 2);
      band(W * 0.93, W * 0.03, 0);
    },
  },
  tang: {
    id: 'tang',
    iris: '#3a3020',
    segments: [34, 22],
    label: 'Blue tang',
    size: 0.72,
    height: 0.27,
    width: 0.07,
    peakT: 0.4,
    peduncle: 0.24,
    sag: 0.0,
    tail: { shape: 'truncate', len: 0.26, span: 0.2 },
    dorsal: { t0: 0.2, t1: 0.88, h: 0.08, peak: 0.12 },
    anal: { t0: 0.4, t1: 0.88, h: 0.07 },
    pectoral: { t: 0.25, len: 0.16 },
    roughness: 0.32,
    metalness: 0.05,
    finColor: '#f6d23a',
    finEdge: '#1b2c7a',
    paint(ctx, W, H) {
      ctx.fillStyle = grad(ctx, H, [
        [0, '#1a3fb0'],
        [0.5, '#2d6ae0'],
        [1, '#4f8cf0'],
      ]);
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#0d1430';
      ctx.beginPath();
      ctx.moveTo(W * 0.12, H * 0.32);
      ctx.bezierCurveTo(W * 0.4, H * 0.08, W * 0.8, H * 0.1, W * 0.98, H * 0.32);
      ctx.bezierCurveTo(W * 0.75, H * 0.28, W * 0.55, H * 0.4, W * 0.6, H * 0.58);
      ctx.bezierCurveTo(W * 0.45, H * 0.45, W * 0.3, H * 0.42, W * 0.12, H * 0.32);
      ctx.fill();
      ctx.fillStyle = '#f6d23a';
      ctx.fillRect(W * 0.93, H * 0.35, W * 0.07, H * 0.3);
    },
  },
  butterfly: {
    id: 'butterfly',
    iris: '#202020',
    segments: [34, 22],
    label: 'Butterflyfish',
    size: 0.6,
    height: 0.34,
    width: 0.055,
    peakT: 0.45,
    peduncle: 0.3,
    sag: 0.0,
    tail: { shape: 'truncate', len: 0.2, span: 0.17 },
    dorsal: { t0: 0.3, t1: 0.92, h: 0.1, peak: 0.3 },
    anal: { t0: 0.5, t1: 0.92, h: 0.1 },
    pectoral: { t: 0.27, len: 0.14 },
    roughness: 0.4,
    metalness: 0.0,
    finColor: '#f3cf2a',
    finEdge: '#202020',
    paint(ctx, W, H) {
      ctx.fillStyle = grad(ctx, H, [
        [0, '#f5c814'],
        [0.6, '#fbdc3e'],
        [1, '#fff3b0'],
      ]);
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fffaf0';
      ctx.fillRect(0, 0, W * 0.08, H);
      ctx.fillStyle = '#111';
      ctx.fillRect(W * 0.08, 0, W * 0.07, H);
      ctx.strokeStyle = 'rgba(200,140,0,0.4)';
      ctx.lineWidth = 2;
      for (let i = -4; i < 12; i++) {
        ctx.beginPath();
        ctx.moveTo(W * (0.15 + i * 0.07), 0);
        ctx.lineTo(W * (0.15 + i * 0.07 + 0.25), H);
        ctx.stroke();
      }
      ctx.fillStyle = '#151515';
      ctx.beginPath();
      ctx.arc(W * 0.8, H * 0.24, H * 0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.stroke();
    },
  },
  angel: {
    id: 'angel',
    iris: '#e0b030',
    segments: [34, 22],
    label: 'Angelfish',
    size: 0.85,
    height: 0.32,
    width: 0.07,
    peakT: 0.42,
    peduncle: 0.35,
    sag: 0.0,
    tail: { shape: 'truncate', len: 0.24, span: 0.22 },
    dorsal: { t0: 0.25, t1: 0.95, h: 0.14, trail: 0.22, peak: 0.25 },
    anal: { t0: 0.45, t1: 0.95, h: 0.12, trail: 0.15 },
    pectoral: { t: 0.28, len: 0.18 },
    roughness: 0.35,
    metalness: 0.05,
    finColor: '#2a50b0',
    finEdge: '#9fd8ff',
    paint(ctx, W, H) {
      ctx.fillStyle = '#20348c';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#f2d23a';
      ctx.lineWidth = 6;
      for (let i = -6; i < 16; i++) {
        ctx.beginPath();
        ctx.moveTo(W * (0.1 + i * 0.06), H);
        ctx.quadraticCurveTo(W * (0.3 + i * 0.06), H * 0.5, W * (0.2 + i * 0.06), 0);
        ctx.stroke();
      }
      ctx.fillStyle = '#0c1020';
      ctx.fillRect(W * 0.07, 0, W * 0.07, H);
      ctx.fillStyle = '#7fd0ff';
      ctx.fillRect(W * 0.14, 0, W * 0.012, H);
      ctx.fillStyle = '#f2c22a';
      ctx.fillRect(W * 0.92, 0, W * 0.08, H);
    },
  },
};
