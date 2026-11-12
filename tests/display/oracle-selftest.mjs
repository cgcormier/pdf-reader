import assert from 'node:assert/strict';
import { compare, compareContents, comparePartial, compareTableRows } from './oracle.mjs';
const expected = { text: 'Chapter One The story continues.', headings: ['Chapter One'] };
const good = { ...expected, visibility: [{ ok: true }] };
assert.deepEqual(compare(expected, good), []);
for (const bad of [
  { ...good, text: 'Chapter One HEADER The story continues.' },
  { ...good, text: 'Chapter One The story' },
  { ...good, text: 'Chapter One The story continues. The story continues.' },
  { ...good, headings: ['Chapter One', 'HEADER'] },
  { ...good, visibility: [{ ok: false }] },
  { ...good, visibility: [] },
  { ...good, introductions: ['Invented chapter'] },
]) assert.ok(compare(expected, bad).length);
const contents = [{ title: 'Chapter One', page: 1, y: 650 }];
assert.deepEqual(compareContents(contents, contents), []);
assert.ok(compareContents(contents, [{ ...contents[0], y: 651 }]).length);
assert.ok(compareContents(contents, [{ ...contents[0], page: 2 }]).length);
console.log('Oracle self-test: positive and injected text, role, visibility, and anchor failures detected.');

const fallback = { ...expected, introductions: ['Entire book \u2726'] };
assert.deepEqual(compare(fallback, { ...good, introductions: ['Entire book\n\u2726'] }), []);
assert.ok(compare(fallback, { ...good, introductions: ['Wrong title \u2726'] }).length);
const partial = { contains: 'story continues', forbidden: ['HEADER'] };
const partialGood = { ...good, headings: [] };
assert.deepEqual(comparePartial(partial, partialGood), []);
assert.ok(comparePartial(partial, { ...good, text: 'HEADER' }).length);
assert.ok(comparePartial(partial, { ...good, visibility: [{ ok: false }] }).length);
assert.deepEqual(compareTableRows(['Apples 12'], [{ text: 'Apples 12', singleLine: true }]), []);
assert.ok(compareTableRows(['Apples 12'], [{ text: 'Apples 12', singleLine: false }]).length);
assert.ok(compareTableRows(['Apples 12'], [{ text: 'Apples' }, { text: '12' }]).length);
