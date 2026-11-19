import type { WaterPresetId } from '../config';

export interface PersistedSettings {
  preset?: WaterPresetId;
  customColor?: string;
  wind?: number;
  mode?: 'play' | 'ambient';
  panelCollapsed?: boolean;
  quality?: 'auto' | 'high' | 'low';
  /** V2: camera view + pans (Focus x, Top x / z / zoom). */
  cam?: { view?: string; focusX?: number; topX?: number; topZ?: number; topZoom?: number };
  /** V2: navigation preferences. */
  nav?: { drift?: boolean; minimap?: boolean };
}

const KEY = 'jelly-ocean-settings-v1';

/** Small, failure-tolerant localStorage persistence (private windows may block storage). */
export const Settings = {
  load(): PersistedSettings {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as PersistedSettings) : {};
    } catch {
      return {};
    }
  },
  save(s: PersistedSettings) {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* storage unavailable: settings simply won't persist */
    }
  },
};
