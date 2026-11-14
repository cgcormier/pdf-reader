/** Session-only horizontal placement. Translation never changes the reader grid. */
export function attachContentsDrag({ document: doc = document, window: win = window } = {}) {
  const panel = doc.getElementById('book-contents');
  const heading = panel?.querySelector('.contents-heading');
  if (!heading) return { destroy() {} };
  const handle = doc.createElement('button');
  handle.type = 'button';
  handle.className = 'contents-drag-handle';
  handle.textContent = '↔';
  handle.setAttribute('aria-label', 'Move contents horizontally');
  handle.title = 'Drag left or right. Arrow keys move; Home resets.';
  const help = doc.createElement('span');
  help.id = 'contents-drag-help';
  help.className = 'contents-drag-help';
  help.textContent = 'Drag left or right, or use Left and Right arrow keys. Home resets the position.';
  handle.setAttribute('aria-describedby', help.id);
  heading.append(handle, help);
  let offset = 0;
  let drag = null;
  const visible = () => {
    const style = win.getComputedStyle(panel);
    return style.display !== 'none' && style.visibility !== 'hidden';
  };
  function move(next) {
    if (!visible()) return;
    const rect = panel.getBoundingClientRect();
    // Drawer transform is independent of our translate, including mid-transition.
    const transform = win.getComputedStyle(panel).transform;
    const drawerX = transform && transform !== 'none' ? new win.DOMMatrixReadOnly(transform).m41 : 0;
    const base = rect.left - offset - drawerX;
    const width = doc.documentElement.clientWidth || win.innerWidth;
    offset = Math.min(Math.max(next, -base), Math.max(-base, width - rect.width - base));
    panel.style.setProperty('--contents-offset', `${offset}px`);
  }
  function end(event) {
    if (!drag || (event?.pointerId != null && event.pointerId !== drag.id)) return;
    const id = drag.id;
    drag = null;
    panel.classList.remove('contents-dragging');
    if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
  }
  function down(event) {
    if (event.button !== 0 || drag || !visible()) return;
    move(offset);
    drag = { id: event.pointerId, x: event.clientX, offset };
    handle.setPointerCapture(event.pointerId);
    handle.focus({ preventScroll: true });
    panel.classList.add('contents-dragging');
    event.preventDefault();
  }
  function pointerMove(event) {
    if (drag?.id === event.pointerId) move(drag.offset + event.clientX - drag.x);
  }
  function keydown(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    // This control's keystrokes must never navigate the underlying book.
    if (['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      end();
      move(event.key === 'Home' ? 0 : offset + (event.key === 'ArrowLeft' ? -20 : 20));
    }
  }
  function resize() { end(); move(offset); }
  handle.addEventListener('pointerdown', down);
  handle.addEventListener('pointermove', pointerMove);
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('lostpointercapture', end);
  handle.addEventListener('keydown', keydown);
  win.addEventListener('resize', resize);
  // Re-clamp after drawers/focus have finished their existing transitions.
  const transitionEnd = event => {
    if (event.target === panel && ['transform', 'visibility'].includes(event.propertyName)) resize();
  };
  panel.addEventListener('transitionend', transitionEnd);
  const observer = new win.MutationObserver(() => { end(); move(offset); });
  observer.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
  return { destroy() {
    end(); observer.disconnect();
    win.removeEventListener('resize', resize);
    panel.removeEventListener('transitionend', transitionEnd);
    handle.remove(); help.remove();
    panel.style.removeProperty('--contents-offset');
  } };
}
