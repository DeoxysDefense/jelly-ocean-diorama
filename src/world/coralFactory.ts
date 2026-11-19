import * as THREE from 'three';
import { Rng } from '../util/math';
import { fbm3 } from '../util/noise';
import { lathe, leafGeometry, merge, paint, rockGeometry, taperedTube } from '../util/geometry';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Procedural reef asset builders. Each returns a BufferGeometry with vertex colours whose
 * origin sits on the ground (y = 0). They are designed as stand-ins that read clearly as the
 * intended species; replace with authored GLB assets via the Reef asset hooks if desired.
 */

const C = (hex: number) => new THREE.Color(hex);

/** Staghorn-style branching coral. */
export function branchingCoral(seed: number, base: number, tip: number, size = 1): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const geos: THREE.BufferGeometry[] = [];
  const cBase = C(base),
    cTip = C(tip);
  let maxY = 0.01;
  const segs: { a: THREE.Vector3; b: THREE.Vector3; r0: number; r1: number; tipEnd: boolean }[] = [];
  const grow = (start: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, depth: number) => {
    const bend = new THREE.Vector3(rng.range(-0.25, 0.25), rng.range(0, 0.2), rng.range(-0.25, 0.25));
    const d = dir.clone().add(bend).normalize();
    const end = start.clone().addScaledVector(d, len);
    const tipEnd = depth === 0;
    segs.push({ a: start, b: end, r0: r, r1: tipEnd ? r * 0.7 : r * 0.78, tipEnd });
    maxY = Math.max(maxY, end.y);
    if (depth === 0) return;
    const kids = depth > 2 ? 2 : rng.int(1, 3);
    for (let k = 0; k < kids; k++) {
      const spread = rng.range(0.35, 0.75);
      const az = rng.range(0, Math.PI * 2);
      const nd = d
        .clone()
        .add(new THREE.Vector3(Math.cos(az) * spread, 0.25, Math.sin(az) * spread))
        .normalize();
      grow(end, nd, len * rng.range(0.68, 0.85), r * 0.78, depth - 1);
    }
  };
  const trunks = 3;
  for (let t = 0; t < trunks; t++) {
    const az = (t / trunks) * Math.PI * 2 + rng.range(0, 1);
    const dir = new THREE.Vector3(Math.cos(az) * 0.45, 1, Math.sin(az) * 0.45).normalize();
    grow(new THREE.Vector3(Math.cos(az) * 0.05, -0.05, Math.sin(az) * 0.05), dir, 0.32 * size, 0.07 * size, 4);
  }
  for (const s of segs) {
    const mid = s.a.clone().lerp(s.b, 0.5).add(new THREE.Vector3(rng.range(-0.02, 0.02), 0, rng.range(-0.02, 0.02)));
    const curve = new THREE.QuadraticBezierCurve3(s.a, mid, s.b);
    const g = taperedTube(curve, 3, 7, (t) => s.r0 + (s.r1 - s.r0) * t, 1, true);
    geos.push(g);
  }
  const g = merge(geos);
  paint(g, (p, n, c) => {
    const t = Math.min(1, Math.max(0, p.y / maxY));
    c.copy(cBase).lerp(cTip, Math.pow(t, 1.4));
    const pol = fbm3(p.x * 30, p.y * 30, p.z * 30, 2);
    c.multiplyScalar((0.9 + pol * 0.4) * (0.55 + 0.45 * Math.min(1, t * 1.6)));
    if (t > 0.82) c.lerp(new THREE.Color(1, 0.97, 0.92), (t - 0.82) * 1.6);
  });
  return g;
}

/** Brain coral dome with meandering grooves. */
export function brainCoral(seed: number, ridgeHex: number, grooveHex: number, size = 1) {
  const ico = new THREE.IcosahedronGeometry(0.5 * size, 4);
  ico.deleteAttribute('normal');
  ico.deleteAttribute('uv');
  const g = mergeVertices(ico);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const ridgeVals = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const m = fbm3(v.x * 2.2 + seed, v.y * 2.2, v.z * 2.2 - seed, 3);
    const ridge = Math.abs(Math.sin(m * 26));
    ridgeVals[i] = ridge;
    const r = 0.5 * size * (1 + 0.045 * ridge + 0.08 * fbm3(v.x * 1.5, v.y * 1.5 + seed, v.z * 1.5, 2));
    let y = v.y * r * 0.72;
    if (y < -0.05 * size) y = -0.05 * size;
    pos.setXYZ(i, v.x * r, y + 0.05 * size, v.z * r);
  }
  g.computeVertexNormals();
  const gr = C(grooveHex),
    rd = C(ridgeHex);
  const ng = g.toNonIndexed();
  const col = new Float32Array(ng.attributes.position.count * 3);
  // recompute ridge per vertex on non-indexed copy
  const p2 = ng.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p2.count; i++) {
    v.fromBufferAttribute(p2, i).normalize();
    const m = fbm3(v.x * 2.2 + seed, v.y * 2.2, v.z * 2.2 - seed, 3);
    const ridge = Math.abs(Math.sin(m * 26));
    const c = gr.clone().lerp(rd, Math.pow(ridge, 0.6)).multiplyScalar(0.7 + 0.3 * Math.min(1, (v.y + 0.3) * 1.5));
    col.set([c.r, c.g, c.b], i * 3);
  }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return ng;
}

