import * as THREE from 'three';
import { clamp } from '../util/math';
import { merge, paint } from '../util/geometry';
import { fbm3 } from '../util/noise';
import { patchMaterial } from '../util/shaders';

/**
 * Detailed procedural models for the rare visitors that are seen up close (green turtle,
 * seahorse, moray eel). Bodies are lofted along a planar spine with shaped cross-sections;
 * scutes, scales and spots are painted once into small canvas textures when the visitor is
 * first needed (nothing is shipped as an image).
 */

export const visitorMat = (key: string, rough = 0.6, extra: THREE.MeshStandardMaterialParameters = {}) =>
  patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, ...extra }), { caustics: true, key: `visitor-${key}` });

const C = (hex: number) => new THREE.Color(hex);
const sstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const hash = (i: number, j: number, k: number) => {
  const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Smoothly interpolated keyframes: rows of [s, ...values]; returns the values at `s`. */
function keys(rows: number[][], s: number, out: number[]) {
  let i = 0;
  while (i < rows.length - 2 && s > rows[i + 1][0]) i++;
  const a = rows[i],
    b = rows[i + 1];
  const t = sstep(a[0], b[0], s);
  for (let k = 1; k < a.length; k++) out[k - 1] = a[k] + (b[k] - a[k]) * t;
  return out;
}

/** Jittered cell points, hashed once per grid (textures query them for every pixel). */
const cellGrids = new Map<string, Float32Array>();
function cellGrid(nu: number, nv: number, seed: number, jitter: number) {
  const key = `${nu}|${nv}|${seed}|${jitter}`;
  let g = cellGrids.get(key);
  if (!g) {
    g = new Float32Array(nu * nv * 3);
    for (let y = 0; y < nv; y++)
      for (let x = 0; x < nu; x++) {
        const i = (y * nu + x) * 3;
        g[i] = 0.5 + (hash(x, y, seed) - 0.5) * jitter;
        g[i + 1] = 0.5 + (hash(x, y, seed + 7) - 0.5) * jitter;
        g[i + 2] = hash(x, y, seed + 3);
      }
    cellGrids.set(key, g);
  }
  return g;
}
const cellOut = { d1: 0, d2: 0, id: 0 };
/** Cells on a jittered grid (tileable over nu × nv): nearest / second distance and the cell id. */
function cells(x: number, y: number, nu: number, nv: number, seed: number, jitter = 0.8) {
  const g = cellGrid(nu, nv, seed, jitter);
  const ix = Math.floor(x),
    iy = Math.floor(y);
  let d1 = 9,
    d2 = 9,
    id = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const gx = ix + dx,
        gy = iy + dy;
      const wx = ((gx % nu) + nu) % nu,
        wy = ((gy % nv) + nv) % nv;
      const i = (wy * nu + wx) * 3;
      const ex = x - gx - g[i],
        ey = y - gy - g[i + 1];
      const d = Math.sqrt(ex * ex + ey * ey);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = g[i + 2];
      } else if (d < d2) d2 = d;
    }
  cellOut.d1 = d1;
  cellOut.d2 = d2;
  cellOut.id = id;
  return cellOut;
}

interface PaintJob {
  y: number;
  w: number;
  h: number;
  fn: (u: number, v: number, out: THREE.Color) => void;
  img: ImageData;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
}
const jobs: PaintJob[] = [];
const paintC = new THREE.Color();

/**
 * Paints queued texture rows for up to `budgetMs`. Textures are painted a few rows per frame
 * so a visitor's first arrival never stalls the animation; returns true once all are done.
 */
export function pumpTextures(budgetMs = 3) {
  const t0 = performance.now();
  while (jobs.length) {
    const j = jobs[0];
    const { w, h, fn, img } = j;
    while (j.y < h) {
      const y = j.y++;
      for (let x = 0; x < w; x++) {
        fn((x + 0.5) / w, 1 - (y + 0.5) / h, paintC); // CanvasTexture is flipped: v = 0 at the bottom
        const i = (y * w + x) * 4;
        img.data[i] = clamp(paintC.r, 0, 1) * 255;
        img.data[i + 1] = clamp(paintC.g, 0, 1) * 255;
        img.data[i + 2] = clamp(paintC.b, 0, 1) * 255;
        img.data[i + 3] = 255;
      }
      if (performance.now() - t0 > budgetMs) return false;
    }
    j.ctx.putImageData(img, 0, 0);
    j.tex.needsUpdate = true;
    jobs.shift();
  }
  return true;
}

/** A small texture painted per pixel (queued, see pumpTextures); `fn` gets (u, v) and writes sRGB 0..1. */
function canvasTex(w: number, h: number, fn: (u: number, v: number, out: THREE.Color) => void) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  jobs.push({ y: 0, w, h, fn, img, ctx, tex: t });
  return t;
}

interface Section {
  n: number; // offset along the in-plane normal
  z: number; // offset along +z (sideways)
  v: number; // texture v (defaults to the angle / 2π)
}

/**
 * Lofts a body along a spine lying in the x–y plane. Cross-sections live in the plane of the
 * in-plane normal N (= z × tangent) and +z, so "up / belly" stays consistent along curls.
 * `section(s, a)` receives the arc-length parameter and the angle (0 = +N) and fills (n, z, v).
 */
