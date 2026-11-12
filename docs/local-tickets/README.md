# Local engineering tickets

No external issues are published. All integration targets local `agent-work`, based on main 9ba3bbe. Existing documentation PR work is isolated.

## Ownership and communication
- Immersive orchestrator owns focus UI design and its patch.
- Page-identity orchestrator discusses alternatives with UX critic before implementation.
- Navigation orchestrator owns transition semantics.
- Root integrator serializes all changes to main.js/index.html/styles.css and runs final checks.
- Escape cue is a separate ticket coordinated after the immersive contract.
- Reflow is assessment-only until justified.

Each worker reports files, assumptions, tests, and exact unresolved risk. Never overwrite another worker's changes. Use isolated copies/worktrees or patches; only integrator changes shared branch.

## Integrated outcome
1. Immersive focus: implemented locally; animation/browser acceptance pending runtime access.
2. Source-page identity: implemented after recorded Socratic discussion (`../page-identity-decision.md`).
3. Next/Escape: preserves in-flight and coalesced navigation before changing focus layout.
4. Exit cue: implemented, fades after two seconds; touch-specific exit instructions.
5. Reflow: assessed, scoped follow-up only; no source-boundary changes.

## Review and testing contract
Changes are committed locally, not published. Browser test files are executable acceptance specifications, not evidence of a passing run. See `verification.md` for final checks and blockers.
6. Contents placement: implemented locally with horizontal handle dragging, keyboard controls and viewport bounds; no reader reflow.
