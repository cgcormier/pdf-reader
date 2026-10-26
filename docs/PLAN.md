# Folio: plan and implementation pipeline

## Product decision

A deliberately small reading room in Chrome. Folio's brand is walnut, parchment, moss, and warm brown ink: a place to slow down. Georgia book typography, quiet sans-serif controls, thin rules, subtle CSS wood grain and paper shadows. The theme requires no downloaded font or texture. No account, upload service, analytics, or AI API. PDFs are selected locally and processed inside the browser.

## Layout and interactions

- Header: Folio wordmark, personal shelf, one clear Open a PDF action.
- Left: book title, expandable Part / Chapter / Section contents with source-page references, editable hierarchy, background scan controls, suggestion review, drag-and-drop import and a privacy cue.
- Center: a tall portrait book spread by default for new readers; at narrow widths use one page. Page flip animates an actual temporary leaf. Scroll offers a continuous column with one native scroll area. Existing layout preferences are kept. Chapter title and running source page numbers make the content feel like a book.
- Small toolbar: Book view / Original PDF and a separate Page flip / Scroll toggle (Pages / Scroll for Original PDF), typography and paper preferences, saved page, focus mode. S switches layouts without changing the source page.
- Footer: previous/next, direct page jump, progress scrubber and keyboard hint. Remember the current book, page, appearance and bookmarks locally.
- On mobile, contents becomes a drawer; touch controls stay available. Reduced motion and visible keyboard focus are required.
- A short original sample book makes the initial screen useful without choosing a file.

## Import pipeline

1. Validate PDF extension/type and size (150 MiB maximum); display progress and actionable errors.
2. PDF.js parses bytes in a bundled local worker. Ask for a password when required.
3. Read the complete PDF outline and page labels without text extraction. Keep resolved parents and children, distinct same-page destinations and destination-less group labels anchored by a valid descendant. Display this initial navigation immediately.
4. Scan every physical page sequentially in the background. Yield and publish a resumable checkpoint every eight pages. Combine printed contents entries, explicit numbered headings, and corroborated heading styles; suppress repeated running text and send uncertain targets to review. Printed numbers need unique PDF page labels or at least two corroborated heading matches to calibrate an offset. No OCR or external service is used. Cancellation and book switches invalidate pending results.
5. Preserve a fallback Entire book entry when there is no usable structure. Manual corrections are ID-keyed overlays, including removals and added entries. The editor permits same-page starts, validates source-page bounds and parent cycles, and keeps corrections across rescans. Existing manually arranged books are not automatically rescanned.
6. Extract visible pages on demand. Rebuild lines and paragraphs in Book view, retaining original source-page navigation. A textless page renders its original canvas within the Book leaf or scroll page; mixed documents keep their reflowed text pages. A complete, successful scan by the current detector with no readable text selects Original PDF, including when restoring an older saved Book view. Partial or failed analysis cannot establish a document-wide fallback. Original PDF remains available for faithful diagrams, tables and layouts.
7. Save the PDF once in the existing IndexedDB library. Keep progress, bookmarks and chapter-edit overlays in a separate small database, so scroll writes do not touch source bytes or require a library upgrade. Store appearance/layout/active-book preferences in localStorage. Clearly report when storage is unavailable. Browser data clearing removes this local library; keep source PDFs separately.

## Page turn pipeline (implemented)

The initial three-minute brainstorm selected larger source pages with 3D turns. The subsequent no-inner-scroll update adds bounded text pagination within source pages. PDF page numbers, chapters and bookmarks retain their meaning; an optional source/text-offset anchor restores continuation leaves without a database upgrade. Bitmap turns remain unnecessary rendering work.

