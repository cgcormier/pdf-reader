# Layout interpretation migration

> October 22 update: manual Contents editing, suggestion actions and overlays were
> removed. Automatic Contents, scan controls, bookmarks and source anchors remain.
> Old custom-only arrangements rescan automatically; retired edit metadata is
> discarded at the storage boundary. Earlier compatibility notes below describe
> the previous implementation.

## October 26 outline classification

Detector snapshots now use version 8. Dense numeric scanner outlines are retained
in `structure.pageNavigation`, separate from semantic Contents nodes. The reader
exposes their original destinations under PDF page bookmarks. Sparse numeric and
Roman chapter outlines remain semantic. Upgrading a saved scan also refreshes
chapter typography and fitted leaves without replacing PDF bytes or source anchors.
The density rule is conservative; ambiguous short numeric outlines remain unchanged.

Modest-size centered titles use casing, whitespace, size and title-sequence
evidence shared by Book rendering and Contents. Smaller capitalized subtitles
can remain children of their adjacent title. Source OCR spelling and anchors are
preserved. Matching source titles suppress generated intros, including titles
after a chapter-number or prefatory line and confirmed mid-page headings.

Adjacent chapter numbers and matching outline titles now share the original
outline identity and title, with the source number retained separately. Pairing
requires compatible ordinals, region, alignment and destination geometry;
distinct same-page headings remain separate. Scroll restoration measures loaded
pages before resolving source anchors, avoiding drift from estimated page heights.

## October 23 review fixes

Detector snapshots used version 5. Printed Contents detection accepts numbered
rows even when the reading layout classifies them as lists; ordinary list items
remain excluded from standalone heading evidence. Horizontal fragments retain
their original tolerant baseline-row identity, keeping title and page-number
fields together when their baselines differ slightly.

Regression tests cover single-run numbered entries, positive and negative
0.2-point baseline differences, and distinct neighboring TOC rows. These fix
cases that previously reduced a valid Contents tree to the Entire book fallback.
Validation on October 23: all 132 Node tests passed, the production build passed,
and the isolated layout browser suite passed at desktop and phone widths,
including scan upgrades, legacy positions, page turns, Scroll and Original PDF.
The validation and measurements below describe earlier runs, not this review.

## Contract and migration strategy

Previously the reader sorted baselines, joined lines into paragraphs, removed a
duplicate chapter heading, then paginated that flattened string. Contents had a
second geometry implementation using maximum font size. Neither retained source
identity. Saved unversioned offsets address that old, heading-dependent string.

The new page-local contract is `layout.version`, immutable captured `runs`,
`lines`, `regions`, ordered `blocks`, separate `annotations`, and `projection`.
Coordinates for analysis are top-down viewport units at scale one. Each run also
retains the PDF transform, source baseline, font metrics, writing direction and
an explicitly estimated box. Run indices identify this extraction, not glyphs or
permanent identities across PDF.js upgrades. Marked content IDs are separate.

Projection segments map UTF-16 ranges to captured run ranges; synthetic
separators have null source. Original strings, including whitespace, remain in
runs. Whitespace changes are mapped transformations, with omitted whitespace
accounted for explicitly. Body and annotation source coverage is checked by
range, not character totals. No ligature expansion or dehyphenation is applied.

The shared adapter bounds its per-document cache, shares pending page work, and
checks cancellation at await boundaries. Layout is independent of text size;
existing six-page pagination caches remain viewport dependent. Contents consumes
corrected lines with original PDF y anchors, leaving hierarchy rules and public
IDs separate from layout roles. Automatic snapshots get a detector version bump;
the existing opt-out and manual overlay policies continue to apply.

Both reading modes render projection fragments using block/line intersections.
Source lines wrap with hanging continuation indentation. Pagination keeps its
contiguous UTF-16 intervals and code-point boundaries, and backs a lonely
speaker off a leaf where possible. A leaf that cannot fit even one code point
uses an explicit Original fallback rather than clipping or stalling.

Before using an old offset, reconstruct the old extraction and duplicate-heading
policy, map it to a captured run range, and resolve that range in the new
projection. Missing targets resolve to the nearest mapped range or page opening.
New positions include layout version and source range. PDF bytes, bookmarks,
Contents IDs/edits/expanded states, and IndexedDB versions are unchanged. Scroll
fractions remain a fallback; source anchors take precedence when available.

Rollback: restore the previous source/build; do not reset storage. Old builds
cannot interpret the new offsets. `legacyOffset` retains the pre-upgrade offset
for a migrated place; a rollback adapter must restore that value or map the
saved source through the legacy projection. Places created after upgrade need
that translation or an explicit page-opening fallback. Downgrading the code
alone does not guarantee precise reading-place restoration.

