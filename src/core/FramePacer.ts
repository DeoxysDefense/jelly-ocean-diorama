/**
 * Smooth frame pacing + automatic quality.
 *
 * Pacing: the display's real refresh interval is measured from requestAnimationFrame, and frames
 * are drawn on an exact multiple of it (60 fps on a 120 Hz screen = every 2nd refresh; 30 fps =
 * every 4th), so frame gaps stay even instead of alternating 16.7 / 25 ms.
 *
 * Quality: instead of averaging frame times (which hides judder), it counts frames that missed
 * their slot. Too many misses → one step down the ladder (anti-aliasing first, then shadow
 * refreshes, and only then a cap on the number of pixels). Upgrades happen only after a long
 * clean stretch, and an upgrade that immediately misses again blocks further upgrades for longer
 * and longer, so quality never bounces back and forth.
 */
export interface QualityLevel {
  /** MSAA samples of the HDR scene target. */
  msaa: number;
  /** Max rendered pixels (width × height × pixelRatio²). */
  budget: number;
  /** Shadow map refresh: every n-th frame (always when the shadow camera moved). */
  shadowEvery: number;
}

export const QUALITY_LADDER: QualityLevel[] = [
  { msaa: 4, budget: Infinity, shadowEvery: 1 },
  { msaa: 4, budget: Infinity, shadowEvery: 2 },
  { msaa: 2, budget: Infinity, shadowEvery: 2 },
  { msaa: 2, budget: 3.4e6, shadowEvery: 3 },
  { msaa: 0, budget: 2.6e6, shadowEvery: 3 },
  { msaa: 0, budget: 1.9e6, shadowEvery: 4 },
];
/** Fixed level used by the "Low (battery saver)" quality setting. */
export const LOW_LEVEL = 4;

const LEVEL_KEY = 'jelly-ocean-quality-level';

export class FramePacer {
  /** Measured refresh interval (ms). */
  refresh = 1000 / 60;
  /** Current target interval between drawn frames (ms). */
  interval = 1000 / 60;
  level = 0;
  /** Share of recently drawn frames that missed their slot (0..1), for the stats overlay. */
  missRatio = 0;
  private deltas: number[] = [];
  private lastRaf = 0;
  private lastFrame = 0;
  private drawn = 0;
  private missed = 0;
  private clean = 0;
  private lastUp = -Infinity;
  private upBlock = 20_000;
  private upAllowedAt = 0;

  constructor() {
    try {
      const l = Number(localStorage.getItem(LEVEL_KEY));
      if (Number.isFinite(l)) this.level = Math.max(0, Math.min(QUALITY_LADDER.length - 1, Math.round(l)));
    } catch {
      /* storage unavailable */
    }
  }

  get quality() {
    return QUALITY_LADDER[this.level];
  }

  /** Every rAF tick: returns the gap since the last drawn frame when this tick should draw, else 0. */
  tick(now: number, fps: number) {
    if (this.lastRaf) {
      const d = now - this.lastRaf;
      if (d > 2 && d < 60) {
        this.deltas.push(d);
        if (this.deltas.length > 90) this.deltas.shift();
        if (this.deltas.length >= 20 && this.deltas.length % 10 === 0) {
          const s = [...this.deltas].sort((a, b) => a - b);
          this.refresh = s[s.length >> 1];
        }
      }
    }
    this.lastRaf = now;
    const n = Math.max(1, Math.round(1000 / fps / this.refresh));
    this.interval = n * this.refresh;
    const gap = now - this.lastFrame;
    if (gap < this.interval - this.refresh * 0.5) return 0;
    this.lastFrame = now;
    return gap;
  }

  /**
   * After a drawn frame: tracks missed slots and, when `adaptive`, returns a new quality level
   * (or null when it stays).
   */
  judge(gap: number, now: number, adaptive: boolean): number | null {
    if (gap > 250) return null; // the window was hidden / throttled, not slow
    this.drawn++;
    if (gap > this.interval + this.refresh * 0.5) this.missed++;
    if (this.drawn < 120) return null;
    const ratio = this.missed / this.drawn;
    this.missRatio = ratio;
    this.drawn = this.missed = 0;
    if (!adaptive) return null;
    if (ratio > 0.1 && this.level < QUALITY_LADDER.length - 1) {
      // a step down; if the last step up caused this, wait longer before trying again
      if (now - this.lastUp < 20_000) this.upBlock = Math.min(600_000, this.upBlock * 2);
      this.upAllowedAt = now + this.upBlock;
      this.clean = 0;
      return this.set(this.level + 1);
    }
    if (ratio < 0.02) {
      this.clean++;
      if (this.clean >= 6 && this.level > 0 && now >= this.upAllowedAt) {
        this.clean = 0;
        this.lastUp = now;
        return this.set(this.level - 1);
      }
    } else this.clean = 0;
    return null;
  }

  set(level: number) {
    this.level = Math.max(0, Math.min(QUALITY_LADDER.length - 1, level));
    try {
      localStorage.setItem(LEVEL_KEY, String(this.level));
    } catch {
      /* storage unavailable */
    }
    return this.level;
  }
}
