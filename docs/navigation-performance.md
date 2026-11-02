# Navigation and fitting audit, batch four

The measurements below are historical #18-#20 evidence. The current calibrated
#23 gate, Long Tasks capability, enforceable budgets and reproduction commands
are in [the October audit handoff](october-audit-handoff.md).

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

## Local issue outcomes

| Issue | Result | Local commit |
| --- | --- | --- |
| #18 | 160ms directional turns; immediate fallback-only/reduced-motion transitions; phase-separated measurements | `5263318` |
| #19 | One pending discrete direction, explicit saturation/opposite/repeat/cancellation policy, real input and anchor regressions | `ae0e3c5` |
| #20 | Cooperative measured fitting, exact bounded memo, shared in-flight ownership, final-first pair search and style-generation cancellation | Commit containing this handoff and titled `Bound cold fitting work and preserve exact measured leaves (#20)` |

All commits remain local on `fix/reader-navigation-performance`; all three prior
audit branches remain ancestors. GitHub issues/tracker checkboxes remain open.

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
also show scheduling interference; the final standalone matrix below is the
primary timing comparison. Timing targets are diagnostic goals, not universal assertions.

All 64 fixture/width/size/motion/preparation groups have three samples. The
normal/reduced, 1440/390px, 13/19px matrix covers text, mixed emphasis, speech,
and blank/image fallback pages. Eleven animation/buffer tests pass, preserving
direction, cancellation, DOM identity and scroll position. The independent
review found no source blocker; rendered desktop verse and narrow mixed-emphasis
captures were inspected. Repeated-input behavior is addressed separately in #19.

## #19 input policy and verification

One active turn and one pending discrete direction are allowed. A second press
is retained; further input before completion replaces that one direction.
Opposite input completes the active turn then turns back. This deliberately
coalesces longer saturated bursts rather than promising one turn for every
press. Held-key `repeat` events never create another turn, even after the first
turn finishes. Mouse, discrete arrows, touch, and pen share this policy.

Only a valid successful commit drains the pending slot. Cancellation, failure,
or a no-op at a boundary clears it. Controls accept input while busy, including
opposite input at the starting boundary. Resize, font/focus changes, Contents
lookup, direct navigation, layout/view/book changes, modal opening, hidden-tab
and reduced-motion changes clear pending and partial swipe intent. Contents
cancels before awaiting its source lookup. Position persistence uses each actual
committed anchor. A successfully displayed recovery fallback is still a turn.

`output/playwright/navigation-performance/run-Zb03kE/report.json` passes 22
reported cases with zero renderer errors. It compares actual visible text and
exact persisted/reloaded source anchors against sequential navigation at
1440px/13px and 390px/19px, with normal/reduced motion. Inputs are real browser
mouse/keyboard and CDP touch/pen events. Repeats are tested both during and
after a turn. Animation is temporarily paused only to make saturation,
opposite-direction, and cancellation ordering deterministic. A real PDF worker
text request is held to exercise repeated input during cold preparation under
both motion settings: the final commits are source pages 2 then 3, offset zero.

The cancellation matrix covers resize, direct page entry, actual Contents,
font, focus, pointerdown/resize/pointerup, Book/Original, both layouts, hidden
state, rejected animation, motion change, modal and book switching, plus EOF.
Hidden state is deterministically emulated with a visibility event; it does not
claim OS background-tab coverage. Handler request-to-cleanup measurements in
this sample range from 0 to 7ms; they exclude OS input delivery and cold-work
cancellation, measured separately for #20. Ordinary two-turn bursts finish in
339–374ms normal motion and 10–62ms reduced motion (four of each, across mouse
and keyboard). These are local observations, not asserted thresholds.
The held-turn screenshot was visually inspected; borrowed pages remain legible
and directional. Eleven animation/buffer checks continue to pass.

## Final standalone timing comparison

Before: `navigation-performance/run-dUd1C3/report.json`. After:
`navigation-performance/run-Ulao9F/report.json`. Each ran alone with 192 turns,
64 fixture/viewport/size/motion/preparation groups, three samples per group,
zero renderer errors and identical final anchors in all 192 paired samples.
The before runner serves the original fitting source plus instrumented #18 main
with the original 420ms/fallback waiting restored inside its isolated server.
It is a reproducible diagnostic, not a checkout mutation. The earlier in-place
baseline `run-q4gjvo` separately verifies the unchanged production path.

