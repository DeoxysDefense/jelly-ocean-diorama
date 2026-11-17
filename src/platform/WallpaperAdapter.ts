import type { App } from '../core/App';
import { PRESET_LIST } from '../water/WaterColor';
import type { WaterPresetId } from '../config';

/**
 * Bridges desktop wallpaper hosts to the app.
 *
 * Lively Wallpaper (https://github.com/rocksdanister/lively/wiki/Web-Guide):
 *  - window.livelyPropertyListener(name, value) receives LivelyProperties.json controls
 *  - window.livelyWallpaperPlaybackChanged(json) receives { IsPaused } when a fullscreen app
 *    covers the desktop — we pause rendering completely.
 *  - Mouse input is only forwarded when "Wallpaper Input: Mouse" is enabled in Lively and the
 *    pointer is over empty desktop; drags are not guaranteed. The adapter therefore defaults
 *    wallpaper sessions to Ambient mode, where hover and simple clicks are enough.
 *
 * Wallpaper Engine (web wallpaper) is also supported via window.wallpaperPropertyListener.
 *
 * URL flags: ?wallpaper=1 (host mode, starts in Ambient), ?mode=play|ambient, ?ui=0
 */
export class WallpaperAdapter {
  readonly isHost: boolean;
  paused = false;

  constructor(private app: App) {
    const q = new URLSearchParams(location.search);
    const ua = navigator.userAgent;
    this.isHost = q.get('wallpaper') === '1' || /Lively/i.test(ua) || q.has('lively');
    const w = window as any;

    w.livelyPropertyListener = (name: string, val: unknown) => this.applyProperty(name, val);
    w.livelyWallpaperPlaybackChanged = (data: string) => {
      try {
        const obj = JSON.parse(data);
        this.setPaused(!!obj.IsPaused);
      } catch {
        /* ignore malformed */
      }
    };
    w.wallpaperPropertyListener = {
      applyUserProperties: (props: Record<string, { value: unknown }>) => {
        for (const [k, v] of Object.entries(props)) this.applyProperty(k, v.value);
      },
      setPaused: (p: boolean) => this.setPaused(p),
    };

    const mode = q.get('mode');
    if (mode === 'ambient' || mode === 'play') app.tools.setMode(mode);
    else if (this.isHost) app.tools.setMode('ambient');
  }

  setPaused(p: boolean) {
    this.paused = p;
    this.app.setPaused(p);
    // a fullscreen app covered the desktop: leave any mini game so nothing is left mid-throw
    if (p) this.app.games.exit();
  }

  /** Property names match lively/LivelyProperties.json. */
  applyProperty(name: string, val: unknown) {
    const app = this.app;
    switch (name) {
      case 'windStrength':
        app.env.setWind(Number(val));
        break;
      case 'waterColor': {
        const idx = Number(val);
        const p = PRESET_LIST[idx];
        if (p) app.env.setPreset(p.id as WaterPresetId);
        break;
      }
      case 'customColor':
        if (typeof val === 'string') app.env.setCustomColor(val.length === 9 ? '#' + val.slice(3) : val);
        break;
      case 'timeMode': {
        const m = (['manual', 'cycle', 'clock'] as const)[Number(val)] ?? 'clock';
        if (m === 'manual') app.env.setTime(14.5);
        app.env.setTimeMode(m);
        break;
      }
      case 'rain':
        app.env.setRain(Number(val));
        break;
      case 'tide':
        app.env.setTideMode(val ? 'auto' : 'manual');
        if (!val) app.env.setSeaLevel(0);
        break;
      case 'playMode':
        app.tools.setMode(val ? 'play' : 'ambient');
        break;
      case 'language': {
        const i = Number(val);
        if (i !== 1 && i !== 2) break; // Auto: keep whatever the user picked in the app
        const lang = i === 1 ? 'zh' : 'en';
        app.prefs.data.lang = lang;
        app.prefs.changed();
        app.i18n.set(lang);
        break;
      }
      case 'oceanMail':
        app.prefs.data.mail.on = !!val;
        app.prefs.changed();
        break;
      case 'surprises':
        app.prefs.data.events.on = !!val;
        app.prefs.changed();
        break;
      case 'surpriseFrequency': {
        const f = (['rare', 'normal', 'often'] as const)[Number(val)] ?? 'normal';
        if (app.prefs.data.events.freq !== f) {
          app.prefs.data.events.freq = f;
          app.events.reschedule();
        }
        app.prefs.changed();
        break;
      }
      case 'quality':
        app.setQuality(['auto', 'high', 'low'][Number(val)] as 'auto' | 'high' | 'low');
        break;
      case 'resetWorld':
        app.resetWorld();
        break;
    }
  }
}
