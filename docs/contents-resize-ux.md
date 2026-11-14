# Contents resize UX review

## Scope and evidence

This is the independent UX record for the desktop Contents divider. The existing
Contents navigation, mobile drawer, book data, and reading locations remain the
baseline. Implementation status and checkpoint ownership live in
`contents-panel-resize.md`. This document records research, content observations,
and the requested review/refinement rounds, including continued acceptance work;
an unfinished round is not a pass.

The initial review read `index.html`, `src/styles.css`, the resize and Contents
paths in `src/main.js`, `tests/contents-navigation.browser.mjs`, and the existing
navigation reconstruction contract. Real Chrome probes used an isolated origin
and browser profile, the existing 48-page synthetic PDF, and nested long titles.
They do not represent a real scanned PDF or a screen-reader hardware test.

## Sources and their authority

Sources checked on 2026-11-14.

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

The initial increment adds visible Narrower/Wider controls and Book/scroll source
anchor capture/restoration. Independent review used 632 sections at minimum width,
both 1440x900 and 1000x420. The 50px control group fits the heading; the desktop
count wraps, while the short count fits one line. Two complete outline rows remain
visible. The no-match message and filter remain usable. The reviewer opened all
four initial images in `contents-navigation-after-aL4r7M/`.

Observed mismatch: Home to 260, click Wider, click Narrower back to 260. Native
disabled made the focused Narrower button lose focus to the body. The agreed
refinement uses `aria-disabled` with a guarded action, keeping focus stable.
Independent run `contents-navigation-after-VJdQBF/` confirmed focused Narrower,
disabled semantics, no width change on Enter, and no page turn on ArrowRight.

A second observed mismatch blocked initial acceptance: at the top of a fresh
Book/scroll document, initial scrollTop was 1 and the chapter title's Y coordinate
was 327.19. Home from 280 to 260 produced scrollTop 284/title Y 44.19, hiding the
chapter opening. The reviewer opened the before/after images in the same run.
Preserving a source offset alone does not preserve this visual reading position.
Interaction/browser owners received the criterion to retain the source anchor's
viewport offset, including the chapter opening at document start. The refined
capture omits a text anchor while the reading line is above source prose,
allowing the scroller's visual fraction to preserve the opening. Independent
`contents-navigation-after-u5IUqr/` rerun kept scrollTop 1/title Y 327.19 before
and after; the reviewer opened the corrected image.

The browser lane also reproduced a modal interruption leaving drag state active.
After its cleanup refinement, the reviewer exercised an actual UI path: hold a
pointer drag, Shift+Tab to Reading corner help, and Enter. The modal opened with
focus on its close button and no resizing state; releasing the pointer and Escape
returned focus to help. Screenshot inspected in `contents-navigation-after-Sifl1L/`.
The ordinary outline ink oracle cannot inspect an intentionally obscured modal
background; that probe used a direct screenshot rather than calling background
ink loss a product defect.

The browser lane's fresh `contents-resize-F17IfT/` robust run passed all 12
checks. Nonzero Book/scroll source offset 585 and Book/pages continuation offset
1066 stayed exact; Original PDF source positioning and cancellation/return paths
passed. Independent image review of the preceding equivalent post-fix run
`contents-resize-BjLVHW/` opened source-scroll before/after, source-pages-after,
and touch-after: the same prose stays at the top, continuation remains visible,
and Original PDF remains painted. Round 3 verdict: pass for the three observed
refinements, supported by independent UI probes and the fresh robust suite.

### Round 4: Avoid redundant work and preserve cancellation recovery

Independent initial Book/pages measurement found three direct child-list
mutations of the painted spread after a no-movement divider click
(`contents-navigation-after-WReG30/`). The implementation defers expensive resize
work until the effective width first changes. The independent same probe then
reported zero mutations (`contents-navigation-after-oOcJZD/`). The interval was
500ms; this measures DOM replacement, not a universal frame-time guarantee.

A boundary probe found a queued-frame interruption defect. With native
pointer capture active, a scripted move and help activation in the same task
cancelled before the scheduled animation frame. The modal closed with normal
painted pages and cleared drag state, but Next did not advance, even after 600ms:
page 1 and the same 821 text characters remained. The code computed whether it
needed a refit before flushing the pending move; that flush then aborted the
page preparation. `contents-navigation-after-gYRE01/` reproduces this; the
equivalent `after-BTLyUN/` screenshot was opened. Exact same-frame event timing
is injected test input, not a claim of a physical-device failure. The agreed
criterion is that cancellation must not start work for an unapplied width and
must leave subsequent page navigation operational. After rollback was changed
to discard the queued width, independent rerun
`contents-navigation-after-3iOAsH/` returned width 280 with no resize state and
then advanced Next to page 2, with newly painted text. The reviewer opened that
image. Round 4 verdict: pass for both independently reproduced UX findings;
the final isolated performance rerun remains the browser lane's acceptance gate.

The real-document performance lane imported the existing 144-page Hamlet PDF
and checked its stored-byte hash. Independent visual review opened
`contents-resize-itGG1X/hamlet-book-pages-during.png`, its after image, and
`hamlet-original-scroll-after.png`. Scene text remained painted and source page
10 remained selected. The browser lane measured six Book/pages drags with no
fitting during the drag, frame p95 16.7-16.9ms, and settle 241-469ms on that run.
These are local observations. The large synthetic outline was slower under
concurrent broad tests; no portable performance guarantee is inferred.

