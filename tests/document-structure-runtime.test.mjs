import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readDocumentStructure, analyzeDocumentStructure } from '../src/document-structure.js';
import { makeStructurePdf } from './structure-fixture.mjs';

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
