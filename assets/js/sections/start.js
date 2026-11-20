// Get started: a copy button on each command sheet ("Copy", then "Copied" for two seconds, announced to screen readers).
// Without scripts the buttons stay hidden and the commands can be selected by hand.
import { qs, qsa, on, copyText } from '../lib/dom.js';

export default function init(root) {
  const status = qs('[data-copy-status]', root);
  for (const box of qsa('[data-copy-box]', root)) {
    const btn = qs('[data-copy]', box);
    const src = qs('[data-copy-src]', box);
    if (!btn || !src) continue;
    btn.hidden = false;
    let timer = 0;
    on(btn, 'click', async () => {
      const ok = await copyText(src.textContent);
      btn.textContent = ok ? 'Copied' : 'Copy';
      if (status) status.textContent = ok ? 'Copied to the clipboard.' : 'Copying failed; select the text to copy it.';
      clearTimeout(timer);
      timer = setTimeout(() => {
        btn.textContent = 'Copy';
        if (status) status.textContent = '';
      }, 2000);
    });
  }
}
