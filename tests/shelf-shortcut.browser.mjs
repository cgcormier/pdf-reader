// Run against an open Folio tab with the browser tool's documented Tab API.
// Uses the current collection without importing, removing, or changing books.
export async function verifyShelfShortcut(tab) {
  const state = await tab.playwright.locator('.shelf-shortcut').evaluate(root => ({
    count: Number(root.querySelector('#shelf-count').textContent),
    books: root.querySelectorAll('button.shelf-spine').length,
    label: root.querySelector('#library-button').textContent.trim(),
    invitationAtLeft: root.querySelector('#library-button').getBoundingClientRect().right <= root.querySelector('#shelf-spines').getBoundingClientRect().left,
  }));
  if (state.books !== Math.min(state.count, 8)) throw new Error('Shelf previews do not match the collection');
  if (!state.label.includes('Your PDFs,') || !state.invitationAtLeft) throw new Error('Shelf invitation must sit to the left of the books');
  for (const spine of await tab.playwright.locator('button.shelf-spine').all()) {
    await spine.press('Tab');
    await tab.pressKey(null, 'shift+Tab');
    const feedback = await spine.evaluate(node => ({
      focused: document.activeElement === node,
      title: node.querySelector('[role="tooltip"]').textContent,
      label: node.getAttribute('aria-label'),
      description: node.getAttribute('aria-describedby') === node.querySelector('[role="tooltip"]').id,
      visible: getComputedStyle(node.querySelector('[role="tooltip"]')).visibility === 'visible',
    }));
    if (!feedback.focused || !feedback.visible || !feedback.description || feedback.label !== `Read ${feedback.title}`) {
      throw new Error('A book does not expose its title on keyboard focus');
    }
  }
  await tab.playwright.locator('#library-button').click();
  const opened = await tab.playwright.locator('#modal').evaluate(node => node.open && node.textContent.includes('Your shelf'));
  if (!opened) throw new Error('Shelf caption does not open the collection');
  await tab.playwright.locator('#modal').press('Escape');
  return { ...state, keyboardTooltips: 'passed', shelfAccess: 'passed' };
}
