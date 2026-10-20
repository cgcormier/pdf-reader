# Folio

A tiny local PDF reading room in Chrome: walnut accents, parchment, serif type, chapter contents and source page numbers. Choose continuous scrolling or an open-book spread. The design and build pipeline are in [docs/PLAN.md](docs/PLAN.md).

## Open it

Double-click **Folio** on your Desktop, or **Start Folio.cmd** in this folder. The launcher starts a server at **http://127.0.0.1:4173/** and opens Chrome. A Desktop shortcut has been created at `C:\Users\ccorm\OneDrive\Desktop\Folio.lnk` on this machine. Keep the app folder in place; the shortcut points here.

Open the app through the launcher or that web address. Opening `index.html` directly from File Explorer cannot run the reader; it now shows a small launch card with the working address and instructions.

If you move the folder, run **Create shortcut.cmd** from the new location. It updates an existing Folio shortcut only when that shortcut already points at this launcher; it won't replace an unrelated shortcut.

Chrome can also bookmark the URL or install Folio as an app when Chrome offers installation. The Desktop launcher starts the local server for you. A bookmark or installed Chrome app needs that server, or the completed offline cache from a previous production visit. Offline caching is implemented; a server-stopped offline session and the browser installation prompt have not been manually verified.

## Read a PDF

1. Click **Open a PDF**, or drop a PDF onto the page. Maximum file size: 150 MiB.
2. Folio displays embedded PDF bookmarks immediately, including nested parts, chapters and sections. It then scans every source page in the background, combining printed contents references with numbered headings and recurring heading styles. Expand a group with its arrow. Scanning supplements incomplete bookmarks; you can keep reading while it runs.
3. Click **Edit** beside Contents to rename, add, remove or regroup entries. Enter the source PDF page, including covers; several entries can start on the same page. Corrections stay separate from automatic detections and survive rescanning. **Review suggestions** lets you accept or dismiss uncertain headings, or choose a page for an unresolved printed reference. **Stop scan**, **Resume scan**, and **Scan PDF again** control analysis; failed pages can be retried separately.
4. Read in **Book view** for book typography. Switch to **Original PDF** for tables, equations, illustrations, scans, or the exact source layout. Both views offer **Scroll**; Book view also offers **Page flip**, and Original PDF offers **Pages**.
5. **Page flip** is the default for a new reader; an existing Scroll preference is kept. It shows a tall open-book spread on desktop and one page on a phone. Overflowing text continues onto another leaf, without inner scrolling. Previous/Next and keyboard arrow keys make a smooth 420 ms forward or reverse turn. A short horizontal touch swipe also turns a page. **Original PDF → Pages** fits the full source page within its frame. **Scroll** uses native wheel, touchpad, touch and Page Down/Up movement. **S** toggles the layout and keeps the source page. The page-number field, chapters and progress slider jump directly. **F** toggles focus mode; **Escape** exits it. **Aa** adjusts book text size directly by dragging left or right; the moon button switches paper appearance.
6. Bookmark a page with the ribbon button. Find saved books and saved pages in **My shelf**.

There is an original eight-page reading sample on the welcome screen. **My shelf → Try a sample PDF** exercises the real import pipeline with a small bundled PDF, without selecting a local file.

## Local storage and limits

PDF bytes, chapter edits, bookmarks and reading position are saved in IndexedDB in the current browser profile. Preferences use localStorage. No account, upload server, analytics, external fonts or cloud API. The static server only serves the built app and bundled assets, and binds to loopback. It has no PDF-upload endpoint. Imported PDF content is rendered as plain text; PDF.js and its worker, fonts, character maps and WASM assets are bundled locally.

Scrolling uses Chrome's native motion, with at most seven mounted book pages or four original pages, two page-loading jobs per scroll controller, and a six-entry extracted-text cache. Each PDF canvas is capped at two million pixels; departed renders are cancelled and canvases released. The UI updates once per animation frame, and position writes are delayed until scrolling pauses for 650 ms. Progress and edits live in the small `folio-reading-places` database; scroll saves never read or rewrite the PDF bytes in `folio-library`. Existing shelf records remain readable without an upgrade. These are bounded resources, not a measured whole-browser memory ceiling: PDF.js and Chrome also maintain their own caches. No new dependency or remote asset was added for scrolling or the theme.

Page flips stage only the adjacent spread and animate temporary text layers with browser transforms. They use no rasterized prose, animation framework, remote assets or per-frame JavaScript loop. Repeated turns are gated until completion; a direct jump, view/layout change, resize, dialog, focus change or hidden tab cancels an unfinished turn. The new source page is saved only after a completed turn. Reduced-motion settings skip the animation. Original PDF navigation remains immediate. Pages keep portrait proportions, a 560px minimum height and a 960px cap; short windows can scroll the outer page to reach the controls. Focus mode frees more space for the book.

Clearing browser data, changing browser profiles or changing the origin/port gives you a different or empty shelf. Keep original PDFs separately; the shelf is convenient local storage, not a backup. If saving fails, the reader reports that the book or position could not be kept.