1. Size paper as a portrait book page, with height between 560 and 960 pixels and ideal width about 68% of height. Fit the spread to available width; reduce reader chrome and free more room in focus mode. Very short windows allow outer scrolling. Measure extracted text in an inert hidden paper of the same dimensions. Split at fitting word boundaries, retaining every source character and paragraph break; oversized tokens split at Unicode code-point boundaries. Chapter introductions consume space only on the first leaf. Very long chapter titles use four lines with full titles in contents/tooltips. Continuation leaves keep the same source number, with a quiet “continued” suffix. No paper has an inner scroll area.
2. Build only the adjacent target spread, using a six-source pagination cache alongside the existing six-source extraction cache. A spread can contain successive leaves from the same PDF page or cross a source-page boundary. Next/Previous walk text fragments, including the final source page's continuations. Keep the existing spread and source/text anchor until the turn finishes. Previous/Next and keyboard arrows initiate turns; touch swipes require a short predominantly horizontal movement and no text selection.
3. Animate temporary inert, aria-hidden text copies with a 420 ms browser transform. Desktop uses a hinged leaf with front and reverse faces, plus the revealed page beneath. Single-page layouts use a centered card. Preserve prose scroll positions after attaching copies to the DOM.
4. Gate repeated turns. Cancel on direct jumps, book/view/layout changes, focus changes, dialogs, resize, reduced-motion preference changes and hidden tabs. Remove overlays and restore original visibility on every settlement path. Save the new source page only after successful completion.
5. Respect reduced motion with immediate navigation. Original PDF canvases keep immediate page changes and fit their frame without inner scrolling. Chapter jumps, the page field and progress slider jump directly. The last visible spread disables Next without showing a duplicate final page.
6. Add no dependency, rasterized prose, remote asset or per-frame JavaScript loop. Preserve the existing bounded native Scroll implementation and the six-entry text cache.

## Continuous scrolling pipeline (implemented)

1. Establish estimated document height before assigning a restored scroll offset; Chrome clamps offsets against existing content.
2. Use native wheel, touch and keyboard movement. One passive scroll listener schedules one animation-frame update; avoid wheel interception or animation dependencies.
3. Maintain a measured/estimated page-height index. Mount at most seven book pages or four original pages near the reading line; leave spacers for the rest. Resize measurements preserve the page and within-page fraction, including CSS subpixel rounding.
4. Load the current page first, then neighbors. Limit each controller to two outstanding jobs, including aborted jobs until their promises settle. Keep extracted text in a six-entry cache. Bound each original canvas to two million pixels and release canvases when they leave the window.
5. Jump directly to chapters or distant pages. UI jumps do not animate through intermediate pages. Long book pages grow naturally, with no nested scroll region in Scroll layout.
6. Update active chapter, page and progress when the reading line enters another source page. Debounce small position writes by 650 ms. Store the layout preference and restore the within-page position in the same reading view.
7. On a view/layout/book change, abort old loads and dispose the old scroll controller before replacement. Original PDFs remain available for scans and layouts text extraction cannot reproduce.

## Build lanes

1. PDF lane: extraction, chapter resolution, limits and unit tests.
2. Visual lane: responsive layout, book styling, focus/drawer states, appearance and accessibility.
3. Integration lane: reader state, local persistence, import/error/password flows, shelf, chapter editor and demo content.
4. Launch/verification lane: local static server, Windows Chrome launcher, installable manifest and cached assets; build, behavior and visual verification.

## Shared contracts

`src/pdf-engine.js` exports `openPdf(bytes, {onPassword, signal})`, `detectChapters(pdf, {onProgress, signal})`, `extractPage(pdf, pageNumber)`, `renderPdfPage(pdf, pageNumber, canvas, {scale, signal, maxPixels})`, and `titleFromFilename(name)`.

