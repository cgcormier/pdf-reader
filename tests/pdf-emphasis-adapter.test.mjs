import test from 'node:test';
import assert from 'node:assert/strict';
import { readPageLayout } from '../src/pdf-layout-adapter.js';
import { conservation } from '../src/pdf-layout.js';

for (const [name, style, font, expected] of [
  ['existing true flags survive omitted fields', { bold: true, italic: true }, {}, [true, true]],
  ['existing false flags remain authoritative', { bold: false, italic: false }, { name: 'Helvetica-BoldOblique' }, [false, false]],
  ['loaded false flags override existing true flags', { bold: true, italic: true }, { bold: false, italic: false }, [false, false]],
  ['existing weight and angle survive omitted fields', { fontWeight: '700', italicAngle: -12 }, {}, [true, true]],
  ['loaded normal weight and zero angle remain meaningful', { fontWeight: '700', italicAngle: -12 }, { cssFontInfo: { fontWeight: '400', italicAngle: 0 } }, [false, false]],
  ['existing actual face name survives omitted fields', { sourceFontName: 'Helvetica-BoldOblique' }, {}, [true, true]],
  ['null fields preserve existing metadata', { bold: true, italic: true, fontWeight: '700', italicAngle: -12 }, { bold: null, italic: null, cssFontInfo: { fontWeight: null, italicAngle: null } }, [true, true]],
]) test(`PDF.js emphasis metadata fallback: ${name}`, async () => {
  const pdf = { numPages: 1, getPage: async () => ({
    view: [0, 0, 600, 800],
    getTextContent: async () => ({ items: [{ str: 'Original text.', width: 70,
      transform: [10, 0, 0, 10, 40, 700], fontName: 'g_d0_f1' }], styles: { g_d0_f1: { fontFamily: 'serif', ...style } } }),
    getOperatorList: async () => ({}),
    commonObjs: { get: () => font },
  }) };
  const layout = await readPageLayout(pdf, 1);
  assert.equal(layout.projection.text, 'Original text.');
  assert.deepEqual([layout.runs[0].style.bold, layout.runs[0].style.italic], expected);
  assert.deepEqual(layout.projection.emphasis, expected.some(Boolean)
    ? [{ start: 0, end: 14, bold: expected[0], italic: expected[1] }] : undefined);
  assert.deepEqual(conservation(layout), { valid: true, errors: [] });
});
