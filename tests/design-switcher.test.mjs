import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { READER_DESIGNS, DESIGN_PREFERENCE, normalizeReaderDesign, applyReaderDesign } from '../src/design-switcher.js';

test('reader designs expose exactly the current experience and three sourced directions', () => {
  assert.deepEqual(READER_DESIGNS.map(item => item.id), ['current', 'margin-house', 'signal-studio', 'common-ground']);
  assert.equal(DESIGN_PREFERENCE, 'reader-design');
  assert.ok(Object.isFrozen(READER_DESIGNS));
});
test('only known exact identifiers can select a design', () => {
  for (const design of READER_DESIGNS) assert.equal(normalizeReaderDesign(design.id), design.id);
  for (const invalid of [undefined, null, '', 0, {}, [], 'Margin House', '__proto__', '<script>', 'dark']) {
    assert.equal(normalizeReaderDesign(invalid), 'current');
  }
});
test('applying a design touches only its own body attribute', () => {
  const body = { dataset: { readingLayout: 'scroll' }, className: 'dark-paper immersive-focus' };
  assert.equal(applyReaderDesign(body, 'signal-studio'), 'signal-studio');
  assert.deepEqual(body, { dataset: { readingLayout: 'scroll', readerDesign: 'signal-studio' }, className: 'dark-paper immersive-focus' });
  assert.equal(applyReaderDesign(body, 'unknown'), 'current');
});
test('dialog uses native modal behavior and isolated shortcuts, not reader rerenders', () => {
  const source = readFileSync(new URL('../src/design-switcher.js', import.meta.url), 'utf8');
  for (const required of ['aria-pressed', 'aria-labelledby', 'aria-describedby', 'showModal()', "event.stopPropagation()", "dialog.addEventListener('close', () => button.focus())"]) assert.ok(source.includes(required), required);
  for (const forbidden of ['innerHTML', 'renderBook(', 'location.reload', 'scrollTo(', 'indexedDB']) assert.ok(!source.includes(forbidden), forbidden);
});
