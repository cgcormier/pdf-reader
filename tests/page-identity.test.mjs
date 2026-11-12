import test from 'node:test';
import assert from 'node:assert/strict';
import { sourcePageIdentity } from '../src/page-identity.js';

test('single source identity does not count reflow leaves', () => {
  const first = sourcePageIdentity(1, 1, 8);
  const continued = sourcePageIdentity(1, 1, 8, true);
  assert.equal(first.label, 'Source page');
  assert.equal(first.tail, 'of 8');
  assert.equal(continued.tail, first.tail);
  assert.equal(continued.leafDescription, 'Source page 1, continued');
  assert.equal(continued.description, 'Source page 1, continued of 8');
});
test('spread spanning source pages gives range without a virtual count', () => {
  assert.deepEqual(sourcePageIdentity(3, 4, 8), {
    label: 'Source pages', tail: '– 4 of 8',
    description: 'Source pages 3 to 4 of 8', leafDescription: 'Source page 3',
  });
});
