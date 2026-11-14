# Subtle ephemeral focus exit cue

Status: planned locally; not published
Branch: agent-work

## Problem and scope
Show a lightweight clear Escape-to-exit cue on entering focus. Fade quickly and avoid consuming reading space. Coordinate with immersive mode, accessibility and reduced motion.

## Acceptance and verification
Entry/reentry, keyboard/mouse focus, timing, contrast, no layout shift, cue not stuck after exit.

## Coordination
Single integrator owns shared-file changes. Ticket orchestrator supplies a patch and tests; communicate design contracts before touching shared reader state. No push, PR, issue creation or deployment.
