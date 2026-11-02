# October 2026 audit: local integration and review

Task branch: `fix/october-audit-completion`, starting at `c2eb22186d871757e43c3ec2a76e224f7fcaf118`.
On November 2 the checkout was clean and 19 commits ahead of local main.
GitHub connector confirmed main `284cdea044b4fac7c3e1d37a518d4c770e2f584c`, tracker #3 and children #4-#26 open, with no comments. Git transport returned repository-not-found; connector reads succeeded. No remote mutation is part of this task.

This document is the acceptance ledger and handoff. All 96 saved criteria appear below with a disposition and evidence boundary. Historical handoffs are not final acceptance evidence.

## Ownership and review ledger

- Root: #8/#21 main wording; #22 settled capture, portable/real gate and production journeys; docs; integration; lane C security/build/offline review.
- `performance`, gpt-6.1-sol/high: #23 runner and budget implementation; later independent lane B review. No production-code ownership.
- `inventory`, gpt-6-luna/high: #24-26 classification, asset README/ignore rule, criterion and tracked-surface inventory.
- `review_rendering`, gpt-6.1-sol/high: independent lane A and root runner review; independent housekeeping review. Read-only.
- Maximum simultaneous active agents: three including root. No descendants. Serial timing window reserved for performance; other agents restricted to lightweight reads/docs; code frozen during measurements. Prices/token usage unavailable. The capable model is used for source maps, async state and subtle browser review; the economical model handles mechanical inventory.

## Capture discrepancy and corrected gate

`output/playwright/reader-fidelity/desktop-Mlub1L/report.json` reproduces the historical Hamlet capture failure on unchanged production baseline. Correct page 10 leaves contained 363 characters before/after full-page capture; page 20 contained 522 and page 50 contained 427. Full-page PNGs were 1425x1102 despite 1440x900 viewport and showed empty paper. Viewport PNGs after settling showed readable correct source content. Resize events occurred during the capture sequence. This supports capture-induced resize/reflow; it does not establish a persistent blank reader defect or prove all earlier screenshots correct.

`tests/reader-capture.mjs` checks current source destination, nonempty rendered body/canvas, settled geometry, fixed viewport capture, unchanged post-capture content and contrast in each visible leaf's text/canvas bounds. Electron asserts expected Hamlet text on pages 10/20/50 before capture. Negative controls hide both/right-only prose on light/dark paper and must reject those captures. Visual inspection remains required: pixel contrast alone cannot certify semantic fidelity.

Independent review found and root repaired baseline-mode false acceptance, dark-background-as-ink, pooled spread ink hiding a blank leaf, and missing visible text bounds on a leaf. These were gate defects; no source text/offset contract changed.

## Repeatable rendering matrix

Run `node tests/audit-gate.mjs` for serial portable core: Node tests, production build, deterministic fixture generation (never `--sample`), recovery #5/#7, visible scan fallback, structure #6/#9/#10/#11/#12/#13, fidelity #14/#15/#16/#17, compatibility layouts, actual Electron security/restart and expanded fidelity journeys, and server-stopped production browser offline recovery. Reports/logs live in a unique ignored `output/playwright/audit-gate/run-*` directory. It rejects diagnostic baseline or alternate executable/origin/sandbox overrides, records input hashes, uses finite per-command timeouts and stops only its own timed-out process tree.

The structure/fidelity fixtures cover numeric scans, structural-keyword prose, modest headings, combined/split/noisy headers, coherent title hierarchy/counts, styled runs, verse/speech, intentionally mismatched OCR and exact 48/65/74 tails. Unit/DOM checks conserve canonical UTF-16/source ranges. Browser matrices cover desktop/narrow and 13/19 px (compatibility also 10/17/23 px), both layouts; Electron core covers 17/19 px, both layouts/views, restart, switches, bookmarks, Contents, source anchors, byte hashes, normal/reduced motion, repeated mouse/key input, cancellation and CDP native touch/pen events. Native physical touch and OS accessibility settings are separate unperformed checks.

For the explicit real matrix set `FOLIO_FRANKENSTEIN_PDF` and `FOLIO_NIETZSCHE_PDF` to local original files, then run `node tests/audit-gate.mjs --real` (or targeted fidelity desktop/browser `--real`). Missing required external files are incomplete with nonzero exit, never portable-core success. Sample and Hamlet are required committed fixtures. The original audit's A Little Book of Light is the bundled sample journey. No external PDFs are copied into source control.

## Confirmed review findings

- **Zero-page adoption (P2, reproduced):** `supplemental-journeys/run-dc6Rao` imports a valid zero-page PDF, saves/activates it, then displays the demo's eight-page count and an unrenderable Original page. The intended boundary is that an opened reader document has at least one source page. The independently reviewed repair validates `openPdf` before handing ownership to callers and disposes an empty loading task; import/reopen must retain the current book and existing saved bytes. Consumers include both main import/reopen paths and no-signal analysis/test callers. Existing empty records remain retained and fail to open clearly; no storage migration or deletion is needed. Targeted R7 and the fresh integrated G passed import/reopen preservation; F also verifies rejection without a signal and exact input bytes. Earlier G `audit-gate/run-xqTkP8` is superseded by the post-repair gate below.
- **Capture false acceptance:** full-page Electron screenshots could trigger resize/reflow and show blank paper despite valid pre-capture DOM. Fixed viewport captures now check settled destination, unchanged geometry/content and contrast on every visible leaf. Blank light/dark spread and right-leaf negative controls exercise rejection.
- **Asynchronous readiness false acceptance:** installed Playwright 1.61.1 `waitForFunction` treats an asynchronous predicate's Promise as truthy before its resolved value is known. The traced `reader-fidelity/run-rSXiGK/report.json` records both imports passing the old completed-scan wait with stored status `pending` and zero scanned pages. The first integrated run consequently sampled an empty placeholder during a scan-triggered render. The shared bounded `waitForAsync` helper polls resolved results, including persisted scan/anchor state; fidelity snapshots validate readiness and ranges atomically. Eight unit cases and real-browser false/false/true and never-true controls cover this regression. This is a harness repair, with source-continuity assertions retained.
- **Offline cache update defect (P2):** the build hashed asset names and index.html but missed content changes at stable public URLs. `scripts/asset-version.mjs` now includes the sorted paths, byte lengths and bytes in the service-worker version. Its regression test covers same-path byte changes, ordering, removal and missing assets. No PDF bytes were changed to test it.
- **Ephemeral-port assumption:** Vite's `port:0` fell back to its default port in the fidelity/fitting runners. Both now reserve an OS-selected TCP port and require that port; the live development origin remains untouched.
- **Design-book viewport state (P3):** the initial Desktop selection displayed both variants, and its before-print handler permanently unhid both after printing. The initial mobile frame is now hidden; existing print CSS displays both without mutating screen state. Native browser toggles and emulated print/return passed for all 12 previews in `design-book/run-OKggyo/report.json`, served through the existing static server. OS print dialogs were not tested. Earlier Vite navigation/action timeouts remain failed diagnostics.
- **Harness startup and geometry:** the fitting runner retained Vite's recursive root watcher, unlike navigation. Two candidate bootstraps timed out before any metric. Diagnostic `bootstrap-diagnostic/run-UivwK6` reached the valid page but used 80.8 CPU seconds and shut down slowly; the equivalent `run-KkF5oo` with watching disabled reached load in 1.4 s and closed in 1.8 s. This supports watcher overhead, not certainty about both individual timeouts. Fixed-input Vite runners now use `watch:null`; fitting was recalibrated under the new runner hash before N/P evaluation. Legacy UI checks also now compare shelf SVG dimensions with a 0.05 CSS-pixel rounding tolerance (an injected 1 px distortion fails), and await actual tooltip visibility within 1 s (a persistently hidden tooltip fails). No product CSS or performance limit changed.
- **Explicit containment reporting:** the unavailable Windows file-symlink subcheck is a separate TAP skip. A new own-temp directory-junction request independently proves external realpath targets return 404 without changing permissions.
- **Public documentation:** README/PLAN now describe 160 ms turns, bounded pending input, automatic Contents and retired manual metadata correctly; earlier dated measurements remain historical.
- **Legacy capture destinations:** scan and desktop-smoke runners now allocate unique ignored capture directories. The earlier scan runs wrote seven fixed `output/playwright/recovery/*.png` destinations. There are no before-run copies/hashes for those seven files, so their earlier contents cannot be verified or restored. Current files are retained. This preservation exception is separate from the 26 tracked captures, whose local bytes were verified unchanged.

