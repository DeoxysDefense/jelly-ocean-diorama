import * as THREE from 'three';
import { CONFIG } from '../config';
import { makeWoodTextures } from '../util/textures';

/**
 * V2 (P1): the wooden display base the resin tray sits on, plus a soft contact shadow.
 * Only Full View (and a zoomed-out Top View) ever sees it; it is hidden otherwise.
 */
export class Plinth {
  readonly group = new THREE.Group();

  constructor() {
    const W = CONFIG.world;
    const pad = 0.9;
    const w = W.xMax - W.xMin + pad * 2,
      d = W.zFront - W.zBack + pad * 2;
    const h = W.bottomY - W.plinthY;
    const wood = makeWoodTextures(31, [96, 64, 40]);
    wood.map.wrapS = wood.map.wrapT = THREE.RepeatWrapping;
    wood.map.repeat.set(10, 1);
    wood.normalMap.wrapS = wood.normalMap.wrapT = THREE.RepeatWrapping;
    wood.normalMap.repeat.set(10, 1);
    const mat = new THREE.MeshStandardMaterial({ map: wood.map, normalMap: wood.normalMap, roughness: 0.6, color: 0xb89a80 });
    // rounded slab: an extruded rounded rectangle (top view) with a small edge bevel
    const r = 1.1;
    const shape = new THREE.Shape();
    const x0 = -w / 2,
      x1 = w / 2,
      y0 = -d / 2,
      y1 = d / 2;
    shape.moveTo(x0 + r, y0);
    shape.lineTo(x1 - r, y0);
    shape.quadraticCurveTo(x1, y0, x1, y0 + r);
    shape.lineTo(x1, y1 - r);
    shape.quadraticCurveTo(x1, y1, x1 - r, y1);
    shape.lineTo(x0 + r, y1);
    shape.quadraticCurveTo(x0, y1, x0, y1 - r);
    shape.lineTo(x0, y0 + r);
    shape.quadraticCurveTo(x0, y0, x0 + r, y0);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: h - 0.16, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 2, curveSegments: 6 });
    geo.rotateX(Math.PI / 2); // extrusion along -y
    geo.translate((W.xMin + W.xMax) / 2, W.bottomY - 0.08, (W.zFront + W.zBack) / 2);
    const slab = new THREE.Mesh(geo, mat);
    slab.receiveShadow = true;
    this.group.add(slab);

    // soft contact shadow on the "table" under the base
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const g = c.getContext('2d')!;
    // radial in a square canvas (fully transparent at the edges), stretched by the plane
    const grd = g.createRadialGradient(64, 64, 2, 64, 64, 64);
    grd.addColorStop(0, 'rgba(0,0,0,0.38)');
    grd.addColorStop(0.6, 'rgba(0,0,0,0.2)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 1.15, d * 1.7),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set((W.xMin + W.xMax) / 2, W.plinthY - 0.02, (W.zFront + W.zBack) / 2 - 0.6);
    shadow.renderOrder = -10;
    this.group.add(shadow);
    this.group.visible = false;
  }

  /** Shown only when the camera is far enough out to see it. */
  update(fullness: number, topBlend: number) {
    this.group.visible = fullness > 0.02 || topBlend > 0.98;
  }
}