/** Gorgonian sea fan: flat branching lattice in the xy plane. */
export function fanCoral(seed: number, hex: number, size = 1) {
  const rng = new Rng(seed);
  const geos: THREE.BufferGeometry[] = [];
  const grow = (a: THREE.Vector2, ang: number, len: number, r: number, depth: number) => {
    const b = new THREE.Vector2(a.x + Math.sin(ang) * len, a.y + Math.cos(ang) * len);
    const curve = new THREE.LineCurve3(new THREE.Vector3(a.x, a.y, rng.range(-0.01, 0.01)), new THREE.Vector3(b.x, b.y, rng.range(-0.015, 0.015)));
    geos.push(taperedTube(curve, 1, 4, (t) => r * (1 - 0.2 * t), 1, depth === 0));
    if (depth === 0) return;
    const n = depth > 3 ? 2 : rng.int(1, 2);
    for (let i = 0; i < n; i++) grow(b, ang + rng.range(-0.55, 0.55) + (i === 0 ? -0.2 : 0.2), len * rng.range(0.75, 0.92), r * 0.8, depth - 1);
  };
  const base = new THREE.Vector2(0, 0);
  for (let i = 0; i < 5; i++) grow(base, -1.0 + i * 0.5 + rng.range(-0.1, 0.1), 0.2 * size, 0.03 * size, 6);
  const g = merge(geos);
  const c0 = C(hex),
    c1 = C(hex).offsetHSL(0.02, 0.05, 0.12);
  paint(g, (p, _n, c) => c.copy(c0).lerp(c1, Math.min(1, p.y / size)));
  return g;
}

/** Cluster of open tube sponges with darker interiors. */
export function tubeSponges(seed: number, hex: number, size = 1) {
  const rng = new Rng(seed);
  const geos: THREE.BufferGeometry[] = [];
  const n = rng.int(6, 8);
  for (let i = 0; i < n; i++) {
    const h = rng.range(0.3, 0.9) * size;
    const r = rng.range(0.07, 0.11) * size;
    const prof: [number, number][] = [
      [0.001, 0],
      [r * 0.8, 0],
      [r * 0.9, h * 0.3],
      [r, h * 0.8],
      [r * 1.12, h],
      [r * 0.95, h * 1.01],
      [r * 0.72, h * 0.95],
      [r * 0.65, h * 0.4],
    ];
    const g = lathe(prof, 16, (a, t) => 1 + 0.05 * Math.sin(a * 5 + i) * t);
    const tiltA = rng.range(0, Math.PI * 2);
    g.rotateX(Math.sin(tiltA) * 0.25);
    g.rotateZ(Math.cos(tiltA) * 0.25);
    g.translate(rng.range(-0.15, 0.15) * size, 0, rng.range(-0.12, 0.12) * size);
    geos.push(g);
  }
  const g = merge(geos);
  const outer = C(hex),
    inner = C(hex).multiplyScalar(0.35);
  paint(g, (p, n, c) => {
    // inward-facing normals belong to the interior
    const radial = new THREE.Vector2(p.x, p.z);
    const nr = new THREE.Vector2(n.x, n.z);
    const inside = radial.length() > 0 && nr.dot(radial) < -0.001 * radial.length();
    c.copy(inside ? inner : outer).multiplyScalar(0.88 + 0.2 * fbm3(p.x * 25, p.y * 25, p.z * 25, 2));
  });
  return g;
}

/** Plate / lettuce coral: stacked ruffled plates on a short stalk. */
export function tableCoral(seed: number, hex: number, size = 1) {
  const rng = new Rng(seed);
  const geos: THREE.BufferGeometry[] = [];
  geos.push(lathe([[0.001, 0], [0.12 * size, 0], [0.08 * size, 0.2 * size], [0.06 * size, 0.32 * size], [0.001, 0.34 * size]], 12));
  for (let k = 0; k < 3; k++) {
    const R = (0.62 - k * 0.15) * size;
    const y = (0.3 + k * 0.1) * size;
    const ph = rng.range(0, 6);
    const plate = lathe(
      [
        [0.001, y + 0.03 * size],
        [R * 0.5, y + 0.04 * size],
        [R, y + 0.07 * size],
        [R * 1.02, y + 0.05 * size],
        [R * 0.5, y + 0.0],
        [0.001, y - 0.01 * size],
      ],
      40,
      (a) => 1 + 0.09 * Math.sin(a * 9 + ph) + 0.04 * Math.sin(a * 17),
    );
    plate.translate(rng.range(-0.08, 0.08) * size, 0, rng.range(-0.06, 0.06) * size);
    geos.push(plate);
  }
  const g = merge(geos);
  const c0 = C(hex),
    c1 = C(hex).offsetHSL(-0.02, 0.1, 0.15);
  paint(g, (p, n, c) => {
    const r = Math.hypot(p.x, p.z) / (0.6 * size);
    c.copy(c0).lerp(c1, Math.min(1, r)).multiplyScalar(n.y > 0 ? 1 : 0.7);
  });
  return g;
}

