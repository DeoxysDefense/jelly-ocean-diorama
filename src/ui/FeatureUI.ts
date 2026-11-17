import type { App } from '../core/App';
import { COCONUT_INTERVALS, MAIL_INTERVAL, type Frequency, type Lang } from '../features/Prefs';
import { formatDuration } from '../features/CoconutGrowth';
import type { OceanMessage } from '../content/messages';

const FREQ: { id: Frequency; label: string }[] = [
  { id: 'rare', label: 'Rare' },
  { id: 'normal', label: 'Normal' },
  { id: 'often', label: 'Often' },
];

const CAT_ICON: Record<OceanMessage['cat'], string> = {
  fact: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 15c3-6 9-8 15-5"/><path d="M18 10l3-2-1 4"/><circle cx="8" cy="13" r="0.8"/><path d="M3 15c3 2 8 3 13 0"/></svg>',
  fortune: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.8z"/></svg>',
  thought: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
};

/**
 * V3 panel additions (Magnifier zoom, Mini Activities, Island Life, Preferences) plus the Ocean
 * Mail parchment note. Injected into the existing Ocean Studio tabs so the sidebar keeps its look;
 * every new group is a collapsible <details>, closed by default, so nothing gets crowded.
 */
export class FeatureUI {
  private note: HTMLElement;
  private tick = 0;

  constructor(private app: App, private root: HTMLElement) {
    const interact = root.querySelector('[data-page="interact"]')!;
    interact.insertAdjacentHTML(
      'beforeend',
      `<div class="segmented three mag-sub" role="group" aria-label="Magnifier zoom">
         <button data-zoom="1.5">1.5×</button><button data-zoom="2">2×</button><button data-zoom="3">3×</button>
       </div>
       <details class="fold mini">
         <summary><span>Mini Activities</span><small class="mini-best"></small></summary>
         <div class="row">
           <button class="btn" data-game="skip">Stone Skipping</button>
           <button class="btn" data-game="hide">Octopus Hide &amp; Seek</button>
         </div>
       </details>`,
    );
    const nature = root.querySelector('[data-page="nature"]')!;
    nature.insertAdjacentHTML(
      'beforeend',
      `<details class="fold island-life">
         <summary><span>Island Life</span><small class="coco-next"></small></summary>
         <label class="switch"><input type="checkbox" data-coco="on"><span>Coconut growth</span></label>
         <div class="field-label gap"><span>Growth interval</span></div>
         <div class="segmented five-s coco-int">${COCONUT_INTERVALS.map((m) => `<button data-interval="${m}">${m < 60 ? `${m}m` : `${m / 60}h`}</button>`).join('')}</div>
         <div class="field-label gap"><span>Max per palm</span></div>
         <div class="segmented three coco-max"><button data-max="3">3</button><button data-max="4">4</button><button data-max="5">5</button></div>
         <p class="hint small coco-info"></p>
       </details>`,
    );
    const world = root.querySelector('[data-page="world"]')!;
    world.insertAdjacentHTML(
      'beforeend',
      `<details class="fold prefs">
         <summary><span>Preferences</span><small class="lang-now"></small></summary>
         <div class="field-label"><span>Language · 语言</span></div>
         <div class="segmented lang-seg"><button data-lang="zh">中文</button><button data-lang="en">English</button></div>
         <div class="pref-row"><label class="switch"><input type="checkbox" data-pref="mail"><span>Ocean Mail</span></label></div>
         <div class="segmented three" data-freq-group="mail">${FREQ.map((f) => `<button data-freq="${f.id}">${f.label}</button>`).join('')}</div>
         <div class="pref-row"><label class="switch"><input type="checkbox" data-pref="events"><span>Ocean Surprises</span></label></div>
         <div class="segmented three" data-freq-group="events">${FREQ.map((f) => `<button data-freq="${f.id}">${f.label}</button>`).join('')}</div>
         <p class="hint small">Bottles and surprises are rare and quiet: no popups, no sounds. They wait while you edit or play.</p>
       </details>`,
    );
    // Ocean Mail note
    this.note = document.createElement('div');
    this.note.className = 'note';
    this.note.setAttribute('role', 'dialog');
    this.note.innerHTML = `
      <div class="note-paper">
        <div class="note-head"><span class="note-cat"></span><button class="note-close" aria-label="Close">×</button></div>
        <p class="note-text"></p>
        <div class="note-foot"><span class="note-from"></span>
          <div class="note-lang"><button data-nlang="zh">中文</button><span>/</span><button data-nlang="en">EN</button></div>
        </div>
      </div>`;
    root.appendChild(this.note);
    this.bind();
    app.i18n.onChange(() => {
      this.renderNote();
      this.refresh();
    });
    app.prefs.onChange(() => this.refresh());
    app.mail.onOpen = () => this.openNote();
    this.refresh();
  }

  private q<T extends HTMLElement>(s: string) {
    return this.root.querySelector(s) as T;
  }
  private all<T extends HTMLElement>(s: string) {
    return Array.from(this.root.querySelectorAll(s)) as T[];
  }