The trace-only run also reported a diagnostic observer's access to localStorage on about:blank; that observer was removed. It is not accepted as a passing run. The first diagnostic setup timeout and all partial reports are retained. Each retry changed the hypothesis or the defective harness; no source assertion or budget was weakened.

The next full gate stopped at the newly introduced 30s import setup deadline. A targeted unchanged-deadline trace (`reader-fidelity/run-cCv6JM`) then passed #14 and measured 8.386 s for the initial PDF.js module plus 20.070 s for its worker request. Cold import setup now has the existing compatibility/navigation runners' bounded 90 s allowance; ordinary interaction waits remain 30 s. This setup allowance is outside performance measurements and does not change regression budgets. `RECOVERY_ISSUE` overrides are rejected so an inherited diagnostic selection cannot silently replace one required recovery group.

## Fresh verification

`node tests/audit-gate.mjs --real` passed all 12 serial checks in G, including 250 passing Node cases and one explicit unavailable file-symlink skip, a fresh production build and actual Electron runs. No child timed out. The gate records commit 9d91e66 plus per-input hashes for the uncommitted candidate; final hash reconciliation binds all 75 tested inputs to the final checkout; only documentation changes follow this run. Earlier failed gates remain under their own directories, never relabeled as passes. The earlier successful pre-zero-page G is retained as historical evidence. Final performance comparison and independent integration signoff are recorded separately below.

Paths in this table are relative to `output/playwright/`:

| Evidence | Exact command/check | Result / retained artifact |
| --- | --- | --- |
| G | `node tests/audit-gate.mjs --real` | passed; `audit-gate/run-cUQWQ2/report.json`, per-command 0.log–11.log |
| U | `node --test tests/*.test.mjs` (same as `npm.cmd test`) | 250 passed/1 skipped/0 failed; G/0.log; includes byte/source/Unicode/state/cache/build/readiness/budget regressions. file-symlink creation is the explicit skip; the directory-junction containment case passed |
| B | `node scripts/build.mjs` (same as `npm.cmd run build`) | passed; G/1.log. No distribution package |
| Fixtures | `node tests/create-fixtures.mjs` | passed; G/2.log; no `--sample` |
| R5 | `node tests/reader-recovery.browser.mjs 5` | passed actual Electron; G/3.log |
| R7 | `node tests/reader-recovery.browser.mjs 7` | passed actual Electron; G/4.log |
| Scan | `node tests/scan-fallback.browser.mjs` | passed actual Electron; G/5.log, `recovery/run-Ec5Amb/` |
| S | `node tests/structure-audit.browser.mjs` | all 6/9/10/11/12/13 groups passed; `structure-reconciliation/run-rWgv15/report.json` |
| F | `node tests/fidelity-audit.browser.mjs --real` | all 14/15/16/17 groups passed; `reader-fidelity/run-Vttpml/report.json` |
| C | `node tests/reader-compat.browser.mjs` | both layout/page-flip HTML suites passed; `reader-fidelity/compat-vyXmpZ/report.json` |
| Smoke | `node tests/desktop.browser.mjs` | passed actual Electron; G/9.log, `desktop-smoke/run-u7eOzR/desktop-smoke.png` |
| D | `node tests/fidelity-desktop.browser.mjs --real` | passed actual Electron, 34 validated captures, 4 blank-capture negative controls, no renderer errors; `reader-fidelity/desktop-PCSm7G/report.json` |
| O | `node tests/offline.browser.mjs` | passed cached production browser reload with its server stopped, Book/Original and exact bytes; `offline/run-znFTqq/report.json` |
| Design | ignored `october-audit-20261102/design-book-check.mjs` | all 12 previews passed native toggles/emulated print/return; `design-book/run-OKggyo/report.json` |
| Supplement | ignored `october-audit-20261102/supplemental-journeys.mjs` | passed existing UI helpers and actual Electron empty/encrypted recovery; `supplemental-journeys/run-gMi9VM/report.json` |
| I | metadata/classification/hash/consumer inventory | `october-audit-20261102/mechanical-inventory.json` and `.md`; six snapshots/patch reconciliation |
| Negative gate | missing real inputs, baseline override, inherited recovery override | explicit incomplete/rejection; `october-audit-20261102/gate-negative-checks.json`, `recovery-override-negative.json` |

Real inputs were the existing local Frankenstein and Nietzsche PDFs, plus committed sample/Hamlet. D verifies original-byte SHA-256; the starting manifest is `october-audit-20261102/pdf-hashes.json`, and `final-preservation.json` confirms all 4 original PDFs and 26 retained captures still match. F covers 13/19 px at desktop/narrow (OCR adds 23 px/320 px); C adds 10/17/23 px; D covers desktop/narrow 17/19 px with source numbering, accessible names, restart and switching. Browser tests and Electron evidence are not interchangeable.

Earlier representative visual review sampled S prefatory/distant-Contents and keyword/header cases, F Hamlet Book/Original, and D numeric scan status, narrow emphasis, dark sample, OCR Original, real Frankenstein Original and Nietzsche balanced tail. Layout code was unchanged by the later empty-PDF rejection. Root freshly inspected final D Hamlet 10/20 and the supplemental encrypted full-restart capture after that repair. The negative dark right-leaf capture was also inspected and its right-only lost ink independently checked. Root also inspected both O offline Book/Original captures. These inspections support the specified content/geometry assertions, not a claim that every saved image or every possible PDF was manually reviewed.

## Artifact retention (#24-26)

All 26 tracked `.playwright-cli/page-*` files were individually classified (13 PNGs visually inspected and 13 generated accessibility YAML snapshots). They are timestamped Readwell design-book captures from 90ef1a8, with no golden/test/source consumers. `design-book/` retains the authored source and intentional assets. Independent review confirmed all 26 hashes. Only Git tracking is removed; local bytes stay, with `.playwright-cli/` ignored. Exact list/hashes: `output/playwright/october-audit-20261102/mechanical-inventory.json`.

`testing_downloads/README.md` documents Hamlet's consumers and retained bytes; `download.jpg` is a stack-of-books image, first committed 9f36105, with no known consumer or original license/source record. Unknown provenance is explicit; it is retained in place.

| Ignored category | Reproduce / retention |
| --- | --- |
| Synthetic PDFs | `node tests/create-fixtures.mjs`; existing output preserved; do not regenerate public/sample.pdf |
| Browser/Electron reports, screenshots, logs | Runners above and historical handoffs name commands; preserve successful and failed evidence; timing must be serial |
| Profiles/shelf/PDF copies | Private local-only data; metadata inventory only, contents not read; do not commit/upload/delete |
| `contents-repair-baseline/` six source snapshots | Exact hash match to historical Git blobs at 90ef1a8; retain, no disposal authorized |
| `contents-index-stage-20261023.patch` | Contents Edit removal reflected in current index; reverse-apply context stale after later edits; preserve original patch |
| `desktop-browser-check.mjs`, `desktop-portable-check.mjs`, structure verify scripts, transfer Markdown/archives | One-off diagnostics/local handoff; path/packaging assumptions retained. Maintained fidelity/compatibility runners already cover reusable journeys; no duplicate promotion justified |
| `dist/`, `release/`, dependency/cache directories | Build output via npm build; release is historical packaging, not rebuilt here; preserve existing release/assets |

Inventory uses metadata and selected authored files, never private profile databases. No blanket cleanup, stash/reset, asset moves or disposal.

The preservation exception for seven confirmed legacy recovery PNG destinations is recorded above. The old fixed `output/desktop-smoke.png` has modification time 2026-10-24T23:39:44Z; both early failed gates stopped before smoke, and successful gates used unique paths. Its pre-run hash was not captured, so this is metadata/execution evidence, not an exact-byte historical guarantee. New maintained runners write to unique run directories. Existing PDFs, captures removed only from Git tracking, snapshots, patches, user profiles and release files remain retained; test-created disposable profiles follow their inspected runner cleanup, while retained run profiles are ignored.

## Security and dependency disposition

