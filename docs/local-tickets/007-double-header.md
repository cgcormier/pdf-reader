# 007: Avoid duplicate chapter captions in Original PDF

Status: integrated locally on `agent-work` at `7b26f6b`; browser visual acceptance outstanding. Nothing published.

## Evidence and decision
The supplied screenshot shows the app's `Sets` caption immediately above an Original PDF page whose own title is `Sets`. This is duplicated interface context, not duplicated PDF text. Hide the app reading caption in Original mode, both Pages and Scroll. Restore it in Book mode. Leave PDF bytes, extraction, source-page identity and canvas rendering unchanged.

## Acceptance criteria, pending browser verification
- Original Pages and Scroll: no app chapter caption and no caption-sized blank gap; PDF title remains intact.
- Book Pages and Scroll: contextual caption restored, including after repeated mode switches.
- Focus and immersive exit do not restore the duplicate in Original mode.
- Desktop and narrow viewport behavior verified with actual rendering.

## Verification
Two unit tests cover hidden-state policy, repeat switching and preserved text. Integrated suite: 301 passing; production build and diff check pass. Browser regression script: `BROWSER_EXECUTABLE=/usr/bin/chromium node tests/reader-caption.browser.mjs`. Browser launch currently blocked by environment socket permission failure; no screenshot or UI assertion is claimed passed.

## Review evidence
Test mapping, accessibility and PDF-fidelity reviews completed. Native hidden state removes duplicate context from layout and accessibility tree without altering source content. Contents navigation retains chapter context. Further bounded integration reviews tracked in orchestration report.

Browser script covers ordinary focus entry/exit, not immersive exit or PDF pixel fidelity. Those remain manual checks. All-Original caption omission is a consistent mode policy; PDFs without printed headings retain chapter context through Contents rather than the supplemental caption.

## Bounded agent review ledger
Fifteen distinct agents were spawned in capacity-limited waves. Completed: design hierarchy, test matrix, accessibility, PDF fidelity, mode transitions, focus interaction, browser-test audit, responsive CSS, navigation context, unit contract, ticket accuracy, critical UX scope, integration diff, final regression audit. Root-cause trace also completed: it independently confirmed the small caption is app chrome, not PDF text. All fifteen bounded agents completed their assigned review. No role is counted as browser visual verification.

The final regression auditor independently ran all 301 tests successfully at `eec6695` and confirmed a clean tracked working tree and passing diff check.
