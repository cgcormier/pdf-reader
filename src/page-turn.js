export const DEFAULT_PAGE_TURN_DURATION = 350;

/**
 * Animate borrowed pages without duplicating their text trees. Empty placeholders
 * retain the source grid slots; cleanup restores identity, order and listeners.
 * The caller retains ownership of the reading position and replaces the stage
 * pages only after this resolves as
 * "finished".
 */
export async function turnPages({ stage, targetPages, direction, singlePage, signal, reducedMotion = false, duration = DEFAULT_PAGE_TURN_DURATION }) {
  if (signal?.aborted) return 'cancelled';
  if (reducedMotion || duration <= 0) return 'finished';

  const sourcePages = [...stage.children].filter(node => node.classList?.contains('paper-page'));
  const doc = stage.ownerDocument;
  if (!doc?.createElement || !sourcePages.length || !targetPages?.length) return 'finished';
  if (typeof doc.createElement('div').animate !== 'function') return 'finished';

  const forward = direction === 'forward';
  const sourceMoving = singlePage ? sourcePages[0] : sourcePages[forward ? 1 : 0];
  const destinationMoving = singlePage ? targetPages[0] : targetPages[forward ? 0 : 1];
  if (!sourceMoving || !destinationMoving) return 'finished';

  const layer = doc.createElement('div');
  layer.className = `page-turn-layer ${forward ? 'turn-forward' : 'turn-backward'}${singlePage ? ' turn-single' : ''}`;
  layer.setAttribute('aria-hidden', 'true');
  layer.inert = true;
  const borrowed = [];
  const borrowPage = (page, className) => {
    const parent = page.parentNode;
    const prose = page.querySelector('.page-prose');
    const scrollTop = prose?.scrollTop ?? 0;
    const hadClass = page.classList.contains(className);
    let placeholder = null;
    if (parent) {
      placeholder = doc.createElement('div');
      placeholder.className = 'paper-page turn-origin';
      placeholder.setAttribute('aria-hidden', 'true');
      parent.replaceChild(placeholder, page);
    }
    if (!hadClass) page.classList.add(className);
    borrowed.push({ page, prose, scrollTop, placeholder, className, hadClass });
    return page;
  };

  if (!singlePage) {
    const revealPage = targetPages[forward ? 1 : 0];
    if (revealPage) layer.append(borrowPage(revealPage, 'page-turn-reveal'));
  }

  const leaf = doc.createElement('div');
  leaf.className = 'page-turn-leaf';
  const front = doc.createElement('div');
  front.className = 'page-turn-face page-turn-front';
  front.append(borrowPage(sourceMoving, 'page-turn-page'));
  const back = doc.createElement('div');
  back.className = 'page-turn-face page-turn-back';
  back.append(borrowPage(destinationMoving, 'page-turn-page'));
  leaf.append(front, back);
  layer.append(leaf);

  const hadTurning = stage.classList.contains('is-turning');
  if (!hadTurning) stage.classList.add('is-turning');
  stage.append(layer);
  // Restore after mounting: detached prose may have its scrollTop clamped.
  for (const { prose, scrollTop } of borrowed) if (prose) prose.scrollTop = scrollTop;

  let onAbort = () => {};
  const cleanup = () => {
    signal?.removeEventListener('abort', onAbort);
    for (const { page, prose, scrollTop, placeholder, className, hadClass } of borrowed) {
      if (!hadClass) page.classList.remove(className);
      if (placeholder?.parentNode) placeholder.parentNode.replaceChild(page, placeholder);
      else page.remove();
      if (prose) prose.scrollTop = scrollTop;
    }
    layer.remove();
    if (!hadTurning) stage.classList.remove('is-turning');
  };

  return new Promise(resolve => {
    let settled = false;
    let animation;
    const settle = result => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    onAbort = () => {
      try { animation?.cancel(); } catch { /* cleanup still owns settlement */ }
      settle('cancelled');
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    try {
      animation = leaf.animate(
        [{ transform: 'rotateY(0deg)' }, { transform: `rotateY(${forward ? '-180deg' : '180deg'})` }],
        { duration, easing: 'cubic-bezier(.2,.72,.25,1)', fill: 'forwards' },
      );
      animation.finished.then(() => settle('finished'), () => settle('cancelled'));
      if (signal?.aborted) onAbort();
    } catch {
      settle('cancelled');
    }
  });
}
