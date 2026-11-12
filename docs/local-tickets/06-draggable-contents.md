# Move the contents window horizontally

Status: implemented locally; not published
Branch integration target: agent-work

## Request and design
Carter requested left/right dragging of the contents window. Add a dedicated accessible heading handle, not resizing. Keep the existing desktop reader column unchanged while the panel overlays the reader with an opaque surface. Session-only position avoids persisting an accidental layout.

## Acceptance
- Drag only the 32px heading handle (44px for coarse pointers); contents text/links retain normal scrolling and selection.
- Pointer capture retains drag outside the handle; cancellation and capture loss end cleanly.
- Arrow Left/Right move 20px, Home resets; prevent reader page-turn shortcuts from receiving those keys. Preserve modified browser keys.
- Clamp full panel inside viewport on movement, resize and visible mode changes.
- Preserve mobile drawer transform/visibility and focus-mode hiding; never clamp hidden zero geometry.
- No width changes, reader reflow, or persistent storage.

## Review and verification
Immersive-focus sibling reviewed geometry, shortcut conflict, touch behavior and stacking. Fixed bubbled transition events cancelling active drags; modifier keys bypass the handler.
`node --test tests/contents-drag.test.mjs`: behavioral DOM fixture verifies keyboard, bounds, pointer capture/cancellation, resize, hidden-state preservation, independent drawer transform and cleanup.
`tests/contents-drag.browser.mjs`: browser regression for pointer/keyboard layout, mobile clamp/close/reopen and runtime errors. Browser launch attempted with /usr/bin/chromium and blocked by process socket restrictions (Operation not permitted); no visual pass claimed. Production build and git diff check passed.

## Coordination
Isolated ticket/contents-drag worktree. Integrator alone merges main.js import/setup changes into agent-work. No push, issue, PR or deployment.