Book view keeps **source PDF page numbers**. In Page flip, extracted text is measured against the actual paper size and font; long source pages become continuation leaves marked with the same number and “continued.” Turn to read the rest, with no scrolling inside the paper. Chapter headings appear only on the first leaf. A source-page/text-offset anchor restores continuation leaves after reload and locates the same text after resizing, focus changes or text-size changes. Pagination caches at most six source pages and never reflows the whole PDF at once. This optional metadata field needs no database upgrade; older saved places begin at the source page's top. Chapter links, bookmarks, the page field and slider keep source-page references. Very long chapter titles show four lines on paper, with the full title in the contents and tooltip.

Continuous pages grow to hold their text, with one scroll area for the book. Scroll position includes the source page and a fraction within that page; it is restored within the same view. Switching views or layouts keeps the source page and starts at its top. An abrupt browser shutdown may precede a pending position write. Book view does not reproduce multi-column layout, tables, math or images; Original PDF is the faithful view. Scanned pages need Original PDF: no OCR is included.

Contents analysis runs locally, extracts one page at a time, and checkpoints after eight pages. Current-version checkpoints resume after reopening; an explicitly stopped scan waits for **Resume scan**. Completed results are reused until the detector changes, then automatically refreshed on reopening. Corrections and reading positions survive that refresh. Printed page labels are mapped to physical PDF pages only with unambiguous labels or corroborated heading matches; uncertain references go to review. Standalone numbered Act and Scene headings use spacing and structural sequence to build nested play contents, including body-sized scene titles. Dialogue counters and bare section numbers are not treated as printed page references. Heading detection is heuristic and can miss unusual layouts, languages and typography. Original PDF navigation is page-based; Book view also attempts a text anchor for a selected subsection. Ordinary page movement cannot distinguish multiple headings on the same source page. A selected contents entry is retained with its saved reading anchor. Background analysis changes the navigation only, keeping the current book typography and reading position stable. Older manually arranged books keep their contents until you choose to scan them.

## Development

Requires Node.js **22.13+** (tested with 22.21.0) and npm. PDF.js is pinned to 6.3.289; Vite is pinned to 7.3.6.

```powershell
npm ci
npm run dev
```

Development runs at `http://127.0.0.1:4173/`. Close a development server before using the production launcher on the same port.

```powershell
npm run build
npm test
npm start
```

`npm run build` bundles the app, copies PDF auxiliary assets, generates a complete offline asset list and versions the service-worker cache. `npm start` serves only `dist/`. The first production visit caches the assets for offline use; refresh after rebuilding. Dependencies are already installed and the production build is present on this machine. Source changes remain local until deliberately committed and published.

## Verification

Structure analysis update, 2026-10-18:

- All **79 Node tests** pass, including actual PDF.js parsing of original 132-page fixtures with and without a nested partial outline. Regression cases cover late chapters, same-page Part/Chapter anchors, decimal section hierarchy, printed page offsets and Roman labels, ambiguous references, weak headings, repeated running titles, full coverage, cancellation, resumption, stale callbacks, legacy manual arrangements, and metadata writes that preserve PDF bytes.
- Chrome on an isolated development origin: imported the nested fixture; expanded its hierarchy; renamed a chapter while retaining its same-page Part; rescanned and reloaded with that correction intact; jumped to a subsection and verified the saved source page, text offset and selected entry after reload; opened review and dismissed a suggestion. No app page errors were reported during these checks. The desktop navigation was visually inspected; mobile document width matched its 390 CSS-pixel viewport. General accuracy on arbitrary books and a full accessibility audit remain unmeasured.
- Background analysis updates navigation without rerendering the reading body. Stop/resume and stale-result isolation have automated coverage; the short browser fixture finished before an interactive Stop action could be exercised.

Verified through 2026-10-04 (earlier Chrome/Windows checks retained below):