export function loft(spine: THREE.Curve<THREE.Vector3>, segs: number, radial: number, section: (s: number, a: number, out: Section) => void, caps: [number, number] = [0.6, 0.6]) {
  const pos: number[] = [],
    uv: number[] = [],
    idx: number[] = [];
  const P = new THREE.Vector3(),
    T = new THREE.Vector3(),
    N = new THREE.Vector3();
  const Z = new THREE.Vector3(0, 0, 1);
  const out: Section = { n: 0, z: 0, v: 0 };
  const ring = (i: number) => i * (radial + 1);
  const centre = [new THREE.Vector3(), new THREE.Vector3()];
  for (let i = 0; i <= segs; i++) {
    const s = i / segs;
    spine.getPointAt(s, P);
    spine.getTangentAt(s, T);
    N.crossVectors(Z, T).normalize();
    const c = new THREE.Vector3();
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      out.v = j / radial;
      section(s, a, out);
      const x = P.x + N.x * out.n,
        y = P.y + N.y * out.n,
        z = out.z + P.z;
      pos.push(x, y, z);
      uv.push(s, out.v);
      if (j < radial) c.add(new THREE.Vector3(x, y, z));
    }
    if (i === 0) centre[0].copy(c.divideScalar(radial));
    if (i === segs) centre[1].copy(c.divideScalar(radial));
  }
  for (let i = 0; i < segs; i++)
    for (let j = 0; j < radial; j++) {
      const a = ring(i) + j,
        b = ring(i + 1) + j;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  // closing caps (a short cone so ends look rounded rather than cut)
  const t0 = spine.getTangentAt(0),
    t1 = spine.getTangentAt(1);
  const r0 = Math.hypot(pos[0] - centre[0].x, pos[1] - centre[0].y, pos[2] - centre[0].z);
  const e = ring(segs) * 3;
  const r1 = Math.hypot(pos[e] - centre[1].x, pos[e + 1] - centre[1].y, pos[e + 2] - centre[1].z);
  const tipA = centre[0].clone().addScaledVector(t0, -r0 * caps[0]);
  const tipB = centre[1].clone().addScaledVector(t1, r1 * caps[1]);
  const ia = pos.length / 3;
  pos.push(tipA.x, tipA.y, tipA.z);
  uv.push(0, uv[1]);
  const ib = ia + 1;
  pos.push(tipB.x, tipB.y, tipB.z);
  uv.push(1, uv[ring(segs) * 2 + 1]);
  for (let j = 0; j < radial; j++) {
    idx.push(j, ia, j + 1);
    idx.push(ring(segs) + j, ring(segs) + j + 1, ib);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // smooth the seam where the ring wraps around
  const nor = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i <= segs; i++) {
    const a = ring(i),
      b = ring(i) + radial;
    const nx = nor.getX(a) + nor.getX(b),
      ny = nor.getY(a) + nor.getY(b),
      nz = nor.getZ(a) + nor.getZ(b);
    const l = Math.hypot(nx, ny, nz) || 1;
    nor.setXYZ(a, nx / l, ny / l, nz / l);
    nor.setXYZ(b, nx / l, ny / l, nz / l);
  }
  return g;
}

/** A small sphere eye with a dark pupil facing `look` and a coloured iris around it. */
function eyeGeo(r: number, look: THREE.Vector3, iris: number, pupil = 0.62, rim = 0x1a1410) {
  const g = new THREE.SphereGeometry(r, 16, 12);
  const l = look.clone().normalize();
  paint(g, (_p, n, c) => {
    const d = n.dot(l);
    if (d > pupil) c.set(0x050505);
    else if (d > pupil - 0.28) c.set(iris).lerp(C(0x3a2a10), (d - (pupil - 0.28)) / 0.28 * 0.4);
    else c.set(rim);
  });
  return g;
}

// ============================================================================ green turtle

export interface TurtleModel {
  root: THREE.Group;
  shell: THREE.Mesh;
  head: THREE.Group;
  headMesh: THREE.Mesh;
  flippers: THREE.Group[];
}

const SHELL_A = 0.56,
  SHELL_B = 0.44,
  SHELL_H = 0.2;
/** Carapace outline at angle θ (0 = forward): a teardrop with a small notch over the neck. */
function shellEdge(th: number): [number, number] {
  const c = Math.cos(th),
    s = Math.sin(th);
  const rear = Math.max(0, -c);
  const d = Math.atan2(s, c);
  const w = SHELL_B * (1 - 0.24 * Math.pow(rear, 1.5));
  const serr = 1 + 0.018 * Math.pow(rear, 2) * Math.abs(Math.sin(th * 14));
  const l = SHELL_A * (1 + 0.07 * Math.pow(rear, 3)) * (1 - 0.06 * Math.exp(-(d * d) / 0.03)) * serr;
  return [l * c, w * s * serr];
}

