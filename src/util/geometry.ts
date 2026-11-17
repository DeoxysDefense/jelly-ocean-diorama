import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm3 } from './noise';

/** Ensures position/normal/uv/color attributes exist (non-indexed) so geometries can merge. */
export function normalizeGeo(g: THREE.BufferGeometry, color?: THREE.Color | [number, number, number]): THREE.BufferGeometry {
  let geo = g.index ? g.toNonIndexed() : g;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const n = geo.attributes.position.count;
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!geo.attributes.color || color) {
    const c = color instanceof THREE.Color ? color : color ? new THREE.Color(...color) : new THREE.Color(1, 1, 1);
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  // drop custom attributes that would break merging
  for (const key of Object.keys(geo.attributes)) {
    if (!['position', 'normal', 'uv', 'color'].includes(key)) geo.deleteAttribute(key);
  }
  return geo;
}

export function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const list = geos.map((g) => normalizeGeo(g));
  const m = mergeGeometries(list, false);
  if (!m) throw new Error('mergeGeometries failed');
  return m;
}

/** Paints vertex colours via a callback on (position, normal). */
export function paint(g: THREE.BufferGeometry, fn: (p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color, uv?: THREE.Vector2) => void) {
  const pos = g.attributes.position,
    nor = g.attributes.normal,
    uvA = g.attributes.uv;
  let col = g.attributes.color as THREE.BufferAttribute;
  if (!col) {
    col = new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3);
    g.setAttribute('color', col);
  }
  const p = new THREE.Vector3(),
    n = new THREE.Vector3(),
    c = new THREE.Color(),
    uv = new THREE.Vector2();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    if (nor) n.fromBufferAttribute(nor, i);
    if (uvA) uv.fromBufferAttribute(uvA as THREE.BufferAttribute, i);
    fn(p, n, c, uvA ? uv : undefined);
    col.setXYZ(i, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
  return g;
}

/** Tube with varying radius along an arbitrary curve. */
export function taperedTube(
  curve: THREE.Curve<THREE.Vector3>,
  segments: number,
  radial: number,
  radius: (t: number) => number,
  vRepeat = 1,
  capEnd = true,
): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(segments, false);
  const pos: number[] = [],
    nor: number[] = [],
    uv: number[] = [],
    idx: number[] = [];
  const P = new THREE.Vector3(),
    N = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, P);
    const r = radius(t);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const s = Math.sin(a),
        c = -Math.cos(a);
      N.set(0, 0, 0).addScaledVector(frames.normals[i], c).addScaledVector(frames.binormals[i], s).normalize();
      pos.push(P.x + N.x * r, P.y + N.y * r, P.z + N.z * r);
      nor.push(N.x, N.y, N.z);
      uv.push(j / radial, t * vRepeat);
    }
  }
  for (let i = 0; i < segments; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j,
        b = (i + 1) * (radial + 1) + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  if (capEnd) {
    // rounded cap: collapse to a point slightly beyond the end
    const end = curve.getPointAt(1);
    const tan = curve.getTangentAt(1);
    const tip = end.clone().addScaledVector(tan, radius(1) * 0.8);
    const ti = pos.length / 3;
    pos.push(tip.x, tip.y, tip.z);
    nor.push(tan.x, tan.y, tan.z);
    uv.push(0.5, vRepeat);
    const base = segments * (radial + 1);
    for (let j = 0; j < radial; j++) idx.push(base + j, ti, base + j + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/**
 * Leaf blade lying along +x, width along z, with a central fold (V cross-section),
 * downward curl and optional serration. Returns indexed geometry.
 */
export function leafGeometry(opts: {
  length: number;
  width: number;
  segs?: number;
  fold?: number;
  curl?: number;
  twist?: number;
  shape?: (t: number) => number;
}): THREE.BufferGeometry {
  const segs = opts.segs ?? 10;
  const fold = opts.fold ?? 0.25;
  const curl = opts.curl ?? 0.3;
  const shape = opts.shape ?? ((t: number) => Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.8) * (1 - 0.15 * t));
  const pos: number[] = [],
    uv: number[] = [],
    idx: number[] = [];
  const cols = 3; // left edge, midrib, right edge
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const x = t * opts.length;
    const w = shape(t) * opts.width * 0.5;
    const yCurl = -curl * opts.length * t * t;
    for (let c = 0; c < cols; c++) {
      const side = c - 1;
      const z = side * w;
      const y = yCurl + (side !== 0 ? fold * w : 0);
      const tw = (opts.twist ?? 0) * t;
      pos.push(x, y * Math.cos(tw) - z * Math.sin(tw), y * Math.sin(tw) + z * Math.cos(tw));
      uv.push(t, c / 2);
    }
  }
  for (let i = 0; i < segs; i++)
    for (let c = 0; c < cols - 1; c++) {
      const a = i * cols + c,
        b = (i + 1) * cols + c;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Noise-displaced, flattened icosphere for natural rocks/pebbles. */
export function rockGeometry(radius: number, detail: number, seed: number, flatten = 0.6, roughness = 0.35) {
  const ico = new THREE.IcosahedronGeometry(radius, detail);
  ico.deleteAttribute('normal');
  ico.deleteAttribute('uv');
  const g = mergeVertices(ico);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const d =
      1 +
      roughness * fbm3(n.x * 1.7 + seed, n.y * 1.7 + seed * 0.37, n.z * 1.7 - seed, 4) * 1.6 +
      0.06 * fbm3(n.x * 6 + seed, n.y * 6, n.z * 6, 2);
    v.copy(n).multiplyScalar(radius * d);
    v.y *= flatten;
    if (v.y < -radius * 0.25 * flatten) v.y = -radius * 0.25 * flatten + (v.y + radius * 0.25 * flatten) * 0.25;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Lathe from a profile of [radius, y] pairs, with optional per-angle radial modulation. */
export function lathe(profile: [number, number][], segments: number, mod?: (a: number, t: number) => number) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, segments);
  if (mod) {
    const pos = g.attributes.position as THREE.BufferAttribute;
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i),
        z = pos.getZ(i);
      const a = Math.atan2(z, x);
      const t = uv.getY(i);
      const k = mod(a, t);
      pos.setX(i, x * k);
      pos.setZ(i, z * k);
    }
    g.computeVertexNormals();
  }
  return g;
}

/**
 * Static batching: merges all plain (non-instanced) meshes under `root` that share a material
 * into one mesh per material, in root-local space. Cuts draw calls for prop-heavy models.
 */
export function bakeStatic(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; cast: boolean; receive: boolean }>();
  const remove: THREE.Object3D[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material)) return;
    const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()) as THREE.BufferGeometry;
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const mat = m.material as THREE.Material;
    let e = groups.get(mat);
    if (!e) groups.set(mat, (e = { geos: [], cast: false, receive: false }));
    e.geos.push(g);
    e.cast ||= m.castShadow;
    e.receive ||= m.receiveShadow;
    remove.push(m);
  });
  for (const m of remove) m.parent?.remove(m);
  // prune empty groups
  const empties: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o !== root && (o.type === 'Group' || o.type === 'Object3D') && o.children.length === 0) empties.push(o);
  });
  empties.forEach((o) => o.parent?.remove(o));
  for (const [mat, e] of groups) {
    const hasColor = e.geos.some((g) => g.attributes.color);
    if (hasColor) for (const g of e.geos) if (!g.attributes.color) normalizeGeo(g, [1, 1, 1]);
    const merged = mergeGeometries(e.geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = e.cast;
    mesh.receiveShadow = e.receive;
    root.add(mesh);
  }
}
