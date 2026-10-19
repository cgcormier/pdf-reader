# Readwell design book: asset and evidence references

## Asset handling

The three atmosphere images below were generated for this design exploration with the built-in ImageGen tool. They are visual cues, not screenshots of existing products. The book is blank by design: every exact label, body-text excerpt, icon, screen, measurement, grid, and callout is rendered with editable HTML, CSS, or SVG.

| File | Direction | Use |
|---|---|---|
| assets/quiet-paper.png | Quiet Paper | Selected welcome and cover atmosphere: warm daylight, open book, ceramic coffee cup |
| assets/daylight-index.png | Stillwater | Airy reading scene, pale blue bookmark, soft daylight |
| assets/garden-margins.png | Garden Margins | Soft botanical detail, linen, pale sage |
| assets/coffee-motif.svg | Quiet Paper | Editable, single-line cup with steam and two faint coffee-ring arcs |

The three photos were generated for this exploration. The coffee mark is code-native SVG. Warm coffee imagery and the small line-art motif live in the cover, welcome concept, and mood board; neither appears behind reading text or acts as a control. Keep photography and texture outside the reading-paper text area so it cannot reduce text contrast.

## Product evidence read before design

The existing product is named Folio in its current source and documentation. The proposed identity in this book is Readwell. No production files were changed.

Current behavior represented in the mockups: local PDF open/drop and parsing, chapter navigation, Book view and Original PDF, Page flip and Scroll layouts, text-size adjustment, warm paper and After hours appearance, focus mode, page progress, bookmarks and the browser-local shelf, plus loading, password, invalid-PDF, and save-error states. Current file limits, storage behavior, and privacy boundaries remain those stated in the project README and plan.

New visual identity, the Quiet Paper recommendation, public welcome shell, default Light theme, coffee motif, and detailed Readwell layout/token values are proposals. The appearance names Light, Warm paper, and Dark in the settings specimen describe the proposed presentation; Light is new, while Folio currently has warm-paper and After hours dark appearances. The proposed palette values do not claim to be the source colors already implemented.

The shared reading excerpt comes from src/demo.js, the bundled eight-page sample The Art of Noticing. The three comparisons use the same title, chapter, paragraphs, page number, controls, and state.

## Color and accessibility sources

The selected Quiet Paper palette follows the user's latest direction: warm, low-saturation paper tones with high-contrast ink and roast-brown actions. The supplied blue-green palette remains a documented alternate direction. Neither color nor coffee is presented as a promise of calm or better cognition.

- [Do we feel colours? A systematic review of 128 years of psychological research linking colours and emotions](https://pmc.ncbi.nlm.nih.gov/articles/PMC12325498/) — user-supplied review; its color associations are not presented as a guaranteed effect for every reader.
- [Color and emotion: effects of hue, saturation, and brightness](https://link.springer.com/article/10.1007/s00426-017-0880-8) — a controlled color-viewing study; used only as context for keeping saturation and brightness restrained.
- [Cognitive performance and emotion are indifferent to ambient color](https://onlinelibrary.wiley.com/doi/10.1002/col.22168) — user-supplied counterpoint to claims that a color improves thinking.
- [Color and cognition: A meta-analysis of color effects on performance](https://pmc.ncbi.nlm.nih.gov/articles/PMC7704521/) — user-supplied counterpoint; no general performance claim is made in the Readwell rationale.
- [W3C: Understanding Success Criterion 1.4.3, Contrast (Minimum)](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html) — normal text target of 4.5:1; large text target of 3:1.
- [Light exposure and alertness: a systematic review](https://pubmed.ncbi.nlm.nih.gov/38981576/) — lighting evidence is kept separate from interface color claims.

## Design-method references

- Existing Folio source: index.html, src/main.js, src/styles.css, src/demo.js, and README.md.
- UI UX Pro Max local search used for reading-focused style, editorial type, visible focus, keyboard order, and reduced motion. Its generic landing-page recommendation did not match a reader with an immediate open action, so it was not adopted.
- Brandkit guidance informed the quiet grid, restrained imagery, coherent material language, and sparse captions. ImageGen created atmosphere only; the coffee motif, precise interface content, measurements, and annotations remain editable SVG/HTML/CSS.
