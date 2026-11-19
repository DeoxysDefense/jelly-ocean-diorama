/**
 * Central tunable configuration for the Jelly Ocean Diorama.
 *
 * Coordinate convention (used by every system):
 *   X = left / right, Y = height (water rest level y = 0), Z = depth into the ocean
 *   (z = zFront is the glass-like front cut facing the viewer, z = zBack is the far side).
 * Terrain is a heightfield H(x, z) = Hbase(x, z) + Hsand(x, z); the water surface is a
 * heightfield W(x, z, t). Front View sees the x–y cross-section, Top View the x–z plane.
 */
export const CONFIG = {
  world: {
    /** V2 (P1): a bounded micro-archipelago, ×1.7 wider than v1 (was -30 … 30). */
    xMin: -51,
    xMax: 51,
    zFront: 6,
    /** V2 (P1): ×1.5 deeper than v1 (was -13; v0 was -6). -22.6 (not -22.5) keeps the
     * 0.2-unit sand rows aligned with v1 grids, so old saves migrate without resampling loss. The front cut stays at z = 6, so the
     * Focus View cross-section and water thickness in front of the reef are unchanged. */
    zBack: -22.6,
    waterLevel: 0,
    seabedY: -6.2,
    /** Shallow sand shelf the island rises from (lagoon side, left). */
    shelfY: -3.5,
    bottomY: -14,
    /** Wooden display base under the diorama (seen in Full View). */
    plinthY: -15.3,
  },

  /**
   * The v1 world: every v1 system, save and composition was authored for this box. P1 keeps the
   * base terrain inside it unchanged (old saves must not move) and derives the Focus View
   * camera from it.
   */
  v1: { xMin: -30, xMax: 30, zBack: -13, tiltDeg: 7.2, centerY: -0.6 },

  camera: {
    /** Visible world height for wide screens (Front View). */
    viewHeight: 18,
    /** Narrow screens grow the view height so at least this width stays visible. */
    minViewWidth: 27,
    centerY: -0.6,
    /** v1 Front View tilt. The Focus View tilt is derived from it (see focusPose()) so the deeper
     * water keeps the v1 sky / sea / seabed proportions. */
    tiltDeg: 7.2,
    distance: 60,
    /** Top View framing at zoom 1 (same as v1): keep this x–z area visible. */
    topWidth: 34,
    topDepth: 21.5,
    /** Top View zoom limits (1 = v1 framing; < 1 zooms out). */
    topZoomMin: 0.55,
    topZoomMax: 2.6,
    /** Full View: tilt that shows the whole tray like a model on a table. */
    fullTiltDeg: 24,
    /** Seconds for a view transition. */
    transition: 1.25,
    /** Focus View auto drift speed (world units / s) — very slow. */
    driftSpeed: 0.16,
  },

  island: {
    x: -8.6,
    z: -0.6,
    /** Radial falloff f = exp(-(r / radius)^power) between the shelf and the peak. */
    radius: 4.0,
    power: 2.2,
    zScale: 1.15,
    peak: 1.25,
  },

  water: {
    /** Simulation cell size (v1: 256 x 82 cells over 60 x 19). The grid grows with the world;
     * calm tiles sleep, so cost follows the disturbed area, not the tray size. */
    simCellX: 60 / 255,
    simCellZ: 19 / 81,
    waveSpeed: 5.2,
    damping: 1.0,
    restoring: 1.4,
    maxDisplacement: 1.15,
    substeps: 2,
    hoverStrength: 1.0,
    dragStiffness: 26,
    dragRadius: 1.25,
    maxDragHeight: 1.0,
    clickImpulse: 3.2,
    bevelRadius: 0.6,
    refraction: 0.014,
  },

  wind: {
    default: 25,
    /** Lambda (1/s) for smoothing slider changes. */
    smoothing: 1.2,
  },

  feed: {
    pelletsPerClick: 7,
    maxPellets: 120,
    sinkSpeed: 0.33,
    floatTime: [0.4, 1.8] as [number, number],
    bottomLife: 28,
  },

  sand: {
    maxParticles: 2600,
    /** Grains per second at Amount = 100 %. */
    maxSpawnRate: 520,
    /** Volume (units^3) added per grain that settles. */
    grainVolume: 0.0016,
    /** tan(angle of repose) — steeper piles slide. */
    reposeSlope: 0.62,
    /** Height removed per second at the brush centre (Erase, Amount = 100 %). */
    removeRate: 1.6,
    /** Brush radius range mapped from the Size slider. */
    brushMin: 0.35,
    brushMax: 2.6,
    /** Added sand may build up to here (Island Stamp can reach above the water). */
    maxSediment: 9,
    /** Island Stamp: crest height above the water line. */
    islandCrest: 0.65,
  },

  current: {
    /** Max live flow emitters (a stroke deposits one every few cm). */
    maxEmitters: 72,
    life: 4.0,
    maxSpeed: 3.2,
  },

  creatures: {
    schoolCount: 44,
    cardinalCount: 16,
    clownCount: 3,
    tangCount: 4,
    butterflyCount: 3,
    angelCount: 2,
    jellyCount: 4,
    crabCount: 2,
    /** Fish keep at least this far below the water surface. */
    surfaceMargin: 0.3,
    /** Home range of the v1 residents (the main island + central reef keep v1 density). */
    swimXMin: -24,
    swimXMax: 24,
    zMin: -22.6 + 0.8,
    zMax: 6 - 0.8,
  },

  performance: {
    activeFPS: 60,
    ambientFPS: 30,
    /** Never render below this (the quality ladder cuts effects before pixels). */
    minPixelRatio: 0.75,
    maxPixelRatio: 1.5,
    msaaSamples: 4,
  },
};

