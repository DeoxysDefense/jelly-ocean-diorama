import * as THREE from 'three';
import { CONFIG, DEFAULTS, outsideView, viewWindow, zCentre } from '../config';
import { CameraManager } from './CameraManager';
import { RenderPipeline } from './RenderPipeline';
import { EnvironmentController } from './EnvironmentController';
import { WaterSurfaceSimulation } from '../water/WaterSurfaceSimulation';
import { WaterColorController, PRESETS } from '../water/WaterColor';
import { OceanRenderer } from '../water/OceanRenderer';
import { TerrainSystem } from '../world/TerrainSystem';
import { Sky } from '../world/Sky';
import { Lighting } from '../world/Lighting';
import { Island } from '../world/Island';
import { Reef } from '../world/Reef';
import { Archipelago } from '../world/Archipelago';
import { Plinth } from '../world/Plinth';
import { Habitat } from '../world/Habitat';
import { Bubbles, MarineSnow, pointScale } from '../world/Particles';
import { CurrentStreaks } from '../world/CurrentStreaks';
import { SedimentSimulation } from '../world/SedimentSimulation';
import { CreatureManager } from '../creatures/CreatureManager';
import { FoodSystem } from '../creatures/FoodSystem';
import type { WorldContext } from '../creatures/types';
import { ToolStateManager } from '../interaction/ToolStateManager';
import { HistoryManager, type HistoryEntry } from '../interaction/HistoryManager';
import { SelectionManager } from '../interaction/SelectionManager';
import { InteractionManager } from '../interaction/InteractionManager';
import { UIController } from '../ui/UIController';
import { WallpaperAdapter } from '../platform/WallpaperAdapter';
import { Settings } from '../platform/Settings';
import { WorldStore } from '../platform/WorldStore';
import { FlowField } from '../world/FlowField';
import { Plankton } from '../world/Plankton';
import { Rain } from '../world/Rain';
import { Floaters } from '../world/Floaters';
import { shared } from '../util/shaders';
import { Prefs } from '../features/Prefs';
import { I18n } from '../features/i18n';
import { Spray } from '../features/fx';
import { OceanMail } from '../features/OceanMail';
import { CoconutGrowth } from '../features/CoconutGrowth';
import { OceanEventManager } from '../features/OceanEvents';
import { Magnifier } from '../features/Magnifier';
import { MiniGameManager } from '../features/MiniGames';
import { FeatureUI } from '../ui/FeatureUI';
import { CameraNav } from '../features/CameraNav';
import { MiniMap } from '../features/MiniMap';
import { OceanJournal } from '../features/OceanJournal';
import { WorldMemory } from '../features/WorldMemory';
import { Creations } from '../features/Creations';
import { RareVisitors } from '../features/RareVisitors';
import { AmbientSound } from '../features/AmbientSound';
import { Intro } from '../features/Intro';
import { L, setUiLang } from '../ui/lang';
import { FramePacer, LOW_LEVEL, QUALITY_LADDER } from './FramePacer';
import { PerfHud } from '../ui/PerfHud';
import { FieldNotebook } from '../features/FieldNotebook';

type Quality = 'auto' | 'high' | 'low';

/**
 * SceneManager / application root. Owns the renderer, systems and the main loop.
 */
