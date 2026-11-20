// The teardown view: one desktop, step by step, as the scanner picture with its masks (scanner view) or as the
// measured point cloud that can be turned, coloured by class or depth, and taken apart (tilted view).
// Both are the same scene: in the scanner's own view every point lies on its pixel of the picture.
//
//   const view = await createTeardownView(host, { base, onChange, onHover, reducedMotion });
//   await view.load('d13');
//   view.set({ step: 12, view: 'tilted', colour: 'class', apart: 0.6 });
//
// State: { desk, steps, step (1-based, may be fractional between two steps), view: 'scanner' | 'tilted',
//          colour: 'scanner' | 'class' | 'depth', apart: 0..1, zoom, playing, gl (false = pictures only),
//          lost (the graphics context went away), error }
import { VS_POINTS, FS_POINTS, VS_SCREEN, FS_EDL, VS_PHOTO, FS_PHOTO } from './shaders.js';
import { program, target, camera } from './gl.js';
import { loadMeta, instanceTables, StepStore, stepUrl } from './store.js';

const NEAR = 500, FAR = 2600;
// The stage colour and the tint of the contact shadow come from the host's CSS (--stage, --stage-shade); these are the
// values used until they have been read, or when they cannot be parsed.
const STAGE = [243 / 255, 246 / 255, 247 / 255], SHADE = [174 / 255, 187 / 255, 194 / 255];
const TILT = 34, AZ = -16, ZOOM_TILTED = 0.82;         // the tilted view used by the dataset's own 3D figures
const LIM = { tilt: [0, 48], az: [-40, 40], zoom: [0.6, 3] };
const SPEED = 1.1;                                     // steps per second while playing
const PAD = 0.96;                                      // share of the canvas the picture fills
const EDL = 20;                                        // strength of the depth shading
const EDGE = 0.42;                                     // the depth shading darkens towards the shadow tint times this: a soft grey, not black
const SHADOW = 0.42;                                   // strength of the contact shadow: a soft shadow on a light table
const SPLAT = 1.9;                                     // point diameter in units of the sample spacing (points overlap, as in the dataset's 3D figures)
const KEYS = ['tilt', 'az', 'zoom', 'cls', 'depth', 'apart'];
const EPS = { tilt: 0.02, az: 0.02, zoom: 0.001, cls: 0.002, depth: 0.002, apart: 0.002 };

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** '#0f1011', '#fff' or 'rgb(15, 16, 17)' -> [r, g, b] in 0..1; `fallback` when the text is none of these. */
export function parseColour(text, fallback) {
  const s = String(text || '').trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (m) {
    const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  return m ? [m[1], m[2], m[3]].map((v) => clamp(Number(v) / 255, 0, 1)) : fallback;
}

/** True when the browser offers WebGL2 at all (the view still falls back to pictures when a context cannot be made). */
export const supported = () => typeof WebGL2RenderingContext !== 'undefined';

export async function createTeardownView(host, opts = {}) {
  const base = opts.base || 'assets/data/explorer/';
  const state = { desk: null, steps: 0, step: 1, view: 'scanner', colour: 'scanner', apart: 0, zoom: 1, playing: false, gl: false, lost: false, error: null };
  const cur = { tilt: 0, az: 0, zoom: 1, cls: 0, depth: 0, apart: 0 }, goal = { ...cur };
  let meta = null, store = null, tables = null, fbo = null, pair = null, geom = null, hover = 0;
  let raf = 0, last = 0, visible = true, destroyed = false, timer = 0, loads = 0;
  let BG = STAGE, TINT = SHADE;
  const readColours = () => {                         // the host's --stage and --stage-shade, read again on every resize
    const cs = getComputedStyle(host);
    BG = parseColour(cs.getPropertyValue('--stage'), STAGE); TINT = parseColour(cs.getPropertyValue('--stage-shade'), SHADE);
  };
  readColours();

  const emit = () => { if (opts.onChange) opts.onChange({ ...state }); };
  const fileStep = (i) => meta.steps[clamp(Math.round(i), 1, state.steps) - 1].step;

  // ---- drawing surface --------------------------------------------------------------------------------------
  const canvas = document.createElement('canvas');
  canvas.className = 'tdv__canvas';
  let gl = null, P, Q, F, vao, pickFbo;
  try {
    gl = supported() ? canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' }) : null;
    if (gl) {
      P = program(gl, VS_POINTS, FS_POINTS); Q = program(gl, VS_SCREEN, FS_EDL); F = program(gl, VS_PHOTO, FS_PHOTO);
      vao = gl.createVertexArray(); pickFbo = gl.createFramebuffer();
    }
  } catch (err) { console.error('teardown view: WebGL2 setup failed, showing pictures only', err); gl = null; }
  state.gl = !!gl;
  const img = document.createElement('img');           // the picture-only view when WebGL2 is not there
  img.className = 'tdv__img'; img.alt = ''; img.decoding = 'async';
  host.append(gl ? canvas : img);

  function fallback() {                                // the graphics context is gone: carry on with pictures
    if (!state.gl) return;
    Object.assign(state, { gl: false, lost: true, view: 'scanner', colour: 'scanner', apart: 0, zoom: 1 });
    gl = null; cancelAnimationFrame(raf); raf = 0;
    canvas.replaceWith(img);
    showPicture(); slideshow(); emit();
  }
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); fallback(); });
  const showPicture = () => { if (meta) img.src = stepUrl(base, state.desk, fileStep(state.step), 'c.webp'); };

  // ---- one frame ----------------------------------------------------------------------------------------------
  function frame(now) {
    if (!gl || !meta) return false;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016; last = now;
    let moving = false;
    if (sway && state.view === 'tilted' && !drag) { goal.az = AZ + 5 * Math.sin((now - swayFrom) / 2400); moving = true; }
    const k = opts.reducedMotion ? 1 : 1 - Math.exp(-dt * 7);
    for (const key of KEYS) {
      const d = goal[key] - cur[key];
      if (Math.abs(d) > EPS[key]) { cur[key] += d * k; moving = true; } else cur[key] = goal[key];
    }
    if (state.playing) {
      state.step = Math.min(state.steps, state.step + dt * SPEED);
      if (state.step >= state.steps) state.playing = false;
      moving = true; emit();
    }

    const N = state.steps, a = clamp(Math.floor(state.step), 1, N), b = Math.min(N, a + 1);
    const ea = store.get(fileStep(a), wake), eb = store.get(fileStep(b), wake);
    if (ea.ready && eb.ready) {
      pair = [a, b];
      for (const s of [b + 1, b + 2, a - 1]) if (s >= 1 && s <= N) store.get(fileStep(s), wake);   // the neighbours, ahead of time
      store.trim([a, b, b + 1, b + 2, a - 1].filter((s) => s >= 1 && s <= N).map(fileStep));
    }

    const dpr = Math.min(opts.maxDpr || 2, window.devicePixelRatio || 1);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (!w || !h) return moving;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h);
    if (!pair) { gl.clearColor(...BG, 1); gl.clear(gl.COLOR_BUFFER_BIT); return moving; }

    const A = store.steps.get(fileStep(pair[0])), B = store.steps.get(fileStep(pair[1]));
    if (!A || !B || !A.ready || !B.ready) { pair = null; return true; }
    let t = pair[0] === a ? state.step - a : (state.step > pair[1] ? 1 : 0);
    t = sstep(0, 1, t);
    const [gw, gh] = meta.grid, K = meta.k, pw = gw * K, ph = gh * K;
    const cropAsp = pw / ph, canAsp = w / h;
    const sx = PAD * (canAsp > cropAsp ? cropAsp / canAsp : 1), sy = PAD * (canAsp > cropAsp ? 1 : canAsp / cropAsp);
    const turned = Math.abs(cur.tilt) + Math.abs(cur.az);
    const photo = (1 - sstep(0.4, 5, turned)) * (1 - cur.depth) * (1 - sstep(0, 0.06, cur.apart));
    geom = { w, h, sx: sx * cur.zoom, sy: sy * cur.zoom, pw, ph, photo, label: t < 0.5 ? A.l : B.l };
    const unit = (i, tex, loc) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc, i); };

    if (photo < 0.999) {                               // the point cloud, then the depth shading
      fbo = target(gl, fbo, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.f); gl.viewport(0, 0, w, h);
      gl.clearBufferfv(gl.COLOR, 0, [...BG, 1]); gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]); gl.clearBufferfv(gl.DEPTH, 0, [1]);
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.useProgram(P.p); gl.bindVertexArray(vao);
      unit(0, A.d, P.u.uDA); unit(1, B.d, P.u.uDB); unit(2, A.c, P.u.uCA); unit(3, B.c, P.u.uCB);
      unit(4, A.l, P.u.uLA); unit(5, B.l, P.u.uLB); unit(6, tables.col, P.u.uInstCol); unit(7, tables.xf, P.u.uInstXf);
      const stride = opts.stride || 1, cols = Math.ceil(gw / stride), rows = Math.ceil(gh / stride);
      gl.uniform2i(P.u.uCells, cols, rows); gl.uniform1i(P.u.uStride, stride); gl.uniform1i(P.u.uK, K);
      gl.uniform1i(P.u.uHover, hover); gl.uniform1f(P.u.uT, t);
      gl.uniformMatrix4fv(P.u.uMVP, false, camera({ intr: meta.intr, crop: meta.crop, size: [pw, ph], centre: meta.centre,
        sx, sy, zoom: cur.zoom, tilt: cur.tilt, az: cur.az, near: NEAR, far: FAR }));
      gl.uniform4f(P.u.uIntr, ...meta.intr); gl.uniform2f(P.u.uCrop, meta.crop[0], meta.crop[1]);
      gl.uniform3f(P.u.uZ, meta.z[0], meta.z[1] - meta.z[0], meta.z[2]); gl.uniform2f(P.u.uZr, meta.zr[0], meta.zr[1]);
      gl.uniform1f(P.u.uPx, K * stride * (sx * cur.zoom * w / pw) * meta.centre[2] * SPLAT);
      gl.uniform1f(P.u.uClass, cur.cls); gl.uniform1f(P.u.uDepth, cur.depth); gl.uniform1f(P.u.uApart, cur.apart);
      gl.drawArrays(gl.POINTS, 0, cols * rows);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h); gl.disable(gl.DEPTH_TEST); gl.useProgram(Q.p);
      unit(0, fbo.c, Q.u.uCol); unit(1, fbo.d, Q.u.uDep);
      gl.uniform2f(Q.u.uNF, NEAR, FAR); gl.uniform1f(Q.u.uStrength, EDL); gl.uniform1i(Q.u.uR, Math.max(1, Math.round(2 * dpr)));
      gl.uniform3f(Q.u.uBg, ...BG);
      // the shadow falls to the lower right: a table pixel is shaded when the cloud covers the place up and left of it (y runs up here)
      gl.uniform3f(Q.u.uShadow, -8 * dpr, 18 * dpr, 26 * dpr); gl.uniform1f(Q.u.uShadowK, SHADOW * (1 - photo)); gl.uniform3f(Q.u.uShade, ...TINT);
      gl.uniform3f(Q.u.uEdge, ...TINT.map((v) => v * EDGE));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else {
      gl.clearColor(...BG, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    }

    if (photo > 0.001) {                               // the scanner picture and its masks, over the points
      gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(F.p); gl.bindVertexArray(vao);
      unit(0, A.c, F.u.uCA); unit(1, B.c, F.u.uCB); unit(2, A.l, F.u.uLA); unit(3, B.l, F.u.uLB); unit(4, tables.col, F.u.uInstCol);
      gl.uniform2f(F.u.uScale, geom.sx, geom.sy); gl.uniform1f(F.u.uT, t); gl.uniform1f(F.u.uMask, cur.cls);
      gl.uniform1f(F.u.uAlpha, photo); gl.uniform1f(F.u.uEdge, Math.max(0.75, 1.25 * pw / (geom.sx * w)));
      gl.uniform1i(F.u.uHover, hover);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.BLEND);
    }
    return moving;
  }

  function wake(_step, err) {
    if (err) { state.error = 'Some of the step data could not be loaded.'; emit(); }
    invalidate();
  }
  function invalidate() { if (gl && !raf && visible && !destroyed) raf = requestAnimationFrame(tick); }
  function tick(now) { raf = 0; if (frame(now)) invalidate(); else last = 0; }

  // ---- which part is under the pointer -----------------------------------------------------------------------
  const px = new Uint8Array(4);
  function pick(clientX, clientY) {
    if (!gl || !geom || !meta) return null;
    const r = canvas.getBoundingClientRect();
    const x = (clientX - r.left) / r.width, y = (clientY - r.top) / r.height;
    if (x < 0 || x >= 1 || y < 0 || y >= 1) return null;
    if (geom.photo > 0.5) {                            // scanner view: the id map itself
      const u = ((x * 2 - 1) / geom.sx + 1) / 2, v = (1 - (1 - y * 2) / geom.sy) / 2;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) return null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, pickFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, geom.label, 0);
      gl.readPixels(Math.floor(u * geom.pw), Math.floor(v * geom.ph), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    } else if (fbo) {                                  // tilted view: the id buffer of the last frame
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.f); gl.readBuffer(gl.COLOR_ATTACHMENT1);
      gl.readPixels(Math.floor(x * geom.w), geom.h - 1 - Math.floor(y * geom.h), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
    } else return null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const id = px[0] * 256 + px[1], e = meta.instances[id];
    return e ? { id, cls: e.cls, label: e.label, col: e.col, leaves: e.leaves, kind: e.kind } : null;
  }

  // ---- pointer -------------------------------------------------------------------------------------------------
  let drag = null, hoverAt = null, hoverRaf = 0;
  let sway = !!opts.sway && !opts.reducedMotion, swayFrom = 0;
  const setHover = (hit, e) => {
    const id = hit ? hit.id : 0;
    if (id !== hover) { hover = id; invalidate(); }
    if (opts.onHover) opts.onHover(hit, e);
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    sway = false;                                          // the visitor has taken over
    drag = { x: e.clientX, y: e.clientY, tilt: goal.tilt, az: goal.az, moved: false, touch: e.pointerType === 'touch' };
    canvas.setPointerCapture(e.pointerId); canvas.classList.add('is-dragging');
    setHover(null, e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drag) {
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 4) return;
      drag.moved = true;
      goal.az = clamp(drag.az - (e.clientX - drag.x) * 0.25, ...LIM.az);
      goal.tilt = clamp(drag.tilt - (e.clientY - drag.y) * 0.25, ...LIM.tilt);
      const v = goal.tilt === 0 && goal.az === 0 ? 'scanner' : 'tilted';
      if (v !== state.view) { state.view = v; touchMode(); emit(); }
      invalidate();
      return;
    }
    if (e.pointerType === 'touch') return;
    hoverAt = e;
    if (!hoverRaf) hoverRaf = requestAnimationFrame(() => { hoverRaf = 0; if (hoverAt && !drag) setHover(pick(hoverAt.clientX, hoverAt.clientY), hoverAt); });
  });
  const release = () => { drag = null; canvas.classList.remove('is-dragging'); };
  const touchMode = () => { canvas.style.touchAction = state.view === 'tilted' ? 'none' : 'pan-y'; };
  canvas.addEventListener('pointerup', (e) => {
    const tap = drag && !drag.moved && drag.touch;
    release();
    if (tap) setHover(pick(e.clientX, e.clientY), e);              // a tap names the part under the finger
  });
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', (e) => { hoverAt = null; if (!drag) setHover(null, e); });
  canvas.addEventListener('wheel', (e) => {             // plain wheel scrolls the page; with ctrl (or a pinch) it zooms
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    api.set({ zoom: state.zoom * Math.exp(-e.deltaY * 0.004) });
  }, { passive: false });

  let io = null, ro = null;
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver((entries) => { visible = entries.some((en) => en.isIntersecting); if (visible) invalidate(); }, { rootMargin: '200px' });
    io.observe(host);
  }
  if ('ResizeObserver' in window) { ro = new ResizeObserver(() => { readColours(); invalidate(); }); ro.observe(host); }

  // ---- picture-only playback -----------------------------------------------------------------------------------
  function slideshow() {
    clearInterval(timer); timer = 0;
    if (state.gl || !state.playing) return;
    timer = setInterval(() => {
      if (state.step >= state.steps) { state.playing = false; clearInterval(timer); timer = 0; } else state.step = Math.round(state.step) + 1;
      showPicture(); emit();
    }, 900);
  }

  // ---- public ----------------------------------------------------------------------------------------------------
  const api = {
    get state() { return { ...state }; },
    get meta() { return meta; },

    async load(desk) {
      const mine = ++loads;
      const m = await loadMeta(base, desk);
      if (destroyed || mine !== loads) return null;                  // a newer request took over
      if (store) store.dispose();
      if (gl && tables) { gl.deleteTexture(tables.col); gl.deleteTexture(tables.xf); }
      meta = m; pair = null; geom = null; hover = 0;
      Object.assign(state, { desk, steps: m.steps.length, step: 1, playing: false, error: null });
      host.style.setProperty('--tdv-ar', `${m.grid[0] * m.k} / ${m.grid[1] * m.k}`);
      if (gl) {
        store = new StepStore(gl, base, desk, opts.keep || 10);
        tables = instanceTables(gl, m);
        await store.get(fileStep(1), wake).promise;
        if (mine !== loads) return null;
      } else showPicture();
      touchMode(); emit(); invalidate();
      return m;
    },

    set(patch) {
      if (!meta) return;
      const p = { ...patch };
      if ('step' in p) state.step = clamp(Number(p.step) || 1, 1, state.steps);
      if ('playing' in p) {
        state.playing = !!p.playing;
        if (state.playing && state.step >= state.steps) state.step = 1;
      }
      if ('colour' in p && ['scanner', 'class', 'depth'].includes(p.colour)) {
        state.colour = p.colour; goal.cls = p.colour === 'class' ? 1 : 0; goal.depth = p.colour === 'depth' ? 1 : 0;
      }
      if ('apart' in p) {
        state.apart = goal.apart = clamp(Number(p.apart) || 0, 0, 1);
        if (state.apart > 0 && state.view === 'scanner' && !('view' in p)) p.view = 'tilted';
      }
      if ('view' in p && (p.view === 'scanner' || p.view === 'tilted')) {
        state.view = p.view;
        if (p.view === 'scanner') { goal.tilt = 0; goal.az = 0; state.zoom = goal.zoom = 1; state.apart = goal.apart = 0; }
        else if (goal.tilt === 0 && goal.az === 0) { goal.tilt = TILT; goal.az = AZ; state.zoom = goal.zoom = ZOOM_TILTED; swayFrom = performance.now(); }
      }
      if ('zoom' in p) state.zoom = goal.zoom = clamp(Number(p.zoom) || 1, ...LIM.zoom);
      if (!state.gl) { Object.assign(state, { view: 'scanner', colour: 'scanner', apart: 0, zoom: 1 }); showPicture(); slideshow(); }
      touchMode();
      emit(); invalidate();
    },

    pick,

    /** Draws the current state at once, without easing (used by checks and by reduced-motion callers). */
    async renderNow() {
      if (!gl || !meta) return;
      const a = clamp(Math.floor(state.step), 1, state.steps), b = Math.min(state.steps, a + 1);
      await Promise.all([store.get(fileStep(a), wake).promise, store.get(fileStep(b), wake).promise]);
      Object.assign(cur, goal);
      const playing = state.playing; state.playing = false;
      frame(performance.now()); gl.finish();
      state.playing = playing;
    },

    destroy() {
      destroyed = true; cancelAnimationFrame(raf); cancelAnimationFrame(hoverRaf); clearInterval(timer);
      if (io) io.disconnect(); if (ro) ro.disconnect();
      if (store) store.dispose();
      const ext = gl && gl.getExtension('WEBGL_lose_context');
      canvas.remove(); img.remove();
      if (ext) ext.loseContext();
    },
  };
  return api;
}
