// The teardown explorer: wires the controls of the section to the teardown view.
import { qs, qsa, on, clamp, fillRange, fmt } from '../lib/dom.js';
import { createTeardownView } from '../teardown/view.js';
import { loadIndex } from '../teardown/store.js';

const BASE = 'assets/data/explorer/';
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const rgb = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

export default async function init(root, ctx) {
  const el = (name) => qs(`[data-x="${name}"]`, root);
  const stage = el('stage'), step = el('step'), apart = el('apart'), tip = el('tip');
  const viewBtns = qsa('button', el('view')), colourBtns = qsa('button', el('colour'));
  const small = window.matchMedia('(max-width: 700px)').matches;
  const demo = new URLSearchParams(location.search).get('demo');          // ?demo=3d: a fixed state for screenshots
  let meta = null, scrubbing = false, wanted = null, shown = { desk: null, n: 0 };

  const index = await loadIndex(BASE);
  const view = await createTeardownView(stage, { base: BASE, reducedMotion: ctx.reducedMotion, onChange: render, onHover: hover,
    maxDpr: small ? 1.5 : 2, stride: small ? 2 : 1, keep: small ? 6 : 10, sway: !demo });

  // desktops
  const desks = el('desks');
  for (const d of index.desktops) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 's-explore__desk'; b.dataset.desk = d.id; b.setAttribute('aria-pressed', 'false');
    b.textContent = d.label;
    if (d.brand) { const sm = document.createElement('small'); sm.textContent = d.brand; b.append(sm); }
    b.setAttribute('aria-label', `${d.label}, ${d.model || d.brand || ''}, ${d.steps} steps`);
    b.title = d.model || d.brand || '';
    desks.append(b);
  }
  const pick = el('pick'); if (pick) pick.hidden = false;      // the row of desktops shows once it has its chips
  on(desks, 'click', (e) => { const b = e.target.closest('[data-desk]'); if (b && b.dataset.desk !== wanted) open(b.dataset.desk); });

  async function open(desk) {
    wanted = desk;                                           // the last click wins, whatever order the data arrives in
    qsa('[data-desk]', desks).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.desk === desk)));
    const m = await view.load(desk);
    if (!m || wanted !== desk) return;
    meta = m; shown = { desk: null, n: 0 };
    const poster = el('poster'); if (poster) poster.remove();
    step.max = String(meta.steps.length);
    el('badge').textContent = `${meta.label}, ${meta.model || meta.brand || ''}, ${meta.steps.length} steps`;
    const legend = el('legend'); legend.textContent = '';
    for (const c of meta.classes) {
      const li = document.createElement('li'), sw = document.createElement('i');
      sw.style.background = rgb(c.col);
      li.append(sw, document.createTextNode(c.label));
      legend.append(li);
    }
    el('near').textContent = `Near ${fmt(Math.round(meta.zr[0]))} mm`;
    el('far').textContent = `Far ${fmt(Math.round(meta.zr[1]))} mm`;
    render(view.state);
  }

  function describe(st) {
    if (!st.actions.length) return { text: st.step === meta.steps[0].step ? 'Initial state' : cap(st.name || 'No part operation'), tools: [] };
    const text = st.actions.map((a) => `${a.verb} the ${a.target}`).join(', then ');
    return { text: cap(text), tools: [...new Set(st.actions.map((a) => a.tool).filter((t) => t && t !== 'none'))] };
  }

  function render(s) {
    if (!meta || s.desk !== meta.desk) return;
    const n = clamp(Math.round(s.step), 1, s.steps), st = meta.steps[n - 1];
    if (!scrubbing) step.value = String(s.step);
    fillRange(step); apart.value = String(s.apart); fillRange(apart);
    if (shown.desk !== s.desk || shown.n !== n) {             // the words change only when the step does
      shown = { desk: s.desk, n };
      const d = describe(st);
      el('stepword').textContent = `Step ${n} of ${s.steps}`;
      const action = el('action'); action.textContent = d.text;
      if (d.tools.length) { const t = document.createElement('span'); t.className = 's-explore__tool'; t.textContent = ` with ${d.tools.join(', ')}`; action.append(t); }
      el('log').textContent = `${st.removed} of ${meta.parts} tracked parts removed${st.actions.length && st.name ? `. Log: ${st.name}` : ''}`;
    }
    const play = el('play');
    play.setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
    el('playicon').textContent = s.playing ? '❚❚' : '▶';
    viewBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === s.view)));
    colourBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === s.colour)));
    for (const c of [step, el('prev'), play, el('next')]) c.disabled = false;
    for (const c of [...viewBtns, ...colourBtns, apart]) c.disabled = !s.gl;
    el('legend').hidden = s.colour !== 'class';
    el('scale').hidden = s.colour !== 'depth';
    const note = el('note');
    const msg = s.error || (s.gl ? '' : (s.lost
      ? 'The 3D view stopped because the graphics context was lost. The scanner pictures can still be stepped through; reload the page to get 3D back.'
      : 'This browser does not offer WebGL2, so the 3D view and the colourings are off. The scanner pictures can still be stepped through.'));
    note.hidden = !msg; note.textContent = msg;
    const hint = el('hint');
    hint.hidden = !s.gl;
    if (s.view !== 'scanner') hint.classList.add('is-off');
  }

  function hover(hit, e) {
    if (!hit) { tip.hidden = true; return; }
    tip.textContent = '';
    const head = document.createElement('b'), sw = document.createElement('i');
    sw.style.background = rgb(hit.col);
    head.append(sw, document.createTextNode(cap(hit.label)));
    const when = hit.leaves == null ? 'Stays to the last step' : (hit.kind === 'removed' ? `Removed in step ${hit.leaves}` : `Changes state in step ${hit.leaves}`);
    tip.append(head, document.createTextNode(when));
    tip.hidden = false;
    const r = stage.getBoundingClientRect();
    const x = clamp(e.clientX - r.left + 14, 6, r.width - tip.offsetWidth - 6), y = clamp(e.clientY - r.top + 16, 6, r.height - tip.offsetHeight - 6);
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  // controls
  const go = (n) => view.set({ step: clamp(n, 1, view.state.steps), playing: false });
  on(step, 'input', () => { scrubbing = true; view.set({ step: Number(step.value), playing: false }); });
  on(step, 'change', () => { scrubbing = false; go(Math.round(Number(step.value))); });
  on(step, 'keydown', (e) => {
    const d = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -5, PageUp: 5 }[e.key];
    if (d) { e.preventDefault(); go(Math.round(view.state.step) + d); }
    else if (e.key === 'Home') { e.preventDefault(); go(1); }
    else if (e.key === 'End') { e.preventDefault(); go(view.state.steps); }
  });
  on(el('prev'), 'click', () => go(Math.round(view.state.step) - 1));
  on(el('next'), 'click', () => go(Math.round(view.state.step) + 1));
  on(el('play'), 'click', () => view.set({ playing: !view.state.playing }));
  on(el('view'), 'click', (e) => { const b = e.target.closest('[data-v]'); if (b) view.set({ view: b.dataset.v }); });
  on(el('colour'), 'click', (e) => { const b = e.target.closest('[data-v]'); if (b) view.set({ colour: b.dataset.v }); });
  on(apart, 'input', () => view.set({ apart: Number(apart.value) }));
  on(stage, 'keydown', (e) => {
    if (e.target !== stage) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(Math.round(view.state.step) - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(Math.round(view.state.step) + 1); }
  });

  root.teardown = view;                                  // for checks from the console
  await open(index.desktops[0].id);

  if (demo === '3d') {                                   // screenshots: step 12, turned, class colours, parts apart
    view.set({ step: 12, view: 'tilted', colour: 'class', apart: 0.7 });
    await view.renderNow();
    return;
  }

  // The first time the stage is well in view, the scanner picture tilts into the point cloud by itself.
  let touched = false;
  for (const type of ['pointerdown', 'keydown', 'input']) on(root, type, () => { touched = true; }, { capture: true, passive: true });
  if (!ctx.reducedMotion && view.state.gl && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((en) => en.isIntersecting)) return;
      io.disconnect();
      setTimeout(() => { if (!touched && view.state.view === 'scanner') view.set({ view: 'tilted', colour: 'class' }); }, 900);
    }, { threshold: 0.6 });
    io.observe(stage);
  }
}