export function shellTexture() {
  // scute centres in normalised shell space (x / A, z / B)
  const C0: [number, number, number][] = [
    [0.66, 0, 0],
    [0.33, 0, 0],
    [0.0, 0, 0],
    [-0.33, 0, 0],
    [-0.64, 0, 0],
  ];
  for (const s of [1, -1])
    for (const x of [0.44, 0.12, -0.2, -0.5]) C0.push([x, s * (x < -0.3 ? 0.5 : 0.6), 1]);
  const dark = C(0x3a2a14),
    mid = C(0x6a5226),
    light = C(0xb48a42),
    seam = C(0xa8905a),
    tmp = C(0);
  // (this runs for every pixel when the first turtle arrives: flat arrays, no Math.hypot)
  const NC = C0.length;
  const CX = new Float64Array(NC),
    CZ = new Float64Array(NC),
    KZ = new Float64Array(NC);
  C0.forEach(([x, z, k], i) => ((CX[i] = x), (CZ[i] = z), (KZ[i] = k ? 1 : 1.18)));
  const LUT = 1024;
  const edgeR = new Float64Array(LUT + 1);
  for (let i = 0; i <= LUT; i++) {
    const [ex, ez] = shellEdge((i / LUT) * Math.PI * 2 - Math.PI);
    edgeR[i] = Math.sqrt(ex * ex + ez * ez);
  }
  return canvasTex(384, 384, (u, v, out) => {
    const x = (u - 0.5) * 2 * 0.64,
      z = (v - 0.5) * 2 * 0.64;
    const th = Math.atan2(z, x);
    const r = Math.sqrt(x * x + z * z) / edgeR[Math.round(((th + Math.PI) / (Math.PI * 2)) * LUT)];
    if (r > 1.03) {
      out.copy(dark);
      return;
    }
    const X = x / SHELL_A,
      Z = z / SHELL_B;
    let edge: number, gx: number, gz: number, id: number;
    if (r > 0.84) {
      // marginal scutes: a ring split by angle
      const n = 26;
      const f = ((th / (Math.PI * 2)) * n + n + 0.5) % n;
      const k = Math.floor(f);
      edge = Math.min(Math.abs(f - k), Math.abs(f - k - 1)) * 0.11 * Math.PI * 2 * 0.6;
      edge = Math.min(edge, (r - 0.84) * 0.5);
      const mth = ((k + 0.5) / n) * Math.PI * 2;
      gx = Math.cos(mth) * 1.05;
      gz = Math.sin(mth) * 1.05;
      id = k / n;
    } else {
      let d1 = 9,
        d2 = 9,
        best = 0;
      for (let i = 0; i < NC; i++) {
        const dx = X - CX[i],
          dz = (Z - CZ[i]) * KZ[i];
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          best = i;
        } else if (d < d2) d2 = d;
      }
      edge = Math.min((d2 - d1) * 0.5 * 0.5, (0.84 - r) * 0.5);
      // growth centre toward the back edge of each scute (where the sunburst starts)
      gx = CX[best] - 0.16;
      gz = CZ[best] * 1.05;
      id = best / NC;
    }
    // sunburst streaks radiating from the growth centre
    const ang = Math.atan2(Z - gz, X - gx);
    const dist = Math.sqrt((X - gx) * (X - gx) + (Z - gz) * (Z - gz));
    // (cheap sine "noise" here: this runs for every pixel when the first turtle arrives)
    const wob = Math.sin(X * 13.1 + id * 7) * Math.sin(Z * 11.7 - id * 3) + 0.5 * Math.sin((X + Z) * 23.3 + id * 11);
    const streak = 0.5 + 0.5 * Math.sin(ang * 9 + 2.4 * Math.sin(ang * 3 + id * 20) + wob * 1.6);
    const growth = 0.5 + 0.5 * Math.sin(dist * 70 + wob * 2);
    out.copy(mid).lerp(light, streak * 0.75 * (0.55 + 0.45 * Math.min(1, dist * 2.2)));
    out.lerp(dark, (1 - streak) * 0.45 + growth * 0.08);
    out.multiplyScalar(0.92 + 0.16 * id);
    // seams: thin pale lines with a darker border
    if (edge < 0.0045) out.copy(seam);
    else if (edge < 0.02) out.lerp(tmp.copy(dark), 0.4 * (1 - (edge - 0.006) / 0.014));
    if (r > 0.97) out.multiplyScalar(0.75);
  });
}

/** Scale pattern for head and flippers: dark polygonal scales with pale seams, pale underneath. */
export function scaleTexture() {
  const cell = C(0x4a3a1c),
    cell2 = C(0x6e5a2c),
    seam = C(0xdccb92),
    pale = C(0xd8cc9a),
    neck = C(0x7a7452);
  return canvasTex(384, 192, (u, v, out) => {
    // v: 0..0.5 = top / sides, 0.5..1 = underside; u < 0.3 is neck skin (head texture only)
    const under = v > 0.5;
    const vv = under ? (v - 0.5) * 2 : v * 2;
    if (u < 0.3) {
      const w = 0.5 + 0.5 * Math.sin(vv * 90 + Math.sin(u * 60 + vv * 9) * 3);
      out.copy(under ? pale : neck).multiplyScalar(0.85 + 0.2 * w);
      return;
    }
    const c = cells(u * 26, vv * 13, 26, 13, under ? 5 : 2, 0.85);
    const e = c.d2 - c.d1;
    out.copy(under ? pale : cell).lerp(under ? pale : cell2, c.id);
    if (!under) out.multiplyScalar(0.85 + 0.3 * Math.min(1, c.d1 * 1.2));
    if (e < (under ? 0.05 : 0.13)) out.lerp(seam, under ? 0.35 : 1 - e / 0.13 * 0.5);
  });
}

