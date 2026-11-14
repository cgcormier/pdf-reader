import './immersive-focus.css';

/** An explicit fullscreen gesture; never requires fullscreen permission to read. */
export function attachImmersiveFocus({ setFocus, beforeChange = async () => {} }) {
  const trigger = document.getElementById('immersive-button');
  const pageNumber = document.getElementById('immersive-page-number');
  const readingArea = document.getElementById('reading-area');
  let active = false;
  let desired = false;
  let generation = 0;
  let ownsFullscreen = false;
  let nativePending = null;
  let transition = Promise.resolve();
  let exiting = false;

  async function leaveNative() {
    if (!ownsFullscreen) return;
    ownsFullscreen = false;
    if (document.fullscreenElement) {
      try { await document.exitFullscreen?.(); } catch { /* Browser retains control. */ }
    }
  }

  // Initiate in the click stack, before layout/animation settlement consumes activation.
  function requestNative() {
    if (nativePending || document.fullscreenElement || !document.documentElement.requestFullscreen) return;
    try {
      const request = document.documentElement.requestFullscreen();
      nativePending = Promise.resolve(request).then(async () => {
        ownsFullscreen = Boolean(document.fullscreenElement);
        if (!desired) await leaveNative();
      }, () => { /* Denied/unsupported: viewport immersion remains usable. */ })
        .finally(() => { nativePending = null; });
    } catch { /* A synchronous rejection also falls back to viewport immersion. */ }
  }

  function exit({ restoreFocus = true } = {}) {
    if (!desired && !active) return transition;
    if (exiting) return transition;
    desired = false;
    exiting = true;
    ++generation;
    // Serialize focus mutations: an in-flight setFocus(true) finishes before false.
    transition = transition.catch(() => {}).then(async () => {
      try {
        await beforeChange();
        active = false;
        document.body.classList.remove('immersive-mode');
        trigger.setAttribute('aria-pressed', 'false');
        pageNumber.hidden = true;
        await setFocus(false);
        await leaveNative();
        if (restoreFocus) document.getElementById('focus-button').focus({ preventScroll: true });
        document.dispatchEvent(new CustomEvent('reader-immersive-change', { detail: { active: false } }));
      } finally { exiting = false; }
    });
    return transition;
  }

  function enter() {
    // The hidden trigger cannot start a competing entry during an exit transition.
    if (desired || exiting) return transition;
    desired = true;
    const token = ++generation;
    requestNative();
    transition = transition.catch(() => {}).then(async () => {
      await beforeChange();
      if (!desired || token !== generation) return;
      active = true;
      document.body.classList.add('immersive-mode');
      trigger.setAttribute('aria-pressed', 'true');
      pageNumber.hidden = false;
      await setFocus(true);
      if (!desired || token !== generation) return;
      readingArea.focus({ preventScroll: true });
      document.dispatchEvent(new CustomEvent('reader-immersive-change', { detail: { active: true } }));
    });
    return transition;
  }

  trigger.addEventListener('click', enter);
  pageNumber.addEventListener('click', () => exit());
  document.addEventListener('fullscreenchange', () => {
    if (nativePending && document.fullscreenElement) ownsFullscreen = true;
    if (desired && ownsFullscreen && !document.fullscreenElement) {
      ownsFullscreen = false;
      exit();
    }
  });
  document.addEventListener('keydown', event => {
    if ((!active && !desired) || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey
      || document.getElementById('modal')?.open
      || /INPUT|TEXTAREA|SELECT/.test(event.target?.tagName)
      || event.target?.isContentEditable || event.repeat) return;
    if (event.key === 'Escape' || event.key.toLowerCase() === 'f') {
      event.preventDefault();
      event.stopImmediatePropagation();
      exit();
    }
  }, true);
  return { enter, exit, get active() { return active; }, get transitioning() { return desired || exiting; } };
}
