# Page flip optimization

Historical October 23 snapshot. The current reader requests a 160 ms turn; see
the [October audit handoff](october-audit-handoff.md) for current checks and budgets.
The 420 ms measurements below describe the earlier implementation.

Implemented locally on branch `optimization`, October 23, 2026. The existing
JavaScript/browser layout stack and 420 ms 3D turn are retained. No dependency,
PDF layout schema, database version, or saved-position format changes.

## Changes

- **Adaptive fitting:** start with a 512-unit probe, then use the preceding
  leaf's measured capacity as a hint. Expand to bracket larger leaves and binary
  search within that bracket. Probe the next complete Unicode code point to
  recognize an unchanged capacity cheaply. Every final break still comes from
  the actual browser fitting callback; headers, whitespace, and oversized glyphs
  retain their existing behavior. Search backward for the final whitespace.
- **Indexed layout slices:** binary search canonical block/line intervals before
  rendering their overlapping range. Per-layout speaker and region maps replace
  repeated scans. WeakMap ownership lets those indexes leave memory with their
  layout model; canonical text and source maps are unchanged.
- **Adjacent spreads:** one preparation object lives for the current layout.
  Its bounded cache shares pending loads and reuses actual page elements.
  Idle preparation warms the previous and next spread; a timer supports browsers
  without `requestIdleCallback`. Touch the preceding spread before preparing a
  new next spread so eviction does not discard the pages just left.
- **Turn layers:** move the live source leaf and prepared destination leaves
  into the temporary transform layer. An empty placeholder retains the source
  grid slot. Cleanup restores source identity/order, classes, and scroll offsets
  and detaches destination leaves. The caller commits only a finished turn.
  There are no deep page copies or duplicate IDs; listeners remain attached.
- **Navigation and saves:** reuse normalized Contents nodes until their source
  snapshot changes and update highlights only on the affected branches.
  Imported-book flips clone only reading-place metadata before saving. Existing
  IndexedDB merging still preserves Contents, bookmarks, and PDF bytes; that
  storage layer can still serialize its existing metadata record. Demo saves
  retain the complete preferences record because those writes replace it.

Typography, focus, size, navigation, and view changes dispose the old preparation
object and its cache when rendering a replacement layout. A turn's cancellation
signal is separate from the layout's lifetime: canceling a turn cannot commit its
destination, while shared preparation can remain useful for the unchanged layout.
Direct jumps and rerenders cannot accept an old preparation result.

## Resource limits and complexity

The prepared-spread cache retains at most **three entries and 1,200 element
nodes**. Pending entries also count toward the entry limit. Oversized spreads
remain displayable without retention, and rejected preparations are retryable.
The caller still owns the displayed spread if it is evicted. A new spread may
temporarily exist while it is built and weighed; these are cache limits, not a
hard limit on all mounted, detached, or in-flight DOM.

The fragment cache retains at most **six source pages and 250,000 UTF-16 text
units** across their fragment intervals. An individual oversized page is fitted
on demand without being retained there. This text budget does not estimate layout
objects, source PDF bytes, PDF.js caches, browser rendering surfaces, or total heap
usage. Shared layout/source strings remain shared; fragment text is not converted
to raster images.

For `n` source characters, `f` leaves, and typical leaf capacity `c`, the old
search made roughly `O(f log n)` fitting calls and could render enormous rejected
tails. Adaptive bracketing makes probes depend on nearby capacities, commonly
`O(f log c)` calls and just two per leaf for a repeated exact capacity. Worst-case
capacity changes can still require `O(f log n)` calls. Each call's text rendering
and browser layout cost is additional; neither version has constant-time fitting.

Finding overlapping blocks now costs `O(log b + k)` for `b` ordered blocks and
`k` overlaps, plus the analogous line searches and output work. Cached spread
lookup is average `O(1)`. Animation creates a constant number of wrapper elements
instead of `O(d)` deep-copy work for `d` page elements. Browser reparenting,
layout, rasterization, and painting can still depend on page content. The entire
page-flip operation is not claimed to be `O(1)`.

## Measurements

Compared with pre-change commit `0e6c518` using the same generated fixture and
isolated Chrome session on this machine. The fitting case contains 100,000 UTF-16
units (`"word "` repeated 20,000 times), with a 500-unit capacity, producing the
same 200 leaves in both versions.

| Measurement | Before | After |
| --- | ---: | ---: |
| Fitting callback calls | 3,042 | 407 |
| Sum of characters passed to fitting callbacks | 10,837,090 | 203,281 |
| Deep-copied pages per desktop turn | 3 | 0 |
| Fitting reads after clicking Next, six forward turns | 0, 51, 0, 51, 0, 0 | 0, 0, 0, 0, 0, 0 |
| Click to animation-layer insertion, six turns | 6, 44, 5, 37, 4, 3 ms | 4, 3, 3, 4, 3, 5 ms |

The character total counts repeated probes, not unique source text or bytes.
Six turns are a small functional sample, with a 350 ms pause before each click
to permit preparation. Background preparation still consumes CPU; its relocation
ahead of the click is distinct from the paginator's reduction in total work.
Timing includes test instrumentation and is not a broad latency benchmark.
The intentional 420 ms animation remains the largest component of turn duration.
Whole-browser peak memory and physical-device frame rates were not measured.

## Verification and reproduction

- All **140 Node tests** pass, including lossless fitting, changing capacities,
  Unicode, oversized glyphs, abort, interval slicing, page navigation, turn
  identity and cleanup, pending-load sharing, stale-result isolation, LRU
  eviction, and node-budget limits. Existing PDF/runtime/storage regressions pass.
- The production build passes.
- `tests/page-flip-check.html` passes on an isolated origin: desktop forward and
  reverse turns, reuse of the preceding DOM pages, zero page clones, fit bounds,
  cancellation by layout change/direct jump/resize, phone continuation, reload,
  font/focus changes, timer fallback, reduced-motion behavior, EOF, metadata
  preservation, and Original PDF rendering.
- `tests/layout-check.html` passes at 1100px and 390px with 10px/17px/23px text:
  migration, same-page Contents selection, fitting leaves, source lines,
  dialogue/stage directions, notes, Original PDF, and source-anchor restoration.
- The desktop reader and a paused 3D turn were visually inspected; completion
  restored two live pages and removed the overlay. Screenshots are retained in
  ignored `output/playwright/optimization-desktop.png` and `optimization-turn.png`.

From Windows PowerShell:

```powershell
node --test tests/*.test.mjs
npm.cmd run build
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4187 --strictPort
```

Open `http://127.0.0.1:4187/tests/page-flip-check.html` and select **Run page flip
checks**. The fixture writes only a synthetic test book and preferences on that
origin. Keep it separate from the normal shelf on port 4173. The layout regression
is at `/tests/layout-check.html` on the same test origin.

For the historical comparison, archive the pre-change `src/` and `index.html`
under ignored `output/playwright/page-flip-baseline/`, change that copied HTML's
module URL to `/output/playwright/page-flip-baseline/src/main.js`, then open
`/tests/page-flip-check.html?baseline`. That optional mode imports the archived
paginator and displays the archived app; normal verification needs no archive.

The code changes are isolated to pagination, layout slicing/render indexes,
turning, preparation, and navigation bookkeeping. A rollback can restore those
modules together from the branch base without converting stored books or anchors.
No language or rendering-engine migration was needed for these improvements.