/** A flat, lens-section flipper whose span runs along ±z. */
function flipperGeo(side: number, span: number, chord: (s: number) => number, le: (s: number) => number, thick: (s: number) => number, droop: (s: number) => number) {
  const S = 24,
    U = 10;
  const pos: number[] = [],
    uv: number[] = [],
    idx: number[] = [];
  const W = 2 * U;
  for (let i = 0; i <= S; i++) {
    const s = i / S;
    const c = chord(s),
      x0 = le(s),
      t = thick(s),
      y0 = droop(s);
    for (let k = 0; k <= W; k++) {
      const top = k <= U;
      const u = top ? k / U : (W - k) / U;
      const shape = Math.sqrt(u) * (1 - u) * 2.6;
      pos.push(x0 - c * u, y0 + (top ? 1 : -1) * t * shape * 0.5, side * span * s);
      uv.push(0.3 + 0.7 * s, top ? 0.5 * u : 0.5 + 0.5 * u);
    }
  }
  for (let i = 0; i < S; i++)
    for (let k = 0; k < W; k++) {
      const a = i * (W + 1) + k,
        b = (i + 1) * (W + 1) + k;
      if (side > 0) idx.push(a, a + 1, b, b, a + 1, b + 1);
      else idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildTurtle(): TurtleModel {
  const root = new THREE.Group();
  // ---- carapace: a low teardrop dome with a thin overhanging rim
  const NA = 72,
    NT = 22;
  const pos: number[] = [],
    uv: number[] = [],
    idx: number[] = [];
  const rows: [number, number][] = [];
  for (let k = 0; k <= NT; k++) rows.push([k / NT, -1]);
  rows.push([1.0, -0.022]); // underside of the rim
  rows.push([0.93, -0.026]);
  for (let k = 0; k < rows.length; k++) {
    const [r, yFixed] = rows[k];
    for (let j = 0; j <= NA; j++) {
      const th = (j / NA) * Math.PI * 2;
      const [ex, ez] = shellEdge(th);
      const x = ex * r,
        z = ez * r;
      const y = yFixed >= -0.5 ? yFixed : SHELL_H * Math.pow(Math.max(0, 1 - Math.pow(r, 2.4)), 0.55) * (1 + 0.07 * Math.cos(th));
      pos.push(x, y, z);
      uv.push(0.5 + x / (2 * 0.64), 0.5 + z / (2 * 0.64));
    }
  }
  for (let k = 0; k < rows.length - 1; k++)
    for (let j = 0; j < NA; j++) {
      const a = k * (NA + 1) + j,
        b = (k + 1) * (NA + 1) + j;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  const shellGeo = new THREE.BufferGeometry();
  shellGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  shellGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  shellGeo.setIndex(idx);
  shellGeo.computeVertexNormals();
  paint(shellGeo, (p, _n, c) => c.setScalar(p.y < -0.01 ? 0.55 : 1));
  const shell = new THREE.Mesh(shellGeo, visitorMat('turtle-shell', 0.5, { map: shellTexture() }));
  shell.castShadow = true;
  root.add(shell);

  // ---- plastron (pale belly plates) + tail, closing the body underneath
  const pl: number[] = [],
    pi: number[] = [];
  const PR = 10;
  for (let k = 0; k <= PR; k++) {
    const r = 0.96 * (1 - k / PR);
    for (let j = 0; j <= NA; j++) {
      const th = (j / NA) * Math.PI * 2;
      const [ex, ez] = shellEdge(th);
      pl.push(ex * r * 0.97, -0.02 - 0.085 * Math.pow(1 - Math.pow(r / 0.96, 2), 0.5), ez * r * 0.92);
    }
  }
  for (let k = 0; k < PR; k++)
    for (let j = 0; j < NA; j++) {
      const a = k * (NA + 1) + j,
        b = (k + 1) * (NA + 1) + j;
      pi.push(a, a + 1, b, b, a + 1, b + 1);
    }
  const plastron = new THREE.BufferGeometry();
  plastron.setAttribute('position', new THREE.Float32BufferAttribute(pl, 3));
  plastron.setIndex(pi);
  plastron.computeVertexNormals();
  const tail = new THREE.ConeGeometry(0.035, 0.12, 10).rotateZ(Math.PI / 2).translate(-0.6, -0.035, 0);
  const belly = merge([plastron, tail]);
  paint(belly, (p, _n, c) => {
    if (p.x < -0.52) c.set(0x6e6646);
    else {
      const seam = Math.abs(p.z) < 0.008 || [0.28, 0.06, -0.16, -0.36].some((x) => Math.abs(p.x - x) < 0.008);
      c.set(seam ? 0xb8a66e : 0xe2d49c).multiplyScalar(0.92 + 0.1 * fbm3(p.x * 12, 0, p.z * 12, 2));
    }
  });
  const bellyMesh = new THREE.Mesh(belly, visitorMat('turtle-belly', 0.7));
  root.add(bellyMesh);

  // ---- head and neck (one loft), pivoting at the neck base for grazing
  const scales = scaleTexture();
  const skinMat = visitorMat('turtle-skin', 0.62, { map: scales });
  const NECK = 0.36;
  const spine = new THREE.CatmullRomCurve3([new THREE.Vector3(0.36, -0.012, 0), new THREE.Vector3(0.52, 0.0, 0), new THREE.Vector3(0.68, 0.016, 0), new THREE.Vector3(0.82, 0.002, 0)]);
  const prof = [
    // s, half-height, half-width, centre lift
    [0, 0.06, 0.07, 0],
    [0.3, 0.054, 0.062, 0],
    [0.46, 0.066, 0.068, 0.006],
    [0.62, 0.074, 0.072, 0.012],
    [0.78, 0.064, 0.06, 0.008],
    [0.9, 0.047, 0.043, -0.002],
    [1, 0.024, 0.022, -0.012],
  ];
  const pv = [0, 0, 0];
  const headGeo = loft(
    spine,
    56,
    36,
    (s, a, o) => {
      keys(prof, s, pv);
      const [h, w, cy] = pv;
      const ca = Math.cos(a),
        sa = Math.sin(a);
      // a slightly boxy head; the underside (jaw) a little flatter
      const k = 2 / 2.4;
      let n = Math.sign(ca) * Math.pow(Math.abs(ca), k) * h * (ca < 0 ? 0.88 : 1);
      // the beak: the upper jaw hooks a little over the lower one near the tip
      if (s > 0.86 && ca < 0 && Math.abs(sa) < 0.9) n -= 0.006 * sstep(0.86, 0.98, s);
      o.n = n + cy;
      o.z = Math.sign(sa) * Math.pow(Math.abs(sa), k) * w;
      // texture: v 0..0.5 top half, 0.5..1 underside
      const up = ca > -0.25;
      const t = Math.abs(Math.atan2(sa, ca)) / Math.PI; // 0 top … 1 bottom
      o.v = up ? t * 0.5 : 0.5 + (t - 0.42) * 0.86;
    },
    [0.3, 0.55],
  );
  // paint: mouth line along the side, horny beak tip
  paint(headGeo, (p, n, c, uv) => {
    const s = uv!.x;
    c.setScalar(1);
    if (s > 0.74) {
      const side = Math.abs(n.z) > 0.55 && n.y < 0.05 && n.y > -0.45;
      const line = side && Math.abs(n.y + 0.2) < 0.08;
      if (line) c.set(0x2a2214);
      if (s > 0.9) c.lerp(C(0x9a8a5a), 0.5);
    }
  });
  headGeo.translate(-NECK, 0, 0);
  const headMesh = new THREE.Mesh(headGeo, skinMat);
  headMesh.castShadow = true;
  const head = new THREE.Group();
  head.position.set(NECK, 0, 0);
  head.add(headMesh);
  // eyes, set into the side of the head with a darker lid around them
  for (const s of [1, -1]) {
    const e = new THREE.Mesh(eyeGeo(0.022, new THREE.Vector3(0.45, 0.15, s), 0x6a4a20, 0.5), visitorMat('turtle-eye', 0.15));
    const lid = new THREE.Mesh(new THREE.TorusGeometry(0.023, 0.007, 8, 18), visitorMat('turtle-lid', 0.6));
    paint(lid.geometry, (_p, _n, c) => c.set(0x5a4a2a));
    lid.rotation.y = s * 1.15;
    const p = new THREE.Vector3(0.645 - NECK, 0.04, s * 0.055);
    e.position.copy(p);
    lid.position.copy(p).add(new THREE.Vector3(0.004, 0, s * 0.003));
    head.add(e, lid);
  }
  root.add(head);

  // ---- flippers: long swept front paddles with a claw, short round rear ones
  const flippers: THREE.Group[] = [];
  const front = (side: number) =>
    flipperGeo(
      side,
      0.62,
      (s) => (0.17 * (1 - Math.pow(s, 2.2)) + 0.014) * (0.76 + 0.24 * sstep(0, 0.35, s)),
      (s) => 0.06 - 0.3 * Math.pow(s, 1.35),
      (s) => 0.05 * (1 - s) + 0.008,
      (s) => -0.045 * s * s,
    );
  const rear = (side: number) =>
    flipperGeo(
      side,
      0.21,
      (s) => 0.125 * Math.sqrt(Math.max(0, 1 - Math.pow(s, 2.5))) + 0.02,
      (s) => 0.05 - 0.03 * s,
      (s) => 0.03 * (1 - s) + 0.006,
      () => 0,
    );
  const white = (g: THREE.BufferGeometry) => paint(g, (_p, _n, c) => c.setScalar(1));
  const claw = (side: number) => {
    const s = 0.42;
    const g = new THREE.ConeGeometry(0.008, 0.03, 6).rotateZ(-Math.PI / 2).rotateY(-side * 0.5);
    g.translate(0.06 - 0.3 * Math.pow(s, 1.35) + 0.008, -0.045 * s * s, side * 0.62 * s);
    paint(g, (_p, _n, c) => c.set(0x3a3020));
    return g;
  };
  for (const [x, z, isFront] of [
    [0.27, 0.3, 1],
    [0.27, -0.3, 1],
    [-0.4, 0.22, 0],
    [-0.4, -0.22, 0],
  ] as const) {
    const side = z > 0 ? 1 : -1;
    const pivot = new THREE.Group();
    pivot.position.set(x, -0.03, z);
    const geo = isFront ? merge([white(front(side)), claw(side)]) : white(rear(side));
    const m = new THREE.Mesh(geo, skinMat);
    m.castShadow = true;
    m.rotation.y = isFront ? -side * 0.22 : -side * 0.93;
    pivot.add(m);
    root.add(pivot);
    flippers.push(pivot);
  }
  return { root, shell, head, headMesh, flippers };
}

// ============================================================================ seahorse

export interface SeahorseModel {
  root: THREE.Group;
  body: THREE.Mesh;
  fin: THREE.Mesh;
  finBase: Float32Array;
  finK: Float32Array; // per vertex: 0 at the base … 1 at the fin edge
  finCol: Float32Array; // per vertex: position along the fin base
  pecs: THREE.Mesh[];
}

export function buildSeahorse(hue: number): SeahorseModel {
  const root = new THREE.Group();
  const base = C(hue);
  // the spine runs from the neck down through the trunk, then the tail curls forward
  const spine = new THREE.CatmullRomCurve3(
    [
      [0.012, 0.205],
      [-0.006, 0.17],
      [-0.016, 0.12],
      [-0.012, 0.06],
      [-0.004, 0.015],
      [-0.012, -0.035],
      [-0.024, -0.085],
      [-0.022, -0.13],
      [-0.008, -0.165],
      [0.016, -0.182],
      [0.04, -0.178],
      [0.054, -0.16],
      [0.052, -0.14],
      [0.038, -0.13],
      [0.026, -0.138],
      [0.025, -0.152],
      [0.033, -0.158],
    ].map(([x, y]) => new THREE.Vector3(x, y, 0)),
    false,
    'centripetal',
  );
  const prof = [
    // s, depth (belly–back half), half-width, belly bulge
    [0, 0.016, 0.013, 0],
    [0.08, 0.019, 0.015, 0.002],
    [0.17, 0.029, 0.021, 0.01],
    [0.26, 0.035, 0.024, 0.015],
    [0.34, 0.029, 0.021, 0.009],
    [0.42, 0.02, 0.017, 0.003],
    [0.55, 0.0135, 0.0125, 0],
    [0.75, 0.0088, 0.0088, 0],
    [0.92, 0.0052, 0.0052, 0],
    [1, 0.003, 0.003, 0],
  ];
  const pv = [0, 0, 0];
  const rings = (s: number) => (s < 0.42 ? ((s - 0.08) / 0.34) * 11 : 11 + ((s - 0.42) / 0.58) * 34);
  const bodyGeo = loft(spine, 340, 20, (s, a, o) => {
    keys(prof, s, pv);
    const [d, w, bulge] = pv;
    const ca = Math.cos(a),
      sa = Math.sin(a);
    // bony plates: a raised ridge at each ring, ridges along the corners, knobs where they meet
    const tailK = sstep(0.38, 0.48, s);
    const corners = (1 - tailK) * Math.pow(Math.abs(Math.cos(3 * a)), 6) + tailK * Math.pow(Math.abs(Math.sin(2 * a)), 6);
    const rb = Math.pow(Math.abs(Math.cos(Math.PI * rings(s))), 8);
    const k = 1 + 0.07 * rb + 0.13 * corners * (0.5 + rb) + 0.05 * corners;
    o.n = (ca * d + (ca > 0 ? bulge * ca : 0)) * k;
    o.z = sa * w * k;
  });
  paint(bodyGeo, (p, n, c, uv) => {
    const s = uv!.x,
      a = uv!.y * Math.PI * 2;
    const rb = Math.pow(Math.abs(Math.cos(Math.PI * rings(s))), 8);
    const blotch = fbm3(p.x * 70, p.y * 70, p.z * 70, 2);
    c.copy(base).multiplyScalar(0.78 + 0.32 * rb + 0.25 * blotch);
    // pale belly plates, a darker back, fine pale lines along the trunk
    if (Math.cos(a) > 0.6 && s > 0.1 && s < 0.42) c.lerp(C(0xf0e0b0), 0.3);
    if (Math.cos(a) < -0.6) c.multiplyScalar(0.8);
    if (fbm3(p.x * 260, p.y * 260, p.z * 260, 1) > 0.42) c.lerp(C(0xffffff), 0.55);
    void n;
  });
  const bodyMat = visitorMat('seahorse', 0.5);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = true;
  root.add(body);

  // ---- head: cranium with cheek plates, long tubular snout, coronet, eyes
  const hs = new THREE.CatmullRomCurve3(
    [
      [-0.014, 0.214],
      [0.012, 0.226],
      [0.045, 0.221],
      [0.08, 0.208],
      [0.115, 0.197],
      [0.134, 0.192],
    ].map(([x, y]) => new THREE.Vector3(x, y, 0)),
  );
  const hp = [
    // s, half-height, half-width
    [0, 0.014, 0.013],
    [0.08, 0.026, 0.02],
    [0.2, 0.029, 0.022],
    [0.33, 0.021, 0.016],
    [0.44, 0.011, 0.0095],
    [0.58, 0.0082, 0.0082],
    [0.88, 0.0078, 0.0078],
    [0.95, 0.0102, 0.0102],
    [1, 0.0065, 0.0065],
  ];
  const headGeo = loft(
    hs,
    90,
    18,
    (s, a, o) => {
      keys(hp, s, pv);
      const [h, w] = pv;
      const ca = Math.cos(a);
      const cheek = s < 0.36 && ca < 0 ? 1.25 : 1; // the gill cover bulges below
      const ridge = s < 0.4 ? 1 + 0.08 * Math.pow(Math.abs(Math.cos(2 * a)), 8) : 1;
      o.n = ca * h * cheek * ridge;
      o.z = Math.sin(a) * w * ridge;
    },
    [0.4, 0.3],
  );
  paint(headGeo, (p, _n, c, uv) => {
    const s = uv!.x;
    c.copy(base).multiplyScalar(0.85 + 0.25 * fbm3(p.x * 90, p.y * 90, p.z * 90, 2));
    // pale streaks radiating back from the eye, a darker snout tip
    if (s < 0.4 && Math.abs(Math.sin((p.y - 0.21) * 900 + p.x * 300)) < 0.12) c.lerp(C(0xfff0c8), 0.4);
    if (s > 0.94) c.multiplyScalar(0.6);
    if (fbm3(p.x * 260, p.y * 260, p.z * 260, 1) > 0.42) c.lerp(C(0xffffff), 0.5);
  });
  // coronet: a short knobbly crown on top of the head
  const crown: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.0065, 0.009, 0.016, 8).translate(0.006, 0.247, 0)];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    crown.push(new THREE.ConeGeometry(0.0028, 0.008, 5).translate(0.006 + Math.cos(a) * 0.0055, 0.257, Math.sin(a) * 0.0055));
  }
  // small spines: over the eyes, on the cheek and along the back of the neck
  const spines: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) spines.push(new THREE.ConeGeometry(0.0025, 0.009, 5).rotateX(-s * 0.5).translate(0.04, 0.235, s * 0.012));
  for (const [x, y] of [
    [-0.022, 0.18],
    [-0.03, 0.14],
    [-0.03, 0.1],
  ])
    spines.push(new THREE.ConeGeometry(0.003, 0.01, 5).rotateZ(Math.PI / 2 + 0.3).translate(x, y, 0));
  const extras = merge([...crown, ...spines]);
  paint(extras, (_p, _n, c) => c.copy(base).multiplyScalar(0.95));
  const headMesh = new THREE.Mesh(merge([headGeo, extras]), bodyMat);
  headMesh.castShadow = true;
  root.add(headMesh);
  for (const s of [1, -1]) {
    const e = new THREE.Mesh(eyeGeo(0.0075, new THREE.Vector3(0.3, 0.1, s), 0xd8b040, 0.55, hue), visitorMat('seahorse-eye', 0.2));
    e.position.set(0.037, 0.226, s * 0.0185);
    root.add(e);
  }

  // ---- dorsal fin: a fan of rays on the back of the lower trunk (it flutters very fast)
  const s0 = 0.3,
    s1 = 0.44;
  const R = 13,
    K = 5;
  const cols = 2 * R - 1;
  const fp: number[] = [],
    fk: number[] = [],
    fc: number[] = [],
    fi: number[] = [],
    fcol: number[] = [];
  const P = new THREE.Vector3(),
    T = new THREE.Vector3(),
    N = new THREE.Vector3(),
    Z = new THREE.Vector3(0, 0, 1);
  const fin = C(hue).offsetHSL(0, -0.15, 0.2);
  for (let i = 0; i < cols; i++) {
    const f = i / (cols - 1);
    const s = s0 + (s1 - s0) * f;
    spine.getPointAt(s, P);
    spine.getTangentAt(s, T);
    N.crossVectors(Z, T).normalize();
    keys(prof, s, pv);
    const h = 0.03 * Math.pow(Math.sin(Math.PI * f), 0.55) + 0.004;
    for (let k = 0; k <= K; k++) {
      const t = k / K;
      const q = P.clone()
        .addScaledVector(N, -pv[0] * 0.85 - h * t)
        .addScaledVector(T, -h * t * 0.35);
      fp.push(q.x, q.y, 0);
      fk.push(t);
      fc.push(f);
      const ray = i % 2 === 0;
      const col = ray ? fin.clone().multiplyScalar(0.7) : fin.clone();
      fcol.push(col.r, col.g, col.b);
    }
  }
  for (let i = 0; i < cols - 1; i++)
    for (let k = 0; k < K; k++) {
      const a = i * (K + 1) + k,
        b = (i + 1) * (K + 1) + k;
      fi.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const finGeo = new THREE.BufferGeometry();
  finGeo.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
  finGeo.setAttribute('color', new THREE.Float32BufferAttribute(fcol, 3));
  finGeo.setIndex(fi);
  finGeo.computeVertexNormals();
  const finMesh = new THREE.Mesh(finGeo, visitorMat('seahorse-fin', 0.4, { side: THREE.DoubleSide, transparent: true, opacity: 0.72, depthWrite: false }));
  root.add(finMesh);
  // pectoral fins behind the cheeks
  const pecs: THREE.Mesh[] = [];
  for (const s of [1, -1]) {
    const g = new THREE.CircleGeometry(0.011, 10, 0, Math.PI).rotateX(-Math.PI / 2);
    paint(g, (_p, _n, c) => c.copy(fin));
    const m = new THREE.Mesh(g, finMesh.material);
    m.position.set(0.012, 0.205, s * 0.02);
    m.rotation.y = s > 0 ? Math.PI * 0.85 : Math.PI * 0.15;
    root.add(m);
    pecs.push(m);
  }
  return {
    root,
    body,
    fin: finMesh,
    finBase: new Float32Array(fp),
    finK: new Float32Array(fk),
    finCol: new Float32Array(fc),
    pecs,
  };
}