## Verification plan

Tiny original PDF fixtures and pure geometry cases cover drop caps and negatives,
columns with spanning bands, dialogue, annotations, tags, rotation/nonzero origin,
source coverage and legacy mapping. Keep outline/printed-TOC/manual-edit tests.
Run targeted tests, the full suite, production build, and an isolated browser
origin for desktop/phone and both reading modes. Optional local Hamlet checks
retain exact Act/Scene anchors. Record measured results and limitations below
after implementation; this plan is not evidence of completed checks.

## Implemented pipeline and ownership

`src/pdf-layout-adapter.js` shares PDF.js reads, including optional marked
content and structure trees, in an eight-page per-document WeakMap cache.
Consumer cancellation rejects promptly without cancelling another consumer's
pending read. Already-started PDF.js work may finish into the bounded cache;
there is no additional whole-book layout pass and no worker/model dependency.

`src/pdf-layout.js` captures immutable source runs, estimates boxes using
available metrics, maps through the actual viewport transform, and associates
supported decorative initials before final grouping/statistics. It separates
recognized FTLN labels, repeated aligned side numbers, physical-page footers,
and small running play labels or paired top-margin titles/page numbers. Other
edge material stays in the body rather than being discarded speculatively.

Local baseline buckets form provisional lines. Sustained whitespace gutters
split text regions; crossing lines divide those columns into horizontal bands.
The regression with a middle spanning heading demonstrates why a single global
gutter cut fails: it puts the lower-left material before the upper-right
material. The constrained recursive cut reads the upper band first, then the
heading, then the lower band. Candidate cuts are capped at 24 per region and
recursion at four levels. Ties use position and capture index; there is no
precedence graph or cycle resolution to maintain. This is an original small
implementation informed by [PdfPig's segmentation descriptions](https://github.com/UglyToad/PdfPig/wiki/Document-Layout-Analysis),
not a port of its code.

Blocks distinguish reflowable paragraphs, headings, hanging lists, speeches,
stage cues, neutral source-line groups, simple captions/footnotes and unknown
regions. Speaker detection combines repeated uppercase labels and dramatic
context; no character list or filename rules are used. A short-line pattern
requires source EOL evidence, width and line-ending evidence before being kept
as neutral verse. This does not assert whether it is poetry or prose. Raised
and lowered initials use adjacency, vertical overlap/flow and ambiguity checks;
they are excluded from representative line sizing. The body measure uses
character-weighted type evidence rather than a largest-letter maximum.

Marked IDs are mapped through the actual tree, with coverage, duplication and
geometric-order checks. Complete compatible trees supply heading/list role
evidence. Partial/reversed trees are rejected with a reason; absent trees use
geometry. Tags do not blindly reorder overlapping content. This conservative
check reflects the [W3C reading-order guidance](https://www.w3.org/WAI/WCAG22/Techniques/pdf/PDF3).
The speech/line/stage distinctions are informed by [TEI drama](https://tei-c.org/release/doc/tei-p5-doc/en/html/DR.html);
TEI is neither a dependency nor a detector.

`src/layout-reading.js` owns projection slicing, the shared safe DOM renderer,
source-anchor resolution, pagination and speaker-boundary handling. Main reader
integration is in `src/main.js`; responsive indentation, wrapping and notes
focus styles are in `src/styles.css`. Source notes use the existing modal.
`src/pdf-engine.js` exposes the layout and constructs the exact legacy text
projection for migration. Its older chapter API now uses the corrected lines
too. `src/document-structure.js` replaces its duplicate geometry code and moves
automatic snapshots to version 3. Public Contents IDs and overlay logic remain
in the existing structure model. No IndexedDB migration was necessary.

## Concrete results

- Original lowered-cap fixture reproduces `y goal ... inexpensive M high-quality`
  in its legacy projection. The new body reads `My goal ... inexpensive
  high-quality textbook.` exactly once, and no paragraph/cap is promoted to
  automatic Contents or review suggestions. The actual textbook was absent;
  this is a geometry reproduction, not a live textbook verification.
- Local Hamlet page 8 has 13 speech blocks, 10 neutral line groups, two stage
  directions and 16 annotation blocks; page 9 has 15 speeches, 21 line groups
  and 33 annotations. FTLN labels and recognized running/counter material are
  inspectable separately. Spoken numeric text remains in the body. The existing
  full-book regression retains all five Acts and twenty Scenes at their exact
  PDF page/y anchors, with no numeric printed-TOC flood.
- Original two-column fixture reads upper left, upper right, middle heading,
  lower left, lower right. One/two/three-column tests assert exact sequence;
  coverage assertions independently account for every captured run range.

## Validation results (October 22, 2026)

Targeted Node tests cover initial positives/negatives, split runs/quotes,
Unicode, whitespace maps, source ranges, paragraphs/verse/lists, shared dialogue,
counter/number separation, columns/bands, footers, superscripts, absent/valid/
partial/reversed tags, real tagged PDFs, a real rotated nonzero-origin PDF,
RTL fallback, contiguous pagination, oversized fallback, lonely labels,
legacy/source positions, bounded caching and cancellation. Original fixture
PDFs are generated from JavaScript; no third-party PDF copies are added.

The browser-native regression at `tests/layout-check.html`, on isolated port
4184, passed desktop 1100px and phone 390px at 10/17/23px text. It checks leaf
height/width bounds, turns, scrolling, speech/stage/notes, DOM selection order,
Original canvases, same-page navigation, version upgrades, a manual rename,
bookmarks, legacy migration, long-line pagination and reload. A saved source
character is checked inside the reading viewport after scroll size/reload
changes. The final measured size-change test was 64ms including test waits and
multiple simulated key events; it is not a renderer-only benchmark. No browser
warnings/errors were captured. Source/pretty screenshots for preface, columns
and dialogue are kept under ignored `output/playwright/`.

Final `npm test`: **131/131 passed**, zero skipped or failed. Final
`npm run build`: **passed**, including the existing offline PDF/font packaging.
`git diff --check`: **passed**. No commits, branch changes or publication were
performed. The handoff document and concurrent reading-corner artwork/UI files
were preserved; they are separate from the parser ownership area.
The final browser run also passed a legacy zero offset after a removed chapter
title in Scroll. The runner waits for a new iframe document and the persisted
scan version before asserting reload/upgrade results. Its complete output is
saved in ignored `output/playwright/layout-browser-results.txt`.
The first sandboxed baseline had 91 passes and six localhost-fetch failures;
the unrestricted baseline checks confirm those server failures were an
environment restriction. No server-test code was changed to mask them.

### Measurements

Windows x64, Node 22.21.0, PDF.js 6.3.289; PDF loading completed before each
measurement. Cold means the interpretation cache was cleared; PDF.js/font
internal caches may still be warm. These are single samples, not budgets or
an accuracy/performance benchmark.

| Corpus/page | Cold page read + interpretation | Cached read |
| --- | ---: | ---: |
| Original initial / 1 | 26.915 ms | 0.010 ms |
| Original columns / 2 | 6.133 ms | 0.018 ms |
| Original play / 3 | 6.948 ms | 0.018 ms |
| Original long line / 4 | 7.401 ms | 0.014 ms |
| Local Hamlet / 8 | 43.593 ms | 0.029 ms |
| Local Hamlet / 9 | 11.484 ms | 0.015 ms |
| Local Hamlet / 32 | 12.042 ms | 0.009 ms |

Every measured page passed source-range conservation. A 1,000-page in-memory
synthetic document (40 runs/page) took 1,037.95ms and exactly 1,000 page reads.
Node heap was 19.55 MiB before, 21.08 MiB after explicit collection, with a
106.04 MiB sampled allocation peak. This measures the adapter/analyzer, not
browser rendering or real PDF.js document memory. Cancellation and eviction
behavior also have explicit assertions; no universal memory ceiling is claimed.
Raw measurements are in ignored `output/playwright/layout-metrics.json`.

## Limits and remaining work

This is a deterministic core rebuild, not universal PDF understanding.
Ambiguous sidebars, parallel translations, overlapping content, complex tables,
math transcription, unusual split initials and arbitrary vertical/RTL reflow
remain limited. Rotated/unsupported-direction runs and recognized formulas or
numeric tables retain their text as unknown blocks and offer Original through
source notes. Some unsupported layouts cannot be identified reliably at all;
Original remains the page-level reference for them. Caption/footnote and
furniture rules are conservative, not a document-wide decoration classifier.

Neutral line groups preserve uncertainty. Shared verse text stays in sequence;
the detector does not reconstruct TEI-style partial-line metrical relationships
or infer prose-versus-verse universally. Inline stage cues remain at their text
position; only strongly supported standalone cues receive a stage role.
Per-character boxes are not available, and estimated run subdivisions are not
glyph precision. No overlapping-text deduplication, OCR, dehyphenation,
ligature expansion, paid inference, uploads or backend was added.

Skill audit: **not applicable**; skill file **none**. Product-specific layout
contracts and fixtures belong in this report and tests. Existing skill guidance
covers the tool recovery and validation; no additional reusable procedure met
the capture threshold. The simpler global gutter alternative failed the
spanning-band fixture, justifying bounded recursion. The portable browser
fixture avoided a global Chrome-tool upgrade; savings are unmeasured.