export class App {
  readonly renderer: THREE.WebGLRenderer;
  readonly cam = new CameraManager();
  readonly pipeline: RenderPipeline;
  readonly world = new THREE.Scene();
  readonly waterScene = new THREE.Scene();
  readonly sim = new WaterSurfaceSimulation();
  readonly colors = new WaterColorController(PRESETS.tropical);
  readonly env = new EnvironmentController(this.colors);
  readonly terrain = new TerrainSystem();
  readonly sky = new Sky();
  readonly lighting = new Lighting();
  readonly ocean: OceanRenderer;
  readonly island: Island;
  readonly reef: Reef;
  readonly archipelago: Archipelago;
  readonly plinth = new Plinth();
  readonly bubbles: Bubbles;
  readonly streaks: CurrentStreaks;
  readonly snow: MarineSnow;
  readonly sediment: SedimentSimulation;
  readonly creatures: CreatureManager;
  readonly tools = new ToolStateManager();
  readonly history: HistoryManager;
  readonly selection: SelectionManager;
  readonly interaction: InteractionManager;
  ui: UIController | null = null;
  readonly wallpaper: WallpaperAdapter;
  readonly flow = new FlowField();
  readonly plankton: Plankton;
  readonly rain: Rain;
  readonly floaters: Floaters;
  // ---- V3: discovery & mini games
  readonly prefs = new Prefs();
  readonly i18n: I18n;
  readonly spray = new Spray();
  readonly mail: OceanMail;
  readonly coconuts: CoconutGrowth;
  readonly events: OceanEventManager;
  readonly magnifier: Magnifier;
  readonly games: MiniGameManager;
  featureUI: FeatureUI | null = null;
  nav!: CameraNav;
  minimap!: MiniMap;
  /** V2 (P2) Ocean Journal: world memory, what you made, and the diary UI. */
  readonly memory = new WorldMemory();
  readonly creations: Creations;
  journal!: OceanJournal;
  /** V2 (P3) rare visitors and the Field Notebook. */
  readonly visitors: RareVisitors;
  readonly sound: AmbientSound;
  readonly notebook: FieldNotebook;
  private hutPos = new THREE.Vector3();
  private tmpV = new THREE.Vector3();
  private lastDt = 1 / 60;
  private lastLevel = 0;
  private lastMode = 'play';