Environment: Windows `10.0.26200`, Intel Core Ultra 7 155U, 14 reported logical
CPUs, Node `22.21.0`, headless Chrome `156.0.8078.48`, viewport 1440×900 or
390×844, reading size 13 or 19px. Power/thermal state and other desktop activity
were not controlled. Each row below has 48 samples; values are p50 / p95 in ms,
using empirical nearest-rank quantiles. Full min/max and all 64 per-case
distributions, raw events and screenshots are retained in each report.

| Motion / preparation | Before visible opportunity | After visible opportunity | Before committed position | After committed position |
| --- | ---: | ---: | ---: | ---: |
| Normal / unprepared | 92.1 / 108.8 | 40.3 / 67.8 | 441.6 / 462.0 | 176.8 / 205.2 |
| Normal / prepared | 87.6 / 97.6 | 36.4 / 44.8 | 438.9 / 450.6 | 174.8 / 180.3 |
| Reduced / unprepared | 11.2 / 45.4 | 12.6 / 47.2 | 1.9 / 30.9 | 1.8 / 38.8 |
| Reduced / prepared | 6.3 / 14.5 | 6.0 / 14.5 | 1.0 / 1.3 | 0.9 / 1.6 |

The prepared normal targets (100ms visible opportunity, 250ms committed) and
ordinary unprepared 300ms commit target pass in this final local sample.
Normal fallback-only turns have no animation wait. These are observations;
the regressions assert semantics/counts and do not enforce brittle wall-clock
thresholds. Visibility is the defined conservative paint opportunity, with a
191ms maximum unprepared sample; it is not hardware-measured first ink.

| Phase/count, unprepared normal, p50 / p95 | Before | After |
| --- | ---: | ---: |
| Preparation elapsed (ms) | 1.1 / 23.7 | 0.9 / 29.3 |
| Animation elapsed (ms) | 434.0 / 445.9 | 171.7 / 180.3 |
| Candidate DOM construction (ms) | 0 / 4.2 | 0 / 4.5 |
| Fit geometry read time (ms) | 0 / 15.8 | 0 / 16.6 |
| Extraction (ms) | 0 / 5.3 | 0 / 6.6 |
| Candidate reconstructions/probes | 0 / 48 | 0 / 46 |
| Fit geometry reads | 0 / 150 | 0 / 142 |
| Prepared idle work elapsed (ms, normal) | 0.8 / 20.8 | 1.0 / 23.7 |

Fit-read counts include the two height properties plus the two bottom rectangles
when evaluated, not every browser/internal layout read. Visible insertion p95
afterward is 0.2ms unprepared and 0.3ms prepared normal. Prepared input performs
zero candidate reconstructions/layout probes; the required work moved to the
separately recorded real idle callback, including its timeout case.

Only 12 of the 48 unprepared samples per motion actually fit cold source text;
the remainder reuse already fitted fragments without warmed adjacent DOM. For
those 12 actual-fit samples afterward, preparation p50/p95 is 22.8/29.8ms normal
and 27.1/51.9ms reduced, with 29/57 probes. Total ordinary unprepared probes
across text/mixed/speech fall from 906 to 840, and fit reads from 2,880 to 2,616.
All 192 paired anchors are unchanged. Reduced-motion cold p95 commit is slightly
slower (30.9→38.8ms): yielding has scheduling overhead despite fewer DOM probes.
The evidence supports less redundant work and responsiveness, not a universal
improvement to every total preparation duration.

## Reproduction

