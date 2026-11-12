# Local integration verification · 2026-11-12

Branch: `agent-work`, based on `main` at `9ba3bbe`. No push, PR, deployment, external issue or publication performed. Existing docs transition checkout left intact.

## Executed and passed
- Baseline: 270 unit tests and production build.
- Final integration: `npm test`: 290 passed, zero failed/skipped.
- `npm run build`: passed; PDF fonts, character maps and offline asset list generated.
- `npm run test:display:oracle`: passed, detects injected text, role, visibility and anchor failures.
- `git diff --check`: clean.
- Async immersive tests cover native rejection, late completion, overlapping enter/exit, keyboard exclusions and cleanup.
- Settlement tests execute the actual helper with mocked browser boundaries: animation finishing, preparation wait, queued turn, cancellation and flag reset.
- Cue tests cover timers, idempotent events, reduced-motion CSS and touch instructions.

## Browser acceptance remains blocked
New Playwright suites: immersive-focus, focus-navigation, page-identity and focus-exit-cue. Browser-native navigation harness also included. These are test specifications, NOT passing browser evidence.

Installed Chromium aborts before any assertions with `socket() failed: Operation not permitted (1)`. Approved escalated launch has the same failure. Switching to the sole connected cloud computer sees the same repository but does not remove the restriction. CUA browser cannot reach the local Vite preview (connection refused). The existing Chrome-channel suite also lacks its expected Chrome binary. No visual screenshot or interactive pass is claimed.

Run in a browser-capable environment, for example:

```sh
BROWSER_EXECUTABLE=/path/to/chromium node tests/immersive-focus.browser.mjs
BROWSER_EXECUTABLE=/path/to/chromium node tests/focus-navigation.browser.mjs
BROWSER_EXECUTABLE=/path/to/chromium node tests/page-identity.browser.mjs
BROWSER_EXECUTABLE=/path/to/chromium node tests/focus-exit-cue.browser.mjs
```

Then run existing navigation, PDF-layout, offline, bookmark-persistence, recovery, display and desktop suites with their supported browser setup. Unit/build success does not establish PDF rendering, browser storage persistence, Electron behavior, visual polish or fullscreen interoperability.

## Review and integration
Four independent orchestrators worked in isolated worktrees. The integrator alone reconciled shared main.js/index.html changes in sequence. Source-number alternatives were debated before implementation; rationale is in `../page-identity-decision.md`. Immersive UX received two static critical passes and a final cross-module async review. Fixes include touch target size, keyboard exclusions, shadow breathing room, stale fullscreen completion, serialized focus transitions and native-fullscreen resize preserving navigation.

## Remaining risks / scope
- Animation timing, shadow appearance, focus restoration and native Escape behavior need actual browser review before release.
- Immersive mode deliberately hides toolbar/navigation controls; keyboard arrows and existing touch swipe navigate, single page number exits. Mouse-only discoverability deserves hands-on review.
- Source-page identities remain stable even when several reflow leaves share them.
- Ticket 05 is an assessed typography follow-up, not a reflow algorithm change.

## Contents-drag follow-up
Integrated ticket 06 at `7f17ac9`. Final unit suite now **293 passed**, production build passed, diff check clean. Dedicated handle supports pointer/touch capture, 20px keyboard arrows and Home reset, and session-only viewport-clamped placement without resizing or reader reflow. Independent static review addressed modified shortcuts, bubbled child transitions and mobile slide-out geometry. Three mocked-DOM behavior tests cover bounds, hidden geometry, pointer cancellation and resize; browser spec is `tests/contents-drag.browser.mjs`. Browser acceptance remains pending the separate visual check; these unit results do not establish appearance.