The retained npm audit snapshot has 15 moderate development-package entries tracing to minimatch GHSA-g3hv-75wg-m249; zero production advisories. [Maintainer advisory](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249) describes attacker-controlled glob amplification. Observed uses are electron-builder packaging patterns from repository config, not imported PDF text. Packaging is out of scope and dependencies are unchanged; do not use npm's suggested downgrade to electron-builder 20.23.1 as a blanket repair. Raw npm audit and installed tree retained in the run inventory directory. This is a bounded reachability assessment, not a guarantee that all dependencies are vulnerability-free.

Custom protocol source review covers host/credentials/port, method allowlist, decoded traversal/NUL/backslash rejection, realpath containment (including symlinks), MIME/CSP and no arbitrary file exposure. Electron source denies external navigation/popups/webviews/permissions with sandbox, context isolation and no Node integration. HTTP source is loopback, read-only built assets and health endpoint with realpath containment. Imported text uses DOM text nodes; design-book innerHTML receives its authored static constants, not PDF/user strings.

## Contracts and handoff

No source-map, pagination model, bytes or persisted-record migration. The empty-document guard enforces the existing reader requirement for a source page; successful-document ownership is unchanged, and invalid old records remain retained. One source page per leaf and page-local balancing remain; original bytes, UTF-16 offsets, source anchors and legacy records retained. Rollback is previous code/build with the shelf preserved, never a storage reset. Local commits require independent review and passing relevant checks; no pushes, merges, issue writes, releases, packaging or installs.

Skill audit: budget-orchestrator, Playwright and narrow UI guidance fit this task. Defects belong to repository code/tests/docs; no global skill/memory update is justified or performed.

## #23 implementation and evidence handoff

**Accepted final sequence:** N and P below passed after the readiness, watcher and empty-document repairs. Earlier within-task calibration/candidate reports remain retained but are superseded. The unchanged budget policy was frozen before either accepted candidate.

Files: tests/navigation-performance.browser.mjs, tests/fitting-performance.browser.mjs, new tests/performance-gate.mjs, new tests/performance-gate.test.mjs. No production code changes in this lane.

Calibration policy frozen before candidate evaluation: each case gets three samples; timing maximum = baseline observed maximum *1.5 +40 ms, long-task maximum/total allowance +50 ms. These are runner-local scheduling tolerances, not universal machine targets. Budgets are exclusive-create files and require pre-candidate timestamp, identical policy, runner/dependency hashes, hardware/OS/Node/browser/environment and verified Long Tasks capability. Missing/incomplete observations fail rather than being interpreted as zero. Source commit/ref and per-source hashes are retained separately to permit intentional source changes. Source validation and watcher repairs superseded earlier within-task calibrations; no candidate measurements ran in the two failed bootstraps, and thresholds were not relaxed. Candidate source was frozen by root for the serial window.

Portable work/semantic gates enforce <=160 ms requested normal animation duration; ordinary turn <=128 fitting probes/<=512 measured reads and no prepared-turn fitting; fitting helper <=64 ordinary or <=1800 unsuccessful-search probes; exact source/Unicode/map/overflow invariants; production cooperative batches <=32 requests; and exact input/anchor/cancellation/cache assertions. Additional runner-local responsiveness caps require <1000 ms observable interaction and <100 ms batch/timer opportunity. Those elapsed-time checks depend on host scheduling and are not universal timing guarantees.

| Measurement | Actual boundary / limitation |
| --- | --- |
| `animationStartMs` | Input handler timestamp to Web Animations start; null for legitimately nonanimated turns |
| `visibleMs` | Input to destination prose with >=40 px projected width past the animation midpoint, or a committed nonanimated destination; paint opportunity, not physical first ink |
| `committedMs` | Input to canonical anchor/DOM commit; durable persistence checked separately |
| `preparationMs`, `animationMs` | Turn preparation and awaited animation phases, independently recorded |
| `candidateMs`, `layoutMs`, probe/read counts | Summed measured candidate construction and geometry-read calls; does not claim complete browser layout/paint CPU attribution |
| `extractionMs`, `visibleInsertionMs` | Recorded PDF extraction and visible DOM insertion work; analysis may already have warmed source extraction |
| `idlePreparationMs`, idle probes/long tasks | Forced real idle callback with its timeout path, separate from foreground input windows |
| Long-task total/maximum/count | Full observer task durations overlapping each window, not clipped overlap or all work below 50 ms; support and an actual 65 ms self-test are recorded |
| Fitting `elapsedMs` | Synchronous DOM fitting helper, including pathological exact-pair search; production cooperative scheduling is a separate work suite |

Long Tasks observer is verified with an actual scheduled 65 ms page task. First attempt used DevTools evaluate directly and failed closed (supported/active but unverified); the retained failed report is fitting-performance/run-oZHioA/report.json. The corrected scheduled-task hypothesis passed before any calibration budget existed. No threshold changes followed; later startup-only candidate failures are separately documented above. Long-task durations are the complete observed tasks intersecting each measured window, not clipped overlap durations or hardware first-ink measurements. The helper's synchronous stress fitting intentionally has long tasks; the production scheduler has separate yield/timer/cancellation bounds.

All paths below under `output/playwright/`:

- Fitting calibration: fitting-performance/run-5O6sEw/report.json; 21 samples, verified observer, zero renderer errors.
- Navigation calibration: navigation-performance/run-mYo9ds/report.json; 192 turns/64 cases, verified observer, zero renderer errors.
- Frozen budgets: october-audit-20261102/fitting-budget-accepted.json and navigation-budget-accepted.json.
- **P: Fitting candidate:** fitting-performance/run-G0hfP0/report.json; passed all 21 samples, timing/long-task budgets, exact source preservation and deterministic probe caps.
- **N: Navigation candidate:** navigation-performance/run-RtidbE/report.json; passed 192 timed turns, 22 input cases, 7 work/cancellation cases, frozen timing/long-task budgets; zero renderer errors.
- New gate unit suite: 8/8 passed, including injected 500 ms wait rejection, independent 80 ms long-task rejection, incompatible environment, missing samples/capability, post-candidate calibration, overwrite protection, intersecting-window attribution, and prepared/animation deterministic bounds.

Candidate navigation p50/p95 milliseconds:

| Motion/preparation | Visible opportunity | Committed anchor |
|---|---:|---:|
| Normal/unprepared |38.9/66.8|173.0/199.7|
| Normal/prepared |33.4/46.2|169.9/181.0|
| Reduced/unprepared |12.6/44.0|1.8/31.6|
| Reduced/prepared |5.9/16.2|0.7/1.0|

All ordinary measured foreground and idle turn windows had zero >=50 ms long tasks; the independent capability self-test verified observation. Visibility remains conservative animation/content paint opportunity, not measured first ink.

The intentionally synchronous unsuccessful-final-pair helper reached 593.5 ms and 606 ms overlapping long task, with 1481 unique probes and no duplicate probes. It is not a sub-100ms foreground guarantee. The separate cooperative production suite observed a 10.4 ms maximum yielded batch/32 requests, 26.1 ms timer opportunity and 39.2 ms last recorded cancellation-to-aborted-fitting interval; shared preparation had 919 unique probes and one owner. Full phase distributions, capabilities and provenance are in `october-audit-20261102/performance-accepted-summary.json`.

Both accepted budgets were created before either candidate (23:27:07Z fitting, 23:28:37Z navigation). Independent review replayed `evaluateGate`, rebuilt budgets from calibration rows and checked deterministic bounds: zero failures. All 24 recorded source/runner/dependency files matched before/after the serial window, and both source/runner fingerprints match the current checkout. Candidate source hash is `c86380d715c6339733555703fecdd81e8400450cb9cef471d23f6aa24db58d71`; both baselines use committed `c2eb221`. This supports these frozen local results, not unperformed remote CI or other hardware.

Environment: Windows 10.0.26200 x64; Intel Core Ultra 7 155U; 14 logical CPUs; Node v22.21.0; headless Chrome 156.0.8078.48; DPR 1; 1440x900/390x844; 13/19 px navigation sizes. Desktop activity/power/thermal state were not controlled beyond exclusive serial test/browser/build execution. Profiles/origins/caches are isolated and retained.

Reproduction (choose NEW budget filenames, keep baseline commit available, run serially without source/harness edits in between):

