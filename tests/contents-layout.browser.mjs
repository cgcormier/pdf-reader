/**
 * Browser regression, run through Playwriter against an isolated dev origin:
 * node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4183 --strictPort
 * npx playwriter@latest -s <session> -f tests/contents-layout.browser.mjs
 * Uses a synthetic shelf entry; does not access the normal shelf on port 4173.
 */
{
  const page = await context.newPage();
  try {
    await page.goto('http://127.0.0.1:4183/', { waitUntil: 'domcontentloaded' });
    await page.setViewportSize({ width: 1000, height: 420 });
    await page.evaluate(async () => {
      const { putBook, updateBook, savePreference } = await import('/src/storage.js');
      const { STRUCTURE_VERSION } = await import('/src/document-structure.js');
      const { openPdf } = await import('/src/pdf-engine.js');
      const bytes = await (await fetch('/sample.pdf')).arrayBuffer();
      const pdf = await openPdf(bytes.slice(0));
      const totalPages = pdf.numPages;
      await pdf.loadingTask.destroy();
      const nodes = Array.from({ length: 16 }, (_, index) => ({
        id: `layout-chapter-${index}`, parentId: null, kind: 'chapter', level: 0,
        title: `Chapter ${index + 1}: Layout example`, page: 1, y: null,
        source: 'outline', confidence: 'high', evidence: ['Synthetic layout fixture'],
      }));
      const fixture = {
        id: 'contents-layout-fixture', title: 'math textbook', filename: 'sample.pdf',
        bytes, page: 1, bookmarks: [], addedAt: Date.now(), source: 'structure',
        chapters: [{ title: nodes[0].title, page: 1 }], contentsExpanded: {},
        structure: { version: STRUCTURE_VERSION, status: 'complete', totalPages,
          nodes, scannedPages: Array.from({ length: totalPages }, (_, index) => index + 1),
          failedPages: [], textPages: totalPages, tocUnresolved: 25,
          candidates: Array.from({ length: 640 }, (_, index) => ({
            ...nodes[0], id: `layout-review-${index}`, page: null, confidence: 'low',
          })),
        },
      };
      await putBook(fixture);
      // Earlier runs may have progress metadata in the separate places store.
      await updateBook(fixture.id, { structure: fixture.structure });
      savePreference('active-book', 'contents-layout-fixture');
      savePreference('reading-layout', 'scroll');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#chapter-list .chapter-link').nth(15).waitFor({ state: 'attached' });
    const checkHeight = async (label) => {
      console.log(await snapshot({ locator: page.locator('#book-contents'), search: /Contents|Scan PDF/ }));
      const box = await page.locator('#chapter-list').boundingBox();
      if (!box || box.height < 86) throw new Error(`${label}: Contents collapsed to ${box?.height}px`);
      console.log(`${label}: Contents height ${Math.round(box.height)}px`);
    };
    await checkHeight('Short desktop scroll');
    // A later chapter must remain reachable through the list's own scrolling.
    await page.locator('#chapter-list .chapter-link').last().click();
    if (await page.locator('#current-chapter').textContent() !== 'Chapter 16: Layout example') {
      throw new Error('Contents navigation did not select the last chapter');
    }
    await page.locator('#pages-layout').click();
    await checkHeight('Desktop page flip');
    await page.setViewportSize({ width: 390, height: 640 });
    await page.locator('#contents-toggle').click();
    await checkHeight('Mobile page flip drawer');
    await page.locator('#contents-close').click();
    await page.locator('#scroll-layout').click();
    await page.locator('#contents-toggle').click();
    await checkHeight('Mobile scroll drawer');
    console.log('Contents layout regression passed.');
  } finally {
    await page.close();
  }
}