/** Depth helper: map 0..1 (front..back) to a z inside the swimmable / editable volume. */
export const depthToZ = (t: number) => CONFIG.world.zFront - 0.7 - t * (CONFIG.world.zFront - CONFIG.world.zBack - 1.4);
/** Centre of the world along z (Top View framing). */
export const zCentre = () => (CONFIG.world.zFront + CONFIG.world.zBack) / 2;
/** Clamp z inside the world with a margin from the front cut and back wall. */
export const zClamp = (z: number, margin = 0.5) => Math.min(CONFIG.world.zFront - margin, Math.max(CONFIG.world.zBack + margin, z));
/**
 * Random z across the world depth. bias > 1 favours the front half, so the reef seen through
 * the front glass stays lively while the extra depth behind it stays calm and sparse.
 */
export const randZ = (margin = 2, bias = 1) => CONFIG.world.zFront - margin - Math.pow(Math.random(), bias) * (CONFIG.world.zFront - CONFIG.world.zBack - 2 * margin);
/** Clamp x inside the world with a margin from the side walls. */
export const xClamp = (x: number, margin = 0.5) => Math.min(CONFIG.world.xMax - margin, Math.max(CONFIG.world.xMin + margin, x));
export const zToDepth = (z: number) => (CONFIG.world.zFront - 0.7 - z) / (CONFIG.world.zFront - CONFIG.world.zBack - 1.4);

/**
 * Where the camera is currently looking (updated every frame by the App). Ambient particles —
 * marine snow, plankton, rain — live in this window, so they follow a panned Focus View and
 * spread over the whole tray in Full View.
 */
export const viewWindow = { cx: 0, halfW: 22 };
/** Random x inside the current view window (clamped to the world). */
export const randViewX = (margin = 1) => {
  const a = Math.max(CONFIG.world.xMin + margin, viewWindow.cx - viewWindow.halfW),
    b = Math.min(CONFIG.world.xMax - margin, viewWindow.cx + viewWindow.halfW);
  return a + Math.random() * (b - a);
};
/** True when x is outside the current view window. */
export const outsideView = (x: number) => Math.abs(x - viewWindow.cx) > viewWindow.halfW + 1;

/**
 * Focus View pose derived from the v1 Front View: in an orthographic camera, the water top band
 * spans depth · sin(tilt) on screen. The deeper world gets a lower tilt so the front waterline
 * and the far horizon land exactly where they were in v1 (sky / sea / seabed proportions stay).
 * Returns tilt (radians) and the target height for a target at z = 0.
 */
export function focusPose() {
  const V = CONFIG.v1,
    W = CONFIG.world;
  const t0 = (V.tiltDeg * Math.PI) / 180;
  const s = ((W.zFront - V.zBack) * Math.sin(t0)) / (W.zFront - W.zBack);
  const tilt = Math.asin(s);
  // screen height of the front waterline (y = 0, z = zFront) relative to the v1 target
  const yFront = -V.centerY * Math.cos(t0) - W.zFront * Math.sin(t0);
  const ty = (-W.zFront * s - yFront) / Math.cos(tilt);
  return { tilt, ty };
}

export type WaterPresetId = 'tropical' | 'lagoon' | 'deep' | 'seaglass' | 'sunset' | 'custom';

export const DEFAULTS = {
  tool: 'default' as const,
  waterPreset: 'tropical' as WaterPresetId,
  customColor: '#22b8c8',
  wind: CONFIG.wind.default,
};
