import test from 'node:test';
import assert from 'node:assert/strict';
import { updateReaderCaption } from '../src/reader-caption.js';

test('original PDF hides redundant app chapter caption in either layout', () => {
  const caption = { hidden: false, textContent: 'Sets', title: 'Chapter 1 › Sets' };
  updateReaderCaption(caption, 'original');
  assert.equal(caption.hidden, true);
  assert.equal(caption.textContent, 'Sets');
  assert.equal(caption.title, 'Chapter 1 › Sets');
});

test('returning to book restores contextual caption without losing its text', () => {
  const caption = { hidden: false, textContent: 'Sets' };
  for (let i = 0; i < 3; i++) {
    updateReaderCaption(caption, 'original');
    assert.equal(caption.hidden, true);
    updateReaderCaption(caption, 'book');
    assert.equal(caption.hidden, false);
    assert.equal(caption.textContent, 'Sets');
  }
});
