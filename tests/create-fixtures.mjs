import { mkdir, writeFile } from 'node:fs/promises';

// Tiny, deterministic PDF fixtures built without downloading document content.
function makePdf(outline = true, sample = false, dense = false) {
  const objects = [];
  const add = value => { objects.push(value); return objects.length; };
  add(`<< /Type /Catalog /Pages 2 0 R ${outline ? '/Outlines 12 0 R' : ''} >>`);
  add('<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R 10 0 R] /Count 4 >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pages = [
    ['CHAPTER ONE', 'The First Light', sample ? 'A little light falls across the page.' : 'This is an original test document for Folio.', 'A quiet room. A warm cup. A story waiting to be read.', 'You can take your time here.'],
    ['A quiet continuation.', sample ? 'Some stories are best read slowly.' : 'This is the second source page.', 'Turn the page to visit the next chapter.'],
    ['Chapter II: A Slower Morning', sample ? 'Leave a little space around the ordinary things.' : 'This is a second chapter with its own source-page anchor.', 'Let the morning arrive at its own pace.'],
    [],
  ];
  if (dense) pages[0] = ['Chapter I: A Long Afternoon', ...Array.from({ length: 40 }, (_, i) => `Line ${i + 1}. A quiet room holds this story as the afternoon passes.`)];
  pages.forEach((lines, index) => {
    const contentId = objects.length + 2;
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    let stream = lines.length ? 'BT /F1 22 Tf 50 735 Td ' : '0.85 0.75 0.6 rg 60 250 480 300 re f ';
    lines.forEach((line, i) => { stream += `${i ? `0 -${dense && index === 0 ? 17 : 38} Td /F1 14 Tf ` : ''}(${line}) Tj `; });
    if (lines.length) stream += 'ET';
    add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  });
  // Object 12 is the outline root, after four page/content pairs.
  add('<< /Type /Outlines /First 13 0 R /Last 14 0 R /Count 2 >>');
  add('<< /Title (The First Light) /Parent 12 0 R /Next 14 0 R /Dest [4 0 R /Fit] >>');
  add('<< /Title (A Slower Morning) /Parent 12 0 R /Prev 13 0 R /Dest [8 0 R /Fit] >>');
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((value, i) => { offsets.push(Buffer.byteLength(output)); output += `${i + 1} 0 obj\n${value}\nendobj\n`; });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return output;
}
await mkdir('output/playwright', { recursive: true });
await writeFile('output/playwright/Folio-Test-Book.pdf', makePdf());
await writeFile('output/playwright/Folio-Heading-Book.pdf', makePdf(false));
await writeFile('output/playwright/invalid.pdf', 'This is not a PDF.');
await writeFile('output/playwright/Folio-Dense-Book.pdf', makePdf(false, false, true));
if (process.argv.includes('--sample')) await writeFile('public/sample.pdf', makePdf(true, true));
console.log('Created local test PDFs (outline, headings, dense text, blank/illustrated page, invalid file).');
