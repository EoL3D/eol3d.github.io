// Team: the copy button of the BibTeX sheet ("Copy", then "Copied" for two seconds, announced to screen readers).
// Without scripts the button stays hidden and the entry can be selected by hand.
import { qs, on, copyText } from '../lib/dom.js';

export default function init(root) {
  const btn = qs('[data-copy]', root);
  const src = qs('[data-bibtex]', root);
  const status = qs('[data-copy-status]', root);
  if (!btn || !src) return;
  btn.hidden = false;

  let timer = 0;
  on(btn, 'click', async () => {
    const ok = await copyText(src.textContent);
    btn.textContent = ok ? 'Copied' : 'Copy';
    if (status) status.textContent = ok ? 'BibTeX copied to the clipboard.' : 'Copying failed; select the text to copy it.';
    clearTimeout(timer);
    timer = setTimeout(() => {
      btn.textContent = 'Copy';
      if (status) status.textContent = '';
    }, 2000);
  });
}
