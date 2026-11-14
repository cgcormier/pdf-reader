# Contents resize UX review

## Scope and evidence

This is the independent UX record for the desktop Contents divider. The existing
Contents navigation, mobile drawer, book data, and reading locations remain the
baseline. Implementation status and checkpoint ownership live in
`contents-panel-resize.md`. This document records research, content observations,
and the four requested review/refinement rounds; an unfinished round is not a pass.

The initial review read `index.html`, `src/styles.css`, the resize and Contents
paths in `src/main.js`, `tests/contents-navigation.browser.mjs`, and the existing
navigation reconstruction contract. Real Chrome probes used an isolated origin
and browser profile, the existing 48-page synthetic PDF, and nested long titles.
They do not represent a real scanned PDF or a screen-reader hardware test.

## Sources and their authority

- **Normative standard:** [WAI-ARIA 1.2 separator](https://www.w3.org/TR/wai-aria-1.2/#separator)
  requires an updated numeric `aria-valuenow` for a focusable separator. It
  recommends explicit minimum/maximum when different from 0/100. Orientation
  defaults to horizontal, so this vertical divider must specify vertical.
- **Informative pattern:** [WAI APG Window Splitter](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/)
  recommends a pane-associated label, controlled pane, and left/right movement.
  Home/End are optional. Its example is unfinished and the page explicitly says
  the pattern review is incomplete. Its collapse interaction is not adopted:
  collapsing desktop Contents is outside this feature's scope.
- **Normative event model:** [Pointer Events](https://www.w3.org/TR/pointerevents3/)
  defines capture/release and cancellation. `lostpointercapture` follows capture
  release. `touch-action` must be configured before the gesture; changing it
  during pointerdown cannot retroactively suppress a browser gesture.
- **Reference implementation guidance:** [MDN pointer capture](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture)
  explains routing later pointer events to the captured element, including when
  the pointer leaves its bounds. [MDN requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)
  explains scheduling work before repaint and its one-shot nature. Neither source
  guarantees this app's render speed or reading-position preservation.
- **WCAG requirement with informative explanation:** [Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)
  describes SC 2.5.7's non-drag single-pointer alternative. Keyboard operation
  alone does not satisfy that requirement. Compact Narrower/Wider buttons provide
  an alternative without a second width-setting surface.
- **WCAG requirement with informative explanation:** [Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
  describes SC 2.5.8's 24 by 24 CSS pixel target or an applicable exception. A
  24px-wide divider target is the chosen design; its visible line can stay thin.

## Alternatives and decision

| Approach | Benefit | Cost / uncertainty | Decision |
| --- | --- | --- | --- |
| Native CSS horizontal resize | Very little event code | Browser resize affordance is remote from the pane boundary; no coherent pane-labelled keyboard separator or app-specific clamping/render lifecycle | Reject |
| Focusable separator with Pointer Events | Boundary interaction, explicit bounds, keyboard value, capture/cancel cleanup, shared click controls | Requires lifecycle and reading-render tests | Adopt |

An outline-only drag preview would reduce live layout work, but hides the result
until release. The chosen judgment is live CSS width at most once per animation
frame and a settled Book/page repagination at the end. This needs measurement;
it is not a claim that all reader modes can avoid all layout work during dragging.

## Content-tested bounds and behavior

Recommend 260px minimum, 480px absolute maximum, and 560px reserved for the reader.
Effective maximum is `min(480, workspaceWidth - 560)` on desktop. At 821px the
range is deliberately only 260-261px. The existing 280px/270px responsive default
can remain until adjustment, clamped as necessary. Session preference must survive
temporary viewport clamps and the mobile drawer, without a new storage schema.

These numbers are design judgments based on real rendered content, not standards:

| Probe | Observation |
| --- | --- |
| 1440x900, rail 220 | Long child title uses four lines; short nested title uses two |
| 1440x900, rail 240 | Long child title uses three lines; short nested title still uses two |
| 1440x900, rail 260 | Long child title uses three lines; short nested title fits one |
| 1440x900, rail 480 | Six complete outline rows versus four at 260; long title uses two lines |
| 1000x420, rail 260 | Two complete rows; 135.7px visible outline; search input 113px |
| 1000x420, rail 440 | Three complete rows; 144.5px visible outline |
| 821x900, rail 260, Book/pages | 561px reader remains legible but cramped, roughly 3-4 body words per line |

Initial artifacts: `output/playwright/contents-navigation-after-Ndaxpv/`.
The reviewer opened `width-1440-900-260.png`, `width-1000-420-440.png`, and
`book-pages-reader561.png` after the real browser probe. The width probes changed
only temporary browser CSS. The 561px Book/pages image exposes a toolbar-label
wrapping problem; 520px reader reserve is therefore rejected. Paper-gutter changes
need matching hidden pagination measurement, not CSS-only visual overrides.

Interaction recommendation: a Contents-labelled vertical separator with
`aria-controls="book-contents"`, pixel-valued current/min/max and readable value
text; Left/Right change 16px, Shift changes 48px, Home/End reach bounds. The root
selected these coarser workspace increments over the initial 10px/40px proposal.
Arrow keys
must not turn the book. Escape and pointercancel restore the gesture start width;
release outside commits; unexpected lost capture commits the effective width and
cleans up. These cancellation choices are app judgments rather than standard
requirements. No collapse, persistent preference, or new reading mode is added.

## Review rounds

### Round 1: Basic interaction and visible divider

Initial real-Chrome review found two concrete problems and agreed refinements
directly with their owners:

1. Set width to 480, shrink viewport to 900 (effective 340), click without
   movement, then return to 1440. The initial implementation restored 340 rather
   than 480. Interaction owner agrees that a no-op gesture must retain the wider
   preference; rerun must restore 480.
2. At 1000x420 Book/pages, scroll the document to 220. Contents remained sticky
   at top 0/bottom 356 while the divider moved to top -156/bottom 200. Layout
   owner agrees that divider and panel top/bottom must remain aligned throughout
   document scroll, while keeping the 24px target and zero extra grid footprint.

The reviewer independently opened light/dark focused-divider images in
`output/playwright/contents-navigation-after-teliDR/`; keyboard focus is plainly
visible and the thin grip fits the existing paper palette. The bright dark-theme
grip does not justify unrelated restyling. Independent interaction and scroll
evidence is in `output/playwright/contents-navigation-after-iEUZty/`, including
the visually inspected `round1-scrolled-short.png`. Initial verdict: refinement
required for the two reproduced issues.

Independent post-refinement rerun in
`output/playwright/contents-navigation-after-vGMZeB/` restored 480 after the
no-op clamped click. At document scroll 220, both rail and divider measured top
0/bottom 356; the reviewer reopened the scrolled screenshot and confirmed the
grip sits at the panel midpoint. Round 1 refinement verdict: pass for both
observed issues. This is a bounded UX verdict, not a replacement for the full
interaction suite.

### Round 2: Narrow reader and short desktop

The initial implementation uses a reader container query and two toolbar rows
near the minimum reader width. The agreed criterion was whole labels and
individually hittable controls without horizontal overflow or loss of two-page
text. Paper metrics were deliberately unchanged because the pagination measuring
surface must match any such change.

Independent Chrome probes covered 821x900, 1000x420, 1100x900, and 1280x900 in
`output/playwright/contents-navigation-after-vMUczB/`; the reviewer opened the
821, short, and 1280 images. All visible toolbar control centers hit their own
control. The previously stacked labels now fit whole. Extra threshold probes at
1217, 1220, and 1240 in `contents-navigation-after-IQniCB/` also passed; the 1220
image was inspected. No artificial layout defect was invented to justify changes.

The meaningful refinement selected with the root is the observed breakpoint
focus loss: focus the desktop separator, then shrink to 390x640. Initial Chrome
behavior moved focus to the body, losing the user's place. Evidence is in
`contents-navigation-after-ddl8Cu/`. The interaction owner receives the criterion:
transfer focus to the visible Contents toggle, allow keyboard reopening, and
retain the desktop preference on return.

Independent post-refinement run `contents-navigation-after-xryFSU/` observed
focus on the visible Contents toggle; Enter opened the drawer and focused its
search field, Escape closed it, and returning to desktop restored the preferred
480px. The reviewer opened the mobile focus screenshot. The broader browser
suite then found a timing-sensitive failure at the exact 820px boundary: browser
blur could precede the media callback. A second refinement records divider focus
until that callback, while clearing it after normal focus departure. Independent
run `contents-navigation-after-bGncjI/` passed eight 1000x640 to 820x640 crossings;
all focused Contents. A stale-focus check moved from divider to the paper button
before crossing and retained the paper button. Round 2 bounded UX verdict: pass
for toolbar acceptance and both focus refinements; full-core acceptance remains
the browser suite owner's responsibility.

### Round 3: Non-drag pointer operation

Planned meaningful accessibility increment: visible Narrower/Wider controls,
accessible names, disabled bounds, and focus retention. Their placement must not
reduce the short-height outline below two complete fixture rows. Pending review.

### Round 4: Lifecycle and final visual integration

Pending selection of an observed refinement after prior rounds. Final review must
cover dark/light paper, mobile and focus-mode hide/return, reduced motion, touch
emulation, reading anchor retention, and a fresh interaction after interruption.

## Limits and skill audit

Browser screenshots and DOM assertions cannot establish screen-reader speech or
physical touch ergonomics. Synthetic pointer cancellation can test cleanup but is
not an operating-system interruption. All reports must preserve those limits.
The existing ui-ux-pro-max and Playwright skills covered research and visual
inspection; no skill change is presently justified.
