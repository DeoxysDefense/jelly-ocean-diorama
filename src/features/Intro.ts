import type { App } from '../core/App';
import { L, T, TA } from '../ui/lang';
import { rand } from '../util/math';

const KEY = 'jelly-ocean-intro-v1';

const CARDS: [string, string][] = [
  ['Move the pointer across the water — it ripples. Drag to lift or press it.', '鼠标划过水面会泛起涟漪，按住拖动可以把水托起或压下。'],
  ['Rest the pointer on a creature and it notices you. Click it, or press and hold.', '鼠标停在生物身上，它会注意到你。点一下，或者按住不放试试。'],
  ['Everything else is up in the top-right corner: views, sound, the journal and settings.', '其他一切都在右上角：视角、声音、日记和设置。'],
  ['Just want to watch? Press A for ambient mode. Enjoy the sea.', '只想静静地看着它？按 A 进入观赏模式。好好享受这片海。'],
];

/**
 * First visit: the empty tray fills with water, the fish swim in from the edges, and four short
 * cards show what you can do — then everything fades away and never comes back by itself (it can
 * be replayed from Settings). Skipped on wallpaper / ambient starts and in scripted captures.
 */
export class Intro {
  private el: HTMLElement;
  private phase: 'idle' | 'fill' | 'arrive' | 'cards' = 'idle';
  private t = 0;
  private card = 0;
  private cardT = 0;
  private from = 0;
  private bubbleT = 0;

  constructor(private app: App, root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'intro-card';
    this.el.innerHTML = `<p class="intro-text"></p>
      <div class="intro-foot"><span class="intro-dots"></span>
        <button class="intro-next">${T('Next', '下一条')}</button>
        <button class="intro-skip" ${TA('Skip the introduction', '跳过引导')}>${T('Skip', '跳过')}</button></div>`;
    root.appendChild(this.el);
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.querySelector('.intro-next')!.addEventListener('click', () => this.next());
    this.el.querySelector('.intro-skip')!.addEventListener('click', () => this.finish());
    app.i18n.onChange(() => this.render());
  }

  get active() {
    return this.phase !== 'idle';
  }

  static seen() {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return true;
    }
  }

  /** Starts the introduction (first visit only unless `force`). */
  play(force = false) {
    if (this.active) return;
    const q = new URLSearchParams(location.search);
    if (!force && (Intro.seen() || this.app.tools.mode !== 'play' || q.has('panel') || q.has('nointro'))) return;
    this.phase = 'fill';
    this.t = 0;
    this.card = 0;
    this.from = this.app.env.seaLevel - 4.5;
    // the fish wait outside; they swim in once there is water
    for (const f of this.app.creatures.fish.fish) f.active = false;
    this.app.ui?.setCollapsed(true);
  }

  /** While filling, the water rises from the bottom of the tray to the sea level. */
  levelOverride(target: number): number | null {
    if (this.phase !== 'fill') return null;
    const k = Math.min(1, this.t / 4.5);
    const e = 1 - Math.pow(1 - k, 3);
    return this.from + (target - this.from) * e;
  }

  update(dt: number) {
    if (this.phase === 'idle') return;
    this.t += dt;
    const app = this.app;
    switch (this.phase) {
      case 'fill': {
        // a few bubbles escape from the sand as the water comes in
        this.bubbleT -= dt;
        if (this.bubbleT <= 0) {
          this.bubbleT = 0.12;
          const x = app.cam.pose.tx + rand(-14, 14),
            z = rand(-6, 3);
          const g = app.terrain.heightAt(x, z);
          if (g < app.sim.level - 0.3) app.bubbles.emit(x, g + 0.1, z, 2, 0.2, 0.8);
        }
        if (this.t >= 4.6) {
          this.phase = 'arrive';
          this.t = 0;
          for (let i = 0; i < 5; i++) app.sim.addRipple(app.cam.pose.tx + rand(-10, 10), rand(-3, 3), 0.04);
          const fs = app.creatures.fish;
          for (const sp of Object.keys(fs.want)) fs.setCount(sp, fs.want[sp]);
        }
        break;
      }
      case 'arrive':
        if (this.t >= 2.5) {
          this.phase = 'cards';
          this.card = 0;
          this.cardT = 0;
          this.render();
          this.el.classList.add('show');
        }
        break;
      case 'cards':
        this.cardT += dt;
        if (this.cardT > 7) this.next();
        break;
    }
  }

  private next() {
    if (this.card >= CARDS.length - 1) return this.finish();
    this.card++;
    this.cardT = 0;
    this.render();
  }

  private render() {
    if (this.phase !== 'cards') return;
    const [en, zh] = CARDS[this.card];
    this.el.querySelector('.intro-text')!.textContent = L(en, zh);
    this.el.querySelector('.intro-dots')!.innerHTML = CARDS.map((_, i) => `<i class="${i === this.card ? 'on' : ''}"></i>`).join('');
    const nxt = this.el.querySelector<HTMLElement>('.intro-next span')!;
    nxt.dataset.en = this.card === CARDS.length - 1 ? 'Done' : 'Next';
    nxt.dataset.zh = this.card === CARDS.length - 1 ? '好的' : '下一条';
    nxt.textContent = L(nxt.dataset.en, nxt.dataset.zh);
  }

  /** Ends (or skips) the introduction; it will not start by itself again. */
  finish() {
    if (this.phase === 'fill' || this.phase === 'arrive') {
      const fs = this.app.creatures.fish;
      for (const sp of Object.keys(fs.want)) fs.setCount(sp, fs.want[sp]);
    }
    this.phase = 'idle';
    this.el.classList.remove('show');
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* storage unavailable */
    }
  }
}
