import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readDocumentStructure, analyzeDocumentStructure } from '../src/document-structure.js';
import { makeStructurePdf, makePlayPdf } from './structure-fixture.mjs';
import { makeLayoutPdf, modestHeadingPages } from './pdf-layout-fixture.mjs';
import { readPageLayout } from '../src/pdf-layout-adapter.js';
import { conservation } from '../src/pdf-layout.js';

test('real PDF.js carries modest title layout evidence through to hierarchical Contents', async () => {
  const task = getDocument({ data: makeLayoutPdf(modestHeadingPages), verbosity: 0 });
  try {
    const pdf = await task.promise;
    const result = await analyzeDocumentStructure(pdf);
    assert.deepEqual(result.nodes.map((node) => [node.title.replaceAll('’', "'"), node.page]), [
      ["Zarathustra's Prologu e", 1], ["Zarathustra's Sp eeches", 2],
      ['O N T H E T H R E E M E T A M O R P H O S E S', 2],
    ]);
    assert.equal(result.nodes[2].parentId, result.nodes[1].id);
    assert.equal(result.nodes[2].kind, 'section');
    for (let page = 1; page <= pdf.numPages; page++) {
      const layout = await readPageLayout(pdf, page);
      assert.deepEqual(conservation(layout), { valid: true, errors: [] });
      for (const node of result.nodes.filter((node) => node.page === page)) {
        const line = layout.lines.find((line) => line.id === node.sourceLineId);
        assert.equal(node.y, line.sourceY);
        assert.equal(node.title, layout.projection.text.slice(line.start, line.end));
      }
    }
  } finally { await task.destroy(); }
});

test('real PDF.js scanner outline remains navigation alongside detected semantic headings', async () => {
  const task = getDocument({ data: new Uint8Array(Buffer.from(makeStructurePdf({ outline: 'scan-pages', pages: 24 }))), isEvalSupported: false,
    standardFontDataUrl: fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).replaceAll('\\', '/') });
  try {
    const pdf = await task.promise;
    const initial = await readDocumentStructure(pdf);
    assert.deepEqual(initial.nodes, []);
    assert.equal(initial.pageNavigation.length, 24);
    assert.deepEqual(initial.pageNavigation.at(-1).title, '9999');
    const result = await analyzeDocumentStructure(pdf, { initial });
    assert.equal(result.pageNavigation.length, 24);
    assert.ok(result.nodes.some((node) => /Foundations/.test(node.title) && node.page === 3));
    assert.ok(result.nodes.every((node) => !/^\d+$/.test(node.title)));
    assert.deepEqual(result.pageNavigation.map((node) => [node.page, node.y]), Array.from({ length: 24 }, (_, index) => [index + 1, 730]));
  } finally { await task.destroy(); }
});

for (const outline of [true, false]) {
  test(`real PDF.js handles a 132-page book (${outline ? 'partial nested outline' : 'printed contents only'})`, async () => {
    const task = getDocument({ data: new Uint8Array(Buffer.from(makeStructurePdf({ outline }))), isEvalSupported: false,
      standardFontDataUrl: fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).replaceAll('\\', '/') });
    try {
      const pdf = await task.promise;
      const initial = await readDocumentStructure(pdf);
      if (outline) {
        assert.equal(initial.nodes.filter(node => node.page === 3).length, 2);
        assert.equal(initial.nodes.find(node => node.kind === 'section').parentId, initial.nodes.find(node => node.kind === 'chapter').id);
      }
      const checkpoints = [];
      const result = await analyzeDocumentStructure(pdf, { initial, onUpdate: snapshot => checkpoints.push(snapshot) });
      assert.equal(result.scannedPages.length, 132);
      assert.equal(result.failedPages.length, 0);
      assert.ok(result.nodes.some(node => node.page === 129 && /Further Reading/.test(node.title)), 'finds late chapters');
      assert.ok(result.nodes.some(node => node.page === 10 && /Practice/.test(node.title)));
      const part = result.nodes.find(node => node.kind === 'part' && node.page === 3);
      const first = result.nodes.find(node => node.kind === 'chapter' && node.page === 3);
      assert.equal(result.nodes.find(node => node.kind === 'chapter' && node.page === 10).parentId, part.id);
      assert.equal(result.nodes.find(node => node.kind === 'section' && node.page === 4).parentId, first.id);
      assert.ok(result.nodes.some(node => node.page === 132 && node.kind === 'appendix'));
      assert.equal(result.nodes.filter(node => /Sample Spaces/.test(node.title)).length, 1);
      assert.ok(checkpoints.some(snapshot => snapshot.status === 'scanning' && snapshot.nodes.some(node => node.page === 10)), 'background scan publishes headings before completion');
      assert.ok(result.nodes.every(node => node.page !== 2), 'printed contents are not chapter boundaries');
      assert.ok(result.candidates.every(node => typeof node.id === 'string'));
      assert.ok(result.candidates.some(node => /optional example/.test(node.title) && node.page === 8), 'weak typography remains reviewable');
      assert.ok(!result.candidates.some(node => node.source === 'toc'), 'printed contents map without accidental merged prose');
    } finally { await task.destroy(); }
  });
}

