import { describe, it, expect } from 'vitest';
import { FramePacer, QUALITY_LADDER } from '../src/core/FramePacer';

/** Feeds the pacer requestAnimationFrame ticks of a `hz` display; `cost(i)` = refreshes a drawn frame takes. */
function run(p: FramePacer, hz: number, fps: number, frames: number, adaptive: boolean, cost: (i: number) => number = () => 1) {
  const r = 1000 / hz;
  let now = 1000;
  let drawn = 0;
  const gaps: number[] = [];
  const levels: number[] = [];
  for (let tick = 0; drawn < frames && tick < frames * 20; tick++) {
    const gap = p.tick(now, fps);
    if (gap) {
      gaps.push(gap);
      const next = p.judge(gap, now, adaptive);
      if (next !== null) levels.push(next);
      // a slow frame makes the following rAF come late (whole refreshes)
      now += r * Math.max(1, cost(drawn));
      drawn++;
    } else now += r;
  }
  return { gaps, levels };
}

describe('Frame pacing', () => {
  it('draws 60 fps on a 120 Hz screen as an even 2-refresh rhythm', () => {
    const p = new FramePacer();
    p.set(0);
    const { gaps } = run(p, 120, 60, 300, false);
    expect(Math.round(1000 / p.refresh)).toBe(120);
    const steady = gaps.slice(40);
    for (const g of steady) expect(g).toBeCloseTo(1000 / 60, 0);
  });

  it('draws 30 fps (ambient) as every 4th refresh at 120 Hz and every 2nd at 60 Hz', () => {
    const a = new FramePacer();
    run(a, 120, 30, 200, false);
    expect(a.interval).toBeCloseTo(1000 / 30, 0);
    const b = new FramePacer();
    run(b, 60, 30, 200, false);
    expect(b.interval).toBeCloseTo(1000 / 30, 0);
  });
});

describe('Automatic quality', () => {
  it('steps down when frames keep missing their slot (judder), cutting effects before pixels', () => {
    const p = new FramePacer();
    p.set(0);
    // every other frame takes 3 refreshes instead of 2 (the 16.7 / 25 ms judder)
    const { levels } = run(p, 120, 60, 800, true, (i) => (i % 2 ? 3 : 1));
    expect(levels.length).toBeGreaterThan(0);
    expect(levels[0]).toBe(1);
    expect(QUALITY_LADDER[1].budget).toBe(Infinity); // the first steps never touch resolution
    expect(QUALITY_LADDER[2].budget).toBe(Infinity);
  });

  it('does not bounce: after a failed step up it waits longer before trying again', () => {
    const p = new FramePacer();
    p.set(2);
    const r = 1000 / 120;
    let now = 1000;
    let drawn = 0;
    const changes: { t: number; level: number }[] = [];
    // phase(ms, judder): run the display for a while, optionally with every other frame late
    const phase = (ms: number, judder: boolean) => {
      const end = now + ms;
      while (now < end) {
        const gap = p.tick(now, 60);
        if (gap) {
          const next = p.judge(gap, now, true);
          if (next !== null) changes.push({ t: now, level: next });
          now += r * (judder && drawn % 2 ? 3 : 1);
          drawn++;
        } else now += r;
      }
    };
    phase(40_000, false); // smooth → one step up
    expect(changes.map((c) => c.level)).toContain(1);
    const upAt = changes.length;
    phase(6_000, true); // the better quality judders → straight back down
    expect(changes.slice(upAt).map((c) => c.level)).toContain(2);
    const downAt = changes.length;
    phase(30_000, false); // smooth again, but the block after a failed try is longer now
    expect(changes.slice(downAt).filter((c) => c.level < 2).map((c) => [Math.round(c.t), c.level])).toEqual([]);
  });

  it('a hidden or throttled window is not counted as slow', () => {
    const p = new FramePacer();
    p.set(0);
    for (let i = 0; i < 400; i++) expect(p.judge(1500, i * 1500, true)).toBeNull();
    expect(p.level).toBe(0);
  });
});
