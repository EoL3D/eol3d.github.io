// The four stages: tabs (click, arrow keys, Home / End) that also change by themselves every few seconds while the
// section is on screen, until the visitor touches them; and the relation graph, where pointing at (or focusing) a
// part lights everything that leads to it. Without this script all four panels show one under the other.
import { qs, qsa, on } from '../lib/dom.js';

const EVERY = 7000;      // ms between automatic changes

function tabs(root, ctx) {
  const tabsEl = qsa('[role="tab"]', root), panels = qsa('[role="tabpanel"]', root);
  if (!tabsEl.length) return;
  root.classList.add('is-tabbed');
  root.style.setProperty('--stage-time', `${EVERY}ms`);
  let at = 0, timer = 0, auto = false, seen = false;

  const show = (i, focus = false) => {
    at = (i + tabsEl.length) % tabsEl.length;
    root.classList.remove('is-auto');
    tabsEl.forEach((t, k) => { t.setAttribute('aria-selected', String(k === at)); t.tabIndex = k === at ? 0 : -1; });
    panels.forEach((p, k) => { p.hidden = k !== at; });
    if (focus) tabsEl[at].focus();
    if (auto) requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('is-auto')));
  };
  const stop = () => { auto = false; clearInterval(timer); root.classList.remove('is-auto'); };
  const start = () => {
    if (auto || ctx.reducedMotion) return;
    auto = true;
    show(at);
    timer = setInterval(() => { if (!document.hidden) show(at + 1); }, EVERY);
  };

  tabsEl.forEach((t, i) => on(t, 'click', () => { stop(); show(i); }));
  on(qs('[role="tablist"]', root), 'keydown', (e) => {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (d) { e.preventDefault(); stop(); show(at + d, true); }
    else if (e.key === 'Home') { e.preventDefault(); stop(); show(0, true); }
    else if (e.key === 'End') { e.preventDefault(); stop(); show(tabsEl.length - 1, true); }
  });
  // any use of a panel (pointer, key, focus) keeps it in place
  for (const type of ['pointerdown', 'keydown', 'focusin']) on(qs('.s-stages__panels', root), type, stop, { passive: true });

  show(0);
  if ('IntersectionObserver' in window && !ctx.reducedMotion) {
    new IntersectionObserver((entries) => {
      const vis = entries.some((en) => en.isIntersecting);
      if (vis && !seen) { seen = true; start(); }
      else if (!vis && auto) { stop(); seen = false; }
    }, { threshold: 0.35 }).observe(root);
  }
}

function graph(svg, note) {
  const nodes = qsa('.rg__node', svg), edges = qsa('.rg__edge', svg);
  const name = (id) => nodes.find((n) => n.dataset.id === id).dataset.label;
  const idle = note ? note.textContent : '';
  const pick = (id) => {
    const up = new Set([id]);                       // the part and everything an arrow path leads from
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of edges) if (up.has(e.dataset.to) && !up.has(e.dataset.from)) { up.add(e.dataset.from); grew = true; }
    }
    svg.classList.add('is-picked');
    nodes.forEach((n) => { n.classList.toggle('is-on', up.has(n.dataset.id)); n.classList.toggle('is-target', n.dataset.id === id); });
    edges.forEach((e) => e.classList.toggle('is-on', up.has(e.dataset.to) && up.has(e.dataset.from)));
    if (note) {
      const others = nodes.filter((n) => up.has(n.dataset.id) && n.dataset.id !== id).map((n) => n.dataset.label.toLowerCase());
      note.textContent = others.length
        ? `Leading to the ${name(id).toLowerCase()}: ${[...new Set(others)].join(', ')}.`
        : `No arrow leads to the ${name(id).toLowerCase()} in this picture.`;
    }
  };
  const clear = () => {
    svg.classList.remove('is-picked');
    nodes.forEach((n) => n.classList.remove('is-on', 'is-target'));
    edges.forEach((e) => e.classList.remove('is-on'));
    if (note) note.textContent = idle;
  };
  nodes.forEach((n) => {
    on(n, 'pointerenter', () => pick(n.dataset.id)); on(n, 'pointerleave', clear);
    on(n, 'focus', () => pick(n.dataset.id)); on(n, 'blur', clear);
    on(n, 'click', () => pick(n.dataset.id));
  });
}

export default function init(root, ctx) {
  qsa('[data-rg]', root).forEach((svg) => graph(svg, qs('[data-rg-note]', root)));
  tabs(root, ctx);
}
