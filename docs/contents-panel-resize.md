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

1. Interaction: in progress.
2. Responsive coherence: pending.
3. Robustness/accessibility: pending.
4. Performance/maintainability: pending.

## Validation and limitations

Baseline synthetic fixture: `output/playwright/contents-navigation-before-mKaDnz/`. UX width probes: `output/playwright/contents-navigation-after-Ndaxpv/`. These are synthetic documents, not evidence of arbitrary PDF behavior. Final validation and publication pending.

### Round 1 completed

Implemented live grid resizing, separator keyboard/ARIA, pointer capture and cancellation, and bounded pure helpers. Initial browser run `contents-resize-IeXUqa` passed seven checks. Observation then reproduced no-movement preference loss (`contents-resize-LiSvXd`, eight pass/one fail) and a divider that scrolled away from the sticky rail. Refinement criteria: clamping followed by a click must restore the original 480px preference on a wide viewport; divider and rail must retain identical top/bottom coordinates after document scrolling. Revised implementation preserves preference for unchanged effective width, clears interrupted keyboard resize state, and uses a sticky separator in the rail grid cell. Revised browser run `contents-resize-vwMVKB` passes ten checks with 16 screenshots and no page errors. Independent UX rerun `contents-navigation-after-vGMZeB` confirms both fixes and painted content. Source suite:280 pass/one existing skip; production build passes. Remaining planned work: narrow toolbar, click alternative, exact scroll anchors, performance and full regression matrix.
