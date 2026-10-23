import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocumentStructure, readDocumentStructure } from '../src/document-structure.js';

function item(str, x, y, size = 10, width = str.length * size * .5) {
  return { str, width, transform: [size, 0, 0, size, x, y], hasEOL: false };
}
function pdf({ count = 3, outline = [], labels, pageText = () => [], pageError = new Set(), refMap = new Map() } = {}) {
  return {
    numPages: count,
    getOutline: async () => outline,
    getPageLabels: async () => labels,
    getDestination: async (dest) => dest === 'missing' ? null : dest,
    getPageIndex: async (ref) => { if (!refMap.has(ref)) throw Error('bad ref'); return refMap.get(ref); },
    getPage: async (n) => ({
      view: [0, 0, 600, 800],
      getTextContent: async () => { if (pageError.has(n)) throw Error('unreadable page'); return { items: pageText(n) }; },
    }),
  };
}

test('readDocumentStructure keeps nested outline parents, rescues missing group destinations, and preserves same-page y anchors', async () => {
  const ref = { ref: 1 };
  const doc = pdf({ count: 4, refMap: new Map([[ref, 1]]), outline: [
    { title: 'Part One', dest: [0, { name: 'Fit' }], items: [
      { title: 'Lost group', dest: 'missing', items: [{ title: 'Chapter One: Start', dest: [1, { name: 'XYZ' }, null, 700] }, { title: 'Section 1.1: Here', dest: [1, { name: 'XYZ' }, null, 400] }] },
      { title: 'External', url: 'https://example.test', items: [{ title: 'Appendix', dest: [ref] }] },
    ] },
  ] });
  const structure = await readDocumentStructure(doc);
  assert.deepEqual(structure.scannedPages, []);
  assert.equal(structure.status, 'pending');
  const part = structure.nodes.find((n) => n.title === 'Part One');
  const group = structure.nodes.find((n) => n.title === 'Lost group');
  const chapter = structure.nodes.find((n) => n.title.startsWith('Chapter One'));
  const section = structure.nodes.find((n) => n.title.startsWith('Section 1.1'));
  const appendix = structure.nodes.find((n) => n.title === 'Appendix');
  assert.equal(group.page, 2);
  assert.equal(group.parentId, part.id);
  assert.equal(chapter.parentId, group.id);
  assert.equal(section.parentId, group.id);
  assert.equal(chapter.y, 700);
  assert.equal(section.y, 400);
  assert.notEqual(chapter.id, section.id);
  assert.equal(appendix.parentId, part.id);
  assert.ok(!structure.nodes.some((n) => n.title === 'External'));
});

test('reads late outline entries past page 120 without scanning page text', async () => {
  let calls = 0;
  const doc = pdf({ count: 150, outline: [{ title: 'Late chapter', dest: [130] }] });
  doc.getPage = async () => { calls++; throw Error('text scan should not run'); };
  const result = await readDocumentStructure(doc);
  assert.equal(result.nodes.find((n) => n.title === 'Late chapter').page, 131);
  assert.equal(calls, 0);
});

test('inferred chapters and decimal sections attach beneath the applicable outline part', async () => {
  const doc = pdf({ count: 5, outline: [{ title: 'Part One', dest: [0] }], pageText: (n) => {
    if (n === 2) return [item('Chapter 1: Arrival', 30, 720, 20), item('Text.', 30, 680)];
    if (n === 3) return [item('1.1 First section', 30, 720, 18), item('Text.', 30, 680)];
    if (n === 4) return [item('1.2 Next section', 30, 720, 18), item('Text.', 30, 680)];
    if (n === 5) return [item('1.1.1 Nested detail', 30, 720, 18), item('Text.', 30, 680)];
    return [];
  } });
  const result = await analyzeDocumentStructure(doc);
  const part = result.nodes.find((n) => n.title === 'Part One');
  const chapter = result.nodes.find((n) => n.title.includes('Arrival'));
  const section = result.nodes.find((n) => n.title.startsWith('1.1'));
  const sibling = result.nodes.find((n) => n.title.startsWith('1.2'));
  const nested = result.nodes.find((n) => n.title.startsWith('1.1.1'));
  assert.equal(chapter.parentId, part.id);
  assert.equal(section.parentId, chapter.id);
  assert.equal(sibling.parentId, chapter.id);
  assert.equal(nested.parentId, section.id);
});

