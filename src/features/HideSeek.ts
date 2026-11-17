import * as THREE from 'three';
import { rand } from '../util/math';
import type { App } from '../core/App';
import { GroundMarker } from '../interaction/GroundMarker';
import type { MiniGame, MiniGameManager } from './MiniGames';

type Phase = 'counting' | 'seek' | 'found';

interface Spot {
  p: THREE.Vector3;
  color: THREE.Color;
  sink: number;
  kind: 'cave' | 'coral' | 'rock' | 'grass' | 'sand';
}

const KIND_COLOR: Record<Spot['kind'], number> = {
  cave: 0x6a5648,
  coral: 0x9a6a5c,
  rock: 0x857a6c,
  grass: 0x6f7a4a,
  sand: 0xd8c49a,
};

/**
 * Octopus Hide & Seek. The real octopus (same model and behaviour system) crawls off to a hiding
 * place while the HUD counts down — a cave, behind a rock, among corals or seagrass, or half
 * buried in open sand — tucks in and camouflages toward that spot's colour. It never vanishes or
 * teleports, and every so often an eye or an arm tip moves. Click where you think it is; up to
 * three gentle hints (area ring → bubbles → a brief glimpse). Misses cost nothing.
 */
export class OctopusHideSeekGame implements MiniGame {
  readonly id = 'hide' as const;
  private phase: Phase = 'counting';
  private count = 0;
  private hints = 0;
  private spot: Spot | null = null;
  private lastSpot = new THREE.Vector3(999, 0, 999);
  private ring: GroundMarker;
  private bubbleT = 0;
  private bubbleLeft = 0;
  private tempOctopus = false;
  private prevMagnifier = false;
  private foundT = 0;
  private missT = 0;
  private tmp = new THREE.Vector3();

  constructor(private app: App, private mgr: MiniGameManager) {
    this.ring = new GroundMarker(app.terrain, 0xfff0b0);
    this.ring.hide();
  }

  private get octo() {
    return this.app.creatures.octopus;
  }

  start() {
    const app = this.app;
    app.world.add(this.ring.mesh);
    // no octopus in this ocean right now? borrow one for the game
    if ((app.creatures.population.octopus ?? 0) < 1) {
      this.tempOctopus = true;
      app.creatures.setPopulation('octopus', 1);
    }
    this.prevMagnifier = app.magnifier.enabled;
    this.newRound();
  }

  private newRound() {
    this.spot = this.chooseSpot();
    this.hints = 0;
    this.bubbleLeft = 0;
    this.ring.hide();
    this.phase = 'counting';
    this.count = 4;
    this.octo.gameHide(this.spot.p, this.spot.color, this.spot.sink);
    this.lastSpot.copy(this.spot.p);
    this.refresh();
  }

  /** Candidate hiding places in view, under water, not the previous one, within crawling reach. */
  private chooseSpot(): Spot {
    const app = this.app;
    const vis = app.cam.visibleX(2.2);
    const level = app.sim.level;
    const o = this.octo.pos;
    const out: Spot[] = [];
    // fair play: from the front, the far back is lost in the blue haze, so keep within ~z > -6.5
    const zMin = app.cam.isTop ? -11.5 : -6.5;
    const ok = (p: THREE.Vector3) =>
      p.x > vis.min &&
      p.x < vis.max &&
      p.z > zMin &&
      level - app.terrain.heightAt(p.x, p.z) > 1.3 &&
      p.distanceTo(this.lastSpot) > 2.5 &&
      Math.hypot(p.x - o.x, p.z - o.z) < 13;
    const add = (p: THREE.Vector3, kind: Spot['kind'], sink = 0.04) => {
      p.y = app.terrain.heightAt(p.x, p.z);
      if (ok(p)) out.push({ p, color: new THREE.Color(KIND_COLOR[kind]), sink, kind });
    };
    for (const h of app.reef.hidingSpotsDetailed()) add(h.p.clone(), h.cave ? 'cave' : 'coral', 0.03);
    for (const s of app.reef.selectables) {
      const q = s.object.position;
      if (s.kind === 'rock') {
        // tucked against the side of the rock: half hidden from the front glass, never fully
        const side = Math.random() < 0.5 ? -1 : 1;
        add(new THREE.Vector3(q.x + side * s.radius * 0.85, 0, q.z - s.radius * 0.35), 'rock', 0.06);
      } else if (s.kind === 'seagrass') add(new THREE.Vector3(q.x + rand(-0.15, 0.15), 0, q.z + rand(-0.15, 0.15)), 'grass', 0.08);
    }
    for (let i = 0; i < 12; i++) {
      const x = rand(vis.min, vis.max),
        z = rand(zMin, 4.5);
      const p = new THREE.Vector3(x, 0, z);
      if (app.reef.obstacles().some((ob) => Math.hypot(ob.center.x - x, ob.center.z - z) < ob.radius + 0.6)) continue;
      add(p, 'sand', 0.17);
    }
    if (!out.length) {
      const p = this.octo.pos.clone();
      p.x += 3;
      p.y = app.terrain.heightAt(p.x, p.z);
      return { p, color: new THREE.Color(KIND_COLOR.sand), sink: 0.17, kind: 'sand' };
    }
    // a little variety: favour less obvious places a bit
    const w = (s: Spot) => ({ cave: 0.7, coral: 1, rock: 1.2, grass: 1.1, sand: 1.3 })[s.kind];
    const total = out.reduce((a, s) => a + w(s), 0);
    let r = Math.random() * total;
    for (const s of out) {
      if (r < w(s)) return s;
      r -= w(s);
    }
    return out[0];
  }

