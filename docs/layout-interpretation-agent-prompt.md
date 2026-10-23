# Agent prompt: rebuild PDF layout interpretation

Prepared October 19, 2026. This is the historical implementation handoff and researched design proposal; the rebuild was not implemented at preparation time. See [the implementation report](layout-interpretation.md) for current behavior and the later removal of manual Contents editing. External resources were checked during this investigation; recheck version-specific APIs and licenses before adopting code or dependencies.

## Assignment

Rebuild the layout interpretation behind Folio's pretty PDF reading view so it recovers meaningful reading order and formatting from text-based PDFs. Address drop caps, play dialogue and verse, indentation, multiple columns, and the distinction between body text and marginal material. Carry the resulting structure through both scrolling and paginated reading and into Contents detection.

The goal is readable, faithful reflow: ordinary prose may wrap naturally, while meaningful source line breaks, speaker relationships, and relative indentation survive. Reproducing every original page coordinate at arbitrary font sizes is a different problem. The existing Original view remains the fidelity reference and fallback.

Use a staged implementation with verifiable milestones. Start with the supplied research rather than repeating a broad search. Favor a deterministic browser implementation using the existing PDF.js dependency. Do not install Python conversion stacks, download model weights or large datasets, call paid APIs, upload PDFs, add a backend, or introduce OCR/LLM inference as part of this assignment. Document any such proposal separately if measured failures later justify it. Implement the core scope; identify unresolved advanced layouts honestly instead of claiming universal PDF understanding.

## 1. Establish the actual baseline

Workspace: `C:\Users\ccorm\repos\pdf-reader`. Read applicable AGENTS.md instructions, check branch and status, then inspect current code and call sites before editing. At preparation time the branch was `feature/table-of-contents`, with existing uncommitted changes in README, `docs/contents-detection-repair.md`, `src/document-structure.js`, `src/main.js`, `src/structure-model.js`, several structure tests/fixtures, and an untracked `tests/document-structure-play.test.mjs`. Preserve those changes. Do not reset, replace the working tree, commit, or publish as part of this handoff.

Read these areas first; paths below are relative to the workspace root:

| Area | Current role and reason to inspect |
| --- | --- |
| `src/pdf-engine.js` | `pageLines`, `splitParagraphs`, `extractPage`: geometry becomes plain paragraph strings here. Also contains legacy chapter APIs; establish their callers before changing them. |
| `src/document-structure.js` | A separate `pageLines` implementation, `itemGeometry`, heading/printed-TOC analysis, resumable scan snapshots and `STRUCTURE_VERSION`. It currently measures a line using its largest item. |
| `src/main.js` | `pageText`, `navigateStructure`, `fillPaperPage`, `fillFragment`, `fittedPager`, reading anchors, page/fragment caches, and both view paths. Plain-string joins/splits currently discard structure. |
| `src/book-pagination.js` | Fits contiguous UTF-16 slices into leaves. Saved offsets refer to the exact flattened string, so changed ordering and separators are a migration concern. |
| `src/book-layout.js` | Duplicate chapter-heading removal and navigation helpers. Do not lose text when changing heading presentation. |
| `src/page-scroll.js`, `src/page-turn.js` | Virtualized page lifecycle, scroll restoration, cancellation and page-turn behavior. |
| `src/structure-model.js`, `src/storage.js` | Manual Contents overlays, automatic-scan upgrade policy, saved positions and IndexedDB boundaries. |
| `src/styles.css` | `.page-prose`, chapter introductions, and the generated `.drop-cap` appearance. Source drop caps and decorative reader styling are separate concerns. |
| `tests/pdf-engine.test.mjs`, `tests/pdf-runtime.test.mjs` | Mock and real-PDF extraction checks. |
| `tests/document-structure*.test.mjs`, `tests/structure-model.test.mjs`, `tests/structure-fixture.mjs` | Existing outlines, printed TOCs, plays, exact anchors, scan lifecycle and manual-edit compatibility. |
| `tests/book-pagination.test.mjs`, `tests/page-scroll.test.mjs`, `tests/contents-layout.browser.mjs` | Character conservation, reading-place restoration and browser test conventions. |
| `docs/contents-detection-repair.md`, `README.md`, `scripts/build.mjs` | Recently repaired Contents behavior, product boundaries, verification history and offline build packaging. |

