// Data of the teardown view: the list of desktops, a desktop's meta, and the three textures of each step
// (kept for the steps used most recently).
import { imageTexture, tableTexture } from './gl.js';

const json = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
};

export const loadIndex = (base) => json(`${base}index.json`);
export const loadMeta = (base, desk) => json(`${base}${desk}/meta.json`);
export const stepUrl = (base, desk, step, kind) => `${base}${desk}/S${String(step).padStart(2, '0')}_${kind}`;

/** Lookup tables indexed by instance id: class colour, and lift / outward push. */
export function instanceTables(gl, meta) {
  const width = meta.max_id + 1;
  const col = new Float32Array(width * 4), xf = new Float32Array(width * 4);
  for (const [id, e] of Object.entries(meta.instances)) {
    const i = Number(id);
    col.set([e.col[0] / 255, e.col[1] / 255, e.col[2] / 255, 1], i * 4);
    xf.set([e.lift, e.push[0], e.push[1], 0], i * 4);
  }
  return { col: tableTexture(gl, col, width), xf: tableTexture(gl, xf, width) };
}

export class StepStore {
  constructor(gl, base, desk, keep = 16) {
    Object.assign(this, { gl, base, desk, keep, steps: new Map(), failed: null });
  }

  /** The entry of a step; starts loading it when it is not there. entry.ready turns true when its textures are up. */
  get(step, onReady) {
    let e = this.steps.get(step);
    if (!e) {
      e = { ready: false, used: 0 };
      this.steps.set(step, e);
      const { gl, base, desk } = this;
      e.promise = Promise.all([
        imageTexture(gl, stepUrl(base, desk, step, 'd.webp')),
        imageTexture(gl, stepUrl(base, desk, step, 'c.webp'), true),
        imageTexture(gl, stepUrl(base, desk, step, 'l.png')),
      ]).then(([d, c, l]) => {
        if (this.disposed) { for (const t of [d, c, l]) gl.deleteTexture(t); return; }
        Object.assign(e, { d, c, l, ready: true });
        if (onReady) onReady(step);
      }).catch((err) => {                                  // the entry stays, marked, so the step is not requested again every frame
        e.failed = true; this.failed = err;
        if (!this.disposed && onReady) onReady(step, err);
      });
    }
    e.used = performance.now();
    return e;
  }

  /** Drops the least recently used steps beyond `keep`, never one of `protect`. */
  trim(protect) {
    while (this.steps.size > this.keep) {
      let old = null;
      for (const [k, v] of this.steps) {
        if (!(v.ready || v.failed) || protect.includes(k)) continue;
        if (old === null || v.used < this.steps.get(old).used) old = k;
      }
      if (old === null) return;
      this.drop(old);
    }
  }

  drop(step) {
    const e = this.steps.get(step);
    if (e && e.ready) for (const t of [e.d, e.c, e.l]) this.gl.deleteTexture(t);
    this.steps.delete(step);
  }

  dispose() {
    this.disposed = true;
    for (const k of [...this.steps.keys()]) this.drop(k);
  }
}
