# Resizable Contents implementation

Status: in progress on `feature/contents-panel-resize`, based on completed Contents reconstruction `45f9f87`.

## Shared contract

The workspace grid owns `--sidebar-width`; the reader receives its remaining column. A workspace-sibling separator sits over the trailing rail edge, with a 24px target and restrained visible grip. No column transition. Desktop minimum Contents width is 260px; maximum is min(480px, workspace width minus 560px). These limits follow actual long/nested-outline and Book-page inspection by the independent UX lead. At <=820px the existing drawer replaces the columns; there is no mobile resizing gesture. The 821px boundary has a deliberately small resize range.

Default width remains responsive 280/270px. A user choice is a session preference distinct from viewport-clamped effective width; persistence is not initially introduced. Keyboard Left/Right adjusts 16px, Shift adjusts 48px, Home/End reach bounds. Separator reports accessible name, orientation and current/min/max pixel widths. Escape and pointer cancellation roll back; outside release commits; unexpected capture loss commits the last width and always cleans up. Breakpoint/focus-mode interruptions clean up before the existing render.

Pointer updates change CSS at animation-frame cadence; Book/pages retain painted content during adjustment and refit after settling. Existing source anchors must survive repagination; scroll uses the existing source capture/restore machinery. Original PDF canvases resize through CSS without repeated rasterization. No dependencies, storage migration or second mobile gesture.

## Ownership and review

Root owns this record, contract, Git checkpoints and publication. `/root/interaction` owns main.js and resize helper/unit tests. `/root/layout` owns index.html and CSS. `/root/browser` owns new browser regression infrastructure. `/root/ux` owns research and independent experience reviews in contents-resize-ux.md. Root alone starts/resumes agents; ceiling eight including root, with fresh exact-commit review capacity reserved.

## Four rounds

Each round requires implementation, actual browser observation, a UX/implementer-agreed observable refinement, reimplementation, repeated checks and independent UX verdict. Evidence will be added as completed.

1. Interaction: completed; sticky alignment and no-op preference refined.
2. Responsive coherence: completed; toolbar layout and breakpoint focus refined.
3. Robustness/accessibility: completed; bound focus, chapter opening and interruption cleanup refined.
4. Performance/maintainability: initial no-op optimization verified; navigation and pending-frame refinements under validation.

## Validation and limitations

Baseline synthetic fixture: `output/playwright/contents-navigation-before-mKaDnz/`. UX width probes: `output/playwright/contents-navigation-after-Ndaxpv/`. These are synthetic documents, not evidence of arbitrary PDF behavior. Final validation and publication pending.

### Round 1 completed

Implemented live grid resizing, separator keyboard/ARIA, pointer capture and cancellation, and bounded pure helpers. Initial browser run `contents-resize-IeXUqa` passed seven checks. Observation then reproduced no-movement preference loss (`contents-resize-LiSvXd`, eight pass/one fail) and a divider that scrolled away from the sticky rail. Refinement criteria: clamping followed by a click must restore the original 480px preference on a wide viewport; divider and rail must retain identical top/bottom coordinates after document scrolling. Revised implementation preserves preference for unchanged effective width, clears interrupted keyboard resize state, and uses a sticky separator in the rail grid cell. Revised browser run `contents-resize-vwMVKB` passes ten checks with 16 screenshots and no page errors. Independent UX rerun `contents-navigation-after-vGMZeB` confirms both fixes and painted content. Source suite:280 pass/one existing skip; production build passes. Remaining planned work: narrow toolbar, click alternative, exact scroll anchors, performance and full regression matrix.

### Round 2 completed

Implemented a toolbar container query: at narrow reader widths the controls occupy two rows with whole labels, without changing visible or measured page typography. Initial browser run `contents-resize-99GkLh` passes 34 checks (24 size/mode/theme matrix cases), 40 screenshots, no errors. UX independently checked 821px, short desktop, and the 640px container threshold; no cosmetic revision was justified. Observed remaining mismatch: focused divider became body focus on mobile crossing. Refined breakpoint handling includes the sibling divider and transfers focus to Contents. Independent `contents-navigation-after-xryFSU` confirms toggle focus, keyboard drawer opening, Escape cleanup and preferred480 restoration. First checkpoint fresh review found no actionable findings; independent helper3/3 pass, archived browser setup failed before feature checks with Invalid workerSrc type (validation limitation).

