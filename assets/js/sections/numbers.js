// Numbers: each figure counts up from 0 once the band is well in view. The template writes the final values and they
// stay in the page until the count actually starts, so a background tab, a jump past the band, in-page search and
// assistive technology (which reads a hidden copy of each value) always meet the real figures. With reduced motion,
// or without scripts, nothing changes; the count always ends on the template's own text.
import { qsa, fmt } from '../lib/dom.js';

const nf1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const DURATION = 1400;
const STAGGER = 80;

export default function init(root, ctx) {
  if (ctx.reducedMotion || !('IntersectionObserver' in window)) return;

  const items = qsa('[data-value]', root)
    .map((el) => ({ el, to: Number(el.dataset.value), text: el.textContent }))
    .filter((it) => Number.isFinite(it.to));
  if (!items.length) return;

  const show = (it, x) => { it.el.textContent = Number.isInteger(it.to) ? fmt(Math.round(x)) : nf1.format(x); };
  const finish = () => items.forEach((it) => { it.el.textContent = it.text; });

  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    items.forEach((it) => show(it, 0));               // the zeros appear only now, with the first frame queued
    const total = DURATION + STAGGER * items.length;
    const guard = setTimeout(finish, total + 400);    // frames can stall (hidden page): never leave a partial figure
    const t0 = performance.now();
    const step = (now) => {
      let busy = false;
      items.forEach((it, i) => {
        const t = Math.min(1, Math.max(0, (now - t0 - i * STAGGER) / DURATION));
        if (t < 1) { busy = true; show(it, it.to * (1 - (1 - t) ** 3)); } else { it.el.textContent = it.text; }
      });
      if (busy) requestAnimationFrame(step); else clearTimeout(guard);
    };
    requestAnimationFrame(step);
  };

  const io = new IntersectionObserver((entries) => {
    const e = entries[entries.length - 1];
    if (!e.isIntersecting) return;
    io.disconnect();
    // Only animate what the visitor is looking at: not in a hidden tab, not when the band is already above the fold.
    if (document.visibilityState === 'visible' && e.boundingClientRect.top > -e.boundingClientRect.height * 0.5) start();
  }, { threshold: 0.3 });
  io.observe(root);
}