// ============================================================================ moray eel

export interface MorayModel {
  root: THREE.Group;
  body: THREE.Mesh;
  jaw: THREE.Group;
}

export function buildMoray(spotted: boolean): MorayModel {
  const root = new THREE.Group();
  // body rises out of the crevice: the hidden rear bends down into the rock
  const spine = new THREE.CatmullRomCurve3(
    [
      [-0.62, -0.42],
      [-0.5, -0.2],
      [-0.32, -0.07],
      [-0.12, 0.0],
      [0.06, 0.035],
      [0.24, 0.03],
    ].map(([x, y]) => new THREE.Vector3(x, y, 0)),
  );
  const L = spine.getLength();
  const D = (s: number) => (1 - s) * L; // distance from the snout tip
  const HINGE = 0.165;
  const prof = [
    // distance from snout, half-height, half-width
    [0, 0.012, 0.01],
    [0.015, 0.03, 0.022],
    [0.05, 0.05, 0.035],
    [0.11, 0.066, 0.045],
    [0.18, 0.074, 0.05],
    [0.26, 0.07, 0.046],
    [0.4, 0.064, 0.04],
    [L - 0.25, 0.06, 0.038],
    [L, 0.03, 0.02],
  ];
  const pv = [0, 0];
  const at = (s: number) => keys(prof, D(s), pv);
  const mouthN = (h: number) => -0.24 * h;
  const IN_V = 0.95; // texture band for the inside of the mouth
  const bodyGeo = loft(
    spine,
    200,
    40,
    (s, a, o) => {
      const d = D(s);
      at(s);
      const [h, w] = pv;
      const ca = Math.cos(a),
        sa = Math.sin(a);
      let n = ca * h,
        z = sa * w;
      // fleshy dorsal fin from behind the head, a lower anal fin further back
      const dorsal = 0.032 * sstep(0.2, 0.3, d) * sstep(L, L - 0.2, d);
      const anal = 0.018 * sstep(0.45, 0.6, d) * sstep(L, L - 0.2, d);
      n += dorsal * Math.pow(Math.max(0, ca), 14) - anal * Math.pow(Math.max(0, -ca), 14);
      // keep the fin fold thin sideways
      if (Math.abs(ca) > 0.9) z *= 0.6;
      o.v = (a / (Math.PI * 2)) * 0.9;
      // the open mouth: below the gape line the head is cut flat (the palate)
      if (d < HINGE) {
        const m = mouthN(h);
        if (n < m) {
          n = m + 0.001 * ca;
          z *= 0.9;
          o.v = IN_V;
        }
      }
      o.n = n;
      o.z = z;
    },
    [0.5, 0.5],
  );
  // lower jaw: the same outline below the gape line, hinged behind the eye
  const sH = 1 - HINGE / L;
  const jawSpine = new THREE.CatmullRomCurve3(Array.from({ length: 12 }, (_, i) => spine.getPointAt(sH + ((1 - sH - 0.004) * i) / 11)));
  const jawGeo = loft(
    jawSpine,
    40,
    28,
    (s, a, o) => {
      const sb = sH + (1 - sH - 0.004) * s;
      at(sb);
      const [h, w] = pv;
      const ca = Math.cos(a),
        sa = Math.sin(a);
      const m = mouthN(h);
      const tip = 0.006 * sstep(0.7, 1, s); // the lower jaw curves up a little at the tip
      if (ca > 0) {
        o.n = m - 0.002 + 0.0015 * ca + tip;
        o.v = IN_V;
      } else {
        o.n = m + ca * (h + m) * 0.98 + tip;
        o.v = (a / (Math.PI * 2)) * 0.9;
      }
      o.z = sa * w * 0.93;
    },
    [0.4, 0.4],
  );
  // teeth along both jaws
  const upper: THREE.BufferGeometry[] = [],
    lower: THREE.BufferGeometry[] = [];
  const P = new THREE.Vector3();
  for (let i = 0; i < 7; i++) {
    for (const side of [1, -1]) {
      for (const up of [true, false]) {
        const d = 0.018 + i * 0.019 + (up ? 0 : 0.009);
        if (d > HINGE - 0.02) continue;
        const s = 1 - d / L;
        spine.getPointAt(s, P);
        at(s);
        const [h, w] = pv;
        const len = 0.011 + (i < 2 ? 0.004 : 0);
        const g = new THREE.ConeGeometry(0.0032, len, 5);
        if (up) g.rotateX(Math.PI).translate(P.x, P.y + mouthN(h) - len * 0.35, side * w * 0.78);
        else g.translate(P.x, P.y + mouthN(h) + len * 0.3, side * w * 0.74);
        (up ? upper : lower).push(g);
      }
    }
  }
  const teethMat = visitorMat('moray-teeth', 0.3);
  const teeth = (gs: THREE.BufferGeometry[]) => {
    const g = merge(gs);
    paint(g, (_p, _n, c) => c.set(0xf4f0e2));
    return new THREE.Mesh(g, teethMat);
  };
  paint(bodyGeo, (_p, _n, c) => c.setScalar(1));
  paint(jawGeo, (_p, _n, c) => c.setScalar(1));
  // nostrils: two short tubes on the snout
  const nos: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    const s = 1 - 0.012 / L;
    spine.getPointAt(s, P);
    nos.push(new THREE.CylinderGeometry(0.0035, 0.0045, 0.014, 6).rotateZ(-0.9).translate(P.x + 0.004, P.y + 0.012, side * 0.008));
  }
  const nosG = merge(nos);
  paint(nosG, (_p, _n, c) => c.setScalar(0.85));

  const tex = morayTexture(spotted, L);
  const m = visitorMat(spotted ? 'moray-spot' : 'moray-green', 0.42, { map: tex });
  const body = new THREE.Mesh(merge([bodyGeo, nosG]), m);
  body.castShadow = true;
  root.add(body, teeth(upper));
  for (const side of [1, -1]) {
    const s = 1 - 0.058 / L;
    spine.getPointAt(s, P);
    at(s);
    const e = new THREE.Mesh(eyeGeo(0.0105, new THREE.Vector3(0.4, 0.2, side), spotted ? 0xd8c050 : 0xc8d050, 0.6, spotted ? 0x8a7a50 : 0x3a4a18), visitorMat('moray-eye', 0.15));
    e.position.set(P.x, P.y + pv[0] * 0.5, side * pv[1] * 0.74);
    root.add(e);
  }
  // the jaw pivots at the corner of the mouth
  const pivot = spine.getPointAt(sH);
  at(sH);
  const jaw = new THREE.Group();
  jaw.position.set(pivot.x, pivot.y + mouthN(pv[0]), 0);
  jawGeo.translate(-jaw.position.x, -jaw.position.y, 0);
  // the jaw's own loft runs 0..1; map it onto the head's stretch of the body texture
  const juv = jawGeo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < juv.count; i++) juv.setX(i, sH + (1 - sH - 0.004) * juv.getX(i));
  const jawMesh = new THREE.Mesh(jawGeo, m);
  jawMesh.castShadow = true;
  const lowTeeth = teeth(lower);
  lowTeeth.position.set(-jaw.position.x, -jaw.position.y, 0);
  jaw.add(jawMesh, lowTeeth);
  root.add(jaw);
  return { root, body, jaw };
}

