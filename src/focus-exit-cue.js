/** A one-shot visual reminder, not a notification or a focus target. */
export function attachFocusExitCue({ document: doc = document, delay = 2000, fade = 180 } = {}) {
  const cue = doc.createElement('div');
  cue.id = 'focus-exit-cue';
  cue.className = 'focus-exit-cue';
  cue.setAttribute('aria-hidden', 'true');
  cue.hidden = true;
  doc.body.append(cue);
  let hideTimer;
  let removeTimer;
  let state = '';
  const clear = () => { clearTimeout(hideTimer); clearTimeout(removeTimer); };
  function update() {
    const focus = doc.body.classList.contains('focus-mode');
    const immersive = doc.body.classList.contains('immersive-mode');
    const next = focus ? (immersive ? 'immersive' : 'focus') : '';
    if (next === state) return;
    state = next;
    clear();
    cue.classList.remove('is-visible');
    cue.hidden = !next;
    if (!next) return;
    const touch = doc.defaultView?.matchMedia?.('(hover: none), (pointer: coarse)').matches;
    cue.textContent = immersive
      ? (touch ? 'Tap page number to exit' : 'Esc to leave immersive reading')
      : (touch ? 'Tap focus icon to exit' : 'Esc to leave focus');
    cue.classList.add('is-visible');
    hideTimer = setTimeout(() => {
      cue.classList.remove('is-visible');
      removeTimer = setTimeout(() => { cue.hidden = true; }, fade);
    }, delay);
  }
  doc.addEventListener('reader-focus-change', update);
  doc.addEventListener('reader-immersive-change', update);
  update();
  return { destroy() { clear(); doc.removeEventListener('reader-focus-change', update); doc.removeEventListener('reader-immersive-change', update); cue.remove(); } };
}