- Production build and all **54 Node tests** pass. Tests cover lossless fitting text slices, word/code-point boundaries, terminal-word handling, abort during fitting, chapter-header space, continuation/source-boundary navigation, EOF, forward/reverse and single-page turn layers, abort/rejection cleanup, reduced motion, detached scroll-position clamping, source spread bounds, swipe direction, bounded scrolling across 1,000 pages, cancelled-load concurrency, variable-height anchoring, browser-style scroll clamping, a short final page, subpixel rounding, canvas cancellation/pixel caps, and metadata-only progress/continuation writes with older shelf records.
- Dependency installation audit: **zero vulnerabilities** after upgrading PDF.js from a vulnerable resolved release.
- Chrome: sample navigation, reload persistence, real bundled PDF import and outline detection, PDF canvas (960×1280 for a source page), blank/illustrated-page fallback, chapter editing, bookmarks, local shelf, refreshed reading position and switching between the PDF and welcome sample.
- Chrome: encrypted PDF password prompt, wrong-password retry and cancellation preserve the existing book. Invalid PDF produces an actionable error and preserves the existing book. Successful password unlock was not separately exercised.
- Responsive 390×844 viewport: single-page content, contents drawer and chapter jumping; desktop layout visually reviewed. Focus mode and light/dark paper controls were exercised. Text sizing is implemented; full accessibility audit is not performed.
- Continuous-scroll update: existing PDF reopened with its edited chapters/bookmark; Scroll / Pages and Book / Original toggles keep the selected source page. A 320 CSS-pixel phone layout had no horizontal or outer-page overflow; a 1,429px text page grew naturally with no nested prose scrolling. Reload restored its scroll offset with a zero-pixel difference. Original scroll canvases were 940,800 pixels each on the desktop sample. Native keyboard scrolling, large text, focus/evening modes and the S shortcut were checked. The direct-file launch card is source-verified; browser automation cannot inspect `file:` pages under its URL policy.
- Windows: scripts parse, shortcut target/working directory/icon verified, Desktop shortcut created, local server health checked and launcher executed successfully.
- Page-flip update, Codex in-app browser: live forward/reverse 3D transforms observed while the old source page stayed selected; completion removed the overlay. Switching to Scroll during an active turn cancelled it and kept the old page. Phone view used a single-page turn; a direct page jump interrupted another turn. A real bundled PDF turned to its final 3–4 spread, disabled Next, reported 100%, and reopened on source page 3 after reload. Original PDF still rendered. Focus mode used 750px pages within a 900px window. At a 320px viewport, document scroll width matched its 305px client width after accounting for the scrollbar; no horizontal overflow remained. Night paper and browser color scheme matched. No console warnings/errors were captured. The Chrome extension connection failed while loading its request policy, so this update's browser checks used the in-app browser. Native touch gestures and an OS reduced-motion setting remain manually unverified; their logic is unit-tested.
- No-inner-scroll update, Codex in-app browser: all eight demo source pages were traversed on desktop; their fragment intervals covered every source character with no gaps and every leaf fit. A 320px phone continuation reopened at the same offset after refresh; 23px text, focus changes and a return to 17px kept the underlying text anchor stable. A real file-picker import of the generated dense PDF succeeded: all 2,578 extracted characters were conserved exactly across seven source-page-1 leaves, including Line 40; backward navigation returned to the final continuation. A page jump during a turn cancelled its overlay, and a blank page's Original PDF fallback fit without overflow. The phone original canvas fit at 236.7×315.6 CSS pixels inside its frame, with equal scroll/client dimensions. Continuous Scroll retained the full long text in naturally growing pages. Desktop scroll/client widths both measured 970px, hidden measurement nodes were removed, and no console warnings/errors were captured.
- Earlier automated file-picker upload in the user's Chrome extension was blocked by its **Allow access to file URLs** setting; current file-picker verification used the in-app browser. Drag/drop and physical touch gestures remain manually unverified.

Browser fixtures can be recreated with `node tests/create-fixtures.mjs`; they are written to ignored `output/playwright/`. Add `--sample` to regenerate the bundled sample PDF. No external documents were downloaded for testing.

## Skills and staffing

Three bounded `gpt-6-luna` workers handled PDF processing (high effort), CSS (medium effort), and launch support (high effort); peak simultaneous staffing was four including the root during a brief integration review. Actual token/cost totals are unavailable. Disjoint lanes and fresh bounded briefs were chosen over full-history copies; savings are unmeasured.

The scroll update reused two workers: scrolling/PDF rendering at high effort and theme/CSS at medium effort, peak three including root. Their follow-up reviews stopped at an account usage limit; root completed integration and verification. No model substitution was used. Native scrolling and small existing dependencies were chosen over an animation framework or rendering the whole PDF; expected savings are unmeasured.

The page-flip update gave a read-only `gpt-6-luna` brainstorm worker three minutes at high effort, then assigned the cancellable animation helper at high effort and CSS geometry at medium effort to two bounded workers. Root integrated navigation, accessibility, touch handling and responsive fixes. Peak simultaneous staffing was three including root; actual usage/cost telemetry is unavailable. Disjoint briefs and native transforms were chosen over full-history workers, an animation framework or full PDF rasterization; cost savings are unmeasured.

The no-inner-scroll update used one bounded `gpt-6-luna` worker at high effort for pure pagination/navigation and tests. Root owned DOM measurement, stable saved anchors, UI, storage compatibility and browser checks. Peak staffing was two including root; actual cost/usage is unavailable. Source-local pagination and a bounded worker brief were chosen over a whole-document pagination migration or a new rendering library; savings are unmeasured.

Skill audit: **not applicable**; skill file: **none**. Existing guidance covers bounded delegation, evidence-based browser recovery and scoped verification. Page geometry and animation contracts are product-specific and belong in the code, tests and plan; no new recurring skill procedure warrants capture. Usage history, the due five-use skill-hierarchy review and the conditional efficiency assessment were completed.

PDF rendering/chapter APIs follow [PDF.js documentation](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFDocumentProxy.html); installable-app configuration follows [Chrome's installation guidance](https://developer.chrome.com/blog/update-install-criteria) and [MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).
