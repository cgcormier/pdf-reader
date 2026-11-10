import './page-turn-speed.css';
import { DEFAULT_PAGE_TURN_DURATION } from './page-turn.js';
import { preference, savePreference } from './storage.js';

export function attachPageTurnSpeed(reducedMotion) {
  const trigger = document.getElementById('page-turn-speed-button');
  const panel = document.getElementById('page-turn-speed-panel');
  const range = document.getElementById('page-turn-speed-range');
  const wheel = range.closest('.speed-wheel');
  const output = panel.querySelector('output');
  const tape = panel.querySelector('.speed-tape');
  const leaf = panel.querySelector('.speed-leaf');
  const note = panel.querySelector('.speed-note');
  const status = panel.querySelector('[role="status"]');
  const step = Number(range.step);
  const max = Number(range.max);
  let pinned = false;
  let opening;
  let closing;
  let panelMotion;
  let rulerMotion;
  let practiceTurn;
  let drag;
  let wheelDelta = 0;
  let wheelTime = 0;

  const saved = preference('page-turn-duration', DEFAULT_PAGE_TURN_DURATION);
  range.valueAsNumber = Number.isFinite(saved) ? saved : DEFAULT_PAGE_TURN_DURATION;
  for (let ms = 0; ms <= max; ms += step) {
    const tick = document.createElement('span');
    tick.className = 'speed-tick';
    if (ms % (2 * step) === 0) {
      tick.classList.add('speed-tick-major');
      tick.textContent = ms;
    }
    tape.append(tick);
  }

  function updateRuler(animate = false) {
    const ms = range.valueAsNumber;
    output.value = ms ? `${ms} ms` : 'Instant';
    range.setAttribute('aria-valuetext', ms ? `${ms} milliseconds` : 'Instant');
    const previous = animate && !reducedMotion.matches ? getComputedStyle(tape).transform : 'none';
    const next = `translateX(calc(var(--speed-tick-width) * -${ms / step + 0.5}))`;
    rulerMotion?.cancel();
    tape.style.transform = next;
    if (previous !== 'none') {
      rulerMotion = tape.animate([{ transform: previous }, { transform: next }], { duration: 115, easing: 'ease-out' });
    }
  }

  function saveDuration(animate) {
    updateRuler(animate);
    savePreference('page-turn-duration', range.valueAsNumber);
  }

  function setDuration(ms, animate) {
    const before = range.valueAsNumber;
    range.valueAsNumber = ms;
    if (range.valueAsNumber !== before) saveDuration(animate);
  }

  function updateMotionNote() {
    note.textContent = reducedMotion.matches
      ? 'Reduced motion is on. Page turns skip animation.'
      : 'Your reading page stays put.';
  }

  function alignPanel() {
    if (!panel.matches(':popover-open')) return;
    const gap = 8;
    const gutter = 12;
    const anchor = trigger.getBoundingClientRect();
    const left = Math.max(gutter, Math.min(anchor.left - gutter,
      document.documentElement.clientWidth - panel.offsetWidth - gutter));
    const below = Math.max(gutter, anchor.bottom + gap);
    const above = Math.min(innerHeight - gutter, anchor.top - gap);
    const belowRoom = innerHeight - gutter - below;
    const aboveRoom = above - gutter;
    const panelHeight = panel.scrollHeight + 2;
    const openAbove = belowRoom < panelHeight && aboveRoom > belowRoom;
    panel.style.setProperty('--speed-left', `${left}px`);
    panel.style.setProperty('--speed-top', `${openAbove ? above - Math.min(aboveRoom, panelHeight) : below}px`);
    panel.style.setProperty('--speed-room', `${openAbove ? aboveRoom : belowRoom}px`);
  }

  function openPanel() {
    if (trigger.hidden || panel.matches(':popover-open')) return;
    panel.showPopover({ source: trigger });
    alignPanel();
  }

  function closePanel(restoreFocus = false) {
    if (!panel.matches(':popover-open')) return;
    panel.hidePopover();
    if (restoreFocus) trigger.focus({ preventScroll: true });
  }

  function closeAfterLeave() {
    clearTimeout(opening);
    clearTimeout(closing);
    closing = setTimeout(() => {
      if (!pinned && !trigger.matches(':hover') && !panel.matches(':hover') && !panel.contains(document.activeElement)) closePanel();
    }, 220);
  }

  updateRuler();
  updateMotionNote();

  panel.addEventListener('beforetoggle', event => {
    const open = event.newState === 'open';
    trigger.setAttribute('aria-expanded', String(open));
    if (!open) {
      pinned = false;
      clearTimeout(opening);
      clearTimeout(closing);
      wheelDelta = 0;
      practiceTurn?.cancel();
      rulerMotion?.cancel();
      leaf.style.transform = '';
      status.textContent = '';
    }
  });
  panel.addEventListener('toggle', event => {
    panelMotion?.cancel();
    if (event.newState === 'open' && !reducedMotion.matches) {
      panelMotion = panel.animate([
        { opacity: 0, transform: 'translateY(-5px) scale(.985)' },
        { opacity: 1, transform: 'translateY(0) scale(1)' },
      ], { duration: 145, easing: 'ease-out' });
    }
  });

  trigger.addEventListener('pointerenter', event => {
    if (event.pointerType !== 'mouse') return;
    clearTimeout(closing);
    opening = setTimeout(openPanel, 130);
  });
  trigger.addEventListener('pointerleave', closeAfterLeave);
  panel.addEventListener('pointerenter', () => clearTimeout(closing));
  panel.addEventListener('pointerleave', closeAfterLeave);
  panel.addEventListener('focusout', closeAfterLeave);
  trigger.addEventListener('click', () => {
    if (pinned) {
      closePanel(true);
      return;
    }
    pinned = true;
    openPanel();
    range.focus({ preventScroll: true });
  });
  panel.querySelector('.speed-close').addEventListener('click', () => closePanel(true));
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !panel.matches(':popover-open')) return;
    event.preventDefault();
    closePanel(pinned || panel.contains(document.activeElement));
  });

  range.addEventListener('input', () => saveDuration(true));
  wheel.addEventListener('wheel', event => {
    if (!event.cancelable || event.ctrlKey || event.metaKey) return;
    const units = event.deltaMode;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const ms = range.valueAsNumber;
    const direction = Math.sign(delta);
    const next = ms + direction * step;
    if (!direction || next < 0 || next > max) {
      wheelDelta = 0;
      return;
    }
    event.preventDefault();
    // Treat small trackpad events as one detent, without carrying a partial
    // movement to the next gesture or jumping many steps on a mouse notch.
    if (event.timeStamp - wheelTime > 160 || Math.sign(wheelDelta) !== direction) wheelDelta = 0;
    wheelTime = event.timeStamp;
    wheelDelta += delta * (units === 1 ? 16 : units === 2 ? 32 : 1);
    if (Math.abs(wheelDelta) < 28) return;
    wheelDelta = 0;
    setDuration(next, true);
  }, { passive: false });
  wheel.addEventListener('pointerleave', () => { wheelDelta = 0; });
  wheel.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    // The wheel handles relative drag while the native range owns keyboard
    // input. Native touch handling on the range would jump to the pressed X.
    event.preventDefault();
    range.focus({ preventScroll: true });
    wheel.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, ms: range.valueAsNumber };
  });
  wheel.addEventListener('pointermove', event => {
    if (drag?.id === event.pointerId) setDuration(drag.ms + Math.round((drag.x - event.clientX) / 18) * step, false);
  });
  wheel.addEventListener('lostpointercapture', () => { drag = undefined; });

  reducedMotion.addEventListener('change', () => {
    practiceTurn?.cancel();
    rulerMotion?.cancel();
    panelMotion?.cancel();
    updateMotionNote();
    alignPanel();
  });
  panel.querySelector('.speed-replay').addEventListener('click', () => {
    const ms = range.valueAsNumber;
    practiceTurn?.cancel();
    const end = 'rotateY(-170deg)';
    leaf.style.transform = end;
    if (ms && !reducedMotion.matches) {
      practiceTurn = leaf.animate([{ transform: 'rotateY(0deg)' }, { transform: end }], {
        duration: ms, easing: 'cubic-bezier(.35,0,.23,1)',
      });
    }
    status.textContent = ms && !reducedMotion.matches ? `Sample turn: ${ms} milliseconds.` : 'Sample page turned without animation.';
  });

  for (const name of ['scroll', 'resize']) window.addEventListener(name, alignPanel, { passive: true });
  return {
    get duration() { return range.valueAsNumber; },
    setAvailable(available) {
      trigger.hidden = !available;
      if (!available) closePanel();
    },
  };
}
