import type { WaterPresetId } from '../config';

export interface PersistedSettings {
  preset?: WaterPresetId;
  customColor?: string;
  wind?: number;
  mode?: 'play' | 'ambient';
  panelCollapsed?: boolean;
  quality?: 'auto' | 'high' | 'low';
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