Current package configuration uses vanilla JavaScript/Vite, `pdfjs-dist` 6.3.289 and Node >=22.13.0. Verify these locally. Inspect the installed PDF.js types at `node_modules/pdfjs-dist/types/src/display/api.d.ts`; do not assume online master matches the installed package.

### Reproductions already verified

**Drop cap:** `C:\Users\ccorm\fall-26\math_8\math_textbook.pdf`, physical PDF page 7, the preface to the third edition of Book of Proof. The original sentence starts with a large M spanning two lines. Current extraction starts:

> y goal in writing this book has been to create a very inexpensive M high-quality textbook.

The M has size approximately 30.3424 and baseline y=469.939. The first line's y is 484.165, with body text around size 10.9091. The second line shares the M's baseline. Baseline sorting therefore moves M after the first line. Separately, the structure analyzer flags the second line beginning `M high-quality textbook...` as prominent heading evidence because its maximum item size is the drop cap's size. An isolated-page analysis reproduced a bogus review candidate; promotion in a complete document depends on corroboration. Do not claim that isolated reproduction proved every final Contents node.

**Play:** `testing_downloads/Hamlet.pdf`, 144 physical pages. On pages 8 and 9, dialogue lines are merged into prose; margin labels such as `FTLN 0001`, right-side counters and running labels enter the text. Page 8 also mixes names on the dialogue baseline with names standing on their own line, plus centered stage directions. Inspect the original rendering rather than assuming every speech uses one layout.

The existing Contents repair has regression expectations for five Acts and twenty Scenes at exact page/y anchors. Preserve that result and the absence of bogus numeric TOC entries. Scene numbers repeat under different Acts and multiple boundaries can share one physical page.

If a local source PDF is absent, use a small original synthetic fixture reproducing its geometry. Do not spend the run hunting for or downloading a replacement textbook. Keep existing local books read-only and do not commit third-party PDF copies.

## 2. Settle the shared contract before broad edits

Write a brief migration note covering current behavior, the proposed model, consumers, compatibility, tests and rollback. Choose the smallest shared interface, then implement it. Suggested module boundaries are a pure layout analyzer, a PDF.js adapter, and block-aware rendering/pagination helpers; names are proposals, not requirements to scaffold many files.

Recommended data flow:

```text
PDF.js text items + optional tags
    -> immutable source runs and normalized geometry
    -> page regions, provisional local lines, special-span relationships
    -> ordered semantic blocks with evidence and source references
    -> pretty scroll / pretty pagination / Contents analysis
```

Geometry and semantic classification may refine one another; do not lock in a global line grouping before detecting columns or decorative initials. Share the geometric evidence between consumers. Keep document hierarchy/Contents rules distinct from page layout roles; a speaker is not automatically a Contents heading.

The model should express, at minimum:

- Source identity: document/page, extraction-version/options, source item index, original text, and local UTF-16 ranges when a run is split. Item indices are identities within a particular extraction, not guaranteed permanent IDs across PDF.js upgrades.
- Geometry: source transform, writing direction, baseline/orientation, available font metrics and an estimated bounding box. Preserve source coordinates and reversible viewport mapping. Mark estimates as estimates.
- Lines and regions: membership, bounds, body-size estimate, local indentation, alignment, and the distinction between source line boundaries and display wrapping.
- Blocks: paragraphs, headings, line-preserving groups, speaker labels/speeches, stage directions, lists, marginal notes/counters, running headers/footers, and unknown regions. Only assign specific roles when evidence supports them.
- Reading order, parent/association relationships where needed, categorical confidence with concrete reasons, and source references for every rendered text range.
- A deterministic text projection and source map for selection, pagination and navigation. Synthesized spaces/newlines must be distinguishable from source characters.

