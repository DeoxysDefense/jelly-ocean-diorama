/** A small hidden performance readout (F9 or ?perf=1): helps judge smoothness on a real machine. */
export class PerfHud {
  private el: HTMLDivElement;
  private shown = false;
  private t = 0;

  constructor(host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'perf-hud';
    this.el.style.display = 'none';
    host.appendChild(this.el);
  }

  toggle() {
    this.shown = !this.shown;
    this.el.style.display = this.shown ? '' : 'none';
  }

  update(s: { fps: number; frameMs: number; stepMs: number; pixelRatio: number; level: number; miss: number; refreshHz: number }) {
    if (!this.shown) return;
    const now = performance.now();
    if (now - this.t < 250) return;
    this.t = now;
    this.el.textContent =
      `${s.fps.toFixed(0)} fps · ${s.refreshHz} Hz · frame ${s.frameMs.toFixed(1)} ms (sim ${s.stepMs.toFixed(1)}) · ` +
      `quality ${s.level} · px ${s.pixelRatio.toFixed(2)} · missed ${(s.miss * 100).toFixed(0)}%`;
  }
}