/** Finger leather / soft coral: thick lobes with polyp speckles. */
export function softCoral(seed: number, hex: number, size = 1) {
  const rng = new Rng(seed);
  const geos: THREE.BufferGeometry[] = [];
  geos.push(lathe([[0.001, 0], [0.16 * size, 0], [0.13 * size, 0.18 * size], [0.15 * size, 0.28 * size], [0.001, 0.3 * size]], 14));
  const n = 9;
  for (let i = 0; i < n; i++) {
    const az = (i / n) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const out = rng.range(0.15, 0.32) * size;
    const h = rng.range(0.45, 0.75) * size;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(Math.cos(az) * 0.05 * size, 0.2 * size, Math.sin(az) * 0.05 * size),
      new THREE.Vector3(Math.cos(az) * out * 0.6, h * 0.65, Math.sin(az) * out * 0.6),
      new THREE.Vector3(Math.cos(az) * out, h, Math.sin(az) * out),
    ]);
    geos.push(taperedTube(curve, 6, 8, (t) => (0.065 - 0.02 * t) * size, 1, true));
  }
  const g = merge(geos);
  const c0 = C(hex);
  paint(g, (p, _n, c) => {
    const dots = fbm3(p.x * 60, p.y * 60, p.z * 60, 1) > 0.18 ? 1.18 : 1;
    c.copy(c0).multiplyScalar(dots * (0.85 + 0.25 * (p.y / size)));
  });
  return g;
}

/** Sea anemone: ruffled column and many tapering tentacles. */
export function anemone(seed: number, columnHex: number, tentHex: number, tipHex: number, size = 1) {
  const rng = new Rng(seed);
  const geos: THREE.BufferGeometry[] = [];
  geos.push(
    lathe(
      [
        [0.001, 0],
        [0.22 * size, 0],
        [0.19 * size, 0.1 * size],
        [0.21 * size, 0.18 * size],
        [0.25 * size, 0.22 * size],
        [0.001, 0.24 * size],
      ],
      24,
      (a, t) => 1 + 0.06 * Math.sin(a * 11) * t,
    ),
  );
  const n = 96;
  for (let i = 0; i < n; i++) {
    const ring = i % 4;
    const az = (i / n) * Math.PI * 2 * 4 + rng.range(-0.1, 0.1);
    const r0 = (0.05 + ring * 0.055) * size;
    const L = rng.range(0.3, 0.5) * size * (1 - ring * 0.08);
    const outward = 0.3 + ring * 0.28;
    const p0 = new THREE.Vector3(Math.cos(az) * r0, 0.22 * size, Math.sin(az) * r0);
    const p1 = p0.clone().add(new THREE.Vector3(Math.cos(az) * L * outward * 0.5, L * 0.6, Math.sin(az) * L * outward * 0.5));
    const p2 = p0.clone().add(new THREE.Vector3(Math.cos(az) * L * outward, L * 0.9, Math.sin(az) * L * outward));
    geos.push(taperedTube(new THREE.CatmullRomCurve3([p0, p1, p2]), 5, 5, (t) => (0.022 - 0.01 * t) * size, 1, true));
  }
  const g = merge(geos);
  const col = C(columnHex),
    tent = C(tentHex),
    tip = C(tipHex);
  paint(g, (p, _n, c) => {
    if (p.y < 0.215 * size && Math.hypot(p.x, p.z) > 0.15 * size) c.copy(col).multiplyScalar(0.7 + p.y * 2);
    else c.copy(tent).lerp(tip, Math.min(1, Math.max(0, (p.y - 0.26 * size) / (0.36 * size))));
  });
  return g;
}

/** Seabed rock with algae on top and pink coralline spots. */
export function reefRock(seed: number, radius: number, flatten = 0.65) {
  const g = rockGeometry(radius, 3, seed, flatten, 0.32).toNonIndexed();
  const base = C(0x8c857c),
    dark = C(0x5f5a55),
    algae = C(0x6f8a4a),
    pink = C(0xc98a9a);
  paint(g, (p, n, c) => {
    const k = fbm3(p.x * 2.5 + seed, p.y * 2.5, p.z * 2.5, 3);
    c.copy(base).lerp(dark, Math.max(0, -k * 2));
    if (n.y > 0.55) c.lerp(algae, Math.min(1, (n.y - 0.55) * 2) * 0.65);
    if (fbm3(p.x * 6, p.y * 6 + seed, p.z * 6, 2) > 0.22) c.lerp(pink, 0.55);
    c.multiplyScalar((0.85 + 0.3 * fbm3(p.x * 20, p.y * 20, p.z * 20, 1)) * (0.5 + 0.5 * Math.min(1, Math.max(0, n.y * 0.6 + 0.6))));
  });
  return g;
}