  private clock = new THREE.Clock();
  time = 0;
  private paused = false;
  /** Even frame pacing on any refresh rate + automatic quality ladder. */
  readonly pacer = new FramePacer();
  /** Hidden performance readout: F9 (or ?perf=1). */
  perfHud: PerfHud | null = null;
  /** First-visit welcome (water fills in, fish arrive, a few short cards). */
  intro: Intro | null = null;
  private shadowStamp = -1;
  private pixelRatio = 1;
  private quality: Quality = 'auto';
  private frameCount = 0;
  private maskVersion = -1;
  readonly ctx: WorldContext;
  stats = { fps: 0, frameMs: 0, stepMs: 0, pixelRatio: 1, level: 0, miss: 0, refreshHz: 60 };

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false });
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;
    this.renderer.domElement.tabIndex = 0;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.ui?.toast(L('Graphics context lost — reload to restore', '图形环境丢失，请刷新页面恢复'));
    });

    this.pipeline = new RenderPipeline(this.renderer);
    this.ocean = new OceanRenderer(this.sim, this.colors, this.pipeline, this.cam);
    this.island = new Island(this.terrain);
    this.reef = new Reef(this.terrain);
    this.archipelago = new Archipelago(this.terrain, this.island);
    this.creations = new Creations(this.terrain, this.reef);
    this.world.add(this.sky.mesh, this.lighting.group, this.terrain.group, this.ocean.worldGroup, this.island.group, this.reef.group, this.archipelago.group, this.plinth.group);
    this.hutPos.set(CONFIG.island.x + 0.35, 1.9, CONFIG.island.z);
    this.waterScene.add(this.ocean.waterMesh);

    const food = new FoodSystem(this.terrain, this.sim);
    this.ctx = {
      terrain: this.terrain,
      water: this.sim,
      reef: this.reef,
      food,
      flow: this.flow,
      obstacles: () => this.reef.obstacles(),
      creatureObstacles: [],
      visibleX: this.cam.homeVisibleX(),
      habitat: new Habitat(this.terrain, this.reef),
    };
    this.creatures = new CreatureManager(this.ctx, food);
    this.world.add(this.creatures.group);
    food.onSplash = (x, z) => this.creatures.ripple(x, z, 0.15);
    this.ctx.onEat = (p) => this.bubbles.emit(p.x, p.y, p.z, 2, 0.04, 0.5);

    this.bubbles = new Bubbles(this.sim, () => [
      this.reef.denPos.clone().add(new THREE.Vector3(0.3, 0.6, -0.3)),
      this.reef.anemonePos.clone(),
      // only corals in view breathe bubbles (the lagoon reefs would otherwise steal them)
      ...this.reef.selectables.filter((s) => s.kind === 'coral' && !outsideView(s.object.position.x)).map((s) => s.object.position.clone().add(new THREE.Vector3(0, s.height * 0.7, 0))),
    ]);
    this.snow = new MarineSnow(this.terrain);
    this.sediment = new SedimentSimulation(this.terrain, this.sim, () => this.reef.obstacles());
    this.sediment.onSettle = (x, z) => this.creatures.seabedDisturbance(x, z, 0.7);
    this.world.add(this.bubbles.points, this.snow.points, this.sediment.mesh);
    this.plankton = new Plankton(this.terrain, this.sim, this.flow);
    this.streaks = new CurrentStreaks(this.terrain, this.sim, this.flow);
    this.world.add(this.streaks.mesh);
    this.rain = new Rain(this.sim, this.terrain);
    this.rain.onDrop = (x, z) => this.plankton.excite(x, this.sim.level - 0.15, z, 0.35, 0.25);
    this.floaters = new Floaters(this.sim, this.terrain, this.flow);
    this.world.add(this.plankton.points, this.rain.lines, this.floaters.group);
    this.i18n = new I18n(this.prefs.data.lang);
    // one language for the whole interface (set before any panel is built)
    setUiLang(this.i18n.lang);
    this.i18n.onChange(() => setUiLang(this.i18n.lang, this.host));
    this.mail = new OceanMail(this, this.prefs);
    this.coconuts = new CoconutGrowth(this, this.prefs);
    this.events = new OceanEventManager(this, this.prefs);
    this.world.add(this.spray.points, this.mail.group, this.coconuts.group, this.events.group);
    this.visitors = new RareVisitors(this);
    this.sound = new AmbientSound(this);
    this.notebook = new FieldNotebook(this);
    this.world.add(this.visitors.group);
    this.creatures.extraPick = (rc) => {
      const v = this.visitors.pick(rc);
      return v ? { kind: 'visitor', ...v } : null;
    };
    this.creatures.extraObstacles = () => this.visitors.obstacles();
    this.ctx.sight = (k, pos) => this.notebook.behaviour(k, pos);
    food.flow = this.flow;
    this.snow.flow = this.flow;
    this.bubbles.flow = this.flow;
    this.sediment.flow = this.flow;

    this.history = new HistoryManager({
      snapshotSediment: () => this.terrain.snapshot(),
      restoreSediment: (s) => {
        this.sediment.clear();
        this.terrain.restore(s);
      },
      restoreObject: (o, pos, rotY) => {
        o.position.copy(pos);
        o.rotation.y = rotY;
      },
      attach: (sel) => this.reef.attach(sel),
      detach: (sel) => {
        this.selection.clear();
        this.reef.detach(sel);
      },
    });
    this.selection = new SelectionManager(this.reef, this.terrain);
    this.reef.onChange = () => this.selection.refresh();
    this.ctx.fx = {
      dust: (x, y, z, n) => this.sediment.emitDust(x, y, z, n, 0.5),
      bubbles: (x, y, z, n) => this.bubbles.emit(x, y, z, n, 0.15),
    };
    this.world.add(this.selection.marker.mesh);
    this.interaction = new InteractionManager(this, this.renderer.domElement);
    this.world.add(this.interaction.brush.mesh);

    this.sim.updateMask((x, z) => this.terrain.heightAt(x, z));

    // persisted settings, then wallpaper host overrides
    const s = Settings.load();
    if (s.customColor) this.env.customColor = s.customColor;
    if (s.preset) this.env.setPreset(s.preset);
    if (typeof s.wind === 'number') this.env.setWind(s.wind);
    this.env.wind = this.env.windTarget / 100;
    if (s.quality) this.quality = s.quality;
    if (s.mode) this.tools.setMode(s.mode);
    // restore the user's saved world (sand, islands, object placement)
    if (WorldStore.load(this)) {
      this.terrain.update(0);
      this.sim.updateMask((x, z) => this.terrain.heightAt(x, z));
      this.creatures.reset();
    }
    this.colors.update(10); // jump to the persisted look without a fade on start
    this.ui = new UIController(this, host);
    this.magnifier = new Magnifier(this, this.ui.rootEl);
    this.games = new MiniGameManager(this, this.ui.rootEl);
    this.featureUI = new FeatureUI(this, this.ui.rootEl);
    // V2: camera navigation (pan / zoom / double-click focus / drift) + minimap & view switcher
    this.nav = new CameraNav(this, host, s.nav);
    this.minimap = new MiniMap(this, this.ui.rootEl);
    this.journal = new OceanJournal(this, this.ui.rootEl);
    if (s.cam) this.cam.restore(s.cam);
    this.cam.onMove(() => this.saveSettingsSoon());
    this.tools.onChange(() => {
      this.magnifier.setTool(this.tools.tool === 'magnify' && this.tools.mode === 'play');
      this.featureUI?.refresh();
    });
    if (s.panelCollapsed) this.ui.setCollapsed(true);
    this.wallpaper = new WallpaperAdapter(this);

    this.tools.onChange(() => {
      this.saveSettings();
      if (this.tools.mode !== this.lastMode) {
        this.lastMode = this.tools.mode;
        this.applyModeQuality();
      }
    });
    this.cam.onChange(() => {
      this.interaction.cancelAll();
      this.resize();
      this.saveSettingsSoon();
    });
    this.env.onChange(() => this.saveSettings());
    window.addEventListener('resize', () => this.resize());
    const hud = () => (this.perfHud ??= new PerfHud(this.host)).toggle();
    if (new URLSearchParams(location.search).get('perf') === '1') hud();
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F9') hud();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.clock.getDelta();
    });
    this.resize();
    this.applyModeQuality();
  }

  /** Debug helper: zoom into (x, y) in the current view; debugView() restores the framing. */
  debugView(x?: number, y?: number, zoom = 1) {
    const c = this.cam.camera;
    this.cam.resize(this.host.clientWidth, this.host.clientHeight);
    if (x !== undefined) {
      const right = new THREE.Vector3().setFromMatrixColumn(c.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(c.matrixWorld, 1);
      const centre = new THREE.Vector3(x, y ?? 0, 0);
      const cur = c.position.clone();
      const d = centre.sub(cur);
      c.position.addScaledVector(right, d.dot(right)).addScaledVector(up, d.dot(up));
      c.zoom = zoom;
    } else c.zoom = 1;
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
    this.render(false);
  }

  // --------------------------------------------------------------- commands
  undo(): HistoryEntry | null {
    return this.history.undo();
  }
  redo(): HistoryEntry | null {
    return this.history.redo();
  }
  saveWorld() {
    return WorldStore.save(this);
  }
  /** V3 data stored alongside the world (island life, preferences, personal bests). */
  serializeExtras(): Record<string, unknown> {
    // language, Ocean Mail / Surprise settings, coconut timers (timestamps), personal bests
    return { prefs: JSON.parse(JSON.stringify(this.prefs.data)) };
  }
  applyExtras(e: Record<string, unknown>) {
    if (!e || typeof e !== 'object' || !e.prefs) return;
    this.prefs.merge(e.prefs as never);
    this.coconuts?.syncFromPrefs();
    this.i18n?.set(this.prefs.data.lang);
    this.prefs.changed();
  }
  get night() {
    return this.env.atm.night;
  }
  /** True while the user is in the middle of an edit stroke or a mini game (surprises wait). */
  get busy() {
    return !!this.games?.active || this.interaction.editing;
  }
  loadWorld() {
    this.interaction.cancelAll();
    this.selection.clear();
    this.sediment.clear();
    const ok = WorldStore.load(this);
    if (ok) {
      this.history.clear();
      this.creatures.reset();
    }
    return ok;
  }

  /** Restores the original diorama (terrain, objects, food, colour, wind, tool). */
  resetWorld() {
    // the sea remembers that it started over; what you made is gone with the world
    this.memory.log('reset');
    this.creations.clear();
    this.visitors.stop();
    this.visitors.clearTraces();
    this.games.exit();
    this.mail.clear();
    this.events.stop();
    this.coconuts.clearFallen();
    this.interaction.cancelAll();
    this.selection.clear();
    this.terrain.clearSediment();
    this.sediment.clear();
    this.bubbles.clear();
    this.reef.resetPositions();
    this.creatures.resetPopulation();
    this.flow.clear();
    this.streaks.clear();
    this.creatures.reset();
    this.creatures.food.clear();
    this.sim.reset();
    this.env.reset();
    this.tools.setTool(DEFAULTS.tool);
    this.tools.setSandMode('add');
    this.tools.setTool(DEFAULTS.tool);
    this.history.clear();
    this.saveSettings();
  }

  setPaused(p: boolean) {
    this.paused = p;
    if (!p) this.clock.getDelta();
  }

  get qualitySetting() {
    return this.quality;
  }

  setQuality(q: Quality) {
    this.quality = q;
    this.saveSettings();
    this.applyQualityLevel();
  }

  saveSettings() {
    Settings.save({
      preset: this.env.preset,
      customColor: this.env.customColor,
      wind: this.env.windTarget,
      mode: this.tools.mode,
      panelCollapsed: this.ui?.isCollapsed ?? false,
      quality: this.quality,
      cam: this.cam.state(),
      nav: this.nav?.state(),
    });
  }
  private saveTimer = 0;
  /** Camera moves fire often: persist them at most twice a second. */
  saveSettingsSoon() {
    if (this.saveTimer) return;
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = 0;
      this.saveSettings();
    }, 500);
  }

  private applyModeQuality() {
    const ambient = this.tools.mode === 'ambient';
    if (ambient) {
      this.interaction.cancelAll();
      this.selection.clear();
    }
    this.resize();
  }

  // --------------------------------------------------------------- sizing
  resize() {
    const w = Math.max(1, this.host.clientWidth),
      h = Math.max(1, this.host.clientHeight);
    const P = CONFIG.performance;
    const dpr = window.devicePixelRatio || 1;
    let pr = Math.min(dpr, P.maxPixelRatio);
    // the quality level caps the number of rendered pixels (only the lower steps do)
    const q = this.qualityLevel();
    if (w * h * pr * pr > q.budget) pr = Math.sqrt(q.budget / (w * h));
    pr = Math.max(Math.min(dpr, P.minPixelRatio), pr);
    this.pixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.cam.resize(w, h);
    this.pipeline.setSize(w, h);
    // creatures keep the v1 home frame for entrances / exits (main island density unchanged)
    const v = this.cam.homeVisibleX();
    this.ctx.visibleX.min = v.min;
    this.ctx.visibleX.max = v.max;
    pointScale.value = (h * pr) / this.cam.viewH;
    this.pointH = h * pr;
    this.stats.pixelRatio = pr;
  }
  private pointH = 720;

  /** The quality step in use: fixed for High / Low, adaptive for Auto. */
  private qualityLevel() {
    if (this.quality === 'high') return QUALITY_LADDER[0];
    if (this.quality === 'low') return QUALITY_LADDER[Math.max(LOW_LEVEL, this.pacer.level)];
    return this.pacer.quality;
  }

  private applyQualityLevel() {
    this.pipeline.setSamples(this.qualityLevel().msaa);
    this.resize();
  }

  // --------------------------------------------------------------- loop
  start() {
    if (this.ui) this.intro = new Intro(this, this.ui.rootEl);
    this.intro?.play();
    this.applyQualityLevel();
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      if (this.paused || document.hidden) return;
      const ambient = this.tools.mode === 'ambient';
      const fps = ambient ? CONFIG.performance.ambientFPS : CONFIG.performance.activeFPS;
      const frameGap = this.pacer.tick(now, fps);
      if (!frameGap) return;
      // simulate exactly the time of the frame slots (even motion, no jitter from rAF timing)
      const dt = Math.min(Math.max(this.clock.getDelta(), 0), 1 / 15);
      const t0 = performance.now();
      this.step(dt, ambient);
      const t1 = performance.now();
      this.render(ambient);
      const ms = performance.now() - t0;
      const S = this.stats;
      S.frameMs = S.frameMs * 0.9 + ms * 0.1;
      S.stepMs = S.stepMs * 0.9 + (t1 - t0) * 0.1;
      S.fps = S.fps * 0.9 + (1000 / Math.max(1, frameGap)) * 0.1;
      const next = this.pacer.judge(frameGap, now, this.quality === 'auto');
      if (next !== null) this.applyQualityLevel();
      S.level = this.quality === 'auto' ? this.pacer.level : this.quality === 'high' ? 0 : LOW_LEVEL;
      S.miss = this.pacer.missRatio;
      S.refreshHz = Math.round(1000 / this.pacer.refresh);
      this.perfHud?.update(S);
    };
    requestAnimationFrame(loop);
  }

  step(dt: number, ambient: boolean) {
    this.time += dt;
    shared.uTime.value = this.time;
    this.env.update(dt);
    const wind = this.env.wind;
    this.nav?.update(dt);
    this.cam.update(dt);
    pointScale.value = this.pointH / this.cam.viewH;
    this.updateViewWindow();
    this.interaction.update(dt, this.time);
    this.flow.update(dt);
    // tide: one sea level for water, terrain shading, creatures and tools
    const atm = this.env.atm;
    this.sim.level = this.env.seaLevel;
    // first visit: the tray fills with water
    const fill = this.intro?.levelOverride(this.env.seaLevel) ?? null;
    if (fill !== null) this.sim.level = fill;
    this.sim.step(dt, wind);
    this.sim.uploadTexture();
    this.terrain.update(dt);
    const levelMoved = Math.abs(this.sim.level - this.lastLevel) > 0.04;
    if ((this.terrain.version !== this.maskVersion || levelMoved) && this.frameCount % 20 === 0) {
      const terrainChanged = this.terrain.version !== this.maskVersion;
      this.maskVersion = this.terrain.version;
      this.lastLevel = this.sim.level;
      this.sim.updateMask((x, z) => this.terrain.heightAt(x, z), terrainChanged);
    }
    this.lighting.apply(atm);
    this.ocean.applyAtmosphere(atm, this.sim.level);
    this.renderer.toneMappingExposure = 1 + atm.night * 0.35;
    this.island.night = atm.night;
    this.creatures.setNight(atm.night);
    this.snow.level = this.sim.level;
    this.rain.update(dt, atm.rain, wind, atm.night);
    this.floaters.update(dt, wind);
    this.plankton.update(dt, this.time, atm.night, this.creatures.fastFishPositions());
    this.sediment.update(dt, this.time);
    this.creatures.update(dt, this.time);
    this.island.update(dt, this.time);
    this.selection.update(dt, this.time);
    this.bubbles.update(dt, this.time, ambient);
    this.streaks.update(dt, this.cam.camera);
    this.snow.update(dt, this.time, wind, ambient);
    this.ocean.update(dt, this.time, ambient, this.cam.blend);
    this.sky.update(dt, this.time, wind, this.cam.viewW / this.cam.viewH, Math.max(this.cam.blend, this.cam.fullness * 0.9), atm);
    this.plinth.update(this.cam.fullness, this.cam.blend);
    this.minimap?.update(dt);
    this.journal?.update(dt);
    // V3 systems
    const busy = this.busy;
    this.coconuts.update(dt, wind);
    this.mail.update(dt, wind, busy);
    this.events.update(dt, this.time, busy);
    this.visitors.update(dt, this.time);
    this.sound.update(dt);
    this.intro?.update(dt);
    this.notebook.update(dt);
    this.games.update(dt, this.time);
    this.spray.update(dt);
    this.featureUI?.update(dt);
    this.lastDt = dt;
    this.frameCount++;
  }

  /** Where the camera looks: particles, gusts, shadows and the cloud mask follow it. */
  private updateViewWindow() {
    const cam = this.cam;
    viewWindow.cx = cam.pose.tx;
    viewWindow.halfW = cam.viewW / 2 + 4;
    const look = Math.max(cam.blend, cam.fullness);
    this.lighting.frame(cam.pose.tx, cam.viewW / 2, zCentre() * look);
    // keep clouds off the hut wherever it is on screen
    const p = this.tmpV.copy(this.hutPos).project(cam.camera);
    const on = Math.abs(p.x) < 1.3 && Math.abs(p.y) < 1.3 ? 1 - cam.blend : 0;
    this.sky.setHut((p.x + 1) / 2, (p.y + 1) / 2, on);
  }

  render(ambient: boolean) {
    // the shadow map refreshes every n-th frame (fewer when idle), and at once when it moved
    const every = Math.max(this.qualityLevel().shadowEvery, ambient ? 2 : 1);
    this.renderer.shadowMap.autoUpdate = false;
    if (this.frameCount % every === 0 || this.lighting.shadowStamp !== this.shadowStamp) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowStamp = this.lighting.shadowStamp;
    }
    this.pipeline.render(this.world, this.waterScene, this.cam.camera);
    this.magnifier.render(this.lastDt);
  }
}
