# Navigation and fitting audit, batch four

Scope: [tracker #3 item 4](https://github.com/cgcormier/pdf-reader/issues/3),
[#18](https://github.com/cgcormier/pdf-reader/issues/18),
[#19](https://github.com/cgcormier/pdf-reader/issues/19), and
[#20](https://github.com/cgcormier/pdf-reader/issues/20). All four live issue
bodies and their empty comment lists were read on October 29, 2026.

The clean checkout was `fix/reader-fidelity-pagination` at `7668a92`.
`git merge-base --is-ancestor` verified the opening, structure, and fidelity
branches before creating local `fix/reader-navigation-performance` from that
branch. Prior handoffs: [fidelity-pagination.md](fidelity-pagination.md) and
[structure-reconciliation.md](structure-reconciliation.md).

## Ownership and contracts

Root owns `src/main.js`, `src/page-turn.js`, animation/input tests,
`tests/navigation-performance.browser.mjs`, and documentation. The fitting
owner owns `src/book-pagination.js`, `src/layout-reading.js`, pagination unit
tests, and `tests/fitting-performance.browser.mjs`. The independent reviewer
owns no files and reviews each issue before its focused local commit.

Shared contracts: canonical UTF-16 text/ranges, page-local source-item indices,
one source page per leaf, shared visible/measured styling, reliable emphasis,
verse/speaker/cue structure, contiguous source coverage, exact overflow
validation, stable bookmarks/Contents/reading anchors, and Original PDF recovery.
The turn layer borrows live/prepared nodes; deep cloning remains forbidden.
Cache bounds remain three spreads/1,200 nodes, six extracted/fitted source
pages, and 250,000 fitted characters. No whole-book preparation is introduced.

## Measurement method

The opt-in `window.__folioReaderMetric` sink records timestamps and work counts;
it records no source text or PDF bytes and retains nothing in normal operation.
Extraction, candidate construction, layout reads, fitting, visible insertion,
preparation, animation, commits, cancellation, and idle work are separate events.
The browser harness retains raw events and reports distributions rather than
asserting universal millisecond limits. The comparable visible-content metric
requires the destination back face past 90 degrees with at least 40px projected
prose width, or a committed nonanimated destination. This conservative browser
paint opportunity avoids counting an exposed paper margin; it is not a photodiode
measurement. Commit latency ends at the canonical position/DOM commit;
persistence and reload are verified separately.

Cold/prepared runs use the same fixtures and traversal. Cold means adjacent DOM
warmup is suppressed, not that every source fragment is uncached: the pager
already fits enough source text to locate its next anchor. Prepared runs invoke
the real idle callback before each input, with `didTimeout: true`. The report
identifies fitting probes instead of equating all unprepared turns with cold
extraction. Source extraction may also have been warmed by document analysis.

## #18 policy and verification

Normal turns use 160ms with the existing forward/reverse hinge. Reduced motion
and transitions where both spreads contain only scan/error/overflow fallbacks
commit without that animation. Borrow/restore identity and cancellation remain
unchanged. Local advisory targets are prepared-turn p95 visible opportunity
within 100ms and committed position within 250ms; cold preparation is reported
separately, with a 300ms advisory commit target for the ordinary corpus.

The original production path was instrumented before choosing this policy.
`run-q4gjvo` contains 192 unchanged-path samples and zero errors. A matching
conservative-visibility baseline is `run-8YWo3r`; the isolated after-#18 run is
`run-8BVsRI`, both under `output/playwright/navigation-performance/`.
These latter two matrices ran concurrently, with separate Vite caches/profiles:
normal prepared commit p50/p95 changed from 441.7/496.2ms to 173.5/244.9ms;
visible opportunity changed from 89.2/122.8ms to 37.6/120.9ms. The visible
p95 target was not met in this concurrent sample. Unprepared animation tails
also show scheduling interference; a final standalone matrix will be reported
separately. Timing targets are diagnostic goals, not universal assertions.

All 64 fixture/width/size/motion/preparation groups have three samples. The
normal/reduced, 1440/390px, 13/19px matrix covers text, mixed emphasis, speech,
and blank/image fallback pages. Eleven animation/buffer tests pass, preserving
direction, cancellation, DOM identity and scroll position. The independent
review found no source blocker; rendered desktop verse and narrow mixed-emphasis
captures were inspected. Repeated-input behavior is addressed separately in #19.

## Reproduction

```powershell
node tests/navigation-performance.browser.mjs metrics --baseline --original-fitting
node tests/navigation-performance.browser.mjs metrics
node tests/fitting-performance.browser.mjs --baseline
node tests/fitting-performance.browser.mjs
npm.cmd test
npm.cmd run build
node tests/fidelity-audit.browser.mjs
node tests/structure-audit.browser.mjs
node tests/reader-compat.browser.mjs
node tests/fidelity-desktop.browser.mjs
```

`--original-fitting` serves the original two fitting modules from `7668a92`
inside the isolated Vite server. Combined with `--baseline`, it restores 420ms
and decorative fallback waiting for the #18 comparison; these flags are for the
#18 commit's main-module interface. Source snapshots and a disabled watcher
prevent concurrent lane edits from changing a running matrix. Fitting baseline
commands otherwise mark diagnostics without restoring old behavior. Keep
the recorded baseline reports for comparisons with later commits. All runners use
fresh isolated origins/profiles and retain artifacts under `output/playwright/`;
never use the live shelf or normal port 4173. Vite caches are isolated. Startup
access failures are separate from product failures. No issue closure, push,
package, or installation is part of this work.