/** Scallop shell: ribbed fan. */
export function scallop(hex: number, size = 1) {
  const pos: number[] = [],
    idx: number[] = [];
  const R = 12,
    A = 24;
  for (let i = 0; i <= R; i++) {
    const r = (i / R) * 0.22 * size;
    for (let j = 0; j <= A; j++) {
      const a = -1.2 + (j / A) * 2.4;
      const rib = 0.008 * size * Math.abs(Math.sin(j * Math.PI * 0.5)) * (i / R);
      const dome = 0.06 * size * Math.sin((i / R) * Math.PI * 0.85) + rib;
      pos.push(Math.sin(a) * r, dome, -Math.cos(a) * r + 0.1 * size);
    }
  }
  for (let i = 0; i < R; i++)
    for (let j = 0; j < A; j++) {
      const a = i * (A + 1) + j,
        b = a + A + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const c0 = C(hex),
    c1 = C(hex).offsetHSL(0, -0.1, 0.2);
  const ng = g.toNonIndexed();
  paint(ng, (p, _n, c) => c.copy(c0).lerp(c1, Math.abs(Math.sin(Math.atan2(p.x, p.z - 0.1 * size) * 12))));
  // hinge ears
  const ear = new THREE.BoxGeometry(0.1 * size, 0.02 * size, 0.04 * size);
  ear.translate(0, 0.01 * size, 0.1 * size);
  return merge([ng, paint(ear.toNonIndexed(), (_p, _n, c) => c.copy(c0))]);
}

/**
 * Spiral gastropod shell (Raup's coiling model): a generating ellipse grows exponentially while
 * it winds around a vertical axis and slides down it. The expansion, offset from the axis and
 * descent are chosen so each whorl overlaps the previous one — the coil is closed (a solid spire
 * with a suture line), not an open spring. The last whorl ends in a flared aperture with a pale
 * inner lining, so a hermit crab can sit in it.
 */
export function conch(hex: number, size = 1) {
  const turns = 4.3;
  const W = 1.95; // whorl expansion per turn
  const k = Math.log(W) / (Math.PI * 2);
  const TH = turns * Math.PI * 2;
  const aEnd = 0.072 * size; // aperture radius
  const ratio = 1.02; // distance of the tube centre from the axis / tube radius (≈ no umbilicus)
  const T = 1.25; // descent along the axis per unit of radial growth (spire height)
  const NU = 240,
    NV = 22;
  const rEnd = aEnd * ratio;
  const spire = (i: number) => {
    const t = i / NU;
    const s = Math.exp(k * (t * TH - TH));
    // a slight flare of the outer lip over the last few percent
    const lip = 1 + 0.28 * Math.pow(Math.max(0, (t - 0.93) / 0.07), 2);
    return { t, th: t * TH, a: aEnd * s * lip, R: rEnd * s, y: T * (rEnd - rEnd * s) };
  };
  const build = (inner: boolean, from: number) => {
    const pos: number[] = [],
      uvs: number[] = [],
      idx: number[] = [];
    let rows = 0;
    for (let i = from; i <= NU; i++, rows++) {
      const { t, th, a, R, y } = spire(i);
      const cx = Math.cos(th),
        cz = Math.sin(th);
      for (let j = 0; j <= NV; j++) {
        const ph = (j / NV) * Math.PI * 2;
        // shoulder: a soft keel with small knobs on the upper outer side of each whorl
        const sh = Math.pow(Math.max(0, Math.sin(ph + 0.6)), 6);
        const knob = inner ? 0 : 0.07 * sh * (0.55 + 0.45 * Math.sin(th * 4.5)) * Math.min(1, t * 3);
        const rr = a * (inner ? 0.86 : 1 + knob);
        const out = Math.cos(ph) * rr,
          up = Math.sin(ph) * rr * 1.12;
        pos.push(cx * (R + out), y + up + rEnd * 0.2, cz * (R + out));
        uvs.push(t, j / NV);
      }
    }
    for (let i = 0; i < rows - 1; i++)
      for (let j = 0; j < NV; j++) {
        const a = i * (NV + 1) + j,
          b = a + NV + 1;
        // outer skin faces out; the aperture lining faces in
        if (inner) idx.push(a, b, a + 1, a + 1, b, b + 1);
        else idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // weld the wrap-around seam (first / last ring vertex share a position): average normals
    const nrm = g.attributes.normal as THREE.BufferAttribute;
    const na = new THREE.Vector3(),
      nb = new THREE.Vector3();
    for (let i = 0; i < rows; i++) {
      const a0 = i * (NV + 1),
        b0 = a0 + NV;
      na.fromBufferAttribute(nrm, a0).add(nb.fromBufferAttribute(nrm, b0)).normalize();
      nrm.setXYZ(a0, na.x, na.y, na.z);
      nrm.setXYZ(b0, na.x, na.y, na.z);
    }
    return g;
  };
  const c0 = C(hex),
    cBand = C(hex).offsetHSL(0, 0.05, -0.18),
    cPale = C(0xfff1e0),
    cNacre = C(0xf6d9d0);
  const outer = build(false, 0).toNonIndexed();
  paint(outer, (_p, _n, c, uv) => {
    const t = uv ? uv.x : 0.5,
      v = uv ? uv.y : 0.5;
    const th = t * TH;
    c.copy(c0)
      .lerp(cPale, 0.3 + 0.3 * Math.sin(v * Math.PI * 2 * 3)) // spiral bands
      .lerp(cBand, 0.6 * Math.pow(0.5 + 0.5 * Math.sin(th * 7.0 + v * 2.0), 4)) // growth flames
      .multiplyScalar(0.85 + 0.15 * t);
  });
  // lining of the last whorl (visible through the aperture), fading into shadow further in
  const from = Math.floor(NU * 0.8);
  const t0 = from / NU;
  const cDeep = C(0x3a2a24);
  const inner = build(true, from).toNonIndexed();
  paint(inner, (_p, _n, c, uv) => {
    const d = 1 - ((uv ? uv.x : 1) - t0) / (1 - t0);
    c.copy(cNacre).lerp(cDeep, Math.min(1, Math.pow(d, 0.6)));
  });
  // the lip: a band joining the outer skin to the lining at the aperture edge
  const lipPos: number[] = [],
    lipIdx: number[] = [];
  {
    const { th, a, R, y } = spire(NU);
    const cx = Math.cos(th),
      cz = Math.sin(th);
    for (let j = 0; j <= NV; j++) {
      const ph = (j / NV) * Math.PI * 2;
      for (const rr of [a, a * 0.86]) {
        const out = Math.cos(ph) * rr,
          up = Math.sin(ph) * rr * 1.12;
        lipPos.push(cx * (R + out), y + up + rEnd * 0.2, cz * (R + out));
      }
    }
    for (let j = 0; j < NV; j++) {
      const o0 = j * 2,
        i0 = o0 + 1,
        o1 = o0 + 2,
        i1 = o0 + 3;
      lipIdx.push(o0, i0, o1, o1, i0, i1);
    }
  }
  const lipG = new THREE.BufferGeometry();
  lipG.setAttribute('position', new THREE.Float32BufferAttribute(lipPos, 3));
  lipG.setIndex(lipIdx);
  lipG.computeVertexNormals();
  const lip = paint(lipG.toNonIndexed(), (_p, _n, c) => c.copy(cPale));
  outer.deleteAttribute('uv');
  inner.deleteAttribute('uv');
  const g = merge([outer, inner, lip]);
  // aperture frame (for the hermit crab): centre, opening direction, and the apex direction
  const e = spire(NU);
  const ec = new THREE.Vector3(Math.cos(e.th) * e.R, e.y + rEnd * 0.2, Math.sin(e.th) * e.R);
  const dR = k * e.R;
  const en = new THREE.Vector3(dR * Math.cos(e.th) - e.R * Math.sin(e.th), -T * dR, dR * Math.sin(e.th) + e.R * Math.cos(e.th)).normalize();
  const ax = new THREE.Vector3(0, 1, 0);
  // same placement as before: lying on its side
  const M = new THREE.Matrix4().makeRotationZ(Math.PI / 2.3).setPosition(0, 0.08 * size, 0);
  g.applyMatrix4(M);
  const rot = new THREE.Matrix3().setFromMatrix4(M);
  g.userData.aperture = { c: ec.applyMatrix4(M), n: en.applyMatrix3(rot).normalize(), axis: ax.applyMatrix3(rot).normalize() };
  return g;
}

/** Five-armed starfish with knobbly surface. */
export function starfish(hex: number, size = 1) {
  const geos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const L = 0.24 * size;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.03 * size, 0),
      new THREE.Vector3(Math.cos(a) * L * 0.5, 0.035 * size, Math.sin(a) * L * 0.5),
      new THREE.Vector3(Math.cos(a + 0.15) * L, 0.02 * size, Math.sin(a + 0.15) * L),
    ]);
    const g = taperedTube(curve, 8, 8, (t) => (0.055 - 0.04 * t) * size, 1, true);
    g.scale(1, 0.55, 1);
    geos.push(g);
  }
  geos.push(new THREE.SphereGeometry(0.07 * size, 12, 8).scale(1, 0.45, 1).translate(0, 0.02 * size, 0));
  const g = merge(geos);
  const c0 = C(hex);
  paint(g, (p, n, c) => {
    const bump = fbm3(p.x * 80, p.y * 80, p.z * 80, 1) > 0.15 ? 1.25 : 1;
    c.copy(c0).multiplyScalar(bump * (n.y > 0 ? 1 : 0.6));
  });
  return g;
}

