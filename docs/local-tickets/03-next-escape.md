# Preserve navigation across focus exit

Status: planned locally; not published
Branch: agent-work

## Problem and scope
Next immediately followed by Escape currently cancels the pending turn. Determine intended state semantics and ensure a committed navigation intent survives focus exit without duplicate turns or stale render.

## Acceptance and verification
Next/Escape timing variants, repeat Next, reverse, reduced motion, mode changes and persistence.

## Coordination
Single integrator owns shared-file changes. Ticket orchestrator supplies a patch and tests; communicate design contracts before touching shared reader state. No push, PR, issue creation or deployment.
