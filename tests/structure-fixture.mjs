/** Original synthetic book; exercises the real PDF.js parser without downloads. */
export function makeStructurePdf({ outline = true, pages = 132 } = {}) {
  const objects = [];
  const add = text => { objects.push(text); return objects.length; };
  const escape = text => text.replace(/[\\()]/g, '\\$&');
  const outlineRoot = 5 + pages * 2;
  add(`<< /Type /Catalog /Pages 2 0 R /PageLabels 4 0 R ${outline ? `/Outlines ${outlineRoot} 0 R` : ''} >>`);
  add(`<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${5 + i * 2} 0 R`).join(' ')}] /Count ${pages} >>`);
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  add('<< /Nums [0 << /S /r >> 2 << /S /D /St 1 >>] >>');
  for (let number = 1; number <= pages; number++) {
    const content = [];
    const text = (value, x, y, size = 11) => content.push(`BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm (${escape(value)}) Tj ET`);
    text('A Field Guide', 50, 779, 9);
    if (number === 1) text('A Field Guide to Learning', 50, 700, 25);
    if (number === 2) {
      text('Contents', 50, 730, 24);
      for (const [i, [title, label]] of [['Chapter 1: Foundations', '1'], ['1.1 Sample Spaces', '2'], ['Chapter 2: Practice', '8'], ['Chapter 3: Further Reading', '127'], ['Appendix A: Notes', '130']].entries()) {
        text(title, 50, 680 - i * 28, 12); text(label, 500, 680 - i * 28, 12);
      }
    }
    if (number === 3) { text('Part I: Learning', 50, 730, 25); text('Chapter 1: Foundations', 50, 670, 22); }
    if (number === 4) text('1.1 Sample Spaces', 50, 690, 20);
    if (number === 8) text('Section 9: An optional example', 50, 650, 11);
    if (number === 10) text('Chapter 2: Practice', 50, 720, 22);
    if (number === 129) text('Chapter 3: Further Reading', 50, 720, 22);
    if (number === 132) text('Appendix A: Notes', 50, 720, 22);
    for (let i = 0; i < 8; i++) text(`This is original example prose on source page ${number}, line ${i + 1}.`, 50, (number === 2 ? 450 : 570) - i * 26);
    text(String(number > 2 ? number - 2 : number), 290, 25, 9);
    const stream = content.join('\n');
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${6 + (number - 1) * 2} 0 R >>`);
    add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  if (outline) {
    const pageRef = number => `${5 + (number - 1) * 2} 0 R`;
    add(`<< /Type /Outlines /First ${outlineRoot + 1} 0 R /Last ${outlineRoot + 1} 0 R /Count 3 >>`);
    add(`<< /Title (Part I: Learning) /Parent ${outlineRoot} 0 R /First ${outlineRoot + 2} 0 R /Last ${outlineRoot + 2} 0 R /Count 2 /Dest [${pageRef(3)} /XYZ null 730 null] >>`);
    add(`<< /Title (Chapter 1: Foundations) /Parent ${outlineRoot + 1} 0 R /First ${outlineRoot + 3} 0 R /Last ${outlineRoot + 3} 0 R /Count 1 /Dest [${pageRef(3)} /XYZ null 670 null] >>`);
    add(`<< /Title (1.1 Sample Spaces) /Parent ${outlineRoot + 2} 0 R /Dest [${pageRef(4)} /XYZ null 690 null] >>`);
  }
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((value, index) => { offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${value}\nendobj\n`; });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return output;
}
