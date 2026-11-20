// Hero: the looping video plays while it is on screen and stops when it leaves; a button pauses and resumes it.
// With reduced motion it never starts by itself. Without scripts the page shows the poster and native controls.
import { qs, on } from '../lib/dom.js';

export default function init(root, ctx) {
  const video = qs('[data-hero-video]', root);
  const btn = qs('[data-hero-toggle]', root);
  if (!video || !btn) return;
  const text = qs('[data-hero-toggle-text]', btn);

  video.removeAttribute('controls');
  btn.hidden = false;

  let held = ctx.reducedMotion;        // true once the visitor paused (or motion is reduced): no automatic start

  const sync = () => {
    const playing = !video.paused;
    btn.setAttribute('aria-pressed', String(playing));
    btn.setAttribute('aria-label', playing ? 'Pause video' : 'Play video');
    if (text) text.textContent = playing ? 'Pause' : 'Play';
  };
  const play = () => {
    if (video.preload === 'none') video.preload = 'auto';
    const p = video.play();
    if (p && p.catch) p.catch(sync);   // the file is missing or the browser refused: stay on the poster
  };

  on(video, 'play', sync);
  on(video, 'pause', sync);
  // No playable source (the file is missing or the format unsupported): keep the poster and drop the button.
  const sources = Array.from(video.querySelectorAll('source'));
  if (sources.length) on(sources[sources.length - 1], 'error', () => { video.pause(); btn.hidden = true; });
  on(btn, 'click', () => {
    if (video.paused) { held = false; play(); } else { held = true; video.pause(); }
  });

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && !held) play();
        else if (!e.isIntersecting && !video.paused) video.pause();
      }
    }, { rootMargin: '200px 0px' });
    io.observe(video);
  } else if (!held) {
    play();
  }
  sync();
}