```powershell
node tests/navigation-performance.browser.mjs metrics --baseline --original-fitting
node tests/navigation-performance.browser.mjs metrics
node tests/navigation-performance.browser.mjs input
node tests/navigation-performance.browser.mjs work
node tests/navigation-performance.browser.mjs work --baseline --original-fitting
node tests/navigation-performance.browser.mjs work --baseline
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
and the instrumented main module from `5263318` inside the isolated Vite server.
Combined with `--baseline`, it restores 420ms and decorative fallback waiting
for the #18 comparison. Source snapshots and a disabled watcher
prevent concurrent lane edits from changing a running matrix. Fitting baseline
commands otherwise mark diagnostics without restoring old behavior. Keep
the recorded baseline reports for comparisons with later commits. All runners use
fresh isolated origins/profiles and retain artifacts under `output/playwright/`;
never use the live shelf or normal port 4173. Vite caches are isolated. Startup
access failures are separate from product failures. No issue closure, push,
package, or installation is part of this work.

## #20 fitting policy and evidence

Pagination yields exact `{text,start,end}` fit requests. The existing synchronous
exports drive the same generator as the production reader. Each invocation
reuses only an identical absolute UTF-16 range in its fixed source/style
generation, with a 4,096-entry FIFO bound and no persisted cache. Final overflow
classification still requests every exact final interval; an already measured
identical range can supply its result. Unmeasured final intervals still render
and pass the original scroll-height and last-child-bottom safety-pixel checks.

The measured unsuccessful #17 search rejected the enlarged terminal leaf for
many candidates. It now measures that leaf first, retaining candidate order,
safe boundaries, the below-25% trigger, both-leaves-fit requirement, and exact
source text. It makes no assumption that nearby DOM fits are monotonic. Speaker
repair still refits its suffix, with absolute source ranges shared through the
invocation memo. No new leaf model or whole-book pagination is introduced.

Production fitting yields to a macrotask after about 8ms or 32 fit requests,
including reused requests. This is a cooperative batch budget, not a hard
deadline: a single DOM probe and generator boundary enumeration/sorting remain
indivisible. The same budget applies when idle warmup's 600ms timeout fires.
Foreground and speculative consumers share an in-flight page fit. Cancelling
the preparation generation prevents obsolete measurements/cache publication;
measurement hosts are removed in `finally`. Current live nodes are retained
when a valid spread exists. An interrupted initial fit resumes after its
modal/hidden/resize interruption with a fresh generation. Font changes also
restart initial fitting, preventing memo reuse across typography changes.

The actual DOM baseline is `fitting-performance/run-WKVUeA`, captured before
production fitting changes. The final seven-case run is `run-ZZ5POb` in the
same artifact parent. Ordinary cases use production styles and `renderLayout`.
The unsuccessful pair deliberately has an asymmetric one-line continuation;
it is stress evidence, not a claim that normal source pages have that geometry.

| DOM fixture | Before probes | After probes | After duplicate probes |
| --- | ---: | ---: | ---: |
| Dense prose | 43 | 42 | 0 |
| Narrow prose | 29 | 27 | 0 |
| Successful sparse-pair balance | 20 | 18 | 0 |
| Speaker-label repair | 37 | 36 | 0 |
| Preserved speech/line groups | 41 | 37 | 0 |
| Unsuccessful final-pair search | 2,948 | 1,481 | 0 |
| Oversized Unicode code point | Not in initial baseline | 1 | 0 |

All six comparable interval arrays are exactly unchanged. Final leaves fit;
the oversized emoji correctly retains `[0,2]` with overflow recovery. Tests
check source coverage/maps, speaker orphans, line structure, and safe boundaries.
The unsuccessful case took 1,198.6ms before and 612.5ms in the final helper run;
those are individual observations, not distributions or a universal speedup.
Probe reductions are the stronger evidence; ordinary timing samples were noisy.

The actual production scheduler report is
`navigation-performance/run-x1t1um/report.json`: seven passed cases, zero
renderer errors. A roughly 37k-character dense source exercises idle-timeout cancellation,
foreground/pending cancellation, shared warmup/foreground ownership, and initial
font/resize/hidden/modal invalidation. Shared preparation performs 919 unique
DOM probes with one fitting owner for the dense source. All aborted work removes
its host and commits no stale turn; cache limits and saved/reloaded page 2 are
asserted. Final font/geometry generations each commit once and measure to fit.

In that scheduler sample, recorded batch p95 values were 8.4–8.7ms with maxima
8.5–8.8ms. Measured cancel-request to aborted fitting-host cleanup ranged
2.7–41.7ms across idle, foreground and initial interruption cases. The idle
test's Playwright request-to-cleanup observation was 99ms, including event
delivery/action waiting. These samples demonstrate yielding and cancellation,
not universal latency bounds; raw event timestamps are retained.

A matching production dense-source diagnostic schedules a zero-delay timer at
fitting start, without cancelling or replacing reader handlers. Before:
`navigation-performance/run-rYOqjn`, 1,039 probes, 430.2ms fitting elapsed,
505.0ms until timer delivery. After: `run-FpseUA`, 919 probes, 876.0ms fitting
elapsed, 11.6ms until timer delivery. Each is one observation at 390px/23px on
the same generated source. The yielded path makes event delivery possible
during fitting but can take longer overall due to macrotask scheduling.
This timer diagnostic measures event-loop opportunity, not click cancellation;
the real input and cancellation regressions are listed separately.

## Final verification and artifacts

All paths below are under ignored `output/playwright/` and retain their profiles,
PDF fixtures, screenshots and JSON reports. Failed startup/diagnostic runs remain
retained separately and are not counted as passing acceptance evidence.

| Required check | Result and retained evidence |
| --- | --- |
| Targeted pagination/animation/buffer checks | Independent reviewer ran 45/45; fitting owner ran 34/34 pagination tests |
| `npm.cmd test` | 232/232; `navigation-performance/unit-final.log` |
| `npm.cmd run build` | Passed; production bundle `index-Do6BSpup.js` |
| `node tests/fidelity-audit.browser.mjs` | All #14–#17 passed; `reader-fidelity/run-kEbDYA/report.json` |
| `node tests/structure-audit.browser.mjs` | All six issues and distant Scroll normal/reduced motion passed; `structure-reconciliation/run-Y2Niio/report.json` |
| `node tests/reader-compat.browser.mjs` | Both fixture gates passed; zero errors/deep clones; `reader-fidelity/compat-cA5KQ5/report.json` |
| `node tests/fidelity-desktop.browser.mjs` | Production Electron journey passed; `reader-fidelity/desktop-cIbdvY/report.json` |
| Rapid input after cooperative integration | Passed 22 cases; `navigation-performance/run-XNeI2p/report.json` |
| Production cold work/cancellation | Passed seven cases; `navigation-performance/run-x1t1um/report.json` |
| Real DOM fitting | Passed seven cases; `fitting-performance/run-ZZ5POb/report.json` |

The Electron runner imports the sample, mixed emphasis, speech, mismatched OCR,
Hamlet, Frankenstein, and Nietzsche into a new isolated profile. It covers both
reading layouts, Book/Original recovery, switching, bookmarks/Contents, and
restart. Normal-motion mouse/key burst text and source anchor match two sequential
turns, ending at page 4/offset 744/source item 84:0, then survive restart.
Nietzsche physical page 3 independently remeasures `[0,665]`, `[665,1116]`,
`[1116,1566]` in both browser and production Electron: 665/451/450 characters.

Root inspected production Nietzsche continuation and rapid-burst screenshots,
Hamlet Scroll, Frankenstein Original, narrow emphasis and held-turn captures,
and both distant Scroll screenshots. Text remains readable, verse indentation
and cues remain, and source destinations/continuations are coherent. Existing
ambiguous source OCR and some Hamlet side counters remain as documented in the
previous handoff; they were not silently corrected.

The compatibility and structure runners encountered loopback startup timeouts
before assertions. Fresh ephemeral ports, isolated dependency caches, inert
bootstrap pages and explicit app/layout readiness waits passed. This is test
startup handling, not a product-performance result. The production journey uses
the built app's `folio://app/` origin and retained isolated Electron profile.

