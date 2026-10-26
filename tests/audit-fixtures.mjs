import { makeLayoutPdf } from './pdf-layout-fixture.mjs';

// Original text reproduces the structural-word ambiguity without third-party PDFs.
export const proseLines = [
  'The preceding body line continues into this',
  'part of their load and help them to bear it-that will',
  'book of stories and ordinary examples remains body text.',
  'section of the narrative continues at the same measure.',
  'section a reader remembers is still ordinary prose.',
  'chapter about an ordinary afternoon continues here.',
  'appendix of supporting material is mentioned in prose.',
  'book civil life describes is still an ordinary sentence.',
];

export function makeProseAuditPdf() {
  return makeLayoutPdf([{ items: proseLines.map((text, index) => ({
    text, x: 40, y: 700 - index * 14, size: 10,
  })) }]);
}