Define a conservation invariant at the captured PDF.js text-item boundary: account for every source text range, including material presented separately as annotations. Do not silently drop numbers, letters, punctuation, or uncertain items. Preserve the original captured strings even if a display projection normalizes whitespace, expands ligatures or rejoins words. Record such transformations and their source mappings. Any intentional deduplication needs geometry evidence and an audit trail.

Do not invent per-character precision: a PDF.js TextItem can contain many characters, and its public data does not promise individual glyph boxes. Retain run-level provenance; subdivide conservatively and identify approximated positions. Missing font metrics, unusual scaling, rotation and incomplete tags need explicit fallback behavior.

## 3. Build the interpretation in ordered passes

### A. Capture geometry and available structure

Use PDF.js `getTextContent` data including transform, width/height, `fontName`, direction, `hasEOL`, and `TextContent.styles`. Handle marked-content entries separately from text items if `includeMarkedContent` is enabled. Treat `hasEOL` as evidence, not proof of a semantic paragraph or verse boundary.

Investigate `getStructTree()` and marked-content IDs as an optional source of semantic roles/order for tagged PDFs. Prove the mapping using a small tagged fixture; tree nodes reference marked content, not arbitrary text-array indices. Tags can be absent, incomplete or wrong. Use validated coverage/order and geometry checks, and fall back predictably. Do not equate outlines/bookmarks with a complete page structure tree.

Normalize coordinates with page rotation, crop/view bounds and writing direction accounted for. Test a nonzero page origin and a rotated page. Derive local tolerances from robust body-font and line-spacing statistics rather than a single fixed pixel threshold or the largest letter. Keep superscripts, subscripts and decorative initials from distorting those statistics.

### B. Recover regions and reading order

Compare a simple whitespace/gutter segmentation approach with a constrained recursive XY-cut approach on the small fixture set. PdfPig's XY-cut/Docstrum and reading-order examples are useful algorithm references; do not implement every algorithm to make this comparison.

Detect sustained column gutters and separate page bands around full-width headings, figures or other spanning material. Read each column in the correct direction within its band. A spanning heading midway down the page must not cause a whole-page two-column sort to read material out of order. Distinguish ordinary page columns from speaker-label gutters, margin counters, tables and aligned lists. Use region width, repeated alignment, spacing and block relationships together.

Use deterministic local ordering or a small precedence graph if needed. If using a graph, define tie-breaking and cycle/conflict recovery; never stall or discard blocks. PDF drawing order is one signal, not the default logical order. Preserve uncertainty for sidebars, overlapping regions, parallel translations and ambiguous reading paths.

Avoid page-global all-pairs work when a sweep, spatial bins or regional partitioning will do. Start with the simpler suitable algorithm; add complexity only for a reproduced failure with a regression fixture.

### C. Correct drop caps before final line/heading decisions

Identify an enlarged initial using combined evidence: a short alphabetic run, location at the beginning of a paragraph/region, horizontal adjacency to its first text, vertical overlap across its opening lines, and body text flowing beside it. Support both a lowered cap spanning several lines and an enlarged raised initial when geometry warrants it. Do not rely on a universal size ratio or assume the initial is always Latin M.

Associate the initial with the earliest appropriate line in that same region, then join it to its word when spacing supports that. Account for an opening quotation mark. Keep the initial exactly once. Exclude a recognized decorative initial from the representative body/heading font-size calculation, while retaining its source geometry.

Negative cases must include a standalone mathematical variable, an equation, a single-letter heading, an initial in a neighboring column, an oversized normal first word, and multiple plausible attachment targets. In ambiguity, retain the original material and lower confidence rather than guessing a word. Do not fix the supplied sentence with a string replacement or globally suppress every line containing an oversized letter.

The reader's CSS-generated first-letter decoration must operate on the corrected logical beginning and only where appropriate. It must not turn a speaker label or stage direction into an ornamental chapter opening.

### D. Recover paragraphs, indentation and alignment