Source SHA-256 values before and after the entire verification are identical;
the Electron journey also verifies imported stored bytes against each source:

| Original PDF | SHA-256 |
| --- | --- |
| `public/sample.pdf` | `7c899f8ec82512fa12ef184f37adf0f6b5a4e0929148a4f9fa7b8f3c59f1de5d` |
| `testing_downloads/Hamlet.pdf` | `61b29ecdfc84ebb24e9b919dfcb7faa435f4886d289f34ea3c6191010577e5e3` |
| Nietzsche excerpt | `2e104006044ef9ff47b1b42cca29579ba6e9ff39d203af90cd7dbc0d37a5a2af` |
| Frankenstein scan | `df427fe124295b75244d559f4e3508665d7e450601217a4b8da7287dd6bf9c7b` |

Existing ignored artifacts, PDFs, profiles, and the live shelf were preserved.
No packaging, installation, publication, or GitHub mutation was performed.

## Preservation, limits, and review

No source/PDF/storage schema migration is required. Reliable bold/italic styling,
the reader's base typeface/size, verse indentation, speakers/cues/structural
breaks, conservative metadata, and Original PDF recovery remain intact. No OCR
corrections are guessed. UTF-16 projection strings, contiguous source coverage,
source-map round trips, page-local item indices, bookmarks/Contents, and source
anchors survive navigation, layout/size/resize, reload, and restart checks.

The pager still measures a whole requested source page and may fit the following
page to locate its next anchor; unusually large pages can take substantial total
time across yielded tasks. An individual expensive probe or candidate-building
step can exceed the cooperative budget. The stress search still examines safe
candidates exactly rather than introducing unsafe pruning. Initial hidden state
is emulated deterministically in browser tests; OS background delivery is not
benchmarked. Longer saturated discrete bursts coalesce by the documented input
policy. Original PDF remains the recovery path for unfit or unreliable text.

Root, fitting owner, and independent reviewer were the three peak active agents.
Workers used `gpt-6.1-sol`/high reasoning for async/source-boundary contracts;
usage/cost telemetry was unavailable. Each issue received independent review
before commit. The reviewer caught the initial-style interleaving issue, which
was corrected and covered by rendered regressions. Skill-update audit: existing
delegation/browser guidance sufficed; the needed changes were repository code
and regressions, so no skill revision was justified. No memory files changed.