```powershell
node tests/fitting-performance.browser.mjs --calibrate=output/playwright/october-audit-20261102/fitting-budget-accepted.json --source-ref=c2eb221
node tests/navigation-performance.browser.mjs metrics --calibrate=output/playwright/october-audit-20261102/navigation-budget-accepted.json --source-ref=c2eb221
node tests/fitting-performance.browser.mjs --budget=output/playwright/october-audit-20261102/fitting-budget-accepted.json
node tests/navigation-performance.browser.mjs all --budget=output/playwright/october-audit-20261102/navigation-budget-accepted.json
node --test tests/performance-gate.test.mjs
```

The shown budget files now exist and are deliberately protected against overwrite; use a new artifact folder on reproduction. --baseline remains an explicitly diagnostic mode and does not certify timing. Candidate metrics/all requires a budget; input/work alone run deterministic checks. Unsupported Long Tasks capability is incomplete evidence, not a portable pass.


## Criterion matrix

### #4 — Open image-only PDFs in a readable view instead of empty Book-view placeholders

Historical local commit: `0b20f07`. Pointers: `src/main.js`; `tests/create-fixtures.mjs`; `tests/scan-fallback.browser.mjs`; `tests/fidelity-desktop.browser.mjs`.

| Saved acceptance criterion | Disposition, evidence and limitation |
|---|---|
| Choose a readable Original PDF presentation when an imported or restored document has no usable text layer. | Verified — Scan and D import/reopen textless fixtures into visible Original canvases; current complete analysis is required. U covers stale/cancelled analysis. |
| For mixed text/image PDFs, provide an appropriate page-level original fallback without replacing valid reflowed pages or trapping navigation. | Verified — Scan retains reflowed prose on mixed page 1 and visible original fallback on image pages, with navigation in both layouts. |
| Preserve source page, bookmarks, and saved reading position during fallback. | Verified — Scan and R5 assert bookmarks, source pages, saved positions and restart recovery; original bytes remain equal. |
| Add an image-only PDF regression fixture and a mixed-document regression; verify actual visible content rather than the mere presence of a paper container. | Verified — generated image-only/mixed fixtures plus Scan visible-content checks and D per-canvas bitmap capture. Empty paper alone cannot pass. |

### #5 — Restore the selected Book or Original PDF view when reopening a saved document

Historical local commit: `29e8ee8`. Pointers: `src/main.js`; `src/storage.js`; `tests/reader-recovery.browser.mjs`; `tests/storage.test.mjs`.

| Saved acceptance criterion | Disposition, evidence and limitation |
|---|---|
| Persist and restore each document's selected view across shelf switches and a full restart, including original paged and scroll presentations. | Verified — R5 exercises independent per-document view/layout across shelf switches and full Electron restarts, including Original Pages/Scroll. |
| Restore the matching source page/anchor without overwriting a usable Book-view text anchor. | Verified — R5 retains matching Book anchors while rejecting stale mismatched positions during Original navigation. |
| Use a sensible fallback for older saved records lacking a view and for documents that cannot support the requested view. | Verified — R5 legacy records and Scan current/stale textless analysis exercise fallback; U covers storage normalization. |
| Exercise both Book-to-Original and Original-to-Book restoration in desktop tests. | Verified — R5 and D switch Book/Original, reopen and fully restart; bookmarks and source SHA-256 remain unchanged. |

### #6 — Do not promote scanner page-number bookmarks into chapter headings

Historical local commit: `4657c00`. Pointers: `src/document-structure.js`; `src/structure-model.js`; `tests/structure-fixture.mjs`; `tests/structure-audit.browser.mjs`; `tests/fidelity-desktop.browser.mjs`.

| Saved acceptance criterion | Disposition, evidence and limitation |
|---|---|
| Distinguish page-navigation bookmarks from semantic chapter/section entries before they drive injected typography. | Verified — S#6 and U distinguish dense page counters from semantic nodes; numeric destinations cannot create chapter intros. |
| Keep legitimate destination navigation available without presenting 228 scan labels as chapters. | Verified — D real Frankenstein retains all 228 page destinations, navigates physical page 155 and renders Original without numeric chapter identity. |
| Handle legitimate numbered/Roman-numeral chapter titles conservatively; do not globally discard every numeric bookmark. | Verified — U document-structure tests retain sparse numeric, padded and dense Roman chapters while separating unpadded page counters. |
| Add both a page-per-bookmark scanned fixture and a legitimate numbered-chapter fixture. | Verified — S generated12-page scanner bookmarks and U legitimate numbered/Roman fixtures pass; D adds textless semantic/numeric/no-outline variants. |

### #7 — Re-enable Scan PDF again after reopening a fully analyzed book

Historical local commit: `4f1deb9`. Pointers: `src/main.js`; `tests/reader-recovery.browser.mjs`.

| Saved acceptance criterion | Disposition, evidence and limitation |
|---|---|
| Refresh scan-control state when loading completes, including the no-auto-scan path for a completed document. | Verified — R7 reopens a completed book without automatic scanning and observes enabled rescan after load. |
| Enable rescan once importing is false and no scan is running; keep appropriate disabled/hidden states while an import or scan is active. | Verified — R7 starts rescan, checks disabled active-scan state and restored access after completion; source review follows importing/scanning guards. |
| Cover successful reopening, cancelled opening, failed opening, and switching books in the relevant lifecycle test. | Verified — R7 failed/cancelled openings retain the current book and usable controls; R5 exercises switching completed books. |
| Verify rescan can actually start from the restored completed-book state. | Verified — R7 actually initiates rescan from the restored completed state, rather than checking only button markup. |

### #8 — Distinguish completed scanning from usable page text when a PDF has only bookmarks

Task implementation: `63a57a9`. Pointers: `src/main.js`; `tests/fidelity-desktop.browser.mjs`; `tests/structure-audit.browser.mjs`.

| Saved acceptance criterion | Disposition, evidence and limitation |
|---|---|
| Communicate completed scan progress, outline availability, and absence of readable page text as distinct facts. | Verified — D asserts completed page count, no readable text and semantic outline/page-bookmark/source-page navigation as separate status facts. |
| Offer a clear route to Original PDF when reflow cannot display the page text. | Verified — D scans open visible Original PDF with an explicit recovery label; F#16 verifies the help route for unreliable text. |
| Do not imply that the file has no usable navigation merely because it has no text layer. | Verified — D textless semantic and numeric outlines retain their respective navigation descriptions; no-outline scan retains source-page navigation. |
| Cover completed scanned PDFs both with and without outlines, plus normal text PDFs. | Verified — D covers semantic outline, numeric page bookmarks, no outline and ordinary sample text. Three scan-status captures are validated; numeric example visually inspected. |

### #9 — Reject ordinary prose beginning with part, book, or section as an explicit heading

Historical local commit: `7d37148`. Pointers: `src/document-structure.js`; `src/pdf-layout.js`; `tests/pdf-layout-fixture.mjs`; `tests/structure-audit.browser.mjs`.

| Saved acceptance criterion | Disposition, evidence and limitation |
|---|---|
| Require credible structural/numbering/typographic evidence for explicit chapter, part, book, section, and appendix headings. | Verified — U structural heading positives/negatives exercise numbering, typography and tags; S#9 checks the resulting DOM roles. |
| Keep prose phrases such as 'part of their load' and 'book of stories' in their paragraph flow. | Verified — S#9 exact part-of-their-load/book-of-stories prose remains P text in both layouts with no invented Contents entry. |
| Retain supported real headings, including written-out, Arabic, and Roman chapter numbers. | Verified — U explicit written, Arabic and Roman chapter/part/section/appendix cases remain headings. |
| Add a regression reproducing the exact body-line classification and check rendered element roles as well as extracted text conservation. | Verified — S#9 asserts exact rendered prose, paragraph roles and first/last-character source roundtrips in both layouts. |

### #10 — Recognize real section titles that do not exceed the 1.4x body-size threshold

Historical local commit: `b395f9f`. Pointers: `src/pdf-layout.js`; `src/layout-reading.js`; `tests/pdf-layout-fixture.mjs`; `tests/structure-audit.browser.mjs`.

