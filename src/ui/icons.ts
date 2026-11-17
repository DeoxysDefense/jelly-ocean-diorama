/** Minimal stroke icons (24x24, currentColor). Drawn for this project. */
const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  water: svg('<path d="M2 9c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/><path d="M2 14c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/><path d="M5 19h14"/>'),
  feed: svg('<path d="M12 3v3"/><circle cx="8" cy="10" r="1.3"/><circle cx="14" cy="9" r="1.3"/><circle cx="11" cy="14" r="1.3"/><circle cx="16" cy="15" r="1.3"/><path d="M3 19c2 0 2-1.4 4.5-1.4S10 19 12 19s2.5-1.4 4.5-1.4S19 19 21 19"/>'),
  sand: svg('<path d="M6 3h12M6 21h12"/><path d="M7 3c0 5 5 6 5 9s-5 4-5 9"/><path d="M17 3c0 5-5 6-5 9s5 4 5 9"/><path d="M9 19c1-1.6 5-1.6 6 0"/>'),
  select: svg('<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12"/><path d="M11 11.5V4a1.5 1.5 0 0 1 3 0v7.5"/><path d="M14 11V6a1.5 1.5 0 0 1 3 0v8"/><path d="M8 13l-1.6-1.6a1.6 1.6 0 0 0-2.3 2.2L8 18c1.5 2 3 3 5.5 3H14a5 5 0 0 0 5-5v-3"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  reset: svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
  play: svg('<path d="M6 5l13 7-13 7z"/>'),
  ambient: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z"/>'),
  chevronRight: svg('<path d="M9 6l6 6-6 6"/>'),
  sliders: svg('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  add: svg('<path d="M12 5v14M5 12h14"/>'),
  remove: svg('<path d="M5 12h14"/>'),
  current: svg('<path d="M4 12a8 8 0 1 1 8 8"/><path d="M8 12a4 4 0 1 1 4 4"/><path d="M12 12h.01"/><path d="M4 16v4h4"/>'),
  bubbles: svg('<circle cx="8" cy="15" r="4"/><circle cx="15.5" cy="8.5" r="2.8"/><circle cx="17.5" cy="16.5" r="1.6"/><path d="M6.6 13.4a2 2 0 0 1 1.4-.6"/>'),
  objects: svg('<path d="M12 21v-6"/><path d="M12 15c-3 0-5-2-5-5 2 0 3.5 1 5 3 1.5-2 3-3 5-3 0 3-2 5-5 5z"/><path d="M12 8V4"/><path d="M10 6l2-2 2 2"/><path d="M4 21h16"/>'),
  erase: svg('<path d="M20 20H9L4.5 15.5a2 2 0 0 1 0-2.8l8-8a2 2 0 0 1 2.8 0l4.2 4.2a2 2 0 0 1 0 2.8L12 19"/><path d="M8 11l5 5"/>'),
  smooth: svg('<path d="M3 15c3-6 6 2 9-2s6-2 9-4"/><path d="M3 19h18"/>'),
  island: svg('<path d="M3 18c3-4 6-5 9-5s6 1 9 5"/><path d="M12 13V6"/><path d="M12 6c-2-1-4-1-5 1M12 6c2-1 4-1 5 1M12 6c-1-2-1-3 1-4"/><path d="M2 21h20"/>'),
  redo: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
  save: svg('<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3"/><rect x="8" y="13" width="8" height="5" rx="1"/>'),
  load: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v6M9.5 13.5L12 16l2.5-2.5"/>'),
  viewFront: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 11c3 1.5 6-1.5 9 0s6-1.5 9 0"/><path d="M3 16h18"/>'),
  magnifier: svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/><path d="M7.5 9a3.5 3.5 0 0 1 3-2.5"/>'),
  viewTop: svg('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/><path d="M12 8.2v.01"/>'),
  place: svg('<path d="M12 21s-6-5.6-6-10a6 6 0 0 1 12 0c0 4.4-6 10-6 10z"/><path d="M12 8v5M9.5 10.5h5"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z"/>'),
  logo: `<svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8be3f0"/><stop offset="1" stop-color="#1690b0"/></linearGradient></defs><rect x="2" y="2" width="28" height="28" rx="9" fill="url(#lg)"/><path d="M2 17c4-2.5 7 2.5 14 0s10 2.5 14 0v6a7 7 0 0 1-7 7H9a7 7 0 0 1-7-7z" fill="#0d6f8c" opacity=".55"/><path d="M2 25c5-2 9 1 14 0s9-2 14 0v-2H2z" fill="#f1dca8"/><circle cx="21" cy="9.5" r="2.4" fill="#fff8d8"/></svg>`,
};