test('real PDF.js detects an original play without a local download or outline', async () => {
  const task = getDocument({ data: new Uint8Array(Buffer.from(makePlayPdf())), isEvalSupported: false,
    standardFontDataUrl: fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).replaceAll('\\', '/') });
  try {
    const result = await analyzeDocumentStructure(await task.promise);
    const acts = result.nodes.filter((node) => /^Act /.test(node.title));
    const scenes = result.nodes.filter((node) => /^Scene /.test(node.title));
    assert.deepEqual(acts.map((node) => [node.title, node.page]), [['Act I', 2], ['Act II', 3]]);
    assert.deepEqual(scenes.map((node) => [node.title, node.page, node.parentId]), [
      ['Scene I', 2, acts[0].id], ['Scene II', 2, acts[0].id], ['Scene I', 3, acts[1].id], ['Scene II', 4, acts[1].id],
    ]);
    assert.equal(result._tocEvidence.length, 0);
    assert.deepEqual(result.candidates, []);
    assert.deepEqual(result.failedPages, []);
  } finally { await task.destroy(); }
});

test('local Hamlet has all five Acts and twenty Scenes at exact anchors, with no numeric Contents flood', async (context) => {
  let data;
  try { data = await readFile(new URL('../testing_downloads/Hamlet.pdf', import.meta.url)); }
  catch (error) { if (error.code === 'ENOENT') { context.skip('Optional local Hamlet.pdf is absent; the original play fixture always runs.'); return; } throw error; }
  const task = getDocument({ data: new Uint8Array(data), isEvalSupported: false, verbosity: 0 });
  try {
    const result = await analyzeDocumentStructure(await task.promise);
    const acts = result.nodes.filter((node) => /^Act /.test(node.title));
    const scenes = result.nodes.filter((node) => /^Scene /.test(node.title));
    assert.deepEqual(acts.map((node) => [node.title, node.page, node.y, node.parentId, node.kind]),
      [8, 40, 64, 96, 120].map((page, index) => [`Act ${index + 1}`, page, 898, null, 'part']));
    const pagesByAct = [[8, 15, 24, 29, 32], [40, 44], [64, 70, 84, 87], [96, 98, 99, 101, 104, 112, 113], [120, 130]];
    const yByAct = [[816, 816, 454, 696, 255], [816, 356], [816, 315, 816, 534], [816, 816, 694, 234, 695, 816, 695], [816, 816]];
    assert.deepEqual(scenes.map((node) => [node.title, node.page, node.y, node.parentId, node.kind]),
      pagesByAct.flatMap((pages, act) => pages.map((page, scene) => [`Scene ${scene + 1}`, page, yByAct[act][scene], acts[act].id, 'chapter'])));
    assert.equal(new Set(result.nodes.map((node) => node.id)).size, result.nodes.length);
    assert.equal(result.nodes.filter((node) => node.source !== 'fallback').length, 25);
    assert.equal(result._tocEvidence.length, 0);
    assert.equal(result.tocUnresolved, 0);
    assert.equal(result.candidates.filter((node) => node.source === 'toc').length, 0);
    assert.ok(![...result.nodes, ...result.candidates].some((node) => /FTLN|ACT\s+\d+\.\s+SC\./i.test(node.title)));
    assert.equal(result.scannedPages.length, 144);
    assert.deepEqual(result.failedPages, []);
  } finally { await task.destroy(); }
});
