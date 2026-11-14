# Contents navigation reconstruction

## Status

The reconstruction is implemented. The contract below records its intended
behavior; the final section distinguishes verified checks from remaining checks.
The baseline source suite passed 274 tests with one existing skip.

## Direction

The left rail becomes a running folio index: compact book identity, a clear
Contents heading, a local title filter, a dominant outline viewport, and a quiet
utility footer. Preserve the warm paper, serif titles, terracotta location marker,
hairline hierarchy, and right-aligned tabular PDF page numbers. Rework the large
illustrated upload area into a compact horizontal drop/browse action using the
existing artwork. Keep help and local-storage reassurance available.

The outline gets the available vertical space instead of a 49dvh ceiling. Its
viewport is the primary scroll surface; metadata and utility spacing compress at
short heights. At desktop and mobile acceptance sizes it must expose multiple
usable rows without requiring scrolling through decoration first. Extreme heights
must keep all controls reachable without clipping.

## Interaction contract

- Keep native nested lists, destination buttons, and disclosure buttons. Do not
  introduce an ARIA tree or custom arrow navigation.
- Filter existing titles locally, retaining matching nodes and their ancestors.
  Effective expansion while filtering does not modify saved expansion choices.
  The query is temporary, clears when changing books, and has a clear action and
  an honest no-match state. Search never changes the current reading location.
- Provide an explicit Current section action that clears the filter, reveals the
  active path, and scrolls that destination into view. Normal reading updates
  preserve the user's outline scroll and focus.
- Keep PDF page bookmarks separate from semantic sections and the reader's saved
  page bookmark control. Label page numbers as PDF destinations accessibly.
- Put detailed scan status and existing scan/resume/stop controls in a Document
  analysis disclosure. Its summary must communicate scanning/paused/error state
  without requiring expansion. No analyzer behavior or evidence is changed.
- Mobile opening focuses an appropriate Contents control, contains keyboard focus,
  and makes the background inert. Escape, close, outside click, and destination
  activation close the drawer with sensible focus return. Crossing the desktop
  breakpoint restores normal interaction. Contents controls must not trigger the
  global reader arrow shortcuts.

## Compatibility and implementation boundaries

Keep navigation anchors, PDF bytes, reading positions, expansion persistence,
bookmarks, structure schema, analyzer lifecycle, and both reader modes unchanged.
Keep existing public DOM IDs and `.chapter-link`, `.chapter-label`, `.chapter-page`,
`data-node-id`, `data-page`, and `data-contents-focus` contracts. All nested nodes
remain attached to the DOM, including hidden descendants, because display tests
inspect the complete outline. Build parent adjacency once instead of repeatedly
filtering the full node array. Consume the normalized structure model rather than
duplicating its validation.

Keep orchestration in `src/main.js`; use a small pure helper only where indexed
filtering benefits from direct tests. Avoid a new callback-based rendering layer,
dependencies, virtualization, backend services, or storage migrations.

Ownership: UI implementer owns `index.html`, `src/styles.css`, and
`src/reading-corner.css`; behavior implementer owns `src/main.js` and any focused
pure helper/unit tests; browser implementer owns the standalone Contents browser
suite and fixture infrastructure; orchestrator owns this document. The root agent
owns Git checkpoints and fresh commit reviews.

Shared new DOM hooks: `#contents-search` (search input with an accessible label),
`#contents-clear` (clear button), `#contents-current` (Current section button),
`#contents-count` (visible result/section count), `#contents-empty` (empty/no-match
message), `#contents-analysis` (details), and `#contents-analysis-label` (summary
state text). Existing `#chapter-note` and dynamically created `#structure-tools`
live within that disclosure. UI owns static markup; behavior owns the values,
visibility and listeners. The renderer may create `#contents-empty` dynamically.

Tradeoffs: retain the editorial texture and a small artwork cue, but give up the
large decorative upload reservation for navigation room. Retain a filtered nested
outline rather than a separate search-results view so hierarchy and controls stay
familiar. Use explicit Current section reveal rather than automatically scrolling
the navigator on every page change. Full DOM rendering preserves compatibility;
linear indexing addresses needless work without adding virtualization machinery.

## Migration and rollback

Replace the sidebar composition and its competing height rules together. Retain
the existing navigation and persistence entry points while adding temporary filter
state and drawer focus management. Existing saved books require no conversion.
Validate source tests and build, then browser journeys before publication. If a
checkpoint must be rolled back, revert its focused commit through normal review;
do not reset the worktree or remove saved user data.

