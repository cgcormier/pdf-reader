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

export function makeOpeningAuditPdf() {
  const escape = text => text.replace(/[\\()]/g, '\\$&');
  const lines = [
    { text: 'An opening note', y: 750, size: 14 },
    { text: 'CHAPTER ONE', y: 715, size: 22 },
    { text: 'The First Light', y: 675, size: 14 },
    ...Array.from({ length: 26 }, (_, index) => ({
      text: `Original opening prose line ${index + 1} continues the story without losing its source.`,
      y: 635 - index * 18, size: 10,
    })),
  ];
  const stream = lines.map(({ text, y, size }) => `BT /F1 ${size} Tf 1 0 0 1 50 ${y} Tm (${escape(text)}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /Outlines 6 0 R >>',
    '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Outlines /First 7 0 R /Last 7 0 R /Count 1 >>',
    '<< /Title (The First Light) /Parent 6 0 R /Dest [4 0 R /XYZ null 675 null] >>',
  ];
  let output = '%PDF-1.4\n'; const offsets = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  return `${output}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}