  refresh() {
    const t = this.mgr.t.bind(this.mgr);
    const app = this.app;
    const mag = app.magnifier.enabled;
    const buttons = [];
    if (this.phase === 'seek')
      buttons.push({ id: 'hint', label: `${t('hide.hint')} ${this.hints}/3`, disabled: this.hints >= 3, onClick: () => this.hint() });
    if (this.phase === 'found') buttons.push({ id: 'again', label: t('hide.again'), primary: true, onClick: () => this.newRound() });
    buttons.push({
      id: 'mag',
      label: `${t('hide.magnifier')}${mag ? ' ✓' : ''}`,
      onClick: () => {
        app.magnifier.setGame(!app.magnifier.enabled);
        this.refresh();
      },
    });
    buttons.push({ id: 'exit', label: `${t('game.exit')} (Esc)`, onClick: () => this.mgr.exit() });
    const status =
      this.phase === 'counting' ? `${t('hide.counting')} ${Math.max(1, Math.ceil(this.count))}` : this.phase === 'seek' ? t('hide.find') : t('hide.found');
    const sub = this.phase === 'seek' ? t('hide.help') : '';
    this.mgr.setHud(t('hide.title'), status, sub, buttons);
  }

  private hint() {
    if (this.phase !== 'seek' || !this.spot || this.hints >= 3) return;
    this.hints++;
    const t = this.mgr.t.bind(this.mgr);
    const p = this.spot.p;
    if (this.hints === 1) {
      // a soft ring around the general area (the octopus is inside it, not at its centre)
      const a = rand(0, Math.PI * 2),
        r = rand(0.6, 1.4);
      this.ring.show(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r * 0.7, 2.4, 2.4);
      this.mgr.setSub(t('hide.hint1'));
    } else if (this.hints === 2) {
      this.bubbleLeft = 8;
      this.mgr.setSub(t('hide.hint2'));
    } else {
      this.octo.gameGlimpse();
      this.mgr.setSub(t('hide.hint3'));
    }
    this.refresh();
    this.mgr.setSub(this.hints === 1 ? t('hide.hint1') : this.hints === 2 ? t('hide.hint2') : t('hide.hint3'));
  }

  /** Screen-space test: is the click on (or very near) the octopus? */
  private isOnOctopus(ndc: THREE.Vector2, px: THREE.Vector2) {
    const app = this.app;
    const pick = app.creatures.pick(app.cam.raycaster3(ndc.x, ndc.y));
    if (pick && pick.kind === 'octopus') return true;
    const canvas = app.renderer.domElement;
    const w = canvas.clientWidth,
      h = canvas.clientHeight;
    const s = this.tmp.copy(this.octo.pos).project(app.cam.camera);
    const sx = ((s.x + 1) / 2) * w,
      sy = ((1 - s.y) / 2) * h;
    const rect = canvas.getBoundingClientRect();
    const d = Math.hypot(px.x - rect.left - sx, px.y - rect.top - sy);
    const unitPx = h / app.cam.viewH; // pixels per world unit
    return d < Math.max(26, unitPx * 0.6);
  }

  pointerDown(ndc: THREE.Vector2, px: THREE.Vector2) {
    if (this.phase !== 'seek') return;
    const app = this.app;
    if (this.isOnOctopus(ndc, px)) {
      this.phase = 'found';
      this.foundT = 0;
      this.octo.gameFound();
      this.ring.hide();
      app.prefs.data.hideSeekFound++;
      app.prefs.changed();
      this.mgr.flash(this.mgr.t('hide.found'), 2);
      this.refresh();
    } else {
      // a miss: just a soft note, nothing jarring
      this.missT = 1.6;
      this.mgr.setSub(this.mgr.t('hide.miss'));
    }
  }
  pointerMove() {}
  pointerUp() {}
  wheel() {}

  update(dt: number, time: number) {
    if (this.phase === 'counting') {
      const before = Math.ceil(this.count);
      this.count -= dt;
      if (Math.ceil(this.count) !== before) this.refresh();
      if (this.count <= 0 && this.octo.gameArrived) {
        this.phase = 'seek';
        this.refresh();
      }
    }
    if (this.missT > 0) {
      this.missT -= dt;
      if (this.missT <= 0 && this.phase === 'seek') this.mgr.setSub(this.hints ? '' : this.mgr.t('hide.help'));
    }
    if (this.bubbleLeft > 0 && this.spot) {
      this.bubbleLeft -= dt;
      this.bubbleT -= dt;
      if (this.bubbleT <= 0) {
        this.bubbleT = rand(0.7, 1.3);
        const p = this.octo.pos;
        this.app.bubbles.emit(p.x + rand(-0.1, 0.1), p.y + 0.15, p.z + rand(-0.1, 0.1), 2, 0.06, 0.5);
      }
    }
    this.ring.update(dt, time);
    if (this.phase === 'found') this.foundT += dt;
  }

  exit() {
    const app = this.app;
    this.octo.gameEnd();
    this.ring.hide();
    app.world.remove(this.ring.mesh);
    this.ring.mesh.geometry.dispose();
    (this.ring.mesh.material as THREE.Material).dispose();
    if (this.tempOctopus) app.creatures.setPopulation('octopus', 0);
    app.magnifier.setGame(this.prevMagnifier);
  }
}