  private bind() {
    const app = this.app;
    const P = app.prefs;
    this.all<HTMLButtonElement>('[data-zoom]').forEach((b) => b.addEventListener('click', () => app.magnifier.setZoom(Number(b.dataset.zoom))));
    this.all<HTMLButtonElement>('[data-game]').forEach((b) =>
      b.addEventListener('click', () => {
        app.games.start(b.dataset.game as 'skip' | 'hide');
        this.refresh();
      }),
    );
    this.q<HTMLInputElement>('[data-coco="on"]').addEventListener('change', (e) => app.coconuts.setEnabled((e.target as HTMLInputElement).checked));
    this.all<HTMLButtonElement>('[data-interval]').forEach((b) => b.addEventListener('click', () => app.coconuts.setInterval(Number(b.dataset.interval))));
    this.all<HTMLButtonElement>('[data-max]').forEach((b) => b.addEventListener('click', () => app.coconuts.setMax(Number(b.dataset.max))));
    this.all<HTMLButtonElement>('[data-lang]').forEach((b) => b.addEventListener('click', () => this.setLang(b.dataset.lang as Lang)));
    this.all<HTMLButtonElement>('[data-nlang]').forEach((b) => b.addEventListener('click', () => this.setLang(b.dataset.nlang as Lang)));
    this.all<HTMLInputElement>('[data-pref]').forEach((c) =>
      c.addEventListener('change', () => {
        const k = c.dataset.pref as 'mail' | 'events';
        P.data[k].on = c.checked;
        P.changed();
      }),
    );
    this.all<HTMLElement>('[data-freq-group]').forEach((g) =>
      g.querySelectorAll<HTMLButtonElement>('[data-freq]').forEach((b) =>
        b.addEventListener('click', () => {
          const k = g.dataset.freqGroup as 'mail' | 'events';
          if (P.data[k].freq === b.dataset.freq) return;
          P.data[k].freq = b.dataset.freq as Frequency;
          if (k === 'mail') app.mail.reschedule();
          else app.events.reschedule();
          P.changed();
        }),
      ),
    );
    this.q<HTMLButtonElement>('.note-close').addEventListener('click', () => this.closeNote());
    // keep panel clicks from reaching the canvas handlers
    this.note.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  private setLang(l: Lang) {
    this.app.prefs.data.lang = l;
    this.app.prefs.changed();
    this.app.i18n.set(l);
  }

  // ---------------------------------------------------------------- note
  get noteOpen() {
    return this.note.classList.contains('show');
  }
  private openNote() {
    this.renderNote();
    this.note.classList.remove('show');
    void this.note.offsetWidth; // restart the unfold animation
    this.note.classList.add('show');
  }
  closeNote() {
    if (!this.noteOpen) return;
    this.note.classList.remove('show');
    this.note.classList.add('closing');
    window.setTimeout(() => this.note.classList.remove('closing'), 450);
    this.app.mail.closed();
  }
  private renderNote() {
    const m = this.app.mail.current;
    if (!m) return;
    const i = this.app.i18n;
    const zh = i.lang === 'zh';
    this.q<HTMLElement>('.note-cat').innerHTML = `${CAT_ICON[m.cat]}<span>${i.t(m.cat === 'fact' ? 'mail.fact' : m.cat === 'fortune' ? 'mail.fortune' : 'mail.thought')}</span>`;
    const text = this.q<HTMLElement>('.note-text');
    text.textContent = zh ? m.zh : m.en;
    text.lang = zh ? 'zh-CN' : 'en';
    this.q<HTMLElement>('.note-from').textContent = i.t('mail.from');
    this.q<HTMLButtonElement>('.note-close').title = i.t('mail.close');
    this.all<HTMLButtonElement>('[data-nlang]').forEach((b) => b.classList.toggle('active', b.dataset.nlang === i.lang));
  }

  // ---------------------------------------------------------------- refresh
  update(dt: number) {
    this.tick -= dt;
    if (this.tick <= 0) {
      this.tick = 1;
      this.refreshTimers();
    }
  }

  private refreshTimers() {
    const app = this.app;
    const ms = app.coconuts.nextIn();
    const ripe = app.coconuts.ripeTotal();
    const i = app.i18n;
    const next = !app.prefs.data.coconut.on ? i.t('island.off') : ms === null ? i.t('island.full') : `${i.t('island.next')} ${formatDuration(ms)}`;
    this.q<HTMLElement>('.coco-next').textContent = next;
    this.q<HTMLElement>('.coco-info').textContent = `${ripe} ${i.t('island.ripe')} · ${next}. Click a ripe coconut to pick it, or click a palm to shake it.`;
  }

  refresh() {
    const app = this.app;
    const P = app.prefs.data;
    this.q<HTMLElement>('.mag-sub').classList.toggle('open', app.tools.tool === 'magnify');
    this.all<HTMLButtonElement>('[data-zoom]').forEach((b) => b.classList.toggle('active', Number(b.dataset.zoom) === P.magnifierZoom));
    this.all<HTMLButtonElement>('[data-game]').forEach((b) => b.classList.toggle('active', app.games.active?.id === b.dataset.game));
    this.q<HTMLElement>('.mini-best').textContent = P.bestSkips ? `best ${P.bestSkips} skips` : '';
    this.q<HTMLInputElement>('[data-coco="on"]').checked = P.coconut.on;
    this.all<HTMLButtonElement>('[data-interval]').forEach((b) => b.classList.toggle('active', Number(b.dataset.interval) === P.coconut.intervalMin));
    this.all<HTMLButtonElement>('[data-max]').forEach((b) => b.classList.toggle('active', Number(b.dataset.max) === P.coconut.max));
    this.all<HTMLButtonElement>('[data-lang]').forEach((b) => b.classList.toggle('active', b.dataset.lang === P.lang));
    this.q<HTMLElement>('.lang-now').textContent = P.lang === 'zh' ? '中文' : 'English';
    for (const k of ['mail', 'events'] as const) {
      this.q<HTMLInputElement>(`[data-pref="${k}"]`).checked = P[k].on;
      const g = this.q<HTMLElement>(`[data-freq-group="${k}"]`);
      g.classList.toggle('off', !P[k].on);
      g.querySelectorAll<HTMLButtonElement>('[data-freq]').forEach((b) => b.classList.toggle('active', b.dataset.freq === P[k].freq));
    }
    this.refreshTimers();
    void MAIL_INTERVAL;
  }
}
