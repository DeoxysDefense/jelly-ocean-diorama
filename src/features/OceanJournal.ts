import type { App } from '../core/App';
import { dayKey, dayLabel, memoryLine, memorySentence, regionName, timeWord, uiText, type BirthMeta } from '../content/journal';
import { pageName, pageNotes } from '../content/notebook';
import type { WorldMemory } from './WorldMemory';
import type { Creations, CreationItem } from './Creations';

const BOOK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5C6.5 4 9.5 4 12 5.5 14.5 4 17.5 4 20 5.5V19c-2.5-1.5-5.5-1.5-8 0-2.5-1.5-5.5-1.5-8 0z"/><path d="M12 5.5V19"/></svg>';

type Tab = 'memory' | 'mine' | 'book';

/**
 * V2 (P2) Ocean Journal: a small diary beside the panel, closed by default.
 *  - World Memory: what this sea has seen (append-only, survives Undo and Reset).
 *  - My Ocean: what you made here (derived from the world as it is now).
 * No badges, no counters, no pop-ups: new lines are simply there when you open it.
 */
export class OceanJournal {
  readonly memory: WorldMemory;
  readonly creations: Creations;
  readonly el: HTMLElement;
  private body: HTMLElement;
  private tab: Tab = 'memory';
  private open = false;
  private refreshT = 0;
  private rainT = 0;
  private rainEpisode = false;
  private editing = false;