## Acceptance evidence required

- Before/after screenshots inspected for desktop, short desktop (1000x420), and
  mobile (390x640); include an extreme short-height reachability check.
- Book and Original PDF modes, page and scroll layouts, light and dark paper.
- Long/nested outlines, long titles, filter matches/ancestors/no matches/clear,
  active-path reveal, disclosure persistence, and distinct PDF page bookmarks.
- Empty, scanning, paused/error, and complete states. Synthetic state fixtures are
  UI coverage, not evidence of a real analyzer failure or scan.
- Keyboard focus visibility, mobile containment/return and resize cleanup, and
  no accidental reader page turns from Contents controls.
- Meaningful performance measurement on a large outline, plus `npm.cmd test` and
  `npm.cmd run build`. Save browser artifacts in a unique ignored output folder.

## Verified implementation

The running index, temporary title filter, Current section reveal, analysis
disclosure, compact import area, and mobile focus isolation are implemented.
Parent indexing/filtering lives in `src/contents-navigation.js`; navigation,
scanner lifecycle, and persistence remain in `src/main.js`. Deep hierarchy keeps
its semantic nesting while visual indentation stops growing after three levels.
At very short heights, the whole rail can scroll to keep controls reachable.

The browser test is standalone and uses an isolated origin/profile:

```powershell
node tests/contents-navigation.browser.mjs
```

The 2026-11-14 run in
`output/playwright/contents-navigation-after-9f86QT/` passed 33 asserted cases plus
three geometry snapshots, with 37 screenshots and no page errors. It covers 24
viewport/mode/layout/theme combinations; filtering and expansion restoration;
Current section without changing reading position; mobile focus containment,
Escape/outside/navigation close, breakpoint cleanup; and normal/reduced motion.
Visible glyph-region checks supplement geometry to catch blank painted content.
Desktop, short desktop, mobile, dark paper, search, and lifecycle screenshots were
visually inspected, including an independent orchestration review.

At 1000x420 the initial outline viewport measured 144px with two fully visible
rows and reachable utility controls. The synthetic 632-node outline loaded and
settled in 1664ms; filtering to a visible match took 30ms on this run. These are
local observations, not portable performance guarantees.

Scanning, stop/resume, and error UI checks intercept the served analyzer only
inside the isolated test browser, exercising real lifecycle callbacks. They do
not establish that a real PDF scan failed. The reduced-motion regression exposed
inherited visibility transitions that left drawer descendants temporarily hidden;
zero transition duration and transform-only drawer motion now permit immediate
focus and painted contents without timer workarounds.

Three pure-helper tests pass, including a 10,000-node hierarchy. On reconstruction
commit `5812fe8`, `npm.cmd test` passed 277 tests with one existing skip (278 total),
and `npm.cmd run build` passed. `npm.cmd run test:display` passed all 84 planned
reader cases with no product failures or harness errors; its report is
`output/playwright/display-suite/run-23K2JC/report.html`.

Fresh reviews found no blockers in the contract (`c5a9899`) or pure-helper
(`ca54dda`) commits. Each checkpoint receives a fresh independent review before
branch publication. No dependency, storage schema, PDF interpretation, or
saved-book migration was introduced.

The fresh interface review found that clicking inside Reading corner help could
close the mobile drawer behind the dialog and lose the return-focus target.
Outside dismissal now ignores clicks while that dialog is open. The reviewer
independently verified help click/close/Escape with normal and reduced motion:
the drawer stays open, closing help returns focus to its launcher, and Escape
returns focus to Contents with no background left inert. This small follow-up
was checked separately from the source/build/display baseline above.
The durable regression runs in both the full suite and the bounded command
`node tests/contents-navigation.browser.mjs --probe`. The follow-up probe in
`output/playwright/contents-navigation-after-nEV8NS/` passed 13 assertions plus
three snapshots with 16 screenshots and no errors. The unaffected full matrix was
not rerun after this guard; the production build was rerun successfully.

The requested Astra low orchestrator synthesized two Luna xhigh brainstorming
lanes. Sol medium handled implementation, architecture, browser infrastructure,
and bounded reviews; the interface review uses Sol high for cross-file focus and
persistence risks. Peak active concurrency was seven, below the authorized eight.
Current model billing was not measured. The existing `budget-orchestrator` and
`ui-ux-pro-max` skills covered this workflow; the skill audit found no update
necessary because no new reusable skill behavior was required.