test('corroborated printed TOC chapter joins inferred Part hierarchy without an outline', async () => {
  const labels = ['i', 'ii', '1', '2', '3', '4', '5', '6', '7', '8'];
  const doc = pdf({ count: 10, labels, pageText: (n) => {
    if (n === 2) return [item('Contents', 30, 760, 18), item('Chapter 2: Practice', 30, 700), item('8', 520, 700)];
    if (n === 3) return [item('Part I: Learning', 30, 730, 25), item('Chapter 1: Foundations', 30, 670, 22), item('Text.', 30, 620)];
    if (n === 4) return [item('1.1 Sample Spaces', 30, 690, 20), item('Text.', 30, 640)];
    if (n === 10) return [item('Chapter 2: Practice', 30, 720, 22), item('Text.', 30, 680)];
    return [];
  } });
  const result = await analyzeDocumentStructure(doc);
  const part = result.nodes.find((n) => n.title.includes('Part I'));
  const firstChapter = result.nodes.find((n) => n.title.includes('Foundations'));
  const section = result.nodes.find((n) => n.title.includes('Sample Spaces'));
  const secondChapter = result.nodes.find((n) => n.title.includes('Practice') && n.page === 10);
  assert.equal(firstChapter.parentId, part.id);
  assert.equal(section.parentId, firstChapter.id);
  assert.equal(secondChapter.parentId, part.id);
});

test('scans every page, maps printed roman labels, and corroborates contents entries', async () => {
  const labels = ['i', 'ii', 'iii', '1', '2', '3'];
  const doc = pdf({ count: 6, labels, pageText: (n) => {
    if (n === 1) return [item('Contents', 30, 760, 18)];
    if (n === 2) return [item('Chapter One: Dawn', 30, 700), item('......', 260, 700), item('1', 520, 700)];
    if (n === 3) return [item('Chapter Two: Return', 30, 700), item('......', 260, 700), item('2', 520, 700)];
    if (n === 4) return [item('Chapter One: Dawn', 30, 720, 20), item('Opening prose.', 30, 670)];
    if (n === 5) return [item('Chapter Two: Return', 30, 720, 20), item('More prose.', 30, 670)];
    return [];
  } });
  const result = await analyzeDocumentStructure(doc);
  assert.equal(result.scannedPages.length, 6);
  assert.equal(result.status, 'complete');
  assert.ok(result.nodes.some((n) => n.title.includes('Chapter One') && n.page === 4));
  assert.ok(result.nodes.some((n) => n.title.includes('Chapter Two') && n.page === 5));
});

test('ambiguous printed contents offsets remain candidates and do not become nodes', async () => {
  const doc = pdf({ count: 5, pageText: (n) => n === 1 ? [
    item('Contents', 30, 760, 18),
    item('Alpha', 30, 700), item('....', 250, 700), item('3', 520, 700),
    item('Beta', 30, 680), item('....', 250, 680), item('8', 520, 680),
  ] : n === 3 ? [item('Alpha', 30, 720, 20), item('Text.', 30, 680)] : n === 4 ? [item('Beta', 30, 720, 20), item('Text.', 30, 680)] : [] });
  const result = await analyzeDocumentStructure(doc);
  assert.equal(result.nodes.some((n) => n.source === 'toc' && (n.title === 'Alpha' || n.title === 'Beta')), false);
  assert.ok(result.candidates.some((c) => c.title === 'Alpha' && c.page === null));
  assert.ok(result.candidates.every((c) => c.id && c.kind && c.level != null && 'parentId' in c));
  assert.ok(result.tocUnresolved > 0);
});

test('infers a printed physical-page offset only after two matching contents entries without leaders', async () => {
  const doc = pdf({ count: 4, pageText: (n) => {
    if (n === 1) return [
      item('Contents', 30, 760, 18),
      item('Chapter One: Dawn', 30, 700), item('2', 520, 700),
      item('Chapter Two: Return', 30, 680), item('3', 520, 680),
    ];
    if (n === 3) return [item('Chapter One: Dawn', 30, 720, 20), item('Opening text.', 30, 680)];
    if (n === 4) return [item('Chapter Two: Return', 30, 720, 20), item('More text.', 30, 680)];
    return [];
  } });
  const result = await analyzeDocumentStructure(doc);
  assert.ok(result.nodes.some((n) => n.page === 3 && n.title.includes('Dawn') && n.source === 'toc'));
  assert.ok(result.nodes.some((n) => n.page === 4 && n.title.includes('Return') && n.source === 'toc'));
});