### Round 5: Explicit navigation during resize settlement

The added round addresses explicit navigation during the 160ms width settle
window. Independent actual clicks started on source page 17, scrolled 500px,
clicked Wider, then clicked the visible Contents destination on page 47. After
700ms the UI/current section and stored page/scroll position were 47, but stored
Book source position had been overwritten with stale page 17/offset 31.
Evidence: `contents-navigation-after-mLNGP6/`. The agreed criterion is that a
deliberate navigation supersedes the earlier resize snapshot, including stored
source position and subsequent reload. The initial correction interrupts resize
and discards its captured source position before explicit navigation.

Independent post-correction `contents-navigation-after-WtNQ8f/` retained
UI/current destination 47, stored Book position 47/offset 0 with the destination
ID, and reloaded at page 47. The browser lane confirmed that immediate paged
Next could still lose its requested turn. An initial near-page scroll failure
read persisted state too early and is inconclusive as product evidence; the
corrected live-position oracle passed. Separately, focused scroller tests
demonstrate that a pending resize notification must not restore the pre-jump
position, and that changed page heights must be measured before computing an
immediate jump's pixel offset. The targeted refinement
clears stale scroller notification state and reconciles measured page positions;
Book/pages waits for the current width's refit before executing one requested
turn. A newer explicit navigation must supersede that pending intent. No queued
turn debt or new navigation mode is justified.

Independent `contents-navigation-after-EUK8n9/` injected the consecutive actions
within one task to exercise the timing boundary. Wider then Next advanced the
painted UI and stored source to page 2/offset 0. Wider, Next, then explicit
Contents destination 47 retained page 47/offset 0 and that destination ID. Both
screenshots were opened; text and chapter labels matched the accepted action.
These bounded paged checks pass. The browser lane's near-page scroll-navigation
test subsequently passed with the corrected live-position oracle. The preceding
consolidated run `contents-resize-g2UIaI/` passed 53 checks, produced 62
screenshots, and reported zero browser errors. Fresh overall gates follow the
performance refinement below.

### Round 6: Large-outline style recalculation

The isolated 632-entry stress run consistently measured frame p95 around 83ms,
compared with roughly 17ms for Hamlet. This was investigated as a real
performance issue rather than hidden behind the successful functional checks.
Browser CDP diagnosis (`contents-resize-Yt1h9S/`) measured 2329.6ms of style
recalculation across four baseline gestures. Resetting the unused inherited
`--sidebar-width` at the Contents and reader branch roots reduced that to 33.4ms
(98.6% less); frame p95 became about 33.3ms. The selected change is one CSS rule.
The workspace and its sibling separator still consume the width variable.

Independent before/after browser probe `contents-navigation-after-srJDG0/`
reproduced p95 83.3/83.2ms before and 33.4/33.3ms after on the same 632 nodes.
At the 260px rail, the outline's measured scroll height remained exactly 44305px.
During wide and narrow drags the divider center matched the boundary at 480px
and 260px. Before/refined screenshots at 480px were visually inspected and had
identical SHA-256 hashes. Filtering Research note 600 revealed it without changing
reader page 1; clearing and Current section restored the visible active path.

Round 6 UX verdict: the measured improvement is accepted. Dense-outline rewrap
still costs real layout work, so this is not a universal 60fps claim. Exact DOM
and row heights remain intact. Content visibility estimates or virtualization
would introduce scroll/height risks without a demonstrated need; no further
complexity or interface addition is justified by this review. The final
`contents-resize-9YeDRm/` consolidated rerun passed 53 checks with 62 screenshots
and zero browser errors. The isolated `contents-resize-NLAIyZ/` rerun passed all
seven performance checks with 11 screenshots. Its dense outline p95 was
33.4-33.6ms, settle 249-305ms; Hamlet across four modes measured 16.7-16.9ms p95,
with Book/pages settle 319-390ms. Active surfaces stayed attached during dragging,
and Original PDF canvases remained attached afterward. These final report totals
were independently read by the UX reviewer.

### Continued acceptance review

The user subsequently requested repeating rounds until there are no actionable
issues and nothing justified left to add. Four rounds are therefore a minimum,
not an automatic stopping condition. Six rounds were completed, including the
additional navigation and measured performance refinements. The final bounded
review found no unresolved actionable UX issue in the inspected scope and no
justified addition. It covers source position and interruption recovery,
light/dark paper, mobile/focus mode, reduced motion, native touch emulation,
keyboard and single-pointer alternatives, large outlines, and the real Hamlet
document. Stop refinement here; further speculative features or cosmetic changes
would expand scope rather than resolve an observed need. This verdict is bounded
by the test environment and the limits below, not a claim that every possible
device or document has been proven defect-free.

## Limits and skill audit

Browser screenshots and DOM assertions cannot establish screen-reader speech or
physical touch ergonomics. Synthetic pointer cancellation can test cleanup but is
not an operating-system interruption. All reports must preserve those limits.
The existing ui-ux-pro-max and Playwright skills covered research and visual
inspection; no skill change is presently justified.