| Saved acceptance criterion | Disposition, evidence and limitation |
|---|---|
| Use corroborating placement, spacing, style, tag, and sequence evidence for section headings rather than requiring the keyword regex or >1.4x body size alone. | Verified — U modest-heading cases require corroborating placement, casing, spacing and sequence; near-identical prose negatives pass. |
| Recover the meaningful hierarchy in representative Nietzsche-like fixtures without creating prose false positives. | Verified — S#10 checks three titles, two roots and the small-capitals child; D real Nietzsche checks the corresponding hierarchy. |
| Ensure corrected roles reach both Book rendering and Contents analysis. | Verified — S#10 checks both rendered heading roles and stored Contents identities/destinations, without duplicate mid-page introductions. |
| Test true modest-size headings and visually similar ordinary prose together. | Verified — U and S#10 run true modest titles and visually similar prose; D source 3 rendering supplies real-document evidence. |

### #11 — Exclude combined and OCR-imperfect running headers from reconstructed body text

Historical local commit: `8447400`. Pointers: `src/pdf-layout.js`; `src/layout-reading.js`; `tests/pdf-layout-fixture.mjs`; `tests/structure-audit.browser.mjs`.

| Saved acceptance criterion | Disposition, evidence and limitation |
|---|---|
| Recognize recurring running titles and folios whether PDF.js provides them as one combined line or separate text items. | Verified — U and S#11 cover combined and split recurring titles/folios; exact body content remains. |
| Handle modest OCR noise and printed/source-page offsets without treating body text near the edge as disposable. | Verified — U and S#11 cover OCR-shaped headers/printed offsets and legitimate near-top body negatives. No arbitrary edge-text deletion. |
| Keep removed text inspectable as annotations with source provenance. | Verified — S#11 compares Source notes text/line associations and header source endpoints with canonical annotations. |
| Add combined-header, split-header, imperfect-OCR, and legitimate near-top-body regression cases. | Verified — all five generated combined/split/noisy/offset cases pass both layouts in S; U covers retained near-top body/Acts. |

### #12 — Suppress duplicate injected chapter titles when the matching source title is not the first block

Historical local commit: `c54050e`. Pointers: `src/layout-reading.js`; `src/main.js`; `tests/opening-title.test.mjs`; `tests/structure-audit.browser.mjs`.

| Saved acceptance criterion | Disposition, evidence and limitation |
|---|---|
| Display the opening title exactly once while preserving the chapter-number line and actual body text. | Verified — S#12 counts one title and one chapter-number line for sample and prefatory fixture; canonical body text is conserved. |
| Match the relevant opening source title using layout/provenance evidence even when it is not the first block or its role is imperfect. | Verified — S#12 prefatory fixture deliberately gives the source title an imperfect role; U checks bounded source-title evidence and negatives. |
| Keep source offset mappings, continuation pagination, chapter navigation, and saved anchors correct. | Verified — S#12 checks contiguous continuation fragments, source projection, restored anchor, selected Contents and unchanged bytes. |
| Test both Scroll and Page flip using public/sample.pdf and a regression with a prefatory line before the title. | Verified — S#12 runs sample and prefatory fixtures in Scroll/Page flip, including 2/11 continuation leaves; validated images retained. |

### #13 — Reconcile a chapter number and its adjacent outline title into coherent Contents entries

Historical local commit: `4ee0320`. Pointers: `src/document-structure.js`; `src/structure-model.js`; `tests/structure-audit.browser.mjs`; `docs/contents-detection-repair.md`.

| Saved acceptance criterion | Disposition, evidence and limitation |
|---|---|
| Represent adjacent chapter-number and title evidence as one coherent entry or an intentional parent/child relationship. | Verified — U reconciliation cases and S#13 final node tuples keep chapter-number/title evidence coherent with outline IDs. |
| Reconcile outline and detected evidence without discarding genuinely distinct same-page parts, chapters, or subsections. | Verified — U distinct adjacent Part/Chapter/subsection and conflicting ordinals remain separate; S preserves original outline identities. |
| Keep active Contents highlighting and the reader's chapter title consistent. | Verified — S#13 selected-node aria-current, current chapter and canonical opening title agree before/after reload in both layouts. |
| Add sample-based regression assertions for final titles, hierarchy, destinations, and selected-node restoration. | Verified — S#13 sample/prefatory final hierarchy/destinations/selection/source anchors and distant Scroll jumps1/17 pass; PDF bytes unchanged. |

### #14 — Preserve supported inline emphasis when converting PDF runs into Book-view text

Historical local commit: `d5aaf00`. Pointers: `src/pdf-layout-adapter.js`; `src/layout-reading.js`; `src/book-pagination.js`; `tests/fidelity-fixtures.mjs`; `tests/fidelity-audit.browser.mjs`; `docs/fidelity-pagination.md`.

| Saved acceptance criterion | Disposition, evidence and limitation |
|---|---|
| Carry reliable inline emphasis evidence through projection and slicing, rendering supported italic/bold spans without changing the canonical text. | Verified — U and F#14 carry reliable regular/bold/italic/bold-italic runs through projection and rendering without changing canonical strings. |
| Preserve UTF-16/source offsets, fragment boundaries, and restored reading positions across styled runs. | Verified — F#14 checks source endpoint roundtrips, contiguous fitted fragments and saved/reloaded positions; U includes UTF-16 boundaries. |
| Handle missing or ambiguous PDF font metadata conservatively and keep Original PDF available. | Verified — U adapter fallback cases cover unavailable/ambiguous font records; F/D preserve Original PDF access. Unsupported style evidence is not guessed. |
| Test mixed styles across line breaks and continuation leaves; retain the reader's chosen base typeface and text size. | Verified — F#14 checks every rendered character at 13/19 px, desktop/narrow, continuations and both layouts; D includes native narrow19 px emphasis. |

### #15 — Avoid paragraph-sized gaps between consecutive preserved verse lines

Historical local commit: `25bb40f`. Pointers: `src/pdf-layout.js`; `src/book-pagination.js`; `tests/fidelity-fixtures.mjs`; `tests/fidelity-audit.browser.mjs`; `testing_downloads/Hamlet.pdf`.

| Saved acceptance criterion | Disposition, evidence and limitation |
|---|---|
| Separate ordinary consecutive verse-line spacing from actual stanza, speech, or stage-direction breaks. | Verified — U and F#15 distinguish adjacent verse lines from stanza, speaker and stage-direction boundaries using measured spacing. |
| Group or style preserved lines so a one-line classification does not automatically receive paragraph-sized extra space. | Verified — F#15 geometry checks compact consecutive preserved lines; reviewed Hamlet captures contain readable densely spaced verse. |
| Preserve speakers, deliberate indentation, source order, and source-to-text mappings. | Verified — F#15 asserts labels, cue associations, indentation, source order and endpoint mappings with exact source coverage. |
| Add a real Hamlet rendering regression plus synthetic stanza/speech fixtures that check both vertical density and text conservation. | Verified — F#15 synthetic stanza/speech and real Hamlet 10/20/50 run both layouts, desktop/narrow 13/19 px; D validates expected production content before capture. |

### #16 — Provide a clear recovery path when the embedded OCR text disagrees with the visible PDF

Historical local commit: `d912862`. Pointers: `src/main.js`; `index.html`; `tests/fidelity-fixtures.mjs`; `tests/fidelity-audit.browser.mjs`; `docs/fidelity-pagination.md`.

| Saved acceptance criterion | Disposition, evidence and limitation |
|---|---|
| Provide an understandable path to compare or use Original PDF when users encounter unreliable extracted text. | Verified — F#16 and D exercise the Book help route to visible Original PDF and back, including narrow presentation. |
| Define and document the product's supported response to poor OCR; any automatic confidence heuristic must be evaluated against both clean and bad text layers. | Verified policy — Original PDF is recovery for unreliable OCR/encoding; no automatic correction heuristic was introduced. F compares clean and corrupted text layers. |
| Never silently replace uncertain words with guessed prose or describe all OCR errors as layout-parser bugs. | Verified — corrupted source string Cod remains literal in Book while Original visibly shows God; no guessed replacement prose. |
| Add an intentionally corrupted-text-layer fixture whose visible page differs from extracted strings; test the chosen recovery behavior. | Verified — F#16 ToUnicode fixture and raster-identical clean reference, both layouts/widths13/19/23 px including 320 px, view restoration, anchors and bytes pass. |