/** A single seagrass blade standing along +y (ribbon). */
export function seagrassBlade(height = 1) {
  const g = leafGeometry({ length: height, width: 0.075, segs: 10, fold: 0.06, curl: 0.06, shape: (t) => (1 - t * 0.55) * Math.min(1, 0.4 + t * 6) });
  g.rotateZ(Math.PI / 2);
  const base = new THREE.Color(0x4a5a2a),
    mid = new THREE.Color(0x6f9a3a),
    tip = new THREE.Color(0xc0c870);
  const p = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const t = Math.min(1, Math.max(0, p.getY(i) / height));
    const c = t < 0.5 ? base.clone().lerp(mid, t * 2) : mid.clone().lerp(tip, (t - 0.5) * 2);
    if (t > 0.55 && Math.sin(i * 12.9898) > 0.6) c.lerp(new THREE.Color(0x9a8a5a), 0.35);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// ============================================================ V2 (P1b) — more reef species

/** Grid surface helper: fn(u, v) with u, v in [0, 1] → point. Returns a non-indexed geometry. */
function surface(nu: number, nv: number, fn: (u: number, v: number) => THREE.Vector3) {
  const pos: number[] = [],
    idx: number[] = [];
  for (let i = 0; i <= nu; i++)
    for (let j = 0; j <= nv; j++) {
      const p = fn(i / nu, j / nv);
      pos.push(p.x, p.y, p.z);
    }
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      const a = i * (nv + 1) + j,
        b = a + nv + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

/** Pillar coral: a cluster of upright, fuzzy columns with rounded tops. */
export function pillarCoral(seed: number, hex: number, size = 1) {
  const rng = new Rng(seed);
  const geos: THREE.BufferGeometry[] = [];
  const n = rng.int(5, 8);
  let maxY = 0.01;
  for (let i = 0; i < n; i++) {
    const h = rng.range(0.45, 1.05) * size;
    const r = rng.range(0.06, 0.1) * size;
    maxY = Math.max(maxY, h + r);
    const prof: [number, number][] = [
      [0.001, 0],
      [r * 1.15, 0],
    ];
    for (let k = 1; k <= 6; k++) prof.push([r * (1 - 0.06 * (k / 6)), (h * k) / 6]);
    for (let k = 1; k <= 4; k++) {
      const a = (k / 4) * Math.PI * 0.5;
      prof.push([Math.max(0.001, r * Math.cos(a)), h + r * 0.8 * Math.sin(a)]);
    }
    const ph = rng.range(0, 6);
    const g = lathe(prof, 14, (a, t) => 1 + 0.08 * Math.sin(a * 7 + ph + t * 9));
    const az = rng.range(0, Math.PI * 2),
      d = i === 0 ? 0 : rng.range(0.1, 0.3) * size;
    g.rotateZ(rng.range(-0.08, 0.08));
    g.translate(Math.cos(az) * d, 0, Math.sin(az) * d);
    geos.push(g);
  }
  const g = merge(geos);
  const c0 = C(hex),
    c1 = C(hex).offsetHSL(0.02, -0.05, 0.16);
  paint(g, (p, _n, c) => {
    const t = Math.min(1, p.y / maxY);
    const fuzz = fbm3(p.x * 70, p.y * 70, p.z * 70, 1);
    c.copy(c0).lerp(c1, t).multiplyScalar((0.82 + 0.35 * fuzz) * (0.6 + 0.4 * Math.min(1, t * 3)));
  });
  return g;
}

/** Mushroom coral: a free-living oval disc with fine radial septa. */
export function mushroomCoral(seed: number, hex: number, size = 1) {
  const rng = new Rng(seed);
  const R = 0.2 * size * rng.range(0.85, 1.15);
  const ridges = 34 + rng.int(0, 10);
  const g = surface(10, 120, (u, v) => {
    const a = v * Math.PI * 2;
    const r = Math.max(0.0005, u * R);
    const dome = 0.06 * size * (1 - u * u) + 0.008 * size;
    const septa = 0.012 * size * Math.pow(Math.abs(Math.cos(a * ridges * 0.5)), 3) * Math.min(1, u * 3) * (1 - u * 0.3);
    return new THREE.Vector3(Math.cos(a) * r, dome + septa, Math.sin(a) * r * 0.72);
  });
  const c0 = C(hex),
    c1 = C(hex).offsetHSL(0.03, 0.1, 0.18);
  paint(g, (p, _n, c) => {
    const u = Math.hypot(p.x, p.z / 0.72) / R;
    c.copy(c0)
      .lerp(c1, Math.min(1, (p.y / (0.07 * size)) * 0.8))
      .multiplyScalar(0.75 + 0.35 * (1 - u * 0.5));
    if (u < 0.12) c.multiplyScalar(0.55); // the mouth slit
  });
  return g;
}

/** Giant barrel sponge: a lumpy, deeply ridged vase with a wavy rim and a dark open interior. */
export function barrelSponge(seed: number, hex: number, size = 1) {
  const rng = new Rng(seed);
  const h = rng.range(0.5, 0.75) * size;
  const r0 = 0.22 * size,
    r1 = 0.4 * size;
  const prof: [number, number][] = [
    [0.001, 0],
    [r0 * 1.1, 0],
    [r0 * 1.25, h * 0.2],
    [r1 * 0.9, h * 0.65],
    [r1, h * 0.95],
    [r1 * 0.9, h * 1.02],
    [r1 * 0.72, h * 0.85],
    [r0 * 0.85, h * 0.25],
    [0.001, h * 0.2],
  ];
  const ph = rng.range(0, 6);
  const g = lathe(prof, 64, (a, t) => 1 + 0.16 * Math.pow(Math.abs(Math.sin(a * 5 + ph)), 0.5) * Math.min(1, t * 2.5) + 0.05 * Math.sin(a * 11 + t * 6));
  // lumpy, irregular body and a wavy rim
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k),
      y = pos.getY(k),
      z = pos.getZ(k);
    const n = fbm3(x * 6 + seed, y * 6, z * 6, 3);
    const k2 = 1 + 0.12 * n;
    const lean = (y / h) * 0.08 * size;
    pos.setXYZ(k, x * k2 + lean, y + (y > h * 0.9 ? 0.06 * size * Math.sin(Math.atan2(z, x) * 4 + ph) : 0), z * k2);
  }
  g.computeVertexNormals();
  const outer = C(hex),
    dark = C(hex).multiplyScalar(0.55),
    inner = C(hex).multiplyScalar(0.25);
  const ng = g.toNonIndexed();
  ng.computeVertexNormals();
  paint(ng, (p, n, c) => {
    const radial = new THREE.Vector2(p.x, p.z);
    const inside = radial.length() > 0 && new THREE.Vector2(n.x, n.z).dot(radial) < -0.001 * radial.length();
    if (inside) {
      c.copy(inner);
      return;
    }
    const mott = fbm3(p.x * 9 + seed, p.y * 9, p.z * 9, 3);
    const pores = fbm3(p.x * 45, p.y * 45, p.z * 45, 1) > 0.3 ? 0.7 : 1;
    c.copy(outer).lerp(dark, Math.min(1, Math.max(0, 0.5 - mott))).multiplyScalar(pores * (0.75 + 0.35 * (p.y / h)));
  });
  return ng;
}

