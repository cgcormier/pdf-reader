# October 26 fidelity and pagination audit, batch three

The subsequent local #18–#20 navigation and fitting work is recorded in
[navigation-performance.md](navigation-performance.md), on a focused branch
retaining all three completed audit batches. The results below remain the
batch-three verification record.

Scope: tracker #3 item 3, issues #14–#17. Local branch
`fix/reader-fidelity-pagination` starts at verified `11231c6` on
`fix/reader-structure-reconciliation`. Ancestry checks include
`fix/reader-opening-recovery`, retaining both prior audit batches.
No publication, issue closure, installation, or live-shelf changes are authorized.

## Local issue outcomes

| Issue | Completed outcome | Local commit |
| --- | --- | --- |
| #14 | Reliable bold/italic projection, sliced semantic rendering, conservative metadata and stable source anchors | `d5aaf00` |
| #15 | Compact ordinary preserved lines with stanza/speech/cue breaks and indentation retained | `25bb40f` |
| #16 | Explained Original PDF recovery for unreliable embedded text, with exact Book-anchor restoration | `d912862` |
| #17 | Measured page-local final-pair balancing with heading/source-line/speaker protection | `4abd8c6` |

All four commits remain local on `fix/reader-fidelity-pagination`; GitHub issues
and tracker checkboxes were not modified. The prior batch handoff remains
[structure-reconciliation.md](structure-reconciliation.md).

## Ownership and shared contracts

| Owner | Files |
| --- | --- |
| Layout lane | `src/pdf-layout.js`, `src/pdf-layout-adapter.js`, `tests/pdf-layout.test.mjs` |
| Rendering lane | `src/layout-reading.js`, `src/styles.css`, `src/book-pagination.js`, `tests/book-pagination.test.mjs` |
| Browser lane | `tests/fidelity-audit.browser.mjs`, `tests/fidelity-fixtures.mjs`, `tests/fidelity-check.html` |
| Root integration | `src/main.js`, `index.html`, documentation, `tests/fidelity-desktop.browser.mjs`, `tests/reader-compat.browser.mjs` |
| Independent reviewer | Read-only review of each issue before its local commit |

Canonical projection text and UTF-16 source offsets remain authoritative.
Inline styling adds sorted, nonoverlapping `projection.emphasis` ranges
`{start,end,bold,italic}`. Opaque font identifiers are not emphasis evidence.
The renderer clips these ranges to fragments and retains the reader's base
typeface and size. Measurement and visible output call the same renderer.
Verse classification and spacing cross the layout/rendering boundary only
through agreed block metadata; each file retains one writer.
The pager model in `book-pagination.js` was inspected and retained unchanged.

Implementation order is #14, #15, #16, then #17. Each issue receives targeted
regressions, independent review, and verification before its commit.
All browser and desktop work uses isolated origins/profiles under ignored
`output/playwright/`; source PDFs and existing artifacts remain intact.

## Verification and outcomes

#14 carries explicit descriptor evidence and recognized source-face suffixes
through canonical projection ranges. Missing/ambiguous metadata remains plain;
explicit normal flags override face-name hints. The PDF.js adapter loads font
records with the operator list and falls back to unstyled text if unavailable.
The reader's base family/size remain inherited. Speaker labels retain nested
source styles. No projection version or persisted-data migration is needed.

Targeted layout/pagination checks passed before the #14 commit. The real mixed-font PDF
browser regression passed at 1440x900/13px and 390x844/19px, in Page flip and
Scroll, including fitted source coverage, source endpoint round trips and
continuation reload anchors. Root visually inspected desktop Page flip and
narrow Scroll screenshots in `output/playwright/reader-fidelity/run-xZsyVO/`.
Live Hamlet pages 10/20/50 retained identical text, source segments and block
roles after font enrichment. Font extraction may require additional operator
list work; this batch does not change the later performance audit scope.

Reproduce: `node --test tests/pdf-layout.test.mjs tests/book-pagination.test.mjs`
and `node tests/fidelity-audit.browser.mjs 14`.

#15 adds `continuesToNext` only to ordinary adjacent preserved lines, including
punctuation/indentation-driven block splits and shared replies. The evidence is
same source region and speech association, ordinary local baseline spacing,
letter-bearing text, and no all-italic cue. Rendering removes that block's
bottom margin; stanza gaps, new speakers, stage cues and headings retain their
existing breaks. Source indentation, block identities, canonical separators,
and offsets remain unchanged. Existing 1.8 reader line-height remains a reading
preference, rather than duplicating the source page's exact geometry.

