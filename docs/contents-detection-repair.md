# Contents detection repair

Status: implemented locally and verified on 2026-10-19. No commit or publication
was requested for this repair.

## Problem and verified baseline

The local Folger Hamlet PDF contains 144 text-readable pages. Version 1 scans all
pages without extraction errors, but produces only the Entire book fallback and
993 low-confidence suggestions. 138 pages are classified as Contents; 825 of the
992 alleged page references are numbered dialogue. Act and Scene are absent from
the heading grammar. Top-margin exclusion also removes genuine act openings.

## Scope and ownership

- Root owns integration, final verification, README, and this plan.
- The detector lane covers src/document-structure.js and detector tests.
- The adversarial review informed the design before its follow-up lifecycle lane:
  the scan policy in src/main.js, src/structure-model.js and model tests.
- All workers use gpt-6.1-sol with high reasoning, fresh bounded briefs, and no
  commits, pushes, installs, PDF modifications, shelf mutations, or unrelated edits.
- Preserve dirty files and the existing storage model. No OCR, external document
  upload, new dependency, or model inference is needed for this repair.

## Detection design

1. Preserve embedded outline destinations as authoritative anchors. Retain the
   existing named destination and page-reference resolution paths.
2. Classify printed Contents conservatively. A Contents heading is strong page
   evidence, but each row still requires a distinct page-reference field. Bare
   Act 1 / Scene 2 labels contain numbering belonging to the title. Dialogue line
   counters and repeating running headers are not page references. Unlabelled
   Contents require layout evidence such as leaders or a repeated aligned page
   column and a high proportion of compact list rows. Do not use two arbitrary
   text-plus-number lines as a page-level switch.
3. Support standalone Act/Scene headings, Roman and Arabic numbering, and repeat
   Scene 1 within different acts. Map acts to existing part nodes and scenes to
   existing chapter nodes so the public kind contract remains compatible. Keep
   their number in matching keys and stable IDs; never collapse every Scene into
   one empty key. Infer scene parents from the preceding act, including same-page
   positions. Ignore abbreviated running labels such as ACT 1. SC. 2.
4. Use document/layout evidence for body-sized scene titles: exact short heading
   syntax, surrounding whitespace, alignment and repeated style/sequence across
   pages. Keep ordinary prose and stage directions out. A narrowly qualified
   structural opening may survive the top-margin filter; do not globally admit
   headers or lower every heading threshold. Retain repeated scene starts across
   acts rather than treating repeated text as a running header.
5. Keep page-number mapping conservative. Require valid in-range anchors and
   corroboration; do not guess offsets from dialogue numbers. Deduplicate review
   candidates without conflating different sections with the same name.

## Compatibility and migration

Increment the detector snapshot version. The analyzer itself must discard stale
checkpoints so direct callers cannot retain old evidence. The app should rescan
outdated completed automatic snapshots on opening a book. Explicitly cancelled
scans and manual arrangements remain under user control. Current-version partial
scans resume normally. Manual overlays and saved reading positions remain outside
the replaced snapshot and must survive. Preserve stable IDs for unchanged existing
heading families exactly. Renamed, hidden, reparented and accepted entries must
remain effective after a version upgrade; reconcile changed identities only with
specific evidence rather than silently duplicating or resurrecting entries.
No database reset or PDF-byte rewrite.

## Review decisions

- Validate every offset-derived page against the document bounds, including
  unresolved candidates. Duplicate anchors cannot establish an offset alone.
- Order coordinate-less outline parents deliberately on the same page as their
  scanned children; preserve multiple explicitly positioned boundaries.
- Keep Act/Scene numbers in matching identity, and distinguish identical scene
  labels at different vertical positions. Avoid changing existing family IDs.
- Test numeric tables and mixed Contents/opening pages. Page classification must
  not turn every numeric row into a reference or erase a separate real opening.
- Hamlet's Contents links point to external local HTML files, not internal PDF
  destinations. Ignore those links; recover the structure from the actual pages.

## Acceptance and verification

- Real Hamlet: five Acts and all twenty Scenes at their actual PDF pages; correct
  Act -> Scene parentage, including repeated Scene 1 and same-page boundaries.
  Zero dialogue lines or running labels admitted; no bogus numeric Contents flood.
- Synthetic plays: same-font scenes, top-edge act openings, Roman numbering,
  repeated scenes, same-page starts, running headers and stage directions.
- Negative cases: numbered poetry/dialogue, numbered prose, numeric tables,
  chapter mentions, body-sized ambiguous headings, and out-of-range references.
- Preserve printed TOC cases (single text item, separated page column, leaders,
  continuation page), outlines, nested sections, page labels and ambiguous offsets.
- Verify cancellation, retries, resumable checkpoints, outdated completed-snapshot
  upgrades, explicit stop/manual opt-out, and manual-overlay preservation.
- Run targeted tests, full npm test, build, diff checks and isolated browser checks.
  Never seed or clear the user's existing shelf merely to test.

## Research used

- PDF.js API: https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFDocumentProxy.html
  documents outline trees, named destinations, page references and page labels.
- Working destination resolution: https://github.com/mozilla/pdf.js/blob/master/web/pdf_link_service.js
- PyMuPDF4LLM heading examples: https://pymupdf.readthedocs.io/en/latest/pymupdf4llm/api.html
  demonstrate font-popularity-based body detection and custom heading logic.
  These support combining layout and syntax; they do not prove this detector's
  thresholds or provide a drop-in JavaScript fix.

## Measured results and limits

- Version 2 scans all 144 Hamlet pages without extraction failures. It finds five
  Acts at PDF pages 8, 40, 64, 96 and 120, and all twenty Scenes at their exact
  page/vertical anchors with the correct Act parents. There are 26 navigation
  entries including Opening pages, zero alleged printed TOC references, and no
  dialogue counters or abbreviated running labels in navigation or review.
- Review suggestions fall from 993 to 1. The remaining body-sized numbered
  quotation on introductory page 4 stays reviewable. Confidence is categorical
  evidence, not a calculated probability or a model score.
- All 97 tests pass, including the optional local Hamlet test, an original
  generated play through PDF.js, numeric-table/dialogue negatives, preserved
  ordinary heading IDs, stale checkpoint replacement, scan opt-outs, correction
  preservation and the two existing 132-page book fixtures. The original play
  fixture always runs; the Hamlet test skips when that local download is absent.
- The production build and git diff whitespace checks pass.
- In the isolated browser origin on port 4187, the bundled sample completed its
  scan. A renamed entry and a removed entry survived rescanning and reload, as did
  the selected reading position at page 3. No browser console errors were observed.
  Evidence: output/contents-repair-sample.png. Hamlet was tested directly through
  PDF.js because browser file-upload permission was declined; no upload workaround
  was used and the user's original shelf was not changed.
- Unlabelled generic two-column lists without leaders or structural titles remain
  conservative: alignment alone also describes numeric tables. General accuracy
  on arbitrary PDFs is unmeasured. No OCR or semantic model was added.
- Two bounded gpt-6.1-sol workers used high reasoning in disjoint lanes. Peak
  staffing was three including root; token and cost totals are unavailable. A
  single-agent repair would avoid coordination overhead, but independent detector
  and compatibility review served this requested workflow. Savings are unmeasured.

## Rollback and handoff

All changes remain local. Review scoped diffs against the pre-task files, not a
reset to HEAD, since this workspace already contains unrelated unfinished work.
If validation fails, keep old persisted data intact and report the exact remaining
case. Do not label proposed behavior as implemented until verified.