/** Sea whips: a tuft of thin, tall, gently curving gorgonian rods. */
export function seaWhips(seed: number, hex: number, size = 1) {
  const rng = new Rng(seed);
  const geos: THREE.BufferGeometry[] = [];
  const n = rng.int(6, 10);
  let maxY = 0.01;
  for (let i = 0; i < n; i++) {
    const az = rng.range(0, Math.PI * 2);
    const lean = rng.range(0.05, 0.35);
    const h = rng.range(0.7, 1.45) * size;
    maxY = Math.max(maxY, h);
    const base = new THREE.Vector3(Math.cos(az) * 0.03 * size, 0, Math.sin(az) * 0.03 * size);
    const curve = new THREE.CatmullRomCurve3([
      base,
      base.clone().add(new THREE.Vector3(Math.cos(az) * lean * 0.3 * h, h * 0.4, Math.sin(az) * lean * 0.3 * h)),
      base.clone().add(new THREE.Vector3(Math.cos(az + 0.3) * lean * 0.8 * h, h * 0.75, Math.sin(az + 0.3) * lean * 0.8 * h)),
      base.clone().add(new THREE.Vector3(Math.cos(az + 0.5) * lean * h, h, Math.sin(az + 0.5) * lean * h)),
    ]);
    geos.push(taperedTube(curve, 12, 5, (t) => (0.022 - 0.012 * t) * size, 1, true));
  }
  const g = merge(geos);
  const c0 = C(hex).multiplyScalar(0.7),
    c1 = C(hex).offsetHSL(0.02, 0.05, 0.12);
  paint(g, (p, _n, c) => c.copy(c0).lerp(c1, Math.min(1, p.y / maxY)));
  return g;
}