### #17 — Avoid nearly empty continuation leaves at source PDF page boundaries

Historical local commit: `4abd8c6`. Pointers: `src/book-pagination.js`; `src/layout-reading.js`; `tests/fidelity-fixtures.mjs`; `tests/fidelity-audit.browser.mjs`; `docs/fidelity-pagination.md`.

| Saved acceptance criterion | Disposition, evidence and limitation |
|---|---|
| Define and implement a pagination policy that avoids tiny tail leaves, such as supported balancing or cross-source text flow, without losing source identity. | Verified policy — page-local exact-fit final-pair balancing; F#17 improves48/65/74-character tails and real Nietzsche source 3 while both revised leaves fit. |
| Preserve source-page navigation, text offsets, bookmarks, and reload/resize anchors if one leaf can contain multiple source ranges. | Resolved without model migration — leaves still contain one source page. F#17 verifies source jumps, bookmarks, resize/font/reload anchors; multi-source leaves were not introduced. |
| Do not merge across meaningful chapter/section boundaries or silently drop/duplicate text to fill a leaf. | Verified — F#17 exact contiguous coverage and meaningful-boundary cases plus U speaker/Unicode constraints; no cross-page or cross-section fill. |
| Cover the observed short-tail cases, blank/image source pages, and forward/backward symmetry in browser tests. | Verified — F#17 blank/image/verse pages, exact observed tails and forward/back symmetry pass desktop/narrow 13/19 px and both layouts; D real balanced tail inspected. |

### #18 — Reduce the fixed page-turn delay that dominates navigation latency

Historical local commit: `5263318`. Pointers: Performance worker lane: `src/page-turn.js`; `tests/navigation-performance.browser.mjs`; `docs/navigation-performance.md`.

| Saved acceptance criterion | Disposition, evidence and limitation |
|---|---|
| Choose and document a more responsive navigation latency target, using measured click-to-visible-content and click-to-committed-position times. | Verified N: requested 160 ms animation and phase boundaries documented above; final normal/unprepared visible opportunity p50/p95=38.9/66.8 ms and commit=173.0/199.7 ms on this runner. |
| Reduce avoidable fixed waiting while retaining understandable direction, cancellation, and reduced-motion behavior. | Verified N/U/C: direction, normal/reduced motion and cancellation pass; fixed 160 ms request is independently bounded from measured completion time. |
| Avoid delaying transitions between fallback notices solely to play a decorative book animation. | Verified N: scan fallback turns assert no decorative animation; D/Scan verify actual visible Original fallback. |
| Compare cold and prepared turns on the same representative fixtures; preserve no-deep-clone and source-anchor guarantees. | Verified N/P/C: baseline/current use the same fixtures, typography, motion/preparation policy and runner/environment fingerprints; zero deep clones and exact anchors pass. |

### #19 — Handle repeated page-turn input without silently dropping navigation intent

Historical local commit: `ae0e3c5`. Pointers: Performance worker lane: `src/page-turn.js`; `tests/navigation-performance.browser.mjs`; `docs/navigation-performance.md`.

| Saved acceptance criterion | Disposition, evidence and limitation |
|---|---|
| Define deterministic behavior for discrete repeated clicks/keys during a turn, such as a bounded pending intent or safe completion/retargeting. | Verified N/U: one active turn plus one latest pending discrete direction; sequential reference destinations confirm the defined policy. |
| Do not allow an unbounded key-repeat queue, overlapping turn layers, skipped text, or incorrect saved anchors. | Verified N: held-repeat saturation, no overlapping layers/deep clones, source conservation and exact stored/reloaded anchors pass. |
| Handle opposite-direction input, resize, hidden-tab cancellation, and reduced motion coherently. | Verified N: opposite direction, resize, hidden-tab, layout and reduced-motion cancellation cases pass; D verifies native interaction cancellation. |
| Add rapid-click and rapid-key tests that assert the intended final anchor and cancellation behavior. | Verified N: all 22 input cases pass, including rapid mouse/key; D additionally passes native normal burst and CDP touch/pen journeys. |

### #20 — Reduce repeated DOM reconstruction and forced layout during cold pagination

Historical local commit: `c2eb221`. Pointers: Performance worker lane: `src/book-pagination.js`; `src/main.js`; `tests/fitting-performance.browser.mjs`; `docs/navigation-performance.md`.

| Saved acceptance criterion | Disposition, evidence and limitation |
|---|---|
| Instrument cold fitting separately from extraction, DOM insertion, animation, and idle preparation. | Verified N/P: extraction, insertion, construction, geometry reads, animation and idle preparation recorded separately with the measurement limits above. |
| Reduce redundant candidate rendering/layout checks while retaining exact fit correctness, source-text conservation, and overflow handling. | Verified P/N/U: 21 actual DOM samples pass exact fit/overflow/source conservation and work limits; generation-local memoization remains bounded. |
| Bound work and cancellation latency for dense or unusually structured pages, including idle warmup under its timeout. | Verified N: 7 production work/cancellation cases pass cooperative batch<=32, timer opportunity, idle timeout and stale-result rejection. Observed local maxima are documented above. |
| Test the actual layout-rendering path with speaker/line-group fixtures; a cheap string-length predicate alone is insufficient. | Verified P: 7 production-style DOM cases x 3, including preserved lines/speaker groups and unsuccessful pair search; all source/map/Unicode/fit assertions pass. |
| Preserve existing cache bounds and avoid whole-book pre-pagination or speculative infrastructure. | Verified N/U/source review: bounded caches and generation-local exact fits; no whole-book speculative pagination or deep cloning. Independent B review found no defect. |

### #21 — Describe next and previous navigation in leaves or spreads rather than two PDF pages

Task implementation: `63a57a9`. Pointers: `index.html`; `src/main.js`; `tests/fidelity-desktop.browser.mjs`; `tests/page-turn.test.mjs`.

| Saved acceptance criterion | Disposition, evidence and limitation |
|---|---|
| Use an accurate accessible name for Book-view spread/leaf navigation while keeping Original PDF page navigation understandable. | Verified — D checks both Previous/Next names: desktop Book spread, narrow Book leaf, Original/Scroll PDF page. |
| Keep visible page-number/range labels, source-page input, and assistive descriptions consistent. | Verified — D pageControls checks visible range, source input label/value, progress aria text and saved source-page/zero-offset state. |
| Test a two-leaf same-source-page spread, a cross-source-page spread, and single-leaf mobile presentation. | Verified — D tests same-source[1,1]/2, cross-source[1,2]/4 and narrow[1]/2 presentations, plus scan source 1/12. |
| Do not change source numbering or saved positions solely to match a label. | Verified — main.js changes only names/status prose; D saved state and R5/F source anchors pass. No numbering or persistence migration. |

### #22 — Add representative rendering regressions that catch the audited PDF failures

Task implementation: `63a57a9` plus `57de547`. Pointers: `tests/create-fixtures.mjs`; `tests/structure-fixture.mjs`; `tests/pdf-layout-fixture.mjs`; `tests/fidelity-fixtures.mjs`; `tests/structure-audit.browser.mjs`; `tests/scan-fallback.browser.mjs`; `tests/fidelity-audit.browser.mjs`.

| Saved acceptance criterion | Disposition, evidence and limitation |
|---|---|
| Add deterministic fixtures for image-only PDFs with numeric outlines, ordinary prose beginning with structural keywords, modest-size real titles, combined running headers, styled text, and sparse tails. | Verified — existing committed generators cover all requested cases; small scanned-outline option adds textless semantic/numeric/no-outline variants. Portable core has no personal PDF paths. |
| Assert correct text roles, Contents hierarchy, title occurrence counts, visible fallback content, and complete source-text coverage. | Verified — S/F/Scan/D assert roles, hierarchy, exact title counts, source coverage and actual canvas/prose content; capture helper rejects unreadable light/dark leaf output. |
| Add rendered geometry or reviewed image comparisons for verse spacing and representative page composition at desktop and narrow viewports. | Verified — F geometry at desktop/narrow 13/19 px and D production captures; root visually inspected selected Hamlet/verse/emphasis/tail/Original comparisons. Not a pixel-perfect corpus proof. |
| Use public/sample.pdf and existing Hamlet where appropriate; create original synthetic fixtures for external PDFs rather than silently committing third-party course materials. | Verified — sample and retained Hamlet used; synthetic external-pattern fixtures generated locally. Real Frankenstein/Nietzsche supplied explicitly, with byte hashes, never committed. |
| Keep each product issue's regression near its fix; this issue owns the shared fixture matrix and meaningful end-to-end quality gate. | Verified — tests/audit-gate.mjs serial 12-check core/real gate passed G. Distributed issue regressions remain near their existing fixtures; missing real prerequisites fail incomplete. |

