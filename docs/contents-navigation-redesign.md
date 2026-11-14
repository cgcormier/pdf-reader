# Contents navigation reconstruction

## Status

This is the agreed implementation contract, not a claim that the redesign has
passed validation. The baseline suite passed 274 tests with one existing skip.
Implementation and rendered acceptance evidence will be recorded below.

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

Pending implementation and review.
