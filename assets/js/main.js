// Page entry: the staggered entrance of each section's parts, the guide's contents list, and loading each section's
// module when it comes near the viewport. `?shot=1` in the address shows everything at once and holds all motion (for screenshots).
import { qsa, whenNear } from './lib/dom.js';

window.__eolStarted = true;          // tells the inline guard in the page head that the script is running

const shot = /[?&]shot=1\b/.test(window.location.search);
const cache = new Map();
const ctx = {
  reducedMotion: shot || window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  /** data('site') -> Promise of assets/data/site.json; one request per name. */
  data(name) {
    if (!cache.has(name)) {
      cache.set(name, fetch(`assets/data/${name}.json`).then((r) => {
        if (!r.ok) throw new Error(`assets/data/${name}.json: ${r.status}`);
        return r.json();
      }));
    }
    return cache.get(name);
  },
};

// Parts of a section that come into view together fade up one after the other, 60 ms apart, in page order.
const STAGGER = 60;
function reveal() {
  const els = qsa('[data-reveal]');
  if (ctx.reducedMotion || !('IntersectionObserver' in window)) { els.forEach((el) => el.classList.add('is-in')); return; }
  const io = new IntersectionObserver((entries) => {
    const now = entries.filter((e) => e.isIntersecting).map((e) => e.target);
    now.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    now.forEach((el, i) => {
      el.style.setProperty('--reveal-delay', `${Math.min(i, 8) * STAGGER}ms`);
      el.classList.add('is-in');
      io.unobserve(el);
    });
  }, { rootMargin: '0px 0px -6% 0px' });
  els.forEach((el) => io.observe(el));
}

function modules() {
  for (const root of qsa('[data-module]')) {
    whenNear(root, async () => {
      const name = root.dataset.module;
      try {
        const mod = await import(`./sections/${name}.js`);
        await mod.default(root, ctx);
        root.dataset.ready = '';
      } catch (err) {
        root.dataset.moduleError = '';      // the section keeps its static content
        console.error(`section "${name}" failed to start`, err);
      }
    });
  }
}

if (shot) {
  // for screenshot tooling: the page offset of each section, readable from a DOM dump
  document.documentElement.classList.add('is-shot');
  window.addEventListener('load', () => {
    const at = qsa('main section[id]').map((s) => `${s.id}:${Math.round(s.getBoundingClientRect().top + window.scrollY)}`);
    document.documentElement.dataset.shotOffsets = at.join(' ');
  });
}
// Guide page: the contents entry of the part on screen is marked as current.
function contents() {
  const links = qsa('.guide__toc a');
  if (!links.length || !('IntersectionObserver' in window)) return;
  const byId = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
  const targets = [...byId.keys()].map((id) => document.getElementById(id)).filter(Boolean);
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      links.forEach((a) => a.classList.toggle('is-current', a === byId.get(e.target.id)));
    }
  }, { rootMargin: '-20% 0px -70% 0px' });
  targets.forEach((t) => io.observe(t));
}

contents();
reveal();
modules();
