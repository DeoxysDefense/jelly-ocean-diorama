import { describe, it, expect } from 'vitest';
import { depthAt, towardDeep } from '../src/creatures/shallows';
import { STRIKE_SUCCESS, LUNGE_SUCCESS } from '../src/creatures/Predation';
import { Prefs } from '../src/features/Prefs';
import { PAGES } from '../src/content/notebook';

/** A beach sloping down toward +x: dry for x < 0, deeper and deeper beyond. */
const beach = {
  terrain: { heightAt: (x: number) => -0.25 * x },
  water: { heightAt: () => 0 },
};

describe('Shallow water: swimmers head for deeper water', () => {
  it('measures depth as surface minus seabed', () => {
    expect(depthAt(beach, 4, 0)).toBeCloseTo(1, 6);
    expect(depthAt(beach, -2, 0)).toBeLessThan(0);
  });

  it('points toward the deep side, from the shallows and from dry land', () => {
    const out = { x: 0, z: 0, dist: 0 };
    expect(towardDeep(beach, 0.5, 0, 0.6, out)).toBe(true);
    expect(out.x).toBeGreaterThan(0.7);
    expect(towardDeep(beach, -3, 0, 0.6, out)).toBe(true);
    expect(out.x).toBeGreaterThan(0.7);
    expect(-3 + out.x * out.dist).toBeGreaterThan(2.3); // lands where it is deep enough
  });

  it('respects the tray depth bounds and gives up when there is no water', () => {
    const out = { x: 0, z: 0, dist: 0 };
    const desert = { terrain: { heightAt: () => 1 }, water: { heightAt: () => 0 } };
    expect(towardDeep(desert, 0, 0, 0.5, out)).toBe(false);
    // deep water only behind z = -5, but the tray stops at z = -2
    const back = { terrain: { heightAt: (_x: number, z: number) => (z < -5 ? -2 : 1) }, water: { heightAt: () => 0 } };
    expect(towardDeep(back, 0, 0, 0.5, out, -2, 6)).toBe(false);
    expect(towardDeep(back, 0, 0, 0.5, out)).toBe(true);
  });
});

describe('Predation stays gentle', () => {
  it('most strikes and lunges fail', () => {
    expect(STRIKE_SUCCESS).toBeLessThan(0.3);
    expect(LUNGE_SUCCESS).toBeLessThan(0.35);
  });

  it('the two hunts have bilingual Field Notebook pages', () => {
    expect(PAGES['b:barracudaStrike'].zh).toBe('梭鱼冲击鱼群');
    expect(PAGES['b:grouperAmbush'].en).toBe('A grouper ambushes');
  });
});

describe('Ambient sound preference', () => {
  it('is off by default and keeps a sane volume', () => {
    const p = new Prefs();
    expect(p.data.sound).toEqual({ on: false, volume: 0.6 });
    p.merge({ sound: { on: true, volume: 3 } } as never);
    expect(p.data.sound).toEqual({ on: true, volume: 1 });
    p.merge({ sound: { on: 'yes', volume: -1 } } as never);
    expect(p.data.sound).toEqual({ on: false, volume: 0 });
  });
});
