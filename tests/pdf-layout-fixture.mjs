/** Tiny original PDFs, generated without conversion runtimes or external data. */
export function makeLayoutPdf(pages, { tagged = false, badTags = false } = {}) {
  const encode = value => new TextEncoder().encode(value);
  const objects = []; const add = value => { objects.push(value); return objects.length; };
  const escape = text => text.replace(/[\\()]/g, '\\$&');
  const pageRef = index => 5 + index * 2;
  const structRoot = 5 + pages.length * 2;
  add(`<< /Type /Catalog /Pages 2 0 R ${tagged ? `/MarkInfo << /Marked true >> /StructTreeRoot ${structRoot} 0 R` : ''} >>`);
  add(`<< /Type /Pages /Kids [${pages.map((_, i) => `${pageRef(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>');
  for (const [index, page] of pages.entries()) {
    const commands = page.items.map((item, i) => `${tagged ? `/P << /MCID ${i} >> BDC\n` : ''}BT /${item.italic ? 'F2' : 'F1'} ${item.size ?? 10} Tf ${item.matrix ?? `1 0 0 1 ${item.x} ${item.y}`} Tm (${escape(item.text)}) Tj ET${tagged ? '\nEMC' : ''}`);
    const stream = commands.join('\n');
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [${(page.view ?? [0, 0, 600, 800]).join(' ')}] /Rotate ${page.rotate ?? 0} /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageRef(index) + 1} 0 R ${tagged ? `/StructParents ${index}` : ''} >>`);
    add(`<< /Length ${encode(stream).length} >>\nstream\n${stream}\nendstream`);
  }
  if (tagged) {
    const count = pages.reduce((n, p) => n + p.items.length, 0);
    const parentTree = structRoot + 1; const firstElement = structRoot + 2;
    add(`<< /Type /StructTreeRoot /K [${Array.from({ length: count }, (_, i) => `${firstElement + (badTags ? count - i - 1 : i)} 0 R`).join(' ')}] /ParentTree ${parentTree} 0 R >>`);
    let next = firstElement;
    add(`<< /Nums [${pages.map((p, i) => `${i} [${p.items.map(() => `${next++} 0 R`).join(' ')}]`).join(' ')}] >>`);
    next = firstElement;
    for (const [p, page] of pages.entries()) for (const [i, item] of page.items.entries()) add(`<< /Type /StructElem /S /${item.role ?? 'P'} /P ${structRoot} 0 R /Pg ${pageRef(p)} 0 R /K ${i} >>`);
  }
  let output = '%PDF-1.7\n'; const offsets = [0];
  objects.forEach((value, index) => { offsets.push(encode(output).length); output += `${index + 1} 0 obj\n${value}\nendobj\n`; });
  const xref = encode(output).length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return encode(output);
}

export const layoutPages = [
  { items: [
    { text: 'Preface', x: 40, y: 730, size: 20 },
    { text: 'M', x: 40, y: 660, size: 30.3424 },
    { text: 'y goal in writing this book has been to create a very inexpensive', x: 66, y: 674.226, size: 10.9091 },
    { text: 'high-quality textbook.', x: 66, y: 660, size: 10.9091 },
    { text: 'Ordinary prose can wrap freely at a different reading size.', x: 40, y: 630, size: 10.9091 },
  ] },
  { items: [
    { text: 'Chapter 1: Two Columns', x: 40, y: 740, size: 20 },
    ...[700, 685, 670].flatMap((y, i) => [{ text: `Left opening line ${i + 1} has original example prose.`, x: 40, y, size: 10 }, { text: `Right opening line ${i + 1} continues the example.`, x: 330, y, size: 10 }]),
    { text: 'A spanning middle heading', x: 150, y: 620, size: 20 },
    ...[580, 565, 550].flatMap((y, i) => [{ text: `Left lower line ${i + 1} begins a new band.`, x: 40, y, size: 10 }, { text: `Right lower line ${i + 1} ends the example.`, x: 330, y, size: 10 }]),
  ] },
  { items: [
    { text: 'ACT I', x: 260, y: 750, size: 18 }, { text: 'Scene I', x: 260, y: 710, size: 12 },
    { text: 'Enter two travellers.', x: 205, y: 680, size: 12, italic: true },
    { text: 'TRAVELLER', x: 60, y: 640, size: 10 }, { text: 'We walk for 25 miles before the dawn.', x: 140, y: 640, size: 12 },
    { text: 'FTLN 0001', x: 2, y: 640, size: 8 }, { text: '5', x: 560, y: 640, size: 8 },
    { text: 'And carry songs along the winding road.', x: 140, y: 622, size: 12 }, { text: 'FTLN 0002', x: 2, y: 622, size: 8 },
    { text: 'MESSENGER', x: 60, y: 590, size: 10 },
    { text: 'The gate is open.', x: 140, y: 572, size: 12 }, { text: '10', x: 560, y: 572, size: 8 },
    { text: '[They leave together.]', x: 205, y: 540, size: 12, italic: true },
    { text: 'TRAVELLER', x: 60, y: 510, size: 10 }, { text: 'A final word.', x: 140, y: 510, size: 12 },
  ] },
  { items: [{ text: 'A very long original source line '.repeat(40), x: 40, y: 700, size: 10, matrix: '.07 0 0 1 40 700' }, { text: 'Next source line remains separate.', x: 40, y: 680, size: 10 }] },
];

// Original prose at the audited page size and title/neighbor coordinates.
// The OCR-shaped title strings are intentional; layout must not rewrite them.
export const modestHeadingPages = [
  { view: [0, 0, 248.4, 425.52], items: [
    ...Array.from({ length: 10 }, (_, index) => ({ text: `Ordinary discussion line ${index + 1} continues across the page.`,
      x: 9, y: 425.52 - (125.92 + index * 11.2), size: 8.85, width: 231 })),
    { text: "Zarathustra's Prologu e", x: 59.77, y: 425.52 - 265.75, size: 10.9, width: 126.62 },
    { text: '1', x: 121.56, y: 425.52 - 286.82, size: 8.85, width: 4.02 },
    ...Array.from({ length: 4 }, (_, index) => ({ text: `The new narrative line ${index + 1} continues across the page.`,
      x: 9, y: 425.52 - (299.96 + index * 11.2), size: 9.8, width: 231 })),
  ] },
  { view: [0, 0, 248.4, 425.52], items: [
    ...Array.from({ length: 10 }, (_, index) => ({ text: `The earlier narrative line ${index + 1} continues across the page.`,
      x: 9, y: 425.52 - (162.05 + index * 11.2), size: 9.8, width: 231 })),
    { text: "Zarathustra's Sp eeches", x: 59.17, y: 425.52 - 303.01, size: 10.9, width: 129.08 },
    { text: 'O N T H E T H R E E M E T A M O R P H O S E S', x: 44.53, y: 425.52 - 324.68, size: 6.1, width: 159.129 },
    ...Array.from({ length: 4 }, (_, index) => ({ text: `The next narrative line ${index + 1} continues across the page.`,
      x: 9, y: 425.52 - (341.69 + index * 11.2), size: 9.8, width: 231 })),
  ] },
];

// Short source headers with original prose below, including offset folios and
// separate PDF runs/lines. Only classification may change the display stream.
export const runningHeaderPages = [
  [{ text: 'THUS SPOKE ZARATHUSTRA: FIRST PART 123', x: 31.32, y: 413.1, size: 8.35, width: 210.4 }],
  [{ text: 'THUS SPOKE ZARATHUSTRA: nRST P.ART', x: 31.2, y: 412.66, size: 7.3, width: 186.88 },
    { text: '121', x: 226.13, y: 412.66, size: 7.3, width: 13.08 }],
  [{ text: '124', x: 9.45, y: 413.75, size: 8.85, width: 13.01 },
    { text: 'THE ?ORTABLE NIETZSCHE', x: 62.64, y: 413.75, size: 8.35, width: 121.45 }],
  [{ text: 'THUS SPOKE ZARATH USTRA: FIRST PART', x: 31.44, y: 413.52, size: 8, width: 187.24 },
    { text: '137', x: 227.45, y: 413.52, size: 8.85, width: 13.39 }],
  [{ text: '124 THE ?ORTABLE NIETZSCHE', x: 9.45, y: 413.75, size: 8.35, width: 175 }],
].map(headers => ({ view: [0, 0, 248.4, 425.52], items: [...headers,
  ...Array.from({ length: 6 }, (_, index) => ({ text: `The ordinary narrative continues across this page ${index + 1}.`,
    x: 9, y: 425.52 - (25.95 + index * 11.2), size: 9.8, width: 231 })),
] }));
