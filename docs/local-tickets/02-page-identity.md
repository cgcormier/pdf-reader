# Clarify source page versus reflow leaves

Status: planned locally; not published
Branch: agent-work

## Problem and scope
Before implementation, record Socratic discussion among agents about source page identity, continued leaves, source PDF navigation, and unobtrusive labels. Implement the best small consistent solution.

## Acceptance and verification
Source-page navigation stays stable across reflow, font size, scroll/book modes, multi-leaf source pages and imports.

## Coordination
Single integrator owns shared-file changes. Ticket orchestrator supplies a patch and tests; communicate design contracts before touching shared reader state. No push, PR, issue creation or deployment.