Recognize paragraph boundaries using indentation changes, interline/paragraph gaps, local column width, line endings and typography together. Justified prose and ragged-right prose need different expectations. Distinguish first-line indent, hanging indent, block quote, list and centered material using surrounding lines and repeated patterns.

Store indentation relative to the region/body measure, then render it in responsive units with a sensible clamp. Do not encode alignment as strings of spaces or preserve accidental PDF justification gaps. Keep ordinary wrapped prose reflowable and meaningful verse/dialogue line boundaries explicit. Preserve uncertain line groups instead of forcing all short lines into paragraphs. Avoid automatic dehyphenation unless it is conservative, source-mapped and separately tested.

### E. Interpret play dialogue and verse

Use repeated layout patterns plus nearby structural context to recognize speaker labels, speech bodies and stage directions. All-caps alone is insufficient. Names can be inline before speech, on a separate baseline, or in a side column; preserve those associations without turning them into independent article columns. Do not require a hardcoded list of Hamlet characters or a filename match.

Preserve verse lines and relative continuation indentation. Treat a source line shared by different speakers as potentially meaningful; do not automatically flatten shared or split verse into a single generic paragraph. Conversely, printed line wraps in prose dialogue need not imply verse: use available evidence and keep a neutral line-preserving representation when unsure. TEI's drama model is a semantic reference, not a PDF detection algorithm or a requirement to adopt XML.

Classify stage directions with multiple signals such as position, typography and surrounding speech structure; italics or brackets alone are insufficient. Keep directions attached to the right point in the reading sequence, including directions embedded within a speech.

Associate FTLN labels and other marginal counters with their source lines as annotation metadata or separate annotation blocks. Do not feed them into the speech's main text or into printed-TOC evidence. Preserve their content and expose a minimal way to inspect it; avoid a new annotation-management project. A real number spoken in dialogue must remain in the speech.

### F. Make headings and Contents consume the corrected model

Use a representative font-size/style distribution plus structural roles, spacing, numbering, alignment and existing outline/TOC evidence. Excluding recognized decorative initials is safer than using a line-wide maximum. Keep real body-sized Act/Scene headings detectable.

Preserve embedded destination resolution, printed-TOC page-label mapping, repeat-scene identities and manual overlays from the current repair. Evidence for page columns, a large initial, a speaker name or marginal counters must not by itself establish a Contents entry. Respect original source y anchors when feeding existing consumers; convert coordinates explicitly rather than reversing y conventions accidentally.

### G. Handle adjacent complexity honestly

Recognize or isolate running headers/footers, footnotes, captions, lists, tables, formulas, rotated side text and image-only pages sufficiently to avoid merging them into body paragraphs or columns. Repeated text plus position/style is stronger furniture evidence than margin location alone; legitimate top-edge headings must survive.

For unsupported tables/formulas/overlapping layouts, preserve source content and offer a region/page Original fallback with a concrete reason. Robust table reconstruction, math transcription, OCR, handwriting and universal vertical/RTL reflow are separate work unless already supported and covered by this implementation. Preserve direction metadata and safe fallback for those cases. Scope boundaries must not become silent text loss.

## 4. Integrate presentation, pagination and saved state

Both pretty reading paths must render the same block model. Do not preserve lines in scrolling mode and then flatten them in pagination. Use semantic DOM, actual line/group boundaries, and CSS indentation/alignment; keep selectable text and DOM reading order consistent with visual order. Render PDF text as text nodes rather than trusted HTML.

When an original meaningful line exceeds the available width, wrap it with a hanging continuation indent. Its next source line must still begin separately. Maintain speaker/speech relationships and avoid isolated speaker labels at leaf boundaries where practical. If an indivisible block cannot fit, define a safe splitting/fallback policy that always advances and never clips or loops. Do not make all source lines unbreakable or introduce horizontal page overflow.

The existing paginator's UTF-16 offsets are a compatibility hazard: correcting M placement, removing annotation text from the body projection, or changing separators changes those offsets. Before switching representations:

