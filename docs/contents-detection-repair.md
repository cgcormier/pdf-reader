# Contents detection repair

Status: design under review; implementation and measured results will be recorded below.

## Problem and verified baseline

The local Folger Hamlet PDF contains 144 text-readable pages. Version 1 scans all
pages without extraction errors, but produces only the Entire book fallback and
993 low-confidence suggestions. 138 pages are classified as Contents; 825 of the
992 alleged page references are numbered dialogue. Act and Scene are absent from
the heading grammar. Top-margin exclusion also removes genuine act openings.

## Scope and ownership

- Root owns integration, scan upgrade policy, final verification, and this plan.
- Detector worker initially reviews this plan; implementation requires a follow-up
  assignment and is restricted to src/document-structure.js and detector tests.
- Adversarial reviewer reads source and research, identifies failure cases, and
  proposes acceptance tests. No source edits or descendant agents.
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
heading families where practical. No database reset or PDF-byte rewrite.

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

## Rollback and handoff

All changes remain local. Review scoped diffs against the pre-task files, not a
reset to HEAD, since this workspace already contains unrelated unfinished work.
If validation fails, keep old persisted data intact and report the exact remaining
case. Do not label proposed behavior as implemented until verified.