The longer browser sequence exposed a CSS-hide-before-media-callback focus race (`contents-resize-KJJ2sw`). The refinement retains separator focus only across hiding at the mobile breakpoint, clears it on ordinary focus departure, and consumes it on transition. Bounded browser `contents-resize-jAODeM` passes both focus-transfer and no-focus-steal checks. Independent UX `contents-navigation-after-bGncjI` passes eight exact1000-to820 crossings and deliberate focus departure. The earlier standalone pass alone was insufficient.

### Round 3 completed

Implemented same-row Narrow/Widen pointer controls and source-aware Book/scroll settlement using existing anchor helpers. Actual observation exposed three mismatches: native disabled buttons lost focus at a bound; source capture above the first text line skipped chapter decoration; opening help left an active drag behind the modal. Refined controls use aria-disabled with guarded activation, capture only text crossing the reading line, and shared interruption cleanup releases capture/class/frame/timer and defers interrupted Book fitting. Independent UX verifies stable bound focus, unchanged chapter titleY327.19/scrollTop1 and actual mid-drag ShiftTab-to-help/Enter/Escape cleanup. Browser `contents-resize-F17IfT` passes12 robust checks/15 screenshots/no errors: nonzero Bookscroll source585 retained, paged continuation1066 retained, Original page/fraction, CDP touch, cancellation/lost capture, both motion settings and synthetic hidden-state cleanup. Physical touch and real OS interruption remain untested. Round2 full refined core `contents-resize-MEh38o` passed12 checks/18 screenshots; fresh review153ffd3 found no actionable findings with helper3/3 pass.

### Round 4 completed: unnecessary work and cancellation

Initial profiling (`contents-resize-9yNRyQ`) showed a no-movement separator click replaced Book DOM and started fitting. Deferred resize work now begins only on effective width change; `contents-resize-itGG1X` retains DOM with zero fitting/commit events for a click. Repeated real Hamlet drags preserve painted surfaces with no fitting during drag. Observation then found cancellation before the first queued frame could flush and abort fitting without preparing later navigation. Refinement discards unpainted pending width on rollback. Independent UX `contents-navigation-after-3iOAsH` confirms modal cancellation leaves width280 and Next paints page2. No cosmetic cleanup or new dependency was justified.

### Round 5: explicit navigation during resize settlement

Added after the user's instruction to continue until reviews find no actionable issue. Fresh review of84a7588 and actual UX `after-mLNGP6` found that Contents47 could leave stored Book source17 when a resize debounce restored an old anchor. Initial navigation interruption fixed far navigation/reload, but further tests examined queued observer/measurement and paged-turn timing. Refinement discards the superseded resize anchor, synchronizes scroll measurements before an explicit jump, clears stale lastNotified on jump, and waits for Book refitting before executing an immediate page-turn command with book/epoch/mode guards. Unit tests reproduced the pending ResizeObserver bug before the fix and cover changed height prefixes. Paged Next and newer destination supersession independently pass `after-EUK8n9`.

An apparent repeated near-Next failure was an invalid test premise: the focused page input intentionally retained typed17 while live reader position differed. The harness now blurs the input and reads live progress/source geometry. That earlier near-failure alone is not product evidence; the independently reproduced stale stored anchor and pending-observer unit failure are. Final corrected browser and isolated profile results pending.

Corrected final behavior run `contents-resize-g2UIaI` passes53 checks/62 screenshots/no page errors. Navigation `contents-resize-1EATKo` passes all5 cases and independent review closes the stale-anchor finding. Existing Contents regression `contents-navigation-after-8FUDy6` passes37 checks/38 screenshots after correcting a fixture wait for a title inside the intentionally closed mobile drawer. Display suite `display-suite/run-Anfq9C` passes84 cases with zero product or harness failures. Ten focused helper tests pass after navigation refinements; broader source/build refresh pending final edits.

### Round 6: large-outline performance (in progress)

Final isolated profile `contents-resize-gdl6Rr` passes7 functional checks/11 screenshots. No-op fitting/commits are zero. Real144-page Hamlet preserves original stored bytes and active surfaces in all4 mode/layout combinations. Six Book/page drags show framep95 16.7-17.2ms and settle334-483ms. However the synthetic632-node outline shows repeated framep95 83.3-83.4ms. This is treated as an actionable measured mismatch, not universal smoothness. A bounded diagnosis compares layout/paint costs and temporary CSS containment while preserving full attached DOM, navigation and accurate settled geometry. No product change selected yet.