/** Long-spined sea urchin. */
export function seaUrchin(seed: number, hex: number, size = 1) {
  const rng = new Rng(seed);
  const geos: THREE.BufferGeometry[] = [];
  const R = 0.07 * size;
  geos.push(new THREE.SphereGeometry(R, 14, 10).scale(1, 0.75, 1).translate(0, R * 0.6, 0));
  const N = 70;
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < N; i++) {
    // fibonacci directions over the upper ~3/4 of the sphere
    const y = 1 - (i / (N - 1)) * 1.45;
    const rr = Math.sqrt(Math.max(0, 1 - y * y));
    const a = i * 2.39996;
    const dir = new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr).normalize();
    const L = rng.range(0.14, 0.24) * size;
    const p0 = dir.clone().multiplyScalar(R * 0.9).add(new THREE.Vector3(0, R * 0.6, 0));
    const spine = new THREE.ConeGeometry(0.006 * size, L, 4, 1);
    spine.translate(0, L / 2, 0);
    spine.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));
    spine.translate(p0.x, p0.y, p0.z);
    geos.push(spine);
  }
  const g = merge(geos);
  const c0 = C(hex);
  paint(g, (p, _n, c) => c.copy(c0).multiplyScalar(0.7 + 0.5 * Math.min(1, p.y / (0.25 * size))));
  return g;
}