test('parses contents references contained in single text items', async () => {
  const doc = pdf({ count: 4, pageText: (n) => {
    if (n === 1) return [item('Contents', 30, 760, 18), item('Chapter One: Dawn .... 2', 30, 700), item('Chapter Two: Return .... 3', 30, 680)];
    if (n === 3) return [item('Chapter One: Dawn', 30, 720, 20), item('Text.', 30, 680)];
    if (n === 4) return [item('Chapter Two: Return', 30, 720, 20), item('Text.', 30, 680)];
    return [];
  } });
  const result = await analyzeDocumentStructure(doc);
  assert.ok(result.nodes.some((n) => n.page === 3 && n.source === 'toc' && n.title.includes('Dawn')));
  assert.ok(result.nodes.some((n) => n.page === 4 && n.source === 'toc' && n.title.includes('Return')));
});

test('numbered single-run contents rows corroborate their destination headings', async () => {
  const doc = pdf({ count: 2, labels: ['1', '2'], pageText: n => n === 1 ? [
    item('Contents', 40, 740, 20), item('1. Introduction ..... 2', 40, 700),
  ] : [
    item('1. Introduction', 40, 700, 16),
    item('Ordinary prose follows this chapter heading and continues along the page.', 40, 675),
  ] });
  const result = await analyzeDocumentStructure(doc);
  assert.ok(result.nodes.some(node => node.title === '1. Introduction' && node.page === 2 && node.source === 'toc'));
  assert.equal(result.nodes.some(node => node.title === 'Entire book'), false);
});

for (const drift of [-0.2, 0.2]) test(`contents fields tolerate a ${drift}-point baseline difference`, async () => {
  const doc = pdf({ count: 3, labels: ['1', '2', '3'], pageText: n => n === 1 ? [
    item('Contents', 40, 740, 20),
    item('Chapter 1: Introduction', 40, 700), item('2', 520, 700 + drift),
    item('Chapter 2: Conclusion', 40, 680), item('3', 520, 680 - drift),
  ] : [
    item(n === 2 ? 'Chapter 1: Introduction' : 'Chapter 2: Conclusion', 40, 700),
    item('Ordinary prose follows this chapter heading.', 40, 675),
  ] });
  const result = await analyzeDocumentStructure(doc);
  assert.deepEqual(result.nodes.filter(node => node.source === 'toc').map(node => [node.title, node.page]), [
    ['Chapter 1: Introduction', 2], ['Chapter 2: Conclusion', 3],
  ]);
  assert.equal(result._tocEvidence.length, 2);
});

test('repeated headers, contents, body mentions, and captions do not create structure nodes', async () => {
  const doc = pdf({ count: 5, pageText: (n) => {
    if (n === 1) return [item('Contents', 30, 760, 18), item('Chapter 1 .... 3', 30, 720)];
    const body = [item('The Book Title', 30, 785, 12), item('For example, chapter 2 is discussed here.', 30, 500), item('Figure 2: Chapter results', 30, 200, 10)];
    if (n === 3 || n === 4 || n === 5) body.push(item(`CHAPTER ${n - 2}: Topic ${n}`, 30, 720, 20));
    return body;
  } });
  const result = await analyzeDocumentStructure(doc);
  assert.ok(!result.nodes.some((n) => n.title === 'The Book Title'));
  assert.ok(!result.nodes.some((n) => n.title.startsWith('Figure')));
  assert.ok(!result.nodes.some((n) => n.title.includes('For example')));
});

test('split title line and corroborated unnumbered prominent headings are retained', async () => {
  const doc = pdf({ count: 4, pageText: (n) => {
    if (n === 1) return [item('CHAPTER 1', 30, 720, 20), item('A Split Title', 30, 695, 20), item('Body text', 30, 650)];
    return [item(`A Repeated Section ${['Two', 'Three', 'Four'][n - 2]}`, 30, 720, 22), item('Body text', 30, 680, 10)];
  } });
  const result = await analyzeDocumentStructure(doc);
  assert.ok(result.nodes.some((n) => n.title.includes('A Split Title') && n.page === 1));
  assert.ok(result.nodes.some((n) => n.title === 'A Repeated Section Two' && n.confidence === 'high'));
});

