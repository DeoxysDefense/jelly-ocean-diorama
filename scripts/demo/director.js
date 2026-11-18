/*
 * Demo director (English edition with soundtrack): a scripted, frame-by-frame gameplay tour of
 * Jelly Ocean Diorama. Injected into the single-file build by scripts/make-demo-video.mjs.
 *
 * The app's own loop is paused; every video frame calls __demo.frame(i), which steps the
 * simulation by exactly 1/FPS s, drives a visible cursor that sends real pointer events, eases the
 * camera and draws captions. CSS transitions are disabled (capture is slower than real time), so
 * every overlay animation is computed from the frame number. Everything audible that happens on
 * screen is logged (events + an environment timeline) so the soundtrack can be synthesised in sync.
 */
(() => {
  const FPS = 60;
  const app = window.__jelly;
  const canvas = app.renderer.domElement;
  const cam = app.cam.camera;
  const V3 = cam.position.constructor;
  const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  const clamp01 = (t) => Math.max(0, Math.min(1, t));
  const lerp = (a, b, t) => a + (b - a) * t;
  const approach = (cur, target, rate) => cur + (target - cur) * Math.min(1, rate / FPS);

  // ------------------------------------------------------------------ overlay DOM
  const css = `
    *, *::before, *::after { transition: none !important; animation: none !important; }
    .panel-open, .tip, .toast, .ambient-exit { display: none !important; }
    .ui-root > .note { zoom: 1.45; bottom: 70px; }
    .demo-layer { position: fixed; inset: 0; pointer-events: none; z-index: 50; font-family: 'Segoe UI Variable Display','Segoe UI',system-ui,sans-serif; }
    .demo-cap { position: absolute; left: 44px; top: 40px; max-width: 640px; padding: 20px 28px 21px 22px; border-radius: 22px; display: flex; gap: 18px; align-items: center;
      background: rgba(246,252,255,0.80); -webkit-backdrop-filter: blur(18px) saturate(150%); backdrop-filter: blur(18px) saturate(150%);
      border: 1px solid rgba(255,255,255,0.75); box-shadow: 0 22px 50px -22px rgba(8,46,66,.55), 0 2px 10px rgba(8,46,66,.10); color: #0f3442; }
    .demo-num { flex: none; width: 56px; height: 56px; border-radius: 16px; display: grid; place-items: center; font-size: 29px; font-weight: 700; color: #fff;
      background: linear-gradient(160deg, #23c1d1, #0f8fb0); box-shadow: 0 6px 16px -6px rgba(15,143,176,.8); }
    .demo-cap h2 { margin: 0; font-size: 34px; line-height: 1.12; font-weight: 700; letter-spacing: .2px; }
    .demo-cap p { margin: 7px 0 0; font-size: 20px; line-height: 1.4; color: #2c5564; }
    .demo-dots { position: absolute; left: 50%; bottom: 30px; transform: translateX(-50%); display: flex; gap: 10px; align-items: center;
      padding: 9px 14px; border-radius: 999px; background: rgba(10,40,52,0.38); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
    .demo-dot { height: 10px; width: 10px; border-radius: 999px; background: rgba(255,255,255,0.45); }
    .demo-dot.on { width: 34px; background: #fff; }
    .demo-dot.done { background: rgba(255,255,255,0.85); }
    .demo-card { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; color: #fff;
      background: radial-gradient(ellipse at 50% 46%, rgba(6,30,44,0.30), rgba(6,30,44,0.62) 75%); }
    .demo-card .tag { justify-self: center; font-size: 18px; font-weight: 600; letter-spacing: 5px; text-transform: uppercase; padding: 7px 18px; border-radius: 999px;
      background: rgba(255,255,255,0.16); border: 1px solid rgba(255,255,255,0.35); margin-bottom: 24px; }
    .demo-card h1 { margin: 0; font-size: 96px; font-weight: 700; letter-spacing: 1px; text-shadow: 0 6px 30px rgba(0,30,50,.55); }
    .demo-card .sub { margin-top: 16px; font-size: 32px; font-weight: 500; text-shadow: 0 3px 16px rgba(0,30,50,.6); }
    .demo-card .url { margin-top: 32px; font-size: 22px; font-weight: 600; padding: 10px 22px; border-radius: 14px; justify-self: center;
      background: rgba(255,255,255,0.92); color: #0f5f74; }
    .demo-cursor { position: absolute; left: 0; top: 0; width: 34px; height: 34px; filter: drop-shadow(0 3px 5px rgba(0,0,0,.45)); }
    .demo-ring { position: absolute; left: 0; top: 0; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 0 12px rgba(255,255,255,.8); }
    .demo-trail { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
    .demo-trail path { fill: none; stroke: rgba(255,255,255,0.9); stroke-width: 5; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 2 13; filter: drop-shadow(0 0 6px rgba(160,240,255,.9)); }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  const layer = document.createElement('div');
  layer.className = 'demo-layer';
  layer.innerHTML = `
    <div class="demo-cap"><div class="demo-num"></div><div><h2></h2><p></p></div></div>
    <div class="demo-dots"></div>
    <div class="demo-card"></div>
    <svg class="demo-trail"><path d=""></path></svg>
    <div class="demo-ring"></div>
    <svg class="demo-cursor" viewBox="0 0 24 24"><path d="M4 2.5l15.5 11.2-6.9 1.1 3.9 7.3-3 1.5-3.9-7.4-5.6 4.4z" fill="#fff" stroke="#0b2a36" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
  document.body.appendChild(layer);
  const capEl = layer.querySelector('.demo-cap');
  const dotsEl = layer.querySelector('.demo-dots');
  const cardEl = layer.querySelector('.demo-card');
  const cursorEl = layer.querySelector('.demo-cursor');
  const ringEl = layer.querySelector('.demo-ring');
  const trailEl = layer.querySelector('.demo-trail path');

  // ------------------------------------------------------------------ audio log
  const events = [];
  const envTrack = [];
  let nowT = 0;
  const ev = (type, extra = {}) => events.push({ t: +nowT.toFixed(4), type, ...extra });

  // ------------------------------------------------------------------ helpers
  const W = () => innerWidth,
    H = () => innerHeight;
  function toScreen(x, y, z) {
    cam.updateMatrixWorld();
    const v = new V3(x, y, z).project(cam);
    return { x: ((v.x + 1) / 2) * W(), y: ((1 - v.y) / 2) * H() };
  }
  // camera: an eased push-in toward a world point, layered on the app's own pose
  let base = null,
    lastBlend = -1;
  const focus = { w: 0, x: 0, y: 0, z: 0, zoom: 1 };
  function applyCamera() {
    if (!base || app.cam.blend !== lastBlend || app.cam.transitioning) {
      // the app just (re)posed the camera this frame
      base = { p: cam.position.clone(), q: cam.quaternion.clone() };
      lastBlend = app.cam.blend;
    }
    cam.position.copy(base.p);
    cam.quaternion.copy(base.q);
    cam.zoom = 1;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    if (focus.w > 0.0001) {
      const v = new V3(focus.x, focus.y, focus.z).applyMatrix4(cam.matrixWorldInverse);
      const cx = (cam.left + cam.right) / 2,
        cy = (cam.top + cam.bottom) / 2;
      const right = new V3().setFromMatrixColumn(cam.matrixWorld, 0);
      const up = new V3().setFromMatrixColumn(cam.matrixWorld, 1);
      cam.position.addScaledVector(right, (v.x - cx) * focus.w).addScaledVector(up, (v.y - cy) * focus.w);
      cam.zoom = lerp(1, focus.zoom, focus.w);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
    }
  }
  function resetBase() {
    base = null;
  }
  function setFocus(x, y, z, zoom, w) {
    focus.x = x;
    focus.y = y;
    focus.z = z;
    focus.zoom = zoom;
    focus.w = w;
  }

  // cursor + real pointer events on the canvas
  const cur = { x: W() * 0.8, y: H() * 0.5, vis: 0, down: false, ring: -1 };
  function pe(type, x, y) {
    canvas.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 7, pointerType: 'mouse', bubbles: true }));
  }
  function moveTo(x, y) {
    cur.x = x;
    cur.y = y;
    pe('pointermove', x, y);
  }
  function glide(target, rate = 9) {
    moveTo(approach(cur.x, target.x, rate), approach(cur.y, target.y, rate));
  }
  function press() {
    app.world.updateMatrixWorld(true); // hit-tests must see this frame's object positions
    cur.down = true;
    pe('pointerdown', cur.x, cur.y);
  }
  function release() {
    cur.down = false;
    pe('pointerup', cur.x, cur.y);
  }
  function click(fr) {
    press();
    release();
    cur.ring = fr;
    ev('tap');
  }
  function drawCursor(fr) {
    cursorEl.style.opacity = cur.vis.toFixed(3);
    cursorEl.style.transform = `translate(${cur.x - 4}px, ${cur.y - 2}px) scale(${cur.down ? 0.86 : 1})`;
    const age = (fr - cur.ring) / FPS;
    if (cur.ring >= 0 && age < 0.55) {
      const r = 10 + age * 90;
      ringEl.style.opacity = (1 - age / 0.55).toFixed(3);
      ringEl.style.width = ringEl.style.height = `${r * 2}px`;
      ringEl.style.transform = `translate(${cur.x - r}px, ${cur.y - r}px)`;
    } else ringEl.style.opacity = '0';
  }
  const trail = [];
  function drawTrail(fr) {
    while (trail.length && fr - trail[0].f > FPS * 1.3) trail.shift();
    if (trail.length < 2) {
      trailEl.setAttribute('d', '');
      return;
    }
    trailEl.setAttribute('d', 'M' + trail.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L'));
    trailEl.style.opacity = Math.min(1, (FPS * 1.3 - (fr - trail[trail.length - 1].f)) / (FPS * 0.4)).toFixed(3);
  }

  // ------------------------------------------------------------------ storyboard
  const CHAPTERS = [
    ['Touch the jelly water', 'Hover for ripples — drag up to lift the whole surface'],
    ['Feed the fish', 'Tap above the water and the school rushes in'],
    ['Paint a current', 'Seagrass, fish and bubbles follow your stroke'],
    ['Build an island', 'Raise a sand bar from above, then dress it with coral'],
    ['Ocean Mail', 'Now and then a bottle drifts by with a little note'],
    ['Shake a palm', 'Coconuts ripen in real time — shake them into the sea'],
    ['Skip stones', 'Pull back, let go, count the skips'],
    ['Wind & rain', 'Waves, palms and raindrops react live'],
    ['Sunset to starlight', 'Follows your PC clock — at night the sea glows'],
  ];
  // chapter start times (s); title before T[0], outro after the last
  const T = [3.0, 8.2, 12.8, 17.6, 25.6, 31.0, 35.6, 42.4, 48.4, 55.0];
  const END = 58.4;
  dotsEl.innerHTML = CHAPTERS.map(() => '<div class="demo-dot"></div>').join('');
  const dots = [...dotsEl.children];

  function caption(idx, t, len) {
    if (idx < 0) {
      capEl.style.opacity = '0';
      dotsEl.style.opacity = '0';
      return;
    }
    const [title, desc] = CHAPTERS[idx];
    capEl.querySelector('.demo-num').textContent = String(idx + 1);
    capEl.querySelector('h2').textContent = title;
    capEl.querySelector('p').textContent = desc;
    const a = ease(clamp01(t / 0.4)) * ease(clamp01((len - t) / 0.35));
    capEl.style.opacity = a.toFixed(3);
    capEl.style.transform = `translateY(${((1 - a) * -12).toFixed(1)}px)`;
    dotsEl.style.opacity = '1';
    dots.forEach((d, i) => (d.className = `demo-dot${i === idx ? ' on' : i < idx ? ' done' : ''}`));
  }
  function card(html, a) {
    if (cardEl.dataset.html !== html) {
      cardEl.innerHTML = html;
      cardEl.dataset.html = html;
    }
    cardEl.style.opacity = a.toFixed(3);
  }
  // Ocean Mail note: drive its unroll manually
  let noteOpenedAt = -1,
    noteClosedAt = -1;
  function driveNote(fr) {
    const paper = document.querySelector('.note-paper');
    if (!paper) return;
    let p = 0;
    if (noteOpenedAt >= 0 && noteClosedAt < 0) p = clamp01((fr - noteOpenedAt) / (FPS * 0.7));
    else if (noteClosedAt >= 0) p = 1 - clamp01((fr - noteClosedAt) / (FPS * 0.35));
    const e = 1 - Math.pow(1 - p, 3);
    paper.style.transform = p >= 1 ? 'none' : `rotateX(${(78 * (1 - e)).toFixed(1)}deg) scaleY(${(0.08 + 0.92 * e).toFixed(3)})`;
    paper.style.opacity = Math.min(1, p * 3).toFixed(3);
  }

  const S = {};
  const level = () => app.sim.level;

  // watch physics for sounds: food splashes, coconuts landing, stone skips
  const coconutPhase = new WeakMap();
  function watchSounds() {
    for (const f of app.coconuts['falling']) {
      const prev = coconutPhase.get(f);
      if (prev !== f.phase) {
        if (prev === 'air' && f.phase === 'roll') ev('thud');
        if ((prev === 'air' || prev === 'roll') && f.phase === 'float') ev('splash', { size: 0.7 });
        coconutPhase.set(f, f.phase);
      }
    }
    const g = app.games.active;
    if (g && g.id === 'skip') {
      if (g.flying && g.flying !== S.stone) {
        S.stone = g.flying;
        S.skips = 0;
        S.stonePhase = 'fly';
      }
      const st = S.stone;
      if (st) {
        if (st.skips > S.skips) {
          for (let k = S.skips + 1; k <= st.skips; k++) ev('skip', { k });
          S.skips = st.skips;
        }
        if (st.phase !== S.stonePhase) {
          if (st.phase === 'sink') ev('plunge');
          S.stonePhase = st.phase;
        }
      }
    }
  }

  function setup() {
    app.setPaused(true);
    app.setQuality('high');
    app.ui.setCollapsed(true);
    app.tools.setMode('play');
    app.tools.setTool('default');
    app.tools.setBrush({ depth: 0.15, size: 0.45, amount: 0.7 });
    app.env.setTimeMode('manual');
    app.env.setTime(14.5);
    app.env.setWind(22);
    app.env.wind = 0.22;
    app.env.setRain(0);
    app.env.setTideMode('manual');
    app.env.setSeaLevel(0);
    app.prefs.data.mail.on = false; // no random bottles / events during the take
    app.prefs.data.events.on = false;
    app.prefs.data.lang = 'en';
    app.i18n.set('en');
    app.prefs.data.coconut.trees.forEach((t) => {
      t.ripe = 3;
      t.since = Date.now();
    });
    app.coconuts.syncFromPrefs();
    // pellets hitting the water make little plops
    const food = app.creatures.food;
    const orig = food.onSplash;
    food.onSplash = (x, z) => {
      ev('plop');
      orig && orig(x, z);
    };
    app.resize();
    for (let i = 0; i < 120; i++) app.step(1 / FPS, false);
    resetBase();
  }

  function frame(fr, draw = true) {
    const t = fr / FPS;
    nowT = t;
    const ch = T.findIndex((s, i) => t >= s && t < (T[i + 1] ?? END));
    const idx = t < T[0] ? -1 : ch >= 0 && ch < CHAPTERS.length ? ch : -2; // -2 = outro
    const lt = idx >= 0 ? t - T[idx] : 0;
    const len = idx >= 0 ? T[idx + 1] - T[idx] : 0;
    const entering = idx >= 0 && !S['in' + idx];
    if (entering) S['in' + idx] = fr;
    run(idx, lt, len, fr, entering);
    app.step(1 / FPS, false);
    watchSounds();
    applyCamera();
    if (draw) app.render(false);
    caption(idx >= 0 ? idx : -1, lt, len);
    if (t < T[0]) {
      card(
        `<div class="tag">Gameplay tour</div><h1>Jelly Ocean Diorama</h1><div class="sub">A living miniature ocean for your desktop</div>`,
        ease(clamp01(t / 0.6)) * ease(clamp01((T[0] - t) / 0.5)),
      );
    } else if (idx === -2) {
      card(
        `<h1>Jelly Ocean Diorama</h1><div class="sub">Live wallpaper · Desktop app · Browser</div><div class="url">github.com/DeoxysDefense/jelly-ocean-diorama</div>`,
        ease(clamp01((t - T[9]) / 0.6)),
      );
    } else card('', 0);
    driveNote(fr);
    drawCursor(fr);
    drawTrail(fr);
    envTrack.push([+t.toFixed(3), +app.env.wind.toFixed(3), +app.env.atm.rain.toFixed(3), +app.env.atm.night.toFixed(3)]);
    return { t, done: t >= END - 1e-6 };
  }

  // ------------------------------------------------------------------ chapter scripts
  function run(idx, lt, len, fr, entering) {
    const zF = 6;
    const dz = 2.66; // Front View depth plane used by the tools (brush depth 0.15)
    switch (idx) {
      case -1: // title: a slow push toward the reef
        setFocus(2, -2.5, 0, 1.08, ease(clamp01(lt / 3)));
        if (fr === 0) ev('title');
        cur.vis = 0;
        break;
      case 0: {
        // hover sweep along the surface, then push in and lift the jelly water
        setFocus(5, -0.4, zF, 1.7, lt < 2.2 ? approach(focus.w, 0, 5) : ease(clamp01((lt - 2.2) / 0.9)));
        cur.vis = ease(clamp01(lt / 0.4));
        if (entering) ev('swish', { dur: 2.4 });
        if (lt < 2.6) {
          const p = toScreen(lerp(15, 1, ease(clamp01(lt / 2.4))), -0.25, zF);
          moveTo(p.x, p.y);
        } else if (lt < 2.9) {
          const p = toScreen(4, -0.22, zF);
          moveTo(p.x, p.y);
        } else if (!S.lift) {
          S.lift = true;
          press();
          ev('lift', { dur: 1.3 });
        } else if (lt < 4.3) {
          const p0 = toScreen(4, -0.22, zF);
          const k = ease(clamp01((lt - 3) / 1.1));
          moveTo(p0.x + 30 * k, p0.y - 125 * k);
        } else if (cur.down) {
          release();
          ev('splash', { size: 1 });
        } else if (lt > 4.5) {
          const p = toScreen(lerp(4.6, 9, ease(clamp01((lt - 4.5) / 0.7))), -0.3, zF);
          moveTo(p.x, p.y);
        }
        break;
      }
      case 1: {
        if (entering) {
          app.tools.setTool('feed');
          const fs = app.creatures.fish.fish.filter((f) => f.active && f.species === 'silverside');
          let sx = 5;
          if (fs.length) sx = fs.reduce((a, f) => a + f.pos.x, 0) / fs.length;
          S.feedX = Math.max(-0.5, Math.min(11, sx));
        }
        const fx = S.feedX;
        setFocus(fx + 1.2, -1.9, dz, 1.6, ease(clamp01(lt / 1.2)));
        cur.vis = 1;
        const a = toScreen(fx - 0.6, 0.9, dz),
          b = toScreen(fx + 1.8, 0.9, dz);
        if (lt < 1.0) glide(a, 8);
        if (lt >= 1.0 && !S.f1) {
          S.f1 = true;
          moveTo(a.x, a.y);
          click(fr);
        }
        if (lt > 1.4 && lt < 2.2) moveTo(lerp(a.x, b.x, ease((lt - 1.4) / 0.8)), lerp(a.y, b.y, ease((lt - 1.4) / 0.8)));
        if (lt >= 2.3 && !S.f2) {
          S.f2 = true;
          click(fr);
        }
        break;
      }
      case 2: {
        // one big circulation cell: sweep right, low through the seagrass meadow (blades bend
        // with it), curl up, then back left through the silverside school (it gets carried along)
        const xL = 0.2,
          xR = 7.0;
        const low = (x) => app.terrain.heightAt(x, dz) + 0.75; // just over the seagrass tips
        if (entering) {
          app.tools.setTool('current');
          app.tools.setBrush({ size: 0.7, amount: 1 });
          // aim the return pass at the silverside school, wherever feeding left it
          const fs = app.creatures.fish.fish.filter((f) => f.active && f.species === 'silverside');
          const sy = fs.length ? fs.reduce((a, f) => a + f.pos.y, 0) / fs.length : -2.7;
          S.hiY = Math.max(-3.2, Math.min(-1.1, sy));
        }
        const hiY = S.hiY;
        setFocus(3.4, (low(3.4) + hiY) / 2, dz, 1.3, ease(clamp01(lt / 0.8)));
        cur.vis = 1;
        // path parameter u: 0..1 low sweep right, 1..1.5 bend up, 1.5..2.5 high sweep back left, 2.5..2.9 bend down
        const bend = (x, y0, y1, k, dir) => {
          const a = k * Math.PI;
          return toScreen(x + dir * Math.sin(a) * 1.0, (y0 + y1) / 2 - Math.cos(a) * ((y1 - y0) / 2), dz);
        };
        const path = (u) => {
          if (u <= 1) {
            const x = lerp(xL, xR, u);
            return toScreen(x, low(x), dz);
          }
          if (u <= 1.5) return bend(xR, low(xR), hiY, (u - 1) / 0.5, 1);
          if (u <= 2.5) return toScreen(lerp(xR, xL, u - 1.5), hiY - Math.sin((u - 1.5) * Math.PI) * 0.15, dz);
          // left-hand bend back down (descending: swap ends)
          const k = (u - 2.5) / 0.5;
          const a = k * Math.PI;
          return toScreen(xL - Math.sin(a) * 1.0, (low(xL) + hiY) / 2 + Math.cos(a) * ((hiY - low(xL)) / 2), dz);
        };
        const t0 = 0.75,
          dur = 3.2;
        if (lt < t0 - 0.05) glide(path(0), 10);
        else if (!S.c1) {
          S.c1 = true;
          const p = path(0);
          moveTo(p.x, p.y);
          press();
          ev('current', { dur });
        } else if (lt < t0 + dur) {
          const k = (lt - t0) / dur;
          const p = path(k * 2.9);
          moveTo(p.x, p.y);
          trail.push({ x: p.x, y: p.y, f: fr });
        } else if (cur.down) release();
        else if (lt > t0 + dur + 0.2) {
          const p = toScreen(8.5, -4.2, dz);
          glide(p, 3);
        }
        break;
      }
      case 3: {
        // Top View: stamp a sand island near the lagoon, add a coral and an anemone, back to Front View
        if (entering) {
          focus.w = 0;
          app.tools.setTool('default');
          app.cam.setView('top');
          ev('whoosh', { dur: 1.1 });
          resetBase();
        }
        cur.vis = 1;
        const ISL = { x: 1.0, z: -3.0 }; // beside the main island, clear of the front glass
        if (lt > 1.15 && !S.e0) {
          S.e0 = true;
          app.tools.setSandMode('island');
          app.tools.setBrush({ size: 0.3 });
        }
        const isl = toScreen(ISL.x, -2, ISL.z);
        const corA = findSpot(ISL.x + 4.6, ISL.z + 2.2, 'branching');
        const corB = findSpot(ISL.x + 3.4, ISL.z + 4.4, 'anemone');
        const pA = toScreen(corA.x, -6, corA.z),
          pB = toScreen(corB.x, -6, corB.z);
        if (lt > 1.2 && lt < 1.9) glide(isl, 10);
        if (lt >= 1.9 && !S.e1) {
          S.e1 = true;
          moveTo(isl.x, isl.y);
          click(fr);
          ev('island');
        }
        if (lt > 3.0 && lt < 3.55) glide(pA, 12);
        if (lt >= 3.6 && !S.e2) {
          S.e2 = true;
          app.tools.setPlaceType('branching');
          moveTo(pA.x, pA.y);
          click(fr);
          ev('place');
        }
        if (lt > 3.9 && lt < 4.45) glide(pB, 12);
        if (lt >= 4.5 && !S.e3) {
          S.e3 = true;
          app.tools.setPlaceType('anemone');
          moveTo(pB.x, pB.y);
          click(fr);
          ev('place');
        }
        if (lt >= 5.2 && !S.e4) {
          S.e4 = true;
          app.tools.setTool('default');
          app.tools.setBrush({ size: 0.45, amount: 0.7 });
          app.cam.setView('front');
          ev('whoosh', { dur: 1.1 });
          resetBase();
        }
        // reveal: ease toward the new islet once we are back in Front View
        if (lt > 6.3) setFocus(ISL.x - 2.0, -0.6, ISL.z, 1.45, ease(clamp01((lt - 6.3) / 1.0)));
        if (lt > 5.4) cur.vis = Math.max(0, 1 - (lt - 5.4) / 0.4);
        break;
      }
      case 4: {
        // Ocean Mail: a bottle drifts by, open it, read, close
        if (entering) {
          app.mail.spawnTest();
          const b = app.mail['bottle'];
          b.pos.set(6.0, level(), 4.5);
          b.vel.set(0.1, 0, 0);
          b.fade = 1;
        }
        const bp = app.mail.bottlePosition;
        if (bp) {
          focus.x = bp.x + 0.3;
          focus.y = bp.y - 0.5;
          focus.z = bp.z;
        }
        focus.zoom = 3.0;
        focus.w = ease(clamp01((lt - 0.1) / 1.1));
        cur.vis = 1;
        if (bp && lt < 1.6) glide(toScreen(bp.x, bp.y + 0.05, bp.z), 8);
        if (bp && lt >= 1.6 && !S.m1) {
          S.m1 = true;
          const p = toScreen(bp.x, bp.y + 0.05, bp.z);
          moveTo(p.x, p.y);
          click(fr);
          noteOpenedAt = fr;
          ev('bottle');
        }
        const close = document.querySelector('.note-close');
        if (close && lt > 4.3 && lt < 4.9) {
          const r = close.getBoundingClientRect();
          glide({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, 10);
        }
        if (close && lt >= 4.9 && !S.m3) {
          S.m3 = true;
          close.click();
          cur.ring = fr;
          noteClosedAt = fr;
          ev('paper', { dur: 0.35 });
        }
        break;
      }
      case 5: {
        if (entering) {
          app.mail.clear();
          noteOpenedAt = noteClosedAt = -1;
        }
        const palm = app.island.palms[1];
        setFocus(-7.2, 1.0, 0, 1.75, 1);
        cur.vis = 1;
        const q = palm.spine[9];
        const p = toScreen(q.x, q.y, q.z);
        if (lt < 1.2) glide(p, 6);
        if (lt >= 1.2 && !S.k1) {
          S.k1 = true;
          moveTo(p.x, p.y);
          click(fr);
          ev('rustle', { dur: 1.0 });
        }
        if (lt > 1.6) glide({ x: p.x + 160, y: p.y + 40 }, 2);
        break;
      }
      case 6: {
        if (entering) {
          app.games.start('skip');
          // throw slightly toward the viewer so the stone skims past the new island
          if (app.games.active) app.games.active['yaw'] = -0.12;
        }
        const g = app.games.active;
        setFocus(3, -0.6, 0, 1.15, 1);
        cur.vis = 1;
        if (!g) break;
        const o = g.origin;
        const s = toScreen(o.x, o.y, o.z);
        const start = { x: s.x + 70, y: s.y - 20 };
        if (lt < 0.9) glide(start, 10);
        if (lt >= 0.9 && !S.s1) {
          S.s1 = true;
          moveTo(start.x, start.y);
          press();
        }
        if (lt > 0.95 && lt < 2.1) {
          const k = ease((lt - 0.95) / 1.0);
          moveTo(start.x - 215 * k, start.y + 30 * k);
        }
        if (lt >= 2.4 && cur.down) {
          release();
          ev('throw');
        }
        if (lt > 2.6) cur.vis = Math.max(0, 1 - (lt - 2.6) / 0.4);
        if (lt >= len - 0.25 && !S.s2) {
          S.s2 = true;
          app.games.exit();
        }
        break;
      }
      case 7: {
        // wind & rain: the storm rolls in, palms bend, raindrops dimple the surface
        if (entering) {
          app.env.setWind(100);
          app.env.setRain(90);
        }
        setFocus(-3, -0.5, 0, 1.05, approach(focus.w, lt < 4.6 ? 1 : 0, 3));
        cur.vis = 0;
        if (lt > 1.9 && !S.w1) {
          S.w1 = true;
          ev('thunder');
        }
        // the storm passes: rain eases out over the last two seconds, wind drops
        if (lt >= 3.9) {
          if (!S.w2) {
            S.w2 = true;
            app.env.setRain(0);
            app.env.setWind(15);
          }
          app.env.rain = approach(app.env.rain, 0, 2.6);
        }
        break;
      }
      case 8: {
        // sunset, then a starry night where sweeping through the water makes it glow
        if (entering) {
          app.env.setWind(12);
          app.env.setRain(0);
          app.env.rain = 0;
        }
        setFocus(0, -1.0, 0, 1.0, approach(focus.w, 0, 3));
        // 0–2.2 s: into the golden sunset glow (peaks just before 18:00) · 2.2–3.6 s: into the night
        const h = lt < 2.2 ? lerp(14.5, 17.8, ease(clamp01(lt / 1.5))) : lerp(17.8, 23.2, ease(clamp01((lt - 2.2) / 1.4)));
        app.env.setTime(h);
        cur.vis = lt > 3.6 ? Math.min(1, (lt - 3.6) / 0.3) : 0;
        if (lt > 3.6) {
          const p = toScreen(lerp(-1, 13, ease(clamp01((lt - 3.6) / 2.4))), -2.2 + Math.sin(lt * 4) * 0.5, dz);
          moveTo(p.x, p.y);
          if (Math.floor(lt * 5) !== Math.floor((lt - 1 / FPS) * 5)) ev('sparkle');
        }
        break;
      }
      case -2:
        cur.vis = Math.max(0, cur.vis - 6 / FPS);
        focus.w = 0;
        break;
    }
  }

  /** Free seabed near (x, z) for a placed object. */
  function findSpot(x, z, type) {
    const key = 'spot-' + type;
    if (S[key]) return S[key];
    const vis = app.cam.visibleX(0);
    for (let r = 0; r < 4; r += 0.4)
      for (let a = 0; a < 6.28; a += 0.7) {
        const px = x + Math.cos(a) * r,
          pz = z + Math.sin(a) * r;
        if (app.selection.canPlace(px, pz, 1.0, vis)) return (S[key] = { x: px, z: pz });
      }
    return (S[key] = { x, z });
  }

  window.__demo = {
    setup,
    frame,
    fps: FPS,
    end: END,
    frames: Math.round(END * FPS),
    chapters: T,
    audio: () => ({ events, env: envTrack, chapters: T, end: END }),
  };
})();
