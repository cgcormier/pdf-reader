import test from 'node:test';
import assert from 'node:assert/strict';
import { contentsWidthBounds, effectiveContentsWidth, contentsWidthKey } from '../src/contents-resize.js';

test('desktop bounds preserve 560 pixels for the reader at the drawer boundary', () => {
  assert.deepEqual(contentsWidthBounds(821), { min: 260, max: 261 });
  assert.deepEqual(contentsWidthBounds(1000), { min: 260, max: 440 });
  assert.deepEqual(contentsWidthBounds(1440), { min: 260, max: 480 });
});

test('effective widths retain responsive defaults and do not replace the preferred width', () => {
  assert.equal(effectiveContentsWidth(null, 1440), 280);
  assert.equal(effectiveContentsWidth(null, 1000), 270);
  assert.equal(effectiveContentsWidth(NaN, 1440), 280);
  assert.equal(effectiveContentsWidth(480, 821), 261);
  assert.equal(effectiveContentsWidth(480, 1440), 480);
  assert.equal(effectiveContentsWidth(100, 1440), 260);
});

test('keyboard resizing handles bounds and accelerated steps', () => {
  const bounds = contentsWidthBounds(1440);
  assert.equal(contentsWidthKey('ArrowRight', 280, bounds), 296);
  assert.equal(contentsWidthKey('ArrowLeft', 280, bounds), 264);
  assert.equal(contentsWidthKey('ArrowRight', 280, bounds, true), 328);
  assert.equal(contentsWidthKey('ArrowLeft', 280, bounds, true), 260);
  assert.equal(contentsWidthKey('Home', 400, bounds), 260);
  assert.equal(contentsWidthKey('End', 280, bounds), 480);
  assert.equal(contentsWidthKey('ArrowRight', 480, bounds), 480);
  assert.equal(contentsWidthKey('Escape', 280, bounds), null);
});
