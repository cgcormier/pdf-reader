# 05 · Reduce distracting reflow fragments without changing source identity
Status: assessed, justified, not implemented.
Priority: polish; follow the navigation and focus changes.

## Evidence and decision
The page-identity review found that a source page can legitimately occupy several reflowed leaves. Replacing source numbers with virtual leaf numbers would hide rather than solve the problem. Very short continuation leaves warrant a narrowly scoped typography investigation; this is not evidence of missing content. No fragment-merging change is justified without representative document measurements.

## Proposed scope
Measure short final leaves under small/large fonts and narrow/wide viewports. Consider paragraph-aware widow/orphan redistribution only within one source page.

## Acceptance
- Preserve every character, reading order, source boundary, anchor, bookmark and position restoration.
- No cross-source merging, new virtual page numbers, or claims of lossless behavior without tests.
- Compare screenshots and leaf metrics against baseline fixtures, including equations, headings, scanned/OCR and long paragraphs.
- Keep current behavior when redistribution would overflow, change semantic order, or degrade responsiveness.
- Document quantified improvement and tradeoffs before enabling.

## Coordination
Separate bounded follow-up. No source changes authorized by this ticket beyond the user-requested assessment until the reproduction and fidelity criteria are established.