test('decimal section headings are classified by depth and textless books receive a fallback', async () => {
  const doc = pdf({ count: 2, pageText: (n) => n === 2 ? [item('2.1.3 Nested idea', 30, 720, 18), item('A paragraph.', 30, 680)] : [] });
  const result = await analyzeDocumentStructure(doc);
  const section = result.nodes.find((n) => n.title.startsWith('2.1.3'));
  assert.equal(section.kind, 'section');
  assert.equal(section.level, 3);
  const blank = await analyzeDocumentStructure(pdf({ count: 2 }));
  assert.deepEqual(blank.nodes.map((n) => [n.title, n.source]), [['Entire book', 'fallback']]);
});

test('alphabetic appendix and section headings are recognized', async () => {
  const doc = pdf({ count: 1, pageText: () => [item('Appendix A: Sources', 30, 720, 20), item('Supporting material.', 30, 680, 10)] });
  const result = await analyzeDocumentStructure(doc);
  const appendix = result.nodes.find((n) => n.title.includes('Appendix A'));
  assert.equal(appendix.kind, 'appendix');
});

test('weak explicit body phrases become review candidates, and repeated chapter headers retain only the first prominent title', async () => {
  const doc = pdf({ count: 5, pageText: (n) => {
    if (n === 1) return [item('Chapter 1: A Real Title', 30, 700, 24), item('Body text.', 30, 650, 11)];
    if (n === 2) return [item('Chapter 2 Describes the result.', 30, 500, 11), item('A sentence follows.', 30, 470, 11)];
    if (n <= 4) return [item('Chapter 1: A Real Title', 30, 720, 11), item('Running prose.', 30, 600, 11)];
    return [];
  } });
  const result = await analyzeDocumentStructure(doc);
  assert.equal(result.nodes.filter((n) => n.title === 'Chapter 1: A Real Title').length, 1);
  assert.ok(!result.nodes.some((n) => n.title.includes('Describes the result')));
  assert.ok(result.candidates.some((c) => c.title.includes('Describes the result') && c.confidence === 'low'));
});

test('abort during pending page extraction rejects promptly and never publishes a stale update', async () => {
  const controller = new AbortController(); let updates = 0;
  const doc = pdf({ count: 1 }); doc.getPage = () => new Promise(() => {});
  const pending = analyzeDocumentStructure(doc, { signal: controller.signal, onUpdate: () => updates++ });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(updates, 0);
});

test('checkpoint updates include detected nodes and retain evidence for a resumable final snapshot', async () => {
  const doc = pdf({ count: 10, pageText: (n) => n === 1 ? [item('Chapter 1: Start', 30, 720, 20), item('Text.', 30, 680)] : [] });
  const updates = [];
  const result = await analyzeDocumentStructure(doc, { onUpdate: (snapshot) => updates.push(snapshot) });
  assert.equal(updates[0].scannedPages.length, 8);
  assert.ok(updates[0].nodes.some((n) => n.page === 1 && n.title.includes('Start')));
  assert.ok(result._headingEvidence.some((h) => h.page === 1));
  const resumed = await analyzeDocumentStructure(doc, { initial: result });
  assert.equal(resumed.nodes.filter((n) => n.page === 1 && n.title.includes('Start')).length, 1);
});

test('resumed analysis scans remaining pages and retries failed pages', async () => {
  const doc = pdf({ count: 3, pageError: new Set([2]), pageText: (n) => n === 1 ? [item('Chapter 1: Start', 30, 720, 20)] : [] });
  const first = await analyzeDocumentStructure(doc);
  assert.equal(first.status, 'complete');
  assert.deepEqual(first.failedPages, [2]);
  const fetched = []; const original = doc.getPage; doc.getPage = async (n) => {
    fetched.push(n); const page = await original(n);
    return { ...page, getTextContent: async () => ({ items: [] }) };
  };
  const resumed = await analyzeDocumentStructure(doc, { initial: first });
  assert.deepEqual(fetched, [2]);
  assert.deepEqual(resumed.failedPages, []);
  assert.equal(resumed.scannedPages.length, 3);
});