/** Giant clam: two ribbed, wavy valves gaping upward around a vivid spotted mantle. */
export function giantClam(seed: number, mantleHex: number, size = 1) {
  const rng = new Rng(seed);
  const L = 0.42 * size,
    H = 0.16 * size,
    W = 0.13 * size;
  const shellA = C(0xd8d2c0),
    shellB = C(0xa89c84);
  const valve = (s: number) => {
    const g = surface(16, 40, (u, v) => {
      const th = 0.06 + v * (Math.PI - 0.12);
      const ph = u * Math.PI * 0.5;
      const rib = 1 + 0.12 * Math.abs(Math.sin(th * 5)) * Math.sin(ph);
      // wavy, interlocking rim
      const wave = 0.035 * size * Math.sin(th * 5) * s * Math.pow(Math.sin(ph), 4);
      return new THREE.Vector3((L / 2) * Math.cos(th), H * (1 - Math.cos(ph)) * Math.sin(th) * rib + wave, s * W * Math.sin(ph) * Math.sin(th) * rib);
    });
    paint(g, (p, _n, c) => {
      const ribs = Math.abs(Math.sin(Math.acos(Math.max(-1, Math.min(1, (2 * p.x) / L))) * 5));
      c.copy(shellB)
        .lerp(shellA, 0.4 + 0.6 * ribs)
        .multiplyScalar(0.8 + 0.25 * (p.y / H));
    });
    return g;
  };
  const mantle = new THREE.SphereGeometry(1, 24, 10)
    .scale(L * 0.44, 0.045 * size, W * 0.75)
    .translate(0, H * 0.82, 0)
    .toNonIndexed();
  const m0 = C(mantleHex),
    m1 = C(mantleHex).offsetHSL(0.05, 0.1, 0.25);
  const spotSeed = rng.range(0, 50);
  paint(mantle, (p, _n, c) => {
    const spot = fbm3(p.x * 55 + spotSeed, p.y * 55, p.z * 55, 1) > 0.2 ? 1 : 0;
    c.copy(m0)
      .lerp(m1, 0.5 + 0.5 * Math.sin(p.x * 60))
      .lerp(new THREE.Color(0.85, 1, 1), spot * 0.55);
  });
  return merge([valve(1), valve(-1), mantle]);
}

/**
 * Bushy gorgonian (sea rod / sea plume): thin branches growing in all directions from a short
 * trunk, so it reads as a rounded 3D bush from the side and from above (the flat sea fan only
 * reads from the front). Muted colours suit the deeper water.
 */
export function gorgonianBush(seed: number, hex: number, size = 1) {
  const rng = new Rng(seed);
  const geos: THREE.BufferGeometry[] = [];
  let maxY = 0.01;
  const grow = (start: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, depth: number) => {
    const wob = new THREE.Vector3(rng.range(-0.25, 0.25), rng.range(-0.05, 0.15), rng.range(-0.25, 0.25));
    const d = dir.clone().add(wob).normalize();
    // branches keep curving upward a little, like real sea rods
    d.y = Math.max(d.y, 0.25);
    d.normalize();
    const end = start.clone().addScaledVector(d, len);
    const mid = start.clone().lerp(end, 0.5).add(new THREE.Vector3(rng.range(-0.02, 0.02), 0.01, rng.range(-0.02, 0.02)));
    geos.push(taperedTube(new THREE.QuadraticBezierCurve3(start, mid, end), 3, 5, (t) => r * (1 - 0.3 * t), 1, depth === 0));
    maxY = Math.max(maxY, end.y);
    if (depth === 0) return;
    const kids = depth >= 3 ? 2 : rng.int(1, 3);
    for (let k = 0; k < kids; k++) {
      const az = rng.range(0, Math.PI * 2);
      const spread = rng.range(0.35, 0.8);
      const nd = d.clone().add(new THREE.Vector3(Math.cos(az) * spread, 0.15, Math.sin(az) * spread)).normalize();
      grow(end, nd, len * rng.range(0.72, 0.88), r * 0.78, depth - 1);
    }
  };
  const trunks = rng.int(2, 3);
  for (let t = 0; t < trunks; t++) {
    const az = (t / trunks) * Math.PI * 2 + rng.range(0, 1);
    grow(new THREE.Vector3(0, -0.03, 0), new THREE.Vector3(Math.cos(az) * 0.3, 1, Math.sin(az) * 0.3).normalize(), 0.22 * size, 0.03 * size, 5);
  }
  const g = merge(geos);
  const c0 = C(hex).multiplyScalar(0.75),
    c1 = C(hex).offsetHSL(0.01, -0.05, 0.1);
  paint(g, (p, _n, c) => {
    const t = Math.min(1, p.y / maxY);
    c.copy(c0)
      .lerp(c1, t)
      .multiplyScalar(0.85 + 0.25 * fbm3(p.x * 40, p.y * 40, p.z * 40, 1));
  });
  return g;
}
