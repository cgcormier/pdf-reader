# October 26 fidelity and pagination audit, batch three

Scope: tracker #3 item 3, issues #14–#17. Local branch
`fix/reader-fidelity-pagination` starts at verified `11231c6` on
`fix/reader-structure-reconciliation`. Ancestry checks include
`fix/reader-opening-recovery`, retaining both prior audit batches.
No publication, issue closure, installation, or live-shelf changes are authorized.

## Ownership and shared contracts

| Owner | Files |
| --- | --- |
| Layout lane | `src/pdf-layout.js`, `src/pdf-layout-adapter.js`, `tests/pdf-layout.test.mjs` |
| Rendering lane | `src/layout-reading.js`, `src/styles.css`, `src/book-pagination.js`, `tests/book-pagination.test.mjs` |
| Browser lane | `tests/fidelity-audit.browser.mjs`, `tests/fidelity-fixtures.mjs` |
| Root integration | `src/main.js`, `index.html`, documentation, desktop verification |
| Independent reviewer | Read-only review of each issue before its local commit |

Canonical projection text and UTF-16 source offsets remain authoritative.
Inline styling adds sorted, nonoverlapping `projection.emphasis` ranges
`{start,end,bold,italic}`. Opaque font identifiers are not emphasis evidence.
The renderer clips these ranges to fragments and retains the reader's base
typeface and size. Measurement and visible output call the same renderer.
Verse classification and spacing cross the layout/rendering boundary only
through agreed block metadata; each file retains one writer.

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

Targeted layout/pagination checks passed (87 tests). The real mixed-font PDF
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

Remaining issue and final matrix are pending.