/** u = along the body (0 tail … 1 snout), v = around (0 top, 0.45 belly, 0.9 top); v > 0.9 is the mouth. */
function morayTexture(spotted: boolean, L: number) {
  const inside = C(0x6a2a2c);
  const cream = C(0xe6d8a2),
    back = C(0xc4b070),
    spot = C(0x3a2216);
  const gTop = C(0x4c6e1c),
    gSide = C(0x7e9632),
    gBelly = C(0xa2b44c);
  return canvasTex(768, 192, (u, v, out) => {
    if (v > 0.91) {
      out.copy(inside);
      return;
    }
    const vv = Math.min(1, v / 0.9);
    const down = 0.5 - 0.5 * Math.cos(vv * Math.PI * 2); // 0 top … 1 belly
    const d = (1 - u) * L; // distance from the snout
    if (spotted) {
      out.copy(back).lerp(cream, Math.min(1, down * 1.6));
      // dense irregular spots, smaller on the head
      const den = d < 0.25 ? 1.7 : 1;
      const c = cells(u * 40 * den, vv * 15 * den, Math.ceil(40 * den) + 2, Math.round(15 * den), 4, 0.9);
      const wob = (Math.sin(u * 410 + vv * 37) * Math.sin(vv * 130 - u * 90) + 0.5 * Math.sin(u * 870 + vv * 260)) * 0.09;
      const r = 0.26 + 0.18 * c.id - down * 0.12;
      if (c.d1 + wob < r) out.copy(spot).lerp(C(0x5a3a24), c.id * 0.5);
    } else {
      out.copy(gTop).lerp(gSide, Math.min(1, down * 2)).lerp(gBelly, Math.max(0, down * 2 - 1));
      const c = cells(u * 30, vv * 9, 32, 9, 6, 1);
      out.multiplyScalar(0.86 + 0.14 * c.id + 0.12 * Math.sin(u * 300 + vv * 50) * Math.sin(vv * 70 - u * 120));
    }
    // fin edges a shade darker
    if (vv < 0.03 || vv > 0.97) out.multiplyScalar(0.72);
  });
}
