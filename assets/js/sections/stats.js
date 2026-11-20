// The dataset in numbers: a crosshair read-out on the line chart (pointer and arrow keys), a hover tooltip on the
// histogram's columns, and the highlighting of the flow chart. Every value is also in the page itself (labels, the table), so this only adds convenience.
import { qs, qsa, on, clamp } from '../lib/dom.js';

const pct = (v) => `${(Math.round(v * 10) / 10).toFixed(1)} %`;
const NAMES = { a: 'In the machine', b: 'In view', c: 'Hidden' };
const COLOURS = { a: 'var(--series-1)', b: 'var(--series-2)', c: 'var(--series-3)' };

function lineChart(lc) {
  const plot = qs('.lc__plot', lc);
  const grid = lc.dataset.grid.split(',').map(Number);
  const series = { a: lc.dataset.a.split(',').map(Number), b: lc.dataset.b.split(',').map(Number), c: lc.dataset.c.split(',').map(Number) };
  const cross = qs('[data-lc-cross]', lc), tip = qs('[data-lc-tip]', lc);
  const dots = Object.fromEntries(qsa('[data-lc-dot]', lc).map((d) => [d.dataset.lcDot, d]));
  let at = null;

  const show = (i) => {
    at = clamp(i, 0, grid.length - 1);
    const x = grid[at];
    cross.style.left = `${x}%`; cross.hidden = false;
    for (const k of Object.keys(series)) { const d = dots[k]; d.style.left = `${x}%`; d.style.top = `${100 - series[k][at]}%`; d.hidden = false; }
    tip.textContent = '';
    const head = document.createElement('b'); head.textContent = `Progress ${Math.round(x)} %`; tip.append(head);
    for (const k of Object.keys(series)) {
      const row = document.createElement('span'); row.style.display = 'block';
      const sw = document.createElement('i'); sw.style.background = COLOURS[k];
      row.append(sw, document.createTextNode(`${NAMES[k]}: ${pct(series[k][at])}`)); tip.append(row);
    }
    tip.hidden = false;
    const w = plot.clientWidth, tw = tip.offsetWidth;
    const px = (x / 100) * w;
    tip.style.left = `${px + 12 + tw > w ? px - 12 - tw : px + 12}px`;
    tip.style.top = '4px';
  };
  const hide = () => { at = null; cross.hidden = true; tip.hidden = true; Object.values(dots).forEach((d) => { d.hidden = true; }); };

  on(plot, 'pointermove', (e) => {
    const r = plot.getBoundingClientRect();
    show(Math.round(((e.clientX - r.left) / r.width) * (grid.length - 1)));
  });
  on(plot, 'pointerleave', hide);
  on(lc, 'focus', () => show(at ?? grid.length - 1));
  on(lc, 'blur', hide);
  on(lc, 'keydown', (e) => {
    const d = { ArrowLeft: -1, ArrowRight: 1, Home: -999, End: 999 }[e.key];
    if (d === undefined) return;
    e.preventDefault();
    show((at ?? 0) + d);
  });
}

function columns(root) {
  const cols = qsa('.hist__col', root);
  cols.forEach((col) => {
    const h = parseFloat(qs('i', col).style.height) || 0;
    col.style.setProperty('--h', String(h));
    const tip = document.createElement('span');
    tip.className = 's-stats__tip'; tip.hidden = true; tip.textContent = col.dataset.tip;
    tip.style.bottom = `calc(${h}% + 8px)`; tip.style.left = '50%'; tip.style.transform = 'translateX(-50%)'; tip.style.minWidth = '0';
    col.append(tip);
    const showTip = () => { tip.hidden = false; };
    const hideTip = () => { tip.hidden = true; };
    on(col, 'pointerenter', showTip); on(col, 'pointerleave', hideTip);
    // the values are in the chart's accessible name and in the page; the columns stay out of the tab order
  });
}

// The flow chart: pointing at (or focusing) an action or a part lights its ribbons and the nodes at their other ends;
// pointing at one ribbon names it. The totals are printed beside every node and each node's accessible name lists
// its ribbons, so nothing is readable only here.
function flow(el) {
  const links = qsa('.flow__link', el), nodes = qsa('.flow__node', el), tip = qs('[data-flow-tip]', el);
  const name = (id) => { const n = nodes.find((x) => x.dataset.id === id); return n ? qs('span', n).firstChild.textContent.trim() : id; };
  const pick = (test) => {
    const on = new Set();
    links.forEach((l) => { const hit = test(l); l.classList.toggle('is-on', hit); if (hit) { on.add(l.dataset.from); on.add(l.dataset.to); } });
    nodes.forEach((n) => n.classList.toggle('is-on', on.has(n.dataset.id)));
    el.classList.add('is-picked');
  };
  const clear = () => { el.classList.remove('is-picked'); if (tip) tip.hidden = true; };
  nodes.forEach((n) => {
    const side = n.parentElement.classList.contains('flow__col--left') ? 'from' : 'to';
    const show = () => pick((l) => l.dataset[side] === n.dataset.id);
    on(n, 'pointerenter', show); on(n, 'focus', show);
    on(n, 'pointerleave', clear); on(n, 'blur', clear);
  });
  links.forEach((l) => {
    on(l, 'pointerenter', (e) => {
      pick((x) => x === l);
      if (!tip) return;
      tip.textContent = `${name(l.dataset.from)} → ${name(l.dataset.to)}: ${Number(l.dataset.n).toLocaleString('en-US')} actions`;
      tip.hidden = false;
      const r = el.getBoundingClientRect();
      tip.style.left = `${clamp(e.clientX - r.left + 12, 0, r.width - tip.offsetWidth)}px`;
      tip.style.top = `${clamp(e.clientY - r.top - 34, 0, r.height - 30)}px`;
    });
    on(l, 'pointerleave', clear);
  });
}

export default function init(root) {
  qsa('[data-lc]', root).forEach(lineChart);
  qsa('.hist', root).forEach(columns);
  qsa('[data-flow]', root).forEach(flow);
}