1. Define one canonical text/source-map projection used by pagination, navigation, selection and tests. Block fragments must retain source identity and structural boundaries.
2. Map legacy `{page, offset}` positions through the old projection to source text ranges where possible, then into the new representation. Define an explicit nearest-source/page fallback for unresolvable positions. Do not reinterpret an old numeric offset as if it addressed the new string.
3. Preserve `scrollPosition` behavior across view/size changes, and use source-based anchors for new precise positions if warranted. Do not promise exact old visual scroll fractions after a reflow; keep the same underlying content when a source mapping exists.
4. Preserve bookmarks, manual Contents renames/hides/reparenting/accepted candidates, selected same-page sections, expanded states and PDF bytes. Layout block IDs need not replace public Contents IDs.
5. Version affected layout caches and automatic structure snapshots deliberately. Explain upgrade/rescan, cancellation/manual opt-out, stable-ID reconciliation and rollback. Do not reset IndexedDB or discard overlays.

Keep analysis page-local/on-demand with bounded caches and cancellation. Share parsed data where practical so structure scans and reading do not launch redundant whole-book work. Separate interpretation caches from font-size/viewport-dependent pagination caches. Avoid retaining every page's PDF.js objects or DOM nodes. Introduce a worker only if measurement shows main-thread work is a problem.

## 5. Execute in milestones with exit criteria

1. **Baseline and contract:** add small reproductions for the known defects; document the schema, source mapping, consumers and compatibility strategy. Capture current relevant behavior and test results before changing it.
2. **Shared geometry and drop caps:** implement shared normalization/provenance and the drop-cap correction; connect extraction and heading sizing. The exact preface begins with `My goal` once, and its paragraph is absent from both automatic headings and review candidates. Regular text and legitimate headings remain intact.
3. **Regions and structural blocks:** add columns/spanning bands, indentation, paragraphs and play-line associations against deterministic fixtures. Validate both positive and adversarial examples before moving thresholds.
4. **End-to-end integration:** render/paginate the blocks in both modes, migrate/resolve reading anchors, feed corrected evidence to Contents, and preserve old manual state. This is essential; a standalone analyzer is not the completed feature.
5. **Verification and handoff:** run targeted checks, the repository suite and production build; visually inspect selected source/pretty comparisons in an isolated test origin. Document supported, ambiguous and deferred behavior, measured performance and remaining risks.

Proceed through authorized reversible work without asking for approval at every milestone. If new paid inference, an external upload, a new runtime, destructive data migration, or another material scope expansion appears necessary, finish the independently useful work and present the specific unresolved decision with evidence. Do not quietly expand the assignment.

## 6. Verification requirements

Use tiny original PDF fixtures and focused unit tests as the required, reproducible corpus. Use local Hamlet and the textbook for optional real-document regressions; missing optional files must not remove synthetic coverage. Avoid redistributing their contents as fixtures.

| Test group | Essential cases and assertions |
| --- | --- |
| Drop caps | Two/three-line lowered cap; raised initial; quotation mark; split runs; standalone variable/heading; near-column distractor. Correct word order and one occurrence of each source range; no false Contents candidate. |
| Prose/indentation | Indented and nonindented paragraphs, justified text, hanging list/quote, center alignment, punctuation, ligatures and discretionary hyphens. Preserve meaningful boundaries without freezing normal prose wraps. |
| Plays/verse | Inline/separate speakers, prose and verse, stanza gaps, stage directions, shared/split lines, real spoken numbers and marginal labels. Names remain with their speech; counters are retained separately. |
| Columns/order | One/two/three columns, uneven heights, heading above/across/midway between columns, sidebar, table-like numeric rows, changing column count. Assert exact expected block order and no cross-column line joining. |
| Geometry/tags | Nonzero origin, rotation, mixed sizes/superscripts, tagged PDF with valid/partial/incorrect structure, and absent tags. Assert coordinate conversion and predictable fallback; avoid unsupported precision claims. |
| Contents | Existing outline/printed-TOC cases and Hamlet's exact five-Act/twenty-Scene expectations; same-page boundaries, repeated Scene 1, no dialogue/counter flood. |
| Pagination/state | Very long source line, tiny viewport/large text, oversized block, page turn/cancel, resize, reload, same-page Contents jump, saved legacy offset and manual overlay. No clipped text, endless pagination, duplicate/gapped fragments or lost reading anchor. |
| Conservation | Source-range coverage and counts, annotation accounting, deterministic normalization map, Unicode/code-point-safe splits, no duplicated drop caps, and no silent discarded unknown regions. Character totals alone are insufficient to prove order. |

