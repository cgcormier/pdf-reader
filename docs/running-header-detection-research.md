# Running headers interrupt the story and become false headings

Research date: November 11, 2026. Suggested priority: P2.

Folio sometimes interprets printed running chapter labels, page numbers, and author names as story structure. This has two distinct effects: Book view inserts heading typography into continuous prose, and some layouts also acquire false Contents entries. Fixing Contents alone will not repair the reading-flow failure.

This is a research report and two proposals, not an implemented application fix. Related: [#11](https://github.com/cgcormier/pdf-reader/issues/11) concerns headers leaking into body text; [#6](https://github.com/cgcormier/pdf-reader/issues/6) concerns numeric embedded bookmarks. The supplied `frank-a5.pdf` is a different, text-bearing edition from the scanned Frankenstein in #6.

## Exact story interruption in the supplied screenshots

The screenshots show printed pages **71-72**, corresponding to physical PDF pages **81-82**. Both pages belong to the same Chapter VI; the actual chapter opening is printed page 67 / physical page 77.

The end of printed page 71 and the start of printed page 72 form one sentence:

> It was completely dark when I arrived in the environs of Geneva; the gates of the town were already shut; and I was obliged to pass the night at Secheron, a village half a league to the east of the city.

The faulty Book reading sequence is:

```text
...the gates of the town were already shut; and

72

                 Chapter VI

I was obliged to pass the night at Secheron...
```

The conjunction **and** belongs to the clause beginning **I was obliged**. The large centered chapter heading interrupts that grammatical connection and signals a new chapter where the story is simply continuing. The folio `72` becomes another unrelated reading block. Repeating this at source-page boundaries repeatedly restarts the visual hierarchy, adds heading spacing, and makes continuous narration appear divided into new sections. Both story clauses remain present: these screenshots demonstrate inserted non-story material and a false structural boundary, not missing narration.

A normal page turn may remain. The correction should move source furniture out of the main story stream, keep the prose in order, and preserve the real chapter opening and Original PDF. It does not require joining all source pages into one paragraph or redesigning pagination.

**Original printed page 71:**

![Original page 71 ends with the unfinished conjunction and](https://raw.githubusercontent.com/cgcormier/pdf-reader/codex/running-header-research-2026-11-11/docs/research/running-header-detection/screenshots/source-printed-71.png)

**Original printed page 72:**

![Original page 72 repeats Chapter VI as page furniture above the continuing sentence](https://raw.githubusercontent.com/cgcormier/pdf-reader/codex/running-header-research-2026-11-11/docs/research/running-header-detection/screenshots/source-printed-72.png)

**Folio Book view:**

![Folio inserts 72 and a centered Chapter VI between the connected clauses](https://raw.githubusercontent.com/cgcormier/pdf-reader/codex/running-header-research-2026-11-11/docs/research/running-header-detection/screenshots/folio-story-interruption.png)

## Three tested examples

These are one real document and two explicitly synthetic, original PDFs. All use installed `pdfjs-dist` **6.3.289** and the actual `analyzeDocumentStructure`, `readPageLayout`, and `structureLines` functions, with full-document scans rather than isolated candidate inspection.

| Example | Expected | Observed result |
| --- | --- | --- |
| Supplied `frank-a5.pdf`, 268 physical pages | Repeated chapter labels and folios remain page furniture; Chapter VI continues across printed 71-72 | **212 running-header rows have layout role `heading`**. On physical 82 the reading projection begins `72`, then `Chapter VI`, then the continuing body text. **No false running-header Contents nodes** in this original PDF: final result is 33 nodes, including 31 outline nodes, one genuine-opening duplicate, and one fallback. |
| Six-page chapter-plus-changing-folio fixture | Two real chapters at pages 1 and 4, source y=650 | **Eight Contents nodes: two genuine openings plus six false header nodes**, including `Chapter 1: River Journey 41`, `...42`, `...43`, and `Chapter 2: The Mountain Road 44-46`, all at y=740. |
| Six-page repeated author-name fixture, no folio | Only those two real chapters | **Three Contents nodes**, including false `MARY ELEANOR SHELLEY` at page 2, y=740. Later repetitions disappear, but the first prominent occurrence survives. The author string is synthetic test data. |

The synthetic header baseline is 60pt / **7.5%** below the top of a 600x800pt page, with 15pt header type and 10pt body. The author hypothesis is therefore confirmed for a prominent author header in this geometry, not for every author-name header.

Controls and variants, all actually run:

- Ordinary 9pt author headers and 9pt chapter-plus-folio headers do not create false Contents nodes.
- The same headers at 3.5% below the top do not create false Contents nodes because the existing margin exclusion catches them.
- Mixed-case `Mary Eleanor Shelley` also produces a false first author entry. Adding changing folios creates four false author entries.
- Splitting chapter labels and folios into separate runs yields only two chapter nodes, but both use the **wrong header y=740**, replacing the real opening anchors at y=650. Checking node count alone misses this failure.
- A genuine standalone chapter opening at 3.5% below the top is already lost by Contents analysis, leaving `Entire book`. A larger unconditional margin exclusion would worsen this class of false negative.

All 11 controlled PDFs, totaling **61 pages**, scanned with zero failed pages and valid source conservation. The real PDF scanned 268/268 pages with zero failures. SHA256 of the unchanged input: `2acdebda2e0111d3f5460fb3a1f63e00a617d8e6a10dfa68924081a37af6bd9a`.

## Why it happens

1. **The two margin checks miss this edition's header row.** Frankenstein's view is `[0,0,419.528,595.276]`. The header/folio source baseline is y=546.675: **48.601pt / 8.164% below the top**. Both `annotationLines` and the structure detector use a top band of only 5.5%. The row is outside it. See [page-layout annotation rules](https://github.com/cgcormier/pdf-reader/blob/4b5d2354c3cf86e6eeb0cc07adb2a15fdb9a04dc/src/pdf-layout.js#L157-L199) and [looksRunning](https://github.com/cgcormier/pdf-reader/blob/4b5d2354c3cf86e6eeb0cc07adb2a15fdb9a04dc/src/document-structure.js#L233-L236).
2. **The running-title rule excludes the very labels causing the problem.** `runningTitle` requires `!isHeading(text)`. A chapter label or `PREFACE` therefore fails the title-plus-folio furniture rule, while `makeBlocks` subsequently recognizes the same label as an explicit heading. Merely widening the band does not resolve this contradiction. See [title gate](https://github.com/cgcormier/pdf-reader/blob/4b5d2354c3cf86e6eeb0cc07adb2a15fdb9a04dc/src/pdf-layout.js#L160-L164) and [heading classification](https://github.com/cgcormier/pdf-reader/blob/4b5d2354c3cf86e6eeb0cc07adb2a15fdb9a04dc/src/pdf-layout.js#L275-L291).
3. **Book rendering and Contents promotion have different gates.** `renderLayout` turns every heading block into an `h3`. The Frankenstein body-sized bare chapter labels are separately rejected by Contents' size logic, so a clean-looking Contents tree does not imply clean Book typography. In the prominent fixtures, the headers also pass Contents' typography checks. See [renderLayout](https://github.com/cgcormier/pdf-reader/blob/4b5d2354c3cf86e6eeb0cc07adb2a15fdb9a04dc/src/layout-reading.js#L179-L190), [evidence collection](https://github.com/cgcormier/pdf-reader/blob/4b5d2354c3cf86e6eeb0cc07adb2a15fdb9a04dc/src/document-structure.js#L338-L374), and [final promotion](https://github.com/cgcormier/pdf-reader/blob/4b5d2354c3cf86e6eeb0cc07adb2a15fdb9a04dc/src/document-structure.js#L449-L470).
4. **Global title repetition is an unreliable furniture detector.** Changing trailing folios make titles different. Exact repetition instead preserves the first prominent occurrence, explaining the lone false author node. It also lacks recurring-position evidence.

An additional regression trap: `titleKey('Chapter I')`, `titleKey('Chapter II')`, etc. all become the empty string. The current repeated-title filter treats 23 genuine chapter openings as one identity and suppresses 22 heading-evidence instances. The original outline/TOC largely masks this. An explicitly labeled ablation disabling only `getOutline()` still scanned the same bytes successfully but lost genuine chapters at physical **235 and 243** entirely. This ablation is not the original-PDF result. Guarding empty keys is a small separate correction, not a fix for running furniture.

## Easy proposition: narrow containment in the existing annotation pass

Add one predicate in `annotationLines`, before `makeBlocks`: recognize a **body-sized explicit chapter/frontmatter label plus a separate same-baseline edge folio**, in the upper 10% of the page, with ordinary body text 1-4 body sizes below. Classify **both** row components as `running-header` using the existing annotations path. Use the title/folio/spacing evidence together; do not simply discard the upper 10% of every page.

This reuses current geometry, baseline peers, annotations, and source mapping. The sandbox prototype is nine predicate lines plus one dispatch addition in `pdf-layout.js`; regression tests and appropriate version changes are additional work.

**Tested in copied modules under ignored `output/`, not applied to production:** on physical 81/82, `Chapter VI` and `71`/`72` move to annotations; all remaining story source spans retain their order; conservation passes. Real chapter openings on physical 33/77 and a synthetic top-edge opening without a folio remain headings in the layout.

**Limits:** this contains the supplied story interruption. It does not solve prominent combined-text chapter/folio rows, author-only headers, the title-key collision, or the existing top-edge Contents miss. Roman-folio matching and real openings that share a row with a folio need further negative tests. The 10% and spacing bounds are provisional. This is the least-code useful improvement, not a complete solution to the three-example family.

## Hard but best proposition: shared document-level page-furniture inference

Build a small recurrence model shared by Book classification and Contents, using the existing incremental scan rather than retaining every page layout in memory:

1. Collect compact observations before promotion: original source IDs/ranges, normalized viewport-relative baseline and x position, alignment, representative font/style, full baseline-row text, and separate possible folio tokens. Combine split PDF runs for matching while preserving their identities.
2. Cluster recurring rows across distinct pages at stable locations. Support mirrored odd/even patterns, chapter-local stretches, author versus chapter variants, and changing Arabic/Roman folios. Normalize a confirmed folio slot for matching; keep real chapter ordinals and volume context. Do not strip every number from semantic titles.
3. Require multiple signals: recurrence plus stable geometry/style and body separation. A top-edge location or repeated title alone is insufficient. Preserve one-off chapter openings, headings with genuine large opening whitespace, and short/ambiguous documents. Recognize validated artifact marked-content signals where PDF.js exposes them; fall back when tags are absent or incomplete.
4. Apply the same confirmed furniture decisions to layout roles and Contents eligibility. Suppress the first occurrence as well once it is established as furniture. Keep outline destinations authoritative; nearby furniture must not steal a real chapter's source y or falsely corroborate a TOC match.
5. Retain recognized furniture as inspectable Source notes with exact original ranges. Keep the immutable source runs and original PDF unchanged. Moving furniture between body and annotations changes the body projection; invalidate affected fits/layout results and map reading places by retained source anchors rather than assuming old text offsets remain valid.
6. Persist compact recurrence evidence in versioned scan checkpoints. Count each physical page once, handle failed-page retries, and make uninterrupted versus resumed scans deterministic. Keep uncertain partial-scan decisions provisional. Preserve the page-local eight-entry adapter cache; use document-scoped classification context or a versioned overlay instead of silently changing a context-free cached page.
7. Start with exact normalized matching and folio-slot inference. Add bounded OCR-tolerant matching only against explicit fixtures, keeping chapter ordinals distinct. Test nonzero crop origins, rotations and mixed page sizes in normalized viewport coordinates. No new OCR service or AI dependency is needed for the initial solution.

This requires coordination across layout, adapter/cache context, structure snapshots and reading-anchor migration. Bump the relevant layout/structure versions and verify refresh of saved scans without losing bookmarks or reading places. Rollback must account for changed body offsets; retaining raw source anchors and the original PDF is the recovery basis.

W3C describes chapter titles, page numbers and author information as running-header content and identifies the `/Artifact` marked-content mechanism; this supports separating furniture from narrative content, not treating margin location as proof. [W3C PDF14](https://www.w3.org/WAI/WCAG22/Techniques/pdf/PDF14). PDF.js exposes text marked-content and structure APIs, whose presence must be checked against the installed parser. [PDF.js text-content types](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html), [PDFPageProxy](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html).

## Acceptance and reproduction

- [ ] On printed 71-72, the story continues from `...already shut; and` to `I was obliged...` without an intervening folio or chapter heading; the real Chapter VI opening on printed 67 remains.
- [ ] The three main cases have the expected heading roles and exact Contents anchors, including no author node. Existing outline identities/destinations remain intact.
- [ ] Combined/split runs, mirrored rows, changing/offset folios, author-only headers and chapter-local repeats are covered alongside genuine top-edge and repeated-numbered headings.
- [ ] Source coverage includes body plus annotations exactly once; story order, Original PDF bytes, bookmarks and reading-place restoration survive classification changes.
- [ ] Fresh, partial, cancelled/resumed and completed-scan-upgrade results agree. Add browser checks in Page flip and Scroll at the actual offending sentence; node counts alone are insufficient.

From the repository root with its dependencies installed:

```powershell
node docs/research/running-header-detection/reproduce.mjs 'C:\Users\ccorm\Downloads\frank-a5.pdf'
node docs/research/running-header-detection/containment-probe.mjs 'C:\Users\ccorm\Downloads\frank-a5.pdf'
node --test tests/pdf-layout.test.mjs tests/document-structure.test.mjs tests/document-structure-runtime.test.mjs
```

The first command generates all 11 original controlled PDFs and JSON under ignored `output/heading-header-research/published-reproduction/`, then scans the optional real PDF. Omit its argument to run only synthetic cases. `MISMATCH` is an observed bug against the stated expectation, not a successful product regression. The second command patches only disposable copies and asserts the narrow proposal's results.

Verification: both published reproduction commands completed successfully; all **113 existing targeted tests passed** despite these reproduced defects. No application fix or full desktop/browser acceptance suite was run. The supplied screenshots provide user-observed Book evidence; the exact source pages were separately checked through the real parser/layout pipeline.

Provenance: local branch `fix/october-audit-completion`, starting HEAD `3d1ffaf8b7684b96b45bb4b0c70b085965095a57`, with unrelated existing modifications preserved. Git blob hashes for the tested `pdf-layout.js` and `document-structure.js` exactly matched GitHub main at `4b5d2354c3cf86e6eeb0cc07adb2a15fdb9a04dc`. Evidence publication adds only this report, two research scripts and the three user-provided screenshots on a separate branch; no production module changes or main-branch update.
