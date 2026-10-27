/** Original PDFs exercise font fidelity, speech spacing, OCR mismatch and tails. */
function pdf(objects) {
  let output = '%PDF-1.7\n'; const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}
const escape = text => text.replace(/[\\()]/g, '\\$&');

export function makeFidelityPdf(pages, { ocrMismatch = false } = {}) {
  const pageRef = index => 8 + index * 2;
  const cmap = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Fixture def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange 3 beginbfrange <00> <46> <0000> <47> <47> <0043> <48> <FF> <0048> endbfrange endcmap CMapName currentdict /CMap defineresource pop end end';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageRef(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    ...['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'].map((font, index) => `<< /Type /Font /Subtype /Type1 /BaseFont /${font}${ocrMismatch && !index ? ' /ToUnicode 7 0 R' : ''} >>`),
    `<< /Length ${Buffer.byteLength(cmap)} >>\nstream\n${cmap}\nendstream`,
  ];
  for (const [index, page] of pages.entries()) {
    const commands = (page.items ?? []).map(item => `BT /F${item.bold ? item.italic ? 4 : 2 : item.italic ? 3 : 1} ${item.size ?? 10} Tf 1 0 0 1 ${item.x ?? 40} ${item.y} Tm (${escape(item.text)}) Tj ET`);
    // A visible image-only page gives the pager a genuine non-text source leaf.
    if (page.image) commands.push('q 180 0 0 180 180 300 cm BI /W 1 /H 1 /CS /RGB /BPC 8 /F /AHx ID 496f91> EI Q');
    const stream = commands.join('\n');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >> >> /Contents ${pageRef(index) + 1} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  return pdf(objects);
}

export function makeEmphasisPdf() {
  return makeFidelityPdf(Array.from({ length: 2 }, (_, page) => ({ items: Array.from({ length: 58 }, (_, line) => {
    const number = page * 58 + line + 1;
    const parts = [
      { text: `Quiet line ${number} ` }, { text: `bold ${number} `, bold: true },
      { text: `italic ${number} `, italic: true }, { text: `both ${number} `, bold: true, italic: true },
      { text: 'continues through the measured room.' },
    ];
    let x = 40;
    return parts.map(part => { const item = { ...part, x, y: 760 - line * 11, size: 10 }; x += part.text.length * 6; return item; });
  }).flat() })));
}

function speechPage() {
  return { items: [
    { text: 'ACT I', x: 260, y: 760, size: 18 },
    { text: 'Enter two travellers.', x: 150, y: 725, italic: true },
    { text: 'TRAVELLER', x: 40, y: 690 },
    ...Array.from({ length: 12 }, (_, i) => i ? [{ text: `We carry quiet songs along the road ${i + 1}.`, x: 110, y: 690 - i * 13 }]
      : [{ text: 'We carry ', x: 110, y: 690 }, { text: 'quiet ', x: 164, y: 690, bold: true },
        { text: 'songs ', x: 200, y: 690, italic: true }, { text: 'along the road 1.', x: 236, y: 690 }]).flat(),
    { text: 'MESSENGER', x: 40, y: 510 },
    ...Array.from({ length: 10 }, (_, i) => ({ text: `The open gate invites the morning light ${i + 1}.`, x: 110, y: 510 - i * 13 })),
    { text: '[They leave together.]', x: 150, y: 350, italic: true },
    { text: 'The river carries evening into sleep.', x: 80, y: 310 },
    { text: 'The willow holds its shadow in the deep.', x: 80, y: 297 },
    { text: 'A lantern turns beside the silent door.', x: 80, y: 265 },
    { text: 'And waits for footsteps on the wooden floor.', x: 80, y: 252 },
  ] };
}
export function makeSpeechPdf() {
  return makeFidelityPdf([speechPage()]);
}

export function makeOcrPdf({ ocrMismatch = true } = {}) {
  return makeFidelityPdf([{ items: Array.from({ length: 58 }, (_, i) => ({
    text: `God keeps the original glyphs on source line ${i + 1}.`, y: 760 - i * 11,
  })) }], { ocrMismatch });
}

export const tailLengths = [48, 65, 74];
export function makeMeasuredTailPdf(lengths = [3000, 3000, 3000]) {
  return makeFidelityPdf(lengths.map((length, page) => {
    let text = 'quiet '.repeat(Math.ceil(length / 6)).slice(0, length - 1) + 'z'; const lines = [];
    while (text.length > 72) {
      const end = text.lastIndexOf(' ', 72); lines.push(text.slice(0, end)); text = text.slice(end + 1);
    }
    lines.push(text);
    return { items: lines.map((text, index) => ({ text, x: 40, y: 760 - index * 13, bold: page === 2, italic: page === 2 })) };
  }));
}
export function makeTailPdf() {
  return makeFidelityPdf([
    ...tailLengths.map((length, page) => ({ items: [
      ...Array.from({ length: 42 }, (_, i) => ({ text: `Original source ${page + 1} line ${i + 1} follows the quiet path through the woods.`, y: 760 - i * 14 })),
      { text: `Tail ${page + 1} ` + 'a'.repeat(length - 7), y: 155 },
    ] })),
    { items: [] }, { image: true },
    { items: [{ text: 'The final source page remains reachable.', y: 700 }] },
    speechPage(),
  ]);
}
