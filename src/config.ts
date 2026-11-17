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
    xMin: -30,
    xMax: 30,
    zFront: 6,
    /** V3: the world reaches much further back (was -6) so Top View has real depth. The front
     * cut stays at z = 6, so the Front View composition and water thickness in front of the reef
     * are unchanged. */
    zBack: -13,
    waterLevel: 0,
    seabedY: -6.2,
    /** Shallow sand shelf the island rises from (lagoon side, left). */
    shelfY: -3.5,
    bottomY: -14,
  },

  camera: {
    /** Visible world height for wide screens (Front View). */
    viewHeight: 18,
    /** Narrow screens grow the view height so at least this width stays visible. */
    minViewWidth: 27,
    centerY: -0.6,
    /** Front View downward tilt in degrees so the water top and roofs read as 3D. V3: lowered
     * from 9.5° so the deeper water surface keeps the original sky / sea proportions. */
    tiltDeg: 7.2,
    distance: 60,
    /** Top View framing: keep this x–z area visible. */
    topWidth: 34,
    topDepth: 21.5,
    /** Seconds for the Front <-> Top transition. */
    transition: 1.1,
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
    simNX: 256,
    simNZ: 82,
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
    swimXMin: -24,
    swimXMax: 24,
    zMin: -13 + 0.8,
    zMax: 6 - 0.8,
  },

  performance: {
    activeFPS: 60,
    ambientFPS: 30,
    minPixelRatio: 0.6,
    maxPixelRatio: 1.5,
    ambientPixelRatioScale: 0.8,
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
export const zToDepth = (z: number) => (CONFIG.world.zFront - 0.7 - z) / (CONFIG.world.zFront - CONFIG.world.zBack - 1.4);

export type WaterPresetId = 'tropical' | 'lagoon' | 'deep' | 'seaglass' | 'sunset' | 'custom';

export const DEFAULTS = {
  tool: 'default' as const,
  waterPreset: 'tropical' as WaterPresetId,
  customColor: '#22b8c8',
  wind: CONFIG.wind.default,
};