#16 offers **Text looks wrong? → Use Original PDF** beside the layout controls.
The explanation distinguishes embedded OCR/encoding errors from reflow and
does not claim to detect or correct them. No OCR engine or confidence heuristic
is added. `setMode` preserves the last Book text anchor on the source page;
Original PDF is the supported recovery. See the README for the product policy.
The original generated mismatch fixture maps visible glyph G to extracted C:
the page shows “God” while PDF.js and Book view read “Cod.”

## Pagination compatibility strategy

Before changing #17, the rendering lane inspected `createBookPager`, the
source-page fragment cache, spread-buffer keys, `paperPage`/`fillFragment`,
navigation, Contents selection, and persisted `bookPosition` consumers.
They all carry one source page per leaf; item indices are local to that page.
The chosen strategy keeps that contract and balances only the final pair of
leaves within one source page. Cross-source packing would require a larger
leaf/source-range migration and is outside this bounded fix.

No source page, text, mapping, bookmark, or stored schema changes are needed.
Existing offsets resolve through the same canonical projection; resize and
size changes rebuild measured fragments. Rollback is the previous source/build
with the existing shelf retained, never a storage reset.

The corrected pre-policy browser baseline at `d912862` uses production's
first-leaf drop cap and continuation styling, and asserts that diagnostic and
actual rendered fragment intervals match. At 1440x900/13px it reproduced
original generated terminal pairs `798/48`, `1080/65`, and `1080/74` characters.
Real Nietzsche source page 3 measured `665/836/65` characters (1,566 total),
including the same 65-character short tail after #14-#16. The original audit's
`756/786/65` distribution was from an older layout/header baseline.

The implemented policy targets only a terminal leaf below 25% of the
combined final pair's canonical character count. It considers earlier eligible
word boundaries near the pair midpoint, or retained line boundaries for
preserved verse, and accepts a change only when both leaves measure to fit.
It protects internal headings and speaker labels with their first words, preserving every exact source
slice. The first leaves and total leaf count remain unchanged except that a
two-leaf source page may rebalance its sole pair.

The final browser regression measured these fitting pairs with the same styling
and asserted that diagnostic intervals match actual reader DOM intervals:

| Case at 1440x900 / 13px | Greedy character counts | Balanced character counts |
| --- | --- | --- |
| Original 48-character tail | 798 / 48 | 420 / 426 |
| Original 65-character tail | 1080 / 65 | 570 / 575 |
| Original bold-italic 74-character tail | 960 / 74 | 516 / 518 |
| Real Nietzsche physical page 3 | 665 / 836 / 65 | 665 / 451 / 450 |

The production Electron runtime independently measured Nietzsche intervals
`[0,665]`, `[665,1116]`, `[1116,1566]`. Root inspected the fitted spread and
final continuation screenshot. The terminal leaf now contains 450 characters;
the source page still has three leaves, with the same exact total text.

## Reproduce and inspect

Run from the repository root with the installed dependencies:

```powershell
npm.cmd test
npm.cmd run build
node tests/fidelity-audit.browser.mjs
node tests/structure-audit.browser.mjs
node tests/reader-compat.browser.mjs
node tests/fidelity-desktop.browser.mjs
```

The fidelity browser command accepts individual issue numbers `14 15 16 17`.
To capture the greedy reference without evaluating improvement, set
`$env:FOLIO_FIDELITY_BASELINE='1'`, run issue `17`, then remove that environment
variable. Its report explicitly says `baseline-diagnostic`, never acceptance
passed. The regular #17 check compares greedy and balanced fitting directly.
`FOLIO_NIETZSCHE_PDF` overrides the browser's real-document path.

The production desktop command serves the built `dist/` through `folio://app/`
and uses a new retained profile. Its local corpus additionally uses
`C:/Users/ccorm/Downloads/Additional reading Nietzsche Zarathustra Prologue.pdf`
and `C:/Users/ccorm/fall-26/pstat_120a/Shelley - Frankenstein.pdf`.
These third-party files are not committed. It generates its own emphasis,
speech and mismatched-OCR PDFs under ignored output. It imports files, checks
both layouts and Original PDF, restarts, switches books, and checks bookmarks,
Contents and original byte hashes. It neither packages nor installs an app.