- `openPdf` returns a PDFDocumentProxy (caller owns `pdf.loadingTask.destroy()`; PDF.js 6 does not expose proxy `destroy()`).
- Chapters result: `{chapters: [{title, page}], source: 'outline' | 'headings' | 'fallback', scannedPages: number}`; source pages are always one-based.
- `src/document-structure.js` exports `STRUCTURE_VERSION`, `readDocumentStructure(pdf, {signal})`, and `analyzeDocumentStructure(pdf, {signal, initial, onProgress, onUpdate})`. The old `detectChapters` API remains for compatibility; the application uses the richer analyzer.
- Structure: `{version, nodes, candidates, scannedPages: number[], failedPages: number[], totalPages, status, textPages, tocUnresolved, pageLabels?}`. Nodes have stable IDs, `parentId`, title, kind, one-based source `page`, optional PDF `y`, source, confidence and evidence. Compact internal heading/contents/outline evidence accompanies checkpoints and complete results for resumption and failed-page retry; no full-document text or rendered pages are stored there.
- Structure overlays: `structureEdits` maps node IDs to manual corrections/additions or `{hidden:true}`; `contentsExpanded` maps IDs to disclosure state. `src/structure-model.js` validates navigation links, adapts legacy records and guards scan lifecycles against stale updates. The saved `bookPosition` may include `contentsId` for same-page selection. Navigation is independent of the legacy chapter projection used for book typography, so background updates do not reflow reading text.
- Page result: `{paragraphs: string[], hasText: boolean}`. Never inject extracted text as HTML.
- `renderPdfPage` returns after canvas render, scale defaults to 1.4; a signal cancels PDF.js's render task and an optional pixel cap bounds its canvas. Caller coordinates stale results.
- Stored book: `{id, title, filename, bytes: ArrayBuffer, chapters, source, scannedPages, page, bookmarks: number[], addedAt}`.
- Reading-place overlay: `{id, page, view, readingLayout, bookmarks, chapters, source, scannedPages, structure, contentsExpanded, scrollPosition: {page, fraction, view}, bookPosition: {page, offset, contentsId?}}`. `view` and `readingLayout` store the document's selected presentation. Older records use `scrollPosition.view` or Book view and the current layout preference. `bookPosition` is optional and uses an offset into extracted paragraphs joined with two newlines, after duplicate standalone heading removal. Reflow chooses the fragment containing that offset; Original navigation preserves it and only reuses it on its matching source page. Allowlisted fields never include source bytes. Demo preferences use localStorage.
- `paginateText(text, fits, {signal})` returns lossless `{start, end, text}` slices. `createBookPager({count, loadFragments})` walks those slices with `spread(anchor, size)` and `previous(anchor, steps)`. Root owns browser measurement, bounded caching, cancellation and commit. Reflow never changes PDF page totals or chapter/bookmark references.
- `createPageScroller(container, options)` owns its track, spacers, listeners, observer and loads. Options define count, initial page/fraction, estimates, mount/concurrency limits, page creation/loading and an `onPosition` callback. It returns `jumpTo`, `getPosition`, `reflow`, `destroy` and diagnostic `getStats`.
- `turnPages({stage, targetPages, direction, singlePage, signal, reducedMotion, duration})` owns temporary layers/classes and returns `finished` or `cancelled`. The caller prepares detached target pages, commits stage content and source-page metadata only after `finished`, and handles cancellation across reader state changes. Source page numbers and existing stored anchors keep their meaning.

## Acceptance checks

- Build succeeds; chapter destination, heading, fallback, scan cap and text ordering tests pass.
- Real browser: sample navigation, file import, original canvas, chapter editing, refresh persistence, shelf, bookmarks, invalid file, password, mobile layout and keyboard operation.
- Offline/local: dependencies and worker are bundled, no external content request; production assets are cached after first visit.
- Windows: launcher starts loopback-only server and opens Chrome; desktop shortcut support. Installed app still needs either the local server or an already cached production app.
- Page turns: forward/reverse and single-page faces, abort/rejection cleanup, reduced motion, detached-node scroll clamping, final spread bounds, and swipe direction tests. Browser checks must also cover live transforms, interruption before commit, reload persistence, 320px layouts, focus/night paper, and an imported PDF.
- Fitted text: conserve complete source strings, prefer word boundaries, preserve Unicode code points, keep chapter headings on the first leaf, and navigate backward/forward within the same source page. Check mobile large text, continuation reload, stable text anchors across repeated focus/font changes, dense PDF import, bounded measurement/cache cleanup, scanned-page fallback, and fitted Original PDF canvas dimensions.

## Deliberate limits and future UX

No OCR, cloud sync, notes, full-text search, language-model inference or large library management is included. Structural detection uses local text/layout heuristics and can require manual review. PDFs with columns may extract in the wrong order; Original PDF preserves source layout. Book mode paginates each source page's text on demand, retaining source-page boundaries; it does not merge short source pages into one globally renumbered edition. Scroll pages grow with the text; Page flip uses fitting continuation leaves. Future work, after use: full-text search, optional local OCR, and optional tagged-heading enrichment.

## Technical references

- [PDF.js examples](https://mozilla.github.io/pdf.js/examples/index.html) and [document API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFDocumentProxy.html).
- [Chrome install criteria](https://developer.chrome.com/blog/update-install-criteria) and [MDN installable web apps](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).
- [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md), used for the scoped controls, focus, motion, form and overflow review.

Implementation status and verified checks belong in README.md; this document describes the intended build and its boundaries.