### #23 — Add browser-level pagination latency and repeated-input regression measurements

Task implementation: `9d91e66` plus `57de547`. Pointers: Performance worker lane: `tests/navigation-performance.browser.mjs`; `tests/fitting-performance.browser.mjs`; committed performance-gate helper/tests; `docs/navigation-performance.md`.

| Saved acceptance criterion | Disposition, evidence and limitation |
|---|---|
| Measure click-to-animation, click-to-content/anchor commit, DOM fit probes, layout work, and long tasks separately. | Verified N/P: phase-separated input, animation, visible opportunity, commit, probes/reads, idle work and Long Tasks recorded; observer capability self-test passed. |
| Cover cold/prepared turns, normal/reduced motion, dense prose, preserved lines, scans, and repeated discrete input. | Verified N/P: 192 timed turns/64 cases x 3, 21 fitting samples, 22 input and 7 work cases cover requested sources, preparation, motions and cancellation. |
| Establish documented budgets appropriate to CI and a reproducible local benchmark without treating one machine's millisecond values as universal. | Verified N/P: frozen pre-candidate budgets and identical environment/runner fingerprints pass; portable work bounds are distinct from local timing tolerances. Remote CI was not run. |
| Use disposable shelves/profiles and retain structured results for comparison. | Verified N/P: isolated fresh origins/profiles and unique structured reports retained, serial comparisons with frozen sources; all runner processes closed. |
| Fail on meaningful regressions rather than implementation-mirroring counters alone. | Verified U/N/P: injected wait/long-task regressions and invalid provenance/missing observations fail the gate; actual candidate timing and semantic/work evaluations passed. |

### #24 — Remove accidental browser captures from source tracking and define an artifact location

Task implementation: `23e39ac`. Pointers: `.playwright-cli/`; `.gitignore`; `design-book/`; `output/playwright/october-audit-20261102/mechanical-inventory.md`.

| Saved acceptance criterion | Disposition, evidence and limitation |
|---|---|
| Classify any captures that are intentional design references or test goldens before changing tracking. | Verified I —26 individually classified files;13 PNGs visually inspected and 13 generated YAML snapshots, no source/test/golden consumers. |
| Move or stop tracking accidental generated captures through a deliberate cleanup commit; retain any needed evidence safely. | Verified — commit 23e39ac untracks exactly26 accidental captures; all local bytes match I hashes and remain present. |
| Ignore future ephemeral captures or configure tools to write under the established ignored artifact directory. | Verified — commit 23e39ac adds .playwright-cli/ ignore; maintained scan/desktop runners now use unique ignored run directories. |
| Keep authored browser fixtures and deliberate reference assets intact; verify the cleanup does not affect test inputs. | Verified — design-book authored assets, fixture generators and PDFs retained; G passes after untracking. Separate legacy seven-PNG overwrite exception is disclosed above. |

### #25 — Clarify the purpose and retention policy of testing_downloads assets

Task implementation: `23e39ac`. Pointers: `testing_downloads/README.md`; `testing_downloads/Hamlet.pdf`; `testing_downloads/download.jpg`; `tests/desktop.browser.mjs`; `tests/fidelity-desktop.browser.mjs`; `tests/document-structure-runtime.test.mjs`.

| Saved acceptance criterion | Disposition, evidence and limitation |
|---|---|
| Document which assets are required fixtures, their provenance, and how tests use them. | Verified documentation — testing_downloads/README.md names purpose, Git provenance and all known consumers. Original download/license provenance remains explicitly unknown. |
| Inspect and classify download.jpg; retain/document it if meaningful, otherwise propose a deliberate scoped cleanup. | Verified I — download.jpg visually classified as a stack-of-books image, retained in place with unknown original source/license; no deletion proposed. |
| Preserve Hamlet and update every consumer if a clearer fixture location is chosen. | Verified — Hamlet remains at its existing path; consumer search, SHA-256 and F/D real rendering pass. No location change or consumer rewrite. |
| Do not treat lack of a code reference as proof that a user-provided asset may be destroyed. | Verified — absence of references did not authorize deletion; both assets remain intact in commit 23e39ac. |

### #26 — Document which ignored audit artifacts are reproducible and which contain local-only work

Task implementation: this documentation commit (retention inventory and reproduction map). Pointers: `output/playwright/october-audit-20261102/mechanical-inventory.md`; `README.md`; `docs/fidelity-pagination.md`; `docs/navigation-performance.md`; `docs/structure-reconciliation.md`; `docs/layout-interpretation.md`; `docs/page-flip-optimization.md`.

| Saved acceptance criterion | Disposition, evidence and limitation |
|---|---|
| Inventory and document artifact categories, purpose, regeneration commands, and retention decisions. | Verified — Artifact retention table plus I maps generated evidence, private data, builds and authored local work to purpose/regeneration/retention. |
| Promote only genuinely reusable authored diagnostics into an appropriate maintained location with dependencies documented. | Resolved — inspected one-off diagnostics duplicate maintained runners or depend on local paths; none justified promotion. New maintained gates declare their dependencies/commands here. |
| Preserve source snapshots/patches until their contents are reconciled or backed up; avoid blanket git clean or output deletion. | Verified I — six snapshots match90ef1a8; patch outcome reconciled with stated stale-context limitation. Snapshots/patch retained; no blanket clean/reset/deletion. |
| Keep user shelf/profile snapshots and third-party PDF copies out of commits and external evidence packages. | Verified — private profile database contents not inspected; external PDFs/profiles/reports remain ignored, never uploaded or staged. |
| Provide a clear map from important audit results to their reproduction procedure. | Verified — Fresh verification and #23 reproduction tables map accepted evidence to exact commands; failed/superseded reports remain local with reasons. |

## Tracked first-party surface inventory and lane assignment

Baseline inventory is 124 tracked paths: 17 `src/`, 39 `tests/`, 8 `docs/`, 9 design-book files, 8 public assets, 2 desktop files, 4 scripts, 2 `testing_downloads/` assets, 9 root-level product/config files, and 26 tracked `.playwright-cli/` captures (housekeeping surface, not product inputs). Assignment is by file ownership; root owns cross-lane integration and durable status docs. Task additions are the performance gate/helper tests, async readiness helper/tests, build asset-version helper/test, capture/shared audit/offline runners, this handoff and the testing_downloads README. They were assigned to their corresponding lanes and independently reviewed; the final candidate has 109 paths: 17 src, 47 tests, 9 docs, 5 scripts, 2 desktop, 9 design-book, 8 public, 3 testing_downloads and 9 root/config files. All 11 added paths have explicit ownership; the 26 removed tracking entries remain local.

### Lane A — PDF interpretation, layout, and rendering

- `src/document-structure.js`, `src/pdf-engine.js`, `src/pdf-layout.js`, `src/pdf-layout-adapter.js`, `src/layout-reading.js`, `src/book-layout.js`, `src/book-pagination.js`, `src/page-scroll.js`.
- `tests/audit-fixtures.mjs`, `tests/book-layout.test.mjs`, `tests/book-pagination.test.mjs`, `tests/contents-layout.browser.mjs`, `tests/document-structure.test.mjs`, `tests/document-structure-play.test.mjs`, `tests/document-structure-runtime.test.mjs`, `tests/fidelity-audit.browser.mjs`, `tests/fidelity-fixtures.mjs`, `tests/opening-title.test.mjs`, `tests/pdf-emphasis-adapter.test.mjs`, `tests/pdf-engine.test.mjs`, `tests/pdf-layout.browser.mjs`, `tests/pdf-layout-fixture.mjs`, `tests/pdf-layout.test.mjs`, `tests/pdf-runtime.test.mjs`, `tests/structure-audit.browser.mjs`, `tests/structure-fixture.mjs`, `tests/structure-model.test.mjs`.
- `docs/contents-detection-repair.md`, `docs/fidelity-pagination.md`, `docs/layout-interpretation.md`, `docs/layout-interpretation-agent-prompt.md`, `docs/structure-reconciliation.md`.

