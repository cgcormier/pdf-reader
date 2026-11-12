# Animated immersive fullscreen

Status: planned locally; not published
Branch: agent-work

## Problem and scope
Hover/focus on the focus control reveals a downward animated immersive-mode icon. Activate an uncluttered full-screen reader with only book and one source-page number; deepen book shadow. Preserve normal focus. Keyboard/touch access, reduced motion, safe fullscreen failure, fast reversible animations.

## Acceptance and verification
Repeated hover/leave, keyboard/touch activation, Escape/native fullscreen exit, resize, rendering modes, imported PDF and reduced motion. At least two UX/critical review passes.

## Coordination
Single integrator owns shared-file changes. Ticket orchestrator supplies a patch and tests; communicate design contracts before touching shared reader state. No push, PR, issue creation or deployment.