  constructor(private app: App, root: HTMLElement) {
    this.memory = app.memory;
    this.creations = app.creations;
    const conditions = (): BirthMeta => ({
      h: Math.round(app.env.timeOfDay * 10) / 10,
      rain: +app.env.atm.rain.toFixed(2),
      wind: +app.env.wind.toFixed(2),
      night: +app.env.atm.night.toFixed(2),
    });
    this.creations.conditions = conditions;
    this.creations.names = this.memory.data.names;
    this.creations.onRename = () => this.memory.changed();
    this.memory.hour = () => app.env.timeOfDay;

    this.el = document.createElement('section');
    this.el.className = 'journal';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.innerHTML = `
      <header class="journal-head">
        <h2></h2>
        <button class="journal-close" aria-label="close">×</button>
      </header>
      <nav class="journal-tabs" role="tablist">
        <button data-jtab="memory" role="tab"></button>
        <button data-jtab="mine" role="tab"></button>
        <button data-jtab="book" role="tab"></button>
      </nav>
      <p class="journal-sub"></p>
      <div class="journal-body"></div>`;
    root.appendChild(this.el);
    this.body = this.el.querySelector('.journal-body')!;
    this.el.querySelector('.journal-close')!.addEventListener('click', () => this.setOpen(false));
    this.el.querySelectorAll<HTMLButtonElement>('[data-jtab]').forEach((b) =>
      b.addEventListener('click', () => {
        this.tab = b.dataset.jtab as Tab;
        this.render();
      }),
    );
    // keep keys typed while renaming out of the app's shortcuts
    this.el.addEventListener('keydown', (e) => e.stopPropagation());
    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.toLowerCase() === 'j' && app.tools.mode === 'play') this.toggle();
    });
    app.i18n.onChange(() => this.render());
    app.tools.onChange(() => {
      if (app.tools.mode !== 'play' && this.open) this.setOpen(false);
    });
    // the creatures report small behaviours (hermit crab moving house, octopus ink …)
    app.ctx.note = (k, p, pos) => {
      this.memory.log(k, p);
      if (pos) app.notebook.behaviour(k, pos);
    };
  }

  /** Small book button for the panel header / nav dock. */
  static buttonHTML(cls = 'icon-btn journal-btn') {
    return `<button class="${cls}" aria-label="Ocean Journal">${BOOK}</button>`;
  }

  get isOpen() {
    return this.open;
  }

  toggle() {
    this.setOpen(!this.open);
  }

  setOpen(on: boolean) {
    this.open = on;
    this.el.classList.toggle('open', on);
    this.el.setAttribute('aria-hidden', on ? 'false' : 'true');
    if (on) this.render();
  }

  // ------------------------------------------------------------------ watchers
  update(dt: number) {
    const app = this.app;
    // a heavy shower (not every drizzle) is remembered once per episode
    const rain = app.env.atm.rain;
    if (rain > 0.55) this.rainT += dt;
    else if (rain < 0.2) {
      this.rainT = 0;
      this.rainEpisode = false;
    }
    if (this.rainT > 20 && !this.rainEpisode) {
      this.rainEpisode = true;
      this.memory.log('rain');
    }
    // the tidal flats dry at low tide (at most once a day)
    if (app.sim.level < -0.75) this.memory.log('lowTide');
    // keep an open journal fresh
    if (this.open && !this.editing) {
      this.refreshT -= dt;
      if (this.refreshT <= 0) {
        this.refreshT = 4;
        this.render();
      }
    }
  }

  // ------------------------------------------------------------------ render
  render() {
    if (!this.open && this.body.childElementCount) return;
    const lang = this.app.i18n.lang;
    this.el.querySelector('h2')!.textContent = uiText('title', lang);
    (this.el.querySelector('.journal-close') as HTMLElement).title = uiText('close', lang);
    this.el.querySelectorAll<HTMLButtonElement>('[data-jtab]').forEach((b) => {
      b.textContent = uiText(b.dataset.jtab === 'memory' ? 'memory' : b.dataset.jtab === 'mine' ? 'mine' : 'book', lang);
      b.classList.toggle('active', b.dataset.jtab === this.tab);
      b.setAttribute('aria-selected', String(b.dataset.jtab === this.tab));
    });
    this.el.querySelector('.journal-sub')!.textContent = uiText(this.tab === 'memory' ? 'memoryNote' : this.tab === 'mine' ? 'mineNote' : 'bookNote', lang);
    if (this.tab === 'memory') this.renderMemory();
    else if (this.tab === 'mine') this.renderMine();
    else this.renderBook();
  }

  private renderMemory() {
    const lang = this.app.i18n.lang;
    const now = Date.now();
    const days = this.memory.byDay();
    if (!days.length) {
      this.body.innerHTML = `<p class="journal-empty">${esc(uiText('memoryEmpty', lang))}</p>`;
      return;
    }
    this.body.innerHTML = days
      .map((d) => {
        const lines = d.entries
          .map((e) => {
            const line = memoryLine(e.k, e.p, e.n ?? 1, lang);
            const hour = e.k === 'summary' || e.k === 'lowTide' ? undefined : e.h;
            return `<li>${esc(memorySentence(hour, line, lang))}</li>`;
          })
          .join('');
        return `<section class="journal-day"><h3>${esc(dayLabel(d.t, now, lang))}</h3><ul>${lines}</ul></section>`;
      })
      .join('');
  }

  private renderMine() {
    const lang = this.app.i18n.lang;
    const items = this.creations.list(lang);
    if (!items.length) {
      this.body.innerHTML = `<p class="journal-empty">${esc(uiText('mineEmpty', lang))}</p>`;
      return;
    }
    const now = Date.now();
    const groups: { key: string; t: number; items: CreationItem[] }[] = [];
    for (const it of items) {
      const k = it.bornAt ? dayKey(it.bornAt) : 'before';
      const g = groups[groups.length - 1];
      if (g && g.key === k) g.items.push(it);
      else groups.push({ key: k, t: it.bornAt, items: [it] });
    }
    const title = esc(uiText('rename', lang));
    this.body.innerHTML = groups
      .map((g) => {
        const head = g.key === 'before' ? (lang === 'zh' ? '更早以前' : 'Earlier') : dayLabel(g.t, now, lang);
        const lines = g.items
          .map(
            (it) =>
              `<li data-cid="${esc(it.id)}"><button class="journal-name${it.custom ? ' custom' : ''}" title="${title}">${esc(it.name)}</button><small>${esc(regionName(it.region, lang))}</small></li>`,
          )
          .join('');
        return `<section class="journal-day"><h3>${esc(head)}</h3><ul class="journal-mine">${lines}</ul></section>`;
      })
      .join('');
    this.body.querySelectorAll<HTMLButtonElement>('.journal-name').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.closest('li')!.dataset.cid!;
        const item = items.find((i) => i.id === id);
        if (item) this.beginRename(b, item);
      }),
    );
  }

  /** Field Notebook: one page per thing you have seen, in the order you met them. */
  private renderBook() {
    const lang = this.app.i18n.lang;
    const pages = this.app.notebook.pages();
    if (!pages.length) {
      this.body.innerHTML = `<p class="journal-empty">${esc(uiText('bookEmpty', lang))}</p>`;
      return;
    }
    const now = Date.now();
    const other = lang === 'zh' ? 'en' : 'zh';
    this.body.innerHTML = pages
      .map((p) => {
        const when = `${dayLabel(p.t, now, lang)}${lang === 'zh' ? ' ' : ', '}${p.h !== undefined ? timeWord(p.h, lang).replace(/^(At|In the|Around) /, (m) => (lang === 'en' ? m.toLowerCase() : m)) : ''}`;
        const img = p.img ? `<img src="${p.img}" alt="" loading="lazy">` : `<div class="book-noimg"></div>`;
        return `<article class="book-page">${img}<div class="book-text"><h4>${esc(pageName(p.key, lang))}<small>${esc(pageName(p.key, other))}</small></h4><p>${esc(pageNotes(p.key, lang))}</p><footer>${esc(uiText('firstSeen', lang))}：${esc(when.trim())}</footer></div></article>`;
      })
      .join('');
  }

  private beginRename(btn: HTMLButtonElement, item: CreationItem) {
    this.editing = true;
    const input = document.createElement('input');
    input.className = 'journal-input';
    input.value = item.name;
    input.maxLength = 40;
    btn.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      this.editing = false;
      if (save) {
        // an empty name goes back to the automatic one
        item.rename(input.value.trim() === item.name && !item.custom ? '' : input.value);
      }
      this.render();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