### Lane B — Main reader, navigation, state, storage, and styles

- `src/main.js`, `src/structure-model.js`, `src/storage.js`, `src/page-turn.js`, `src/spread-buffer.js`, `src/demo.js`, `src/styles.css`, `src/header-shelf.css`, `src/reading-corner.css`.
- `tests/page-scroll.test.mjs`, `tests/page-turn.test.mjs`, `tests/reader-recovery.browser.mjs`, `tests/scan-fallback.browser.mjs`, `tests/shelf-shortcut.browser.mjs`, `tests/spread-buffer.test.mjs`, `tests/storage.test.mjs`.
- `docs/navigation-performance.md`, `tests/navigation-performance.browser.mjs`, and `tests/fitting-performance.browser.mjs` were authored by the performance worker and independently reviewed by root and lane C. Timing execution is serialized.

### Lane C — Desktop/runtime, scripts, config, HTML/assets, docs, and test runners

- Desktop/runtime: `desktop/assets.mjs`, `desktop/main.mjs`; `scripts/build.mjs`, `scripts/server.mjs`, `scripts/Create-Shortcut.ps1`, `scripts/Start-Folio.ps1`; `Create shortcut.cmd`, `Start Folio.cmd`.
- Config/root: `.gitignore`, `electron-builder.json`, `package.json`, `package-lock.json`, `LICENSE`, `README.md`, `index.html`.
- Public/design assets: all tracked `public/**`, `design-book/**`, and `testing_downloads/**`. Preserve Hamlet and the image per the #25 inventory.
- Test runner/support surfaces: `tests/create-fixtures.mjs`, `tests/desktop-assets.test.mjs`, `tests/desktop.browser.mjs`, `tests/fidelity-check.html`, `tests/fidelity-desktop.browser.mjs`, `tests/layout-check.html`, `tests/page-flip-check.html`, `tests/page-flip.browser.mjs`, `tests/reader-compat.browser.mjs`, `tests/reading-corner-check.html`, `tests/server.test.mjs`.
- Remaining docs: `docs/PLAN.md`, `docs/page-flip-optimization.md`.

### Root / shared / housekeeping

Root retains tracker/handoff integration, the acceptance matrix, shared README and audit-doc decisions, package-wide verification, any cross-lane source/test edits, and any unassigned files. The26 generated `.playwright-cli/` files were untracked in 23e39ac with local bytes retained. Ignored `output/` is local mixed evidence and must stay outside commits unless an individual artifact is explicitly reconciled and promoted. `testing_downloads/README.md` and `.gitignore` classification/retention changes are committed in 23e39ac.

## Review coverage, limits and publication boundary

The complete tracked first-party surface received one review pass in lanes A/B/C, with root handling shared runners, documentation, design-book and integration. A read the PDF/layout/structure modules, fixture generators and tests; B read the reader, pagination/scroll/turn/cache/storage modules and all reader styles, and independently ran 63 related unit cases; C read desktop/protocol/server/build/service-worker/launcher/config/dependency boundaries and independently checked the performance implementation. Reports: `output/playwright/october-audit-20261102/review-A.md`, `review-B.md`, `review-C.md`, `review-async-wait.md`, `review-final.md`. Root reviewed the workers' authored diffs; workers reviewed root fixes. No author is the sole reviewer of an accepted repair. Detailed reports are local evidence; durable dispositions are this document.

The existing browser-native `pdf-layout.browser.mjs` and `page-flip.browser.mjs` execute through C, not directly as Node scripts. `contents-layout.browser.mjs` is an older Playwriter-specific manual diagnostic; `shelf-shortcut.browser.mjs` exports a browser-tool helper rather than a standalone gate. They received source review and ran through the ignored supplemental adapter on an isolated ephemeral origin; only fixed-origin guards and Tab API plumbing were adapted. All five reading-corner geometries, shelf keyboard/tooltip access and short/narrow Contents assertions passed in `supplemental-journeys/run-gMi9VM/report.json`, with injected geometry/hidden-tooltip failures rejected. The same report records actual Electron empty/encrypted-PDF recovery and restart. Earlier adapter/setup failures remain failed reports; none substitute for this final pass. Third-party PDF.js/Electron/Vite and generated assets received provenance/dependency/integration review, not an impractical line-by-line vendor audit.

Remaining boundaries: physical touch/pen hardware, OS screen reader and reduced-motion settings, OS print/shortcut dialogs, other operating systems, packaging/install and release behavior were not exercised. CDP touch/pen and browser reduced-motion emulation are explicit. File-symlink creation is an explicit skipped test because Windows permission is unavailable; own-temp directory-junction realpath rejection and the other path rejection cases pass. The existing encrypted-PDF prompt was exercised with an original synthetic RC4-128 fixture: wrong password, cancellation, successful unlock and full-restart unlock. AES fixture generation lacked the optional Python cryptography dependency; it was not installed and AES-specific runtime behavior remains unverified. Empty-page-tree and malformed open/cancel recovery preserve the current book; Original is the supported recovery for unreliable extraction. Offline O covers an already cached same-origin restart, not a clean offline install or a full deployed service-worker upgrade lifecycle. Unknown original asset licenses and the 15 moderate dev dependency advisory entries remain disclosed; no unjustified deletion or blanket upgrade.

The seven legacy recovery PNG overwrite exception remains unresolved because no pre-run backup exists. All current bytes are retained and future scan/smoke captures use unique paths. No user PDF/profile/shelf/patch/snapshot disposal occurred.

Independent final review revalidated G, replayed N/P against reconstructed frozen budgets, checked all 75 G inputs and 24 timing inputs, and approved the scoped fixes. No unresolved high-impact product finding remains within this reviewed surface. The focused local commit map below records the integrated result. GitHub tracker/children remain unchanged by this task; local evidence prepares a later publication/closure decision. No push, merge, issue comment/closure, release, package or install is authorized or performed.

## Local commits and later publication decision

These commits are local on `fix/october-audit-completion`, in order after the preserved `c2eb221` baseline. Earlier issue implementations retain their historical commits in the criterion matrix.

| Commit | Scope | Acceptance evidence |
| --- | --- | --- |
| `23e39ac` | #24 capture untracking and #25 retained asset documentation | I; all 26 local capture hashes unchanged |
| `9d91e66` | #23 calibrated timing and deterministic work gates | U, final N/P and independent replay |
| `5d5a4f2` | Stable asset byte changes invalidate offline caches | U build-asset regression, B, O; deployed upgrade lifecycle not exercised |
| `57de547` | Await resolved readiness, reserve isolated ports, disable irrelevant watchers and use unique captures | U, G, recalibrated N/P; legacy seven-PNG exception disclosed |
| `7d32d43` | Reject empty PDFs before saving/adopting them | R7, F no-signal byte-preservation check, supplemental Electron journey |
| `63a57a9` | #8/#21 wording and #22 settled rendering/core/real/desktop/offline gate | G, S/F/C/D/O, capture negative controls and visual inspection |
| `e10c41d` | Explicit file-symlink skip, directory-junction containment, accurate shelf UI checks | U and supplemental positive/negative UI cases |
| `c72d7c3` | Correct initial design preview and preserve selection after printing | Design native toggles and emulated print/return |
| This documentation commit | #26 retention/reproduction inventory, all 96 acceptance dispositions, public behavior corrections and final handoff | Independent final document review and criterion inventory |

The final implementation bytes match all 75 G inputs and all 24 timing inputs; Git commits change their history, not those tested bytes. The final checkout reconciliation is retained locally as `output/playwright/october-audit-20261102/final-checkout.json`. The implementation has no source/persistence migration. Reverting a focused product/build commit is a code rollback; keep the existing shelf and original PDF bytes. To reproduce later, regenerate only the named synthetic fixtures and use new isolated report/profile/budget paths. Recalibrate performance when source or runner compatibility changes; do not overwrite the accepted budgets.

This ledger supplies local closure evidence for #4-#26. It does not close issues or authorize publishing: tracker #3 and all children were left unchanged. The preservation exception, dependency disposition and unperformed checks above must accompany any later publication decision.
