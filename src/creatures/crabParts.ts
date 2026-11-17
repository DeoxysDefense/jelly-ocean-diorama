import * as THREE from 'three';
import { fbm3 } from '../util/noise';

/**
 * Shared crustacean parts: jointed walking legs and chelae. Each part exposes its joints so
 * the owner can animate a gait.
 */
export interface Leg {
  pivot: THREE.Group; // coxa (attached to the body)
  knee: THREE.Group; // merus → carpus
  ankle: THREE.Group; // propodus → dactyl
  side: number;
  index: number;
}

export interface Claw {
  arm: THREE.Group;
  wrist: THREE.Group;
  finger: THREE.Group;
  side: number;
}

function tapered(r0: number, r1: number, len: number, mat: THREE.Material, segs = 7) {
  const g = new THREE.CylinderGeometry(r1, r0, len, segs, 2);
  g.rotateZ(-Math.PI / 2); // along +x
  g.translate(len / 2, 0, 0);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

/** A 3-segment walking leg extending along local +x. */
export function buildLeg(mat: THREE.Material, joint: THREE.Material, tip: THREE.Material, scale = 1): Omit<Leg, 'side' | 'index'> {
  const pivot = new THREE.Group();
  const L1 = 0.15 * scale,
    L2 = 0.13 * scale,
    L3 = 0.1 * scale;
  pivot.add(tapered(0.02 * scale, 0.017 * scale, L1, mat));
  const knee = new THREE.Group();
  knee.position.x = L1;
  const kj = new THREE.Mesh(new THREE.SphereGeometry(0.019 * scale, 8, 6), joint);
  knee.add(kj);
  knee.add(tapered(0.016 * scale, 0.012 * scale, L2, mat));
  const ankle = new THREE.Group();
  ankle.position.x = L2;
  ankle.add(new THREE.Mesh(new THREE.SphereGeometry(0.013 * scale, 8, 6), joint));
  const dactyl = new THREE.Mesh(new THREE.ConeGeometry(0.011 * scale, L3, 6).rotateZ(-Math.PI / 2).translate(L3 / 2, 0, 0), tip);
  dactyl.castShadow = true;
  ankle.add(dactyl);
  knee.add(ankle);
  pivot.add(knee);
  return { pivot, knee, ankle };
}

/** Knobbly chela with toothed fingers, pointing along local +z. */
export function buildClaw(mat: THREE.Material, joint: THREE.Material, tip: THREE.Material, big: number, side: number): Claw {
  const arm = new THREE.Group();
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.022 * big, 0.026 * big, 0.13 * big, 8).rotateX(Math.PI / 2).translate(0, 0, 0.065 * big), mat);
  upper.castShadow = true;
  arm.add(upper);
  const wrist = new THREE.Group();
  wrist.position.z = 0.13 * big;
  wrist.add(new THREE.Mesh(new THREE.SphereGeometry(0.026 * big, 8, 6), joint));
  wrist.rotation.y = -side * 0.85;
  const palmG = new THREE.SphereGeometry(0.06 * big, 16, 12);
  const pp = palmG.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pp.count; i++) {
    const x = pp.getX(i),
      y = pp.getY(i),
      z = pp.getZ(i);
    const k = 1 + 0.12 * Math.max(0, fbm3(x * 60, y * 60, z * 60, 2));
    pp.setXYZ(i, x * 0.78 * k, y * 0.72 * k, z * 1.35 * k);
  }
  palmG.computeVertexNormals();
  palmG.translate(0, 0, 0.07 * big);
  const palm = new THREE.Mesh(palmG, mat);
  palm.castShadow = true;
  wrist.add(palm);
  // fixed finger with small teeth
  const fixed = new THREE.Group();
  fixed.position.set(0, -0.012 * big, 0.14 * big);
  fixed.add(new THREE.Mesh(new THREE.ConeGeometry(0.022 * big, 0.11 * big, 7).rotateX(Math.PI / 2).translate(0, 0, 0.055 * big), mat));
  for (let t = 0; t < 4; t++) {
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.006 * big, 0.016 * big, 4), tip);
    tooth.position.set(0, 0.014 * big, 0.02 * big + t * 0.018 * big);
    fixed.add(tooth);
  }
  const fixedTip = new THREE.Mesh(new THREE.ConeGeometry(0.01 * big, 0.03 * big, 6).rotateX(Math.PI / 2).translate(0, 0, 0.11 * big), tip);
  fixed.add(fixedTip);
  wrist.add(fixed);
  // movable finger (dactyl)
  const finger = new THREE.Group();
  finger.position.set(0, 0.022 * big, 0.12 * big);
  finger.add(new THREE.Mesh(new THREE.ConeGeometry(0.018 * big, 0.11 * big, 7).rotateX(Math.PI / 2).translate(0, 0, 0.055 * big), mat));
  finger.add(new THREE.Mesh(new THREE.ConeGeometry(0.009 * big, 0.03 * big, 6).rotateX(Math.PI / 2).translate(0, -0.004 * big, 0.11 * big), tip));
  wrist.add(finger);
  arm.add(wrist);
  return { arm, wrist, finger, side };
}

/** Stalked eye with a glossy dark bead. */
export function buildEyeStalk(mat: THREE.Material, length = 0.08) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, length, 6).translate(0, length / 2, 0), mat));
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), new THREE.MeshPhysicalMaterial({ color: 0x0c0c10, roughness: 0.1, clearcoat: 1 }));
  eye.position.y = length;
  g.add(eye);
  return g;
}