Use exact block-order expectations and adjacent/pairwise order assertions on the small corpus; check role accuracy and false heading counts separately. Do not substitute a visually plausible screenshot or total character count for these checks.

Run `npm test` and `npm run build` after relevant targeted checks pass. Use the repository's existing browser tooling and isolated origin conventions; never overwrite the user's normal shelf. Check desktop and a narrow phone viewport, small/default/large font sizes, scrolling and paginated pretty views, Original view, selection/copy order, navigation and reload. Render source/pretty comparisons for a representative page of each category. Check page/prose bounds and overflow, not just whether text exists.

Measure cold-page interpretation and subsequent cached/reflow behavior on a few representative pages, plus memory/cancellation on a larger synthetic document. Report environment, corpus and actual results; do not invent universal accuracy, millisecond budgets or performance improvements. Finish once relevant checks pass unless new failures justify more investigation.

## 7. Researched resources and how to use them

These are primary sources, not benchmark endorsements. The implementation strategy above is our proposed synthesis; none of the linked systems has been tested against this app's Hamlet/drop-cap cases during this research. Source descriptions below are limited to what their documentation or code supports.

### Read first: mechanisms transferable to this browser app

1. **[PDF.js page API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html)** and **[API source definitions](https://github.com/mozilla/pdf.js/blob/master/src/display/api.js)**. `getTextContent`, `getViewport`, optional `getStructTree`, text items/styles and marked-content types. The structure tree can be absent. Compare against the installed types before coding; public TextItems are runs, not guaranteed individual glyphs.
2. **[W3C PDF3: reading order](https://www.w3.org/WAI/WCAG22/Techniques/pdf/PDF3)**. Tagged structure supplies logical order; untagged or incorrectly tagged columns can be read across instead of down. Use this to distinguish visual geometry from logical/accessible order, including the need to verify tags rather than trusting their presence.
3. **[pdfminer.six layout analysis explanation](https://pdfminersix.readthedocs.io/en/latest/topic/converting_pdf_to_text.html)** and **[LAParams reference](https://pdfminersix.readthedocs.io/en/latest/reference/composable.html)**. Character overlap/gaps, inferred word spacing, line-to-box grouping and box ordering are separate heuristic stages. Tolerances are relative to character/line dimensions; `boxes_flow` changes ordering behavior. Borrow the staged reasoning, not a Python dependency or universal parameter values.
4. **[PdfPig document layout analysis](https://github.com/UglyToad/PdfPig/wiki/Document-Layout-Analysis)**. Concrete implementations of word extraction, recursive XY-cut, Docstrum, decoration classification and block reading-order detectors. Its documentation distinguishes segmentation from ordering and notes algorithm limits, including decoration-order failures. Compare one simple approach with the relevant examples; port ideas selectively and check licensing before copying code.
5. **[pdfplumber official README](https://github.com/jsvine/pdfplumber)**. Exposes character/word geometry, bounding boxes, configurable tolerances, crop operations and visual debugging. `layout=True` is explicitly experimental; underlying PDF text-flow ordering is not guaranteed logical. Good reference for inspectable geometric evidence and word/space joining, not proof that layout becomes semantic structure automatically.
6. **[PyMuPDF text recipes](https://pymupdf.readthedocs.io/en/latest/recipes-text.html)** and **[TextPage API](https://pymupdf.readthedocs.io/en/latest/textpage.html)**. Native extraction order, coordinate-based sorting, block/word outputs and positional reconstruction. Useful diagnostic comparison; a coordinate sort is not a complete reading-order algorithm. This is a Python/native stack, not a drop-in browser module.
7. **[TEI Performance Texts](https://tei-c.org/release/doc/tei-p5-doc/en/html/DR.html)**, especially sections 7.2.2, 7.2.5 and 7.2.6. Models speakers, speeches, stage directions and speech contents, including verse split across speakers. Use its distinctions to design play blocks and tests. It does not detect those roles from PDF geometry, and adopting TEI/XML is unnecessary.

### Architecture comparisons: learn from them without installing them

8. **[Docling document model](https://docling-project.github.io/docling/concepts/docling_document/)** and **[architecture](https://docling-project.github.io/docling/concepts/architecture/)**. Separates content items, hierarchy, body/furniture, geometry and provenance; tree/child order represents reading order. This supports a structured intermediate representation rather than immediately flattening into Markdown or paragraphs.
9. **[Docling heading hierarchy guide](https://github.com/docling-project/docling/blob/main/docs/usage/heading_levels.md)** and **[pipeline options](https://docling-project.github.io/docling/reference/pipeline_options/)**. Separates heading-level inference from reading-order processing, with outline/numbering/style signals and explicit configuration. Useful comparison for avoiding font-size-only heading logic. Features and defaults are version-sensitive.
10. **[Docling Technical Report](https://arxiv.org/abs/2408.09869)**. Describes model-based layout/table recognition in a conversion pipeline. Useful for understanding what trained components add; it does not establish that comparable robustness is free in a small deterministic browser implementation.
11. **[GROBID design principles](https://grobid.readthedocs.io/en/latest/Principles/)**. Uses a cascade of specialized models, beginning with document zones and applying finer interpretation to smaller areas. Borrow the separation of concerns and progressively narrower decisions. GROBID's research-document extraction domain and runtime are different from a consumer book reader.
12. **[Marker official repository](https://github.com/datalab-to/marker)**. Describes layout/text/OCR/model stages, extensible processors/renderers and hierarchical JSON blocks with geometry. Its current pipeline includes local model inference and optional external LLM enhancement. Treat it as an architectural comparison, not a lightweight dependency or guaranteed answer to these defects. Code and model license terms must be checked separately for any future adoption.
13. **[Unstructured partitioning](https://docs.unstructured.io/open-source/core-functionality/partitioning)** and **[strategy-selection implementation](https://github.com/Unstructured-IO/unstructured/blob/main/unstructured/partition/strategies.py)**. Shows explicit fast/layout/OCR strategy boundaries and conditional selection/fallbacks. Useful precedent for making extraction capability and fallback behavior visible; do not automatically escalate readable PDFs into a costly inference path.
14. **[PyMuPDF4LLM official repository](https://github.com/pymupdf/PyMuPDF4LLM)**. Documents layout-aware conversion and multicolumn handling on a Python/native stack. A possible future diagnostic comparator, not required infrastructure. Recheck transitive dependencies and licensing rather than assuming its behavior is identical to basic `Page.get_text` sorting.

### Evaluation and representation references; no bulk downloads

15. **[DocLayNet official dataset repository](https://github.com/DS4SD/DocLayNet)**. Provides diverse page-region annotations and labeling guidance. Useful for defining category coverage and train/test-style separation of fixture layouts. Layout-region boxes/categories alone do not demonstrate correct dialogue semantics or complete reading order. Do not download its large dataset for this scoped implementation.
16. **[PRImA PAGE XML repository](https://github.com/PRImA-Research-Lab/PAGE-XML)**. Reference for representing page content and explicit structure in document-analysis tooling. Consult only if the minimal internal model needs a clearer representation of regions/order; implementing PAGE XML serialization is outside scope.

## 8. Final report expected from you

Explain the implemented pipeline and supported layouts, list changed ownership areas, show concrete before/after results for the preface and Hamlet, and report targeted/full/build/browser validation separately. Explain source conservation, reading-order checks, legacy-anchor/manual-edit migration, performance measurements and remaining fallbacks. Mark anything unimplemented or unverified clearly. Include the required skill audit under applicable instructions. Do not claim a complete layout rebuild if only the extractor or only one pretty view was changed.
