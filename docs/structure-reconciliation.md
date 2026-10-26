# October 26 structure audit, batch two

Scope: [tracker #3, item 2](https://github.com/cgcormier/pdf-reader/issues/3),
issues #6, #9, #10, #11, #12 and #13. Local branch
`fix/reader-structure-reconciliation` starts at `fix/reader-opening-recovery`
(`0b20f07`), retaining the first batch's fixes. No remote publication or issue
closure is part of this handoff.

## Ownership and review

One writer owned each production/test area. Layout interpretation and its unit
fixtures belonged to the layout lane; Contents analysis, hierarchy and model
tests to the structure lane; reader integration and documentation to the root;
browser acceptance fixtures to the browser lane. A separate read-only reviewer
checked each issue before its commit. Temporary browser ownership transfers were
explicit and occurred only while its owner was stopped.
Root also owned the supplemental Scroll window and spacer correction discovered
during final rendered verification; the browser lane supplied its regression.

Workers used `gpt-6.1-sol` with high reasoning for parser edge cases, source
conservation and independent review. Peak active count was five including root.
Usage/cost data was not exposed. No skill edits were needed: the existing
delegation, Git, PDF and browser workflows covered the work; the audit identified
test gaps in this repository, addressed by fixtures below.

## Implemented behavior

| Issue | Behavior and evidence | Local commit |
| --- | --- | --- |
| [#6](https://github.com/cgcormier/pdf-reader/issues/6) | Dense scanner labels remain usable under PDF page bookmarks, outside semantic Contents and injected chapter typography. Sparse numeric and Roman chapters remain. Saved analyses refresh their chapter typography on upgrade. | `4657c00` |
| [#9](https://github.com/cgcormier/pdf-reader/issues/9) | Structural words in ordinary prose stay in paragraphs. Written, Arabic, Roman and supported alphabetic identifiers remain recognized. Lowercase prose after a numeral is also rejected by the #10 classifier patch. | `7d37148` |
| [#10](https://github.com/cgcormier/pdf-reader/issues/10) | Modest centered titles combine spacing, casing, size and sequence evidence shared by rendering and Contents. Existing Part parents and first credible repeated headings survive; smaller adjacent capitals form a section child. | `b395f9f` |
| [#11](https://github.com/cgcormier/pdf-reader/issues/11) | Combined, split and OCR-shaped running headers move to inspectable Source notes. Printed folios need not equal physical page numbers. Exact body text and header source ranges remain intact. | `8447400` |
| [#12](https://github.com/cgcormier/pdf-reader/issues/12) | A matching source title suppresses the generated copy, including imperfect opening roles, prefatory lines, split number/title pairs and confirmed mid-page titles. Source blocks and projection offsets remain intact. | `c54050e` |
| [#13](https://github.com/cgcormier/pdf-reader/issues/13) | Adjacent chapter-number/title evidence shares the original outline ID and title. Conflicting ordinals remain separate; equivalent Roman/written numbers reconcile. Chapter ordinals exclude continuation headings. Measured restoration and stable Scroll windows preserve source anchors and destinations. | `4ee0320`, `e0cf0e7` |

## Regression and migration contracts

- `pageNavigation` preserves destination title, physical page, original y, label
  and outline evidence. It does not feed chapter typography. Classification
  requires dense, largely contiguous leaf destinations and page-counter evidence.
- `structureLines()` shares source line/region identities, roles and supporting
  heading evidence with Contents. It keeps printed-Contents eligibility separate
  from standalone heading eligibility.
- Captured runs and body/annotation source coverage remain inspectable. Heading
  classification does not repair embedded OCR spelling or alter PDF bytes.
- Generated intro suppression is used in both visible rendering and measured
  pagination. Continuation intervals remain contiguous; saved source anchors
  resolve against the canonical projection.
- Detector upgrades rescan saved completed snapshots. An explicitly cancelled
  scan remains cancelled. The layout/source-map format and IndexedDB versions
  are unchanged; no data migration or deletion is required.
- Distant Scroll navigation restores its logical position after replacing the
  mounted page window. Geometry spacers never transition: the global reduced-
  motion duration otherwise introduces a brief height transition that can clamp
  the destination before the new spacer height is applied.

## Verification

Reproducible fixtures are original generated PDFs, plus `public/sample.pdf`.
The sample has four physical pages; tests use its actual page count.

```powershell
npm.cmd test
npm.cmd run build
node tests/structure-audit.browser.mjs
```

The browser command supports issue-number arguments and owns a fresh retained
Chrome profile plus an available loopback Vite origin. It writes screenshots and
reports under ignored `output/playwright/structure-reconciliation/`.
Its checks cover actual file import, both reading layouts, source text and
mapping conservation, numeric navigation, old-snapshot upgrade, title counts,
continuation intervals and restored Contents selection.

The six-issue browser run passed together with no renderer errors. The full
Node suite passed 199/199 and the production build passed. The existing Page
flip and layout browser gates also passed, including desktop/mobile typography,
Original PDF, source migration, cancelled turns, resize and reload.

The production Electron matrix passed using a fresh retained profile and the
production build. It covers both reading layouts, Original PDF, scanner
destination 155, header notes, Contents, restart and shelf switching. The input
PDF hashes match the stored bytes. Actual page-17 Scroll screenshots were
visually inspected after waiting for loading and persistence to settle.

The final rendered check exposed a distant Scroll jump settling on an earlier
page. An original 17-page fixture reproduced page 17 moving to page 14 before
the supplemental correction. Afterward, the visible and saved page stay at 17,
mounted pages stay bounded at seven, and selected Contents/source anchors
survive reload under reduced motion. Normal-motion jumps back to page 1 and
forward to page 17 also pass.

Actual-document coverage includes the four-page sample, the 228-page
Frankenstein scan, and all 17 pages of the Nietzsche excerpt. The Nietzsche
layout audit retained all body/source ranges, isolated 25 running-header lines,
and round-tripped 80 header source endpoints. Contents contains the two modest
Zarathustra titles and their smaller capitals section. Source OCR spacing is
retained in these labels.

Local evidence is retained under `output/playwright/structure-reconciliation/`:

| Evidence | Directory |
| --- | --- |
| Final full six-issue browser run, including distant Scroll regression | `run-Dmf7LB` |
| Final Page flip and layout compatibility browser gates | `compat-scrQwh` |
| Failing original distant-jump reproduction | `run-aMV7XN` |
| Passing expanded #13 regression | `run-uXOY0i` |
| Production Electron matrix and inspected actual PDFs | `desktop-rniVm3` |

The local supplemental commands are `node output/verify-structure-desktop.mjs`
and `node output/verify-structure-compat.mjs`. These verifiers, screenshots and
profiles remain ignored local artifacts; third-party PDFs are not committed.

## Limits

The heuristics intentionally leave ambiguous numeric outlines and unfamiliar
typography unchanged. This batch does not perform OCR correction, repair inline
emphasis or verse spacing, or address the later performance/a11y audit items.
The original PDF remains the reference for ambiguous source interpretation.
Long source headings can span fitted leaves at narrow widths; their fragments
retain heading markup and source text. This batch does not add a keep-together
pagination rule. The production desktop runtime is tested; no new installer or
portable executable is packaged or installed.

Rollback uses the previous application source/build without deleting the shelf.
Older detectors may recreate the original classification defects. Source anchors
and original bytes remain available; do not reset storage to change detectors.