Browser commands use fresh isolated origins/contexts/profiles, never port 4173.
The new fidelity and compatibility runners isolate Vite dependency caches;
their setup waits for explicit app readiness. On this Windows environment,
browser/desktop commands need execution outside the restricted sandbox for
loopback browser access; sandbox startup timeouts are not product test passes.
Retained screenshots and JSON reports live under `output/playwright/`.

## Verification evidence

- `npm.cmd test`: 225/225 passed; production build passed.
- `structure-reconciliation/run-QF6cg2`: existing six-issue structure audit
  passed, including distant Scroll destinations under reduced and normal
  motion, Contents selection, restored source anchors, and byte conservation.
- `reader-fidelity/run-gvLek5`: corrected pre-policy diagnostic; actual
  production and measurement-helper intervals match, including the three
  exact tiny tails and real Nietzsche page 3 after #14-#16.
- `reader-fidelity/run-Q0VSpz`: #17 acceptance passed, including bold-italic
  balancing, preserved verse continuations, blank/image source pages, complete
  forward/backward traversal, bookmark/resize/font/reload/source-page anchors,
  fitting bounds, contiguous text intervals and source-map round trips.
- `reader-fidelity/desktop-VLW0Dk`: final production Electron matrix passed
  with the sample, generated fidelity/OCR corpus, Hamlet pages 10/20/50,
  Frankenstein's 228 source destinations, and the 17-page Nietzsche excerpt.
  Root inspected production OCR help, Hamlet Scroll, restored sample, and
  Nietzsche Page flip/continuation screenshots.
- `reader-fidelity/compat-vXxvnw`: existing Page flip and layout browser gates
  passed, including cancellation, forward/reverse turns, phone continuations,
  reload, 10/17/23px typography at desktop/narrow widths, Original PDF, legacy
  anchor migration, Scroll source restoration, and no renderer errors.

- `reader-fidelity/run-bfPsg5`: final combined #14-#17 run passed together:
  four completed issue reports, zero renderer errors and zero failures. It
  includes desktop/narrow Page flip and Scroll, 13/19px text, and the OCR
  recovery journey additionally at 320px/23px. Cross-issue startup honors the
  saved Scroll layout rather than assuming Page flip. Root also inspected the
  normal/reduced-motion distant Scroll screenshots from the structure run.

Each issue received independent review before its local commit. No blocking
review findings remain. The reports above record successful runs; earlier
diagnostic/failure artifacts remain retained and are not acceptance evidence.

## Limits and preservation

Balancing applies to interpreted PDF layouts, only within a source page and
only to the final pair below the 25% character threshold. It changes neither
leaf count nor physical page count and does not pack across source pages.
Sparse singleton, blank/image, substantial-tail, heading-protected, unbreakable
word, or no-fitting-candidate cases can retain whitespace. Raw demo/legacy
plain-text pagination remains greedy. The threshold is a character proxy;
both candidate leaves must pass actual rendering measurements. A failed search
can measure multiple candidates; broader performance work remains with the
later audit, rather than introducing a new fitting/cache architecture here.

Entirely italic preserved lines conservatively retain existing spacing to
protect ambiguous stage cues. Some Hamlet folios and side counters still appear
in body text under existing marginal detection. This batch preserves that text
and source order; it does not claim exact source-page typography or complete
marginal recovery. Original PDF remains available for those cases and OCR.

No original PDF changed. Repository SHA-256 values before/after verification:
`public/sample.pdf` =
`7c899f8ec82512fa12ef184f37adf0f6b5a4e0929148a4f9fa7b8f3c59f1de5d`;
`testing_downloads/Hamlet.pdf` =
`61b29ecdfc84ebb24e9b919dfcb7faa435f4886d289f34ea3c6191010577e5e3`.
Imported stored bytes also matched source digests, including Nietzsche
`2e104006044ef9ff47b1b42cca29579ba6e9ff39d203af90cd7dbc0d37a5a2af`
and Frankenstein
`df427fe124295b75244d559f4e3508665d7e450601217a4b8da7287dd6bf9c7b`.
Existing PDFs, ignored artifacts, profiles and the live shelf were retained.

Workers used `gpt-6.1-sol` with high reasoning for source provenance, UTF-16
boundaries, pagination and independent review; peak active count was five
including root. Usage/cost telemetry was unavailable. Skill audit: existing
delegation, PDF, browser and UI guidance sufficed; no skill revision was
justified. The needed improvements were repository regressions and isolated
verification setup, implemented here. No memory files were modified.
