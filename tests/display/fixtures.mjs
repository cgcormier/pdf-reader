// Expectations describe the intended reading stream, independently of extraction.
const sentence = i => `The river carried our small boat onward past quiet wooded shore number ${i + 1}.`;
const body = (start = 710, page = 0) => Array.from({ length: 20 }, (_, i) => ({ text: page === 2 && i === 19 ? 'The gates of the town were already shut; and' : page === 3 && i === 0 ? 'I was obliged to remain on the road until morning.' : sentence(i), x: 60, y: start - i * 15, size: 10 }));
const chapter = p => p < 4 ? 'Chapter 1: River Journey' : 'Chapter 2: The Mountain Road';
const headings = [{ title: chapter(1), page: 1, y: 650 }, { title: chapter(4), page: 4, y: 650 }];
function book(kind) {
  const pages = Array.from({ length: 6 }, (_, i) => {
    const p = i + 1, opening = p === 1 || p === 4;
    const header = kind === 'clean' ? [] : kind === 'author' ? [{ text: 'MARY ELEANOR SHELLEY', x: 60, y: 740, size: 15 }]
      : kind === 'split' ? [{ text: p % 2 ? String(p + 40) : chapter(p), x: 60, y: 740, size: 10 }, { text: p % 2 ? chapter(p) : String(p + 40), x: 430, y: 740, size: 10 }]
      : [{ text: `${chapter(p)} ${p + 40}`, x: 60, y: 740, size: 15 }];
    return { items: [...header, ...(opening ? [{ text: chapter(p), x: 60, y: 650, size: 22 }] : []), ...body(opening ? 610 : 710, p)] };
  });
  return { name: kind, pages, contents: headings, checked: [1, 2, 3, 4], expected: p => ({ text: `${p === 1 || p === 4 ? chapter(p) + ' ' : ''}${body(710, p).map(line => line.text).join(' ')}`, headings: p === 1 || p === 4 ? [chapter(p)] : [] }) };
}
const edge = { name: 'top-edge', pages: [{ items: [{ text: 'Chapter 1: River Journey', x: 60, y: 772, size: 22 }, ...body()] }],
  contents: [{ title: 'Chapter 1: River Journey', page: 1, y: 772 }], checked: [1], expected: () => ({ text: `Chapter 1: River Journey ${body().map(line => line.text).join(' ')}`, headings: ['Chapter 1: River Journey'] }) };
const numericLine = 'In 1842 the party walked 25 miles before the dawn.';
const numeric = { name: 'numeric-prose', pages: [{ items: Array.from({ length: 12 }, (_, i) => ({ text: numericLine, x: 60, y: 710 - i * 15, size: 10 })) }],
  contents: [{ title: 'Entire book', page: 1, y: null }], checked: [1], expected: () => ({ text: Array(12).fill(numericLine).join(' '), headings: [], introductions: ['Entire book \u2726'] }) };
export const cases = [book('clean'), book('combined'), book('split'), book('author'), edge, numeric];
