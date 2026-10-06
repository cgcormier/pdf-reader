import test from 'node:test';
import assert from 'node:assert/strict';
import { removeRepeatedChapterHeading, sourcePageNavigation, swipePageDirection } from '../src/book-layout.js';

test('a standalone source heading is not repeated under the book chapter title', () => {
  assert.deepEqual(removeRepeatedChapterHeading(['CHAPTER ONE The First Light', 'A little light.'], 'The First Light'), ['A little light.']);
  assert.deepEqual(removeRepeatedChapterHeading(['Chapter II: A Slower Morning', 'A quiet day.'], 'Chapter II: A Slower Morning'), ['A quiet day.']);
});
test('body content merged with a heading remains readable', () => {
  const paragraphs = ['Chapter One The First Light A little light falls across the page.'];
  assert.deepEqual(removeRepeatedChapterHeading(paragraphs, 'The First Light'), paragraphs);
});
test('unrelated and empty content is preserved', () => {
  assert.deepEqual(removeRepeatedChapterHeading(['Something else.'], 'The First Light'), ['Something else.']);
  assert.deepEqual(removeRepeatedChapterHeading([], 'The First Light'), []);
});

test('spreads stop at the visible last page without repeating it', () => {
  assert.deepEqual(sourcePageNavigation(1, 8, 2), { end: 2, previous: null, next: 3 });
  assert.deepEqual(sourcePageNavigation(7, 8, 2), { end: 8, previous: 5, next: null });
  assert.deepEqual(sourcePageNavigation(5, 5, 2), { end: 5, previous: 3, next: null });
  assert.deepEqual(sourcePageNavigation(1, 1, 2), { end: 1, previous: null, next: null });
});

test('even chapter starts, mobile pages and the original view keep source numbering', () => {
  assert.deepEqual(sourcePageNavigation(2, 7, 2), { end: 3, previous: 1, next: 4 });
  assert.deepEqual(sourcePageNavigation(6, 7, 2), { end: 7, previous: 4, next: null });
  assert.deepEqual(sourcePageNavigation(6, 7), { end: 6, previous: 5, next: 7 });
  assert.deepEqual(sourcePageNavigation(7, 7), { end: 7, previous: 6, next: null });
});

test('touch swipes turn horizontally without turning during vertical scrolling or text selection', () => {
  assert.equal(swipePageDirection({ x: -85, y: 15, elapsed: 240 }), 'next');
  assert.equal(swipePageDirection({ x: 60, y: 0, elapsed: 900 }), 'previous');
  assert.equal(swipePageDirection({ x: -80, y: 80, elapsed: 240 }), null);
  assert.equal(swipePageDirection({ x: -59, y: 0, elapsed: 240 }), null);
  assert.equal(swipePageDirection({ x: -100, y: 0, elapsed: 901 }), null);
  assert.equal(swipePageDirection({ x: -100, y: 0, elapsed: 240, hasSelection: true }), null);
});
