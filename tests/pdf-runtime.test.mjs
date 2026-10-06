import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fileURLToPath } from 'node:url';
import { detectChapters, extractPage } from '../src/pdf-engine.js';

test('installed PDF.js parses the real sample, extracts chapters/text, and disposes its loading task', async () => {
  const bytes = new Uint8Array(await readFile(new URL('../public/sample.pdf', import.meta.url)));
  const fonts = fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).replaceAll('\\', '/');
  const task = getDocument({ data: bytes, isEvalSupported: false, standardFontDataUrl: fonts });
  try {
    const pdf = await task.promise;
    assert.equal(pdf.numPages, 4);
    assert.equal(pdf.loadingTask, task);
    assert.equal(typeof pdf.loadingTask.destroy, 'function');
    const chapters = await detectChapters(pdf);
    assert.equal(chapters.source, 'outline');
    assert.deepEqual(chapters.chapters.map(chapter => chapter.page), [1, 3]);
    assert.match((await extractPage(pdf, 1)).paragraphs.join(' '), /A little light/);
    assert.equal((await extractPage(pdf, 4)).hasText, false);
  } finally {
    await task.destroy();
    assert.equal(task.destroyed, true);
  }
});
