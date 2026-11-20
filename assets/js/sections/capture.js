// How it was recorded: pointing at a device in the legend lights its marks on the photograph, and the other way round.
// The numbers already tie marks and legend together, so this only helps the eye.
import { qsa, on } from '../lib/dom.js';

export default function init(root) {
  const items = qsa('[data-k]', root);
  const pick = (k) => {
    root.classList.toggle('is-picked', !!k);
    items.forEach((el) => el.classList.toggle('is-on', !!k && el.dataset.k === k));
  };
  items.forEach((el) => {
    on(el, 'pointerenter', () => pick(el.dataset.k));
    on(el, 'pointerleave', () => pick(null));
  });
}
