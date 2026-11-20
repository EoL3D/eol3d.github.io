// Small helpers shared by the section modules.

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export const on = (el, type, fn, opts) => { el.addEventListener(type, fn, opts); return () => el.removeEventListener(type, fn, opts); };
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);

const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** 2748 -> "2,748"; 11.1 -> "11.1" (the same form the build tool writes into the page). */
export const fmt = (x) => (Number.isInteger(x) ? nf0.format(x) : nf1.format(x));

/** Calls fn(entry) once when el comes within `margin` of the viewport. */
export function whenNear(el, fn, margin = '600px') {
  if (!('IntersectionObserver' in window)) { fn(); return; }
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io.disconnect(); fn(); }
  }, { rootMargin: margin });
  io.observe(el);
}

/** Sets --fill on a range input so the track left of the thumb can be coloured. */
export function fillRange(input) {
  const lo = Number(input.min || 0), hi = Number(input.max || 100);
  input.style.setProperty('--fill', `${hi > lo ? ((Number(input.value) - lo) / (hi - lo)) * 100 : 0}%`);
}

/** Copies text; resolves true when it worked. */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  const ta = Object.assign(document.createElement('textarea'), { value: text });
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.append(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}
