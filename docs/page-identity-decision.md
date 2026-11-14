# Source page identity decision

Local ticket 02. No publication.

## Socratic review before implementation

- Page-identity agent: Should reflow leaves receive new numbers? Their count changes with font size and viewport, so that would detach navigation from the source PDF.
- Integrator: Would a visible PDF-page form and compact numbered leaves be sufficient? What about the built-in sample, which is not an actual PDF?
- Page-identity agent: Use “Source page” universally. This describes both the sample and imports accurately and keeps the same mental model across modes. Keep the continuation mark only on the leaf.
- Integrator: Is the footer's continuation suffix redundant? It repeats what the leaf says and consumes space.
- Resolution: “Source page” or “Source pages” plus a source range in the footer; compact leaf numbers with “continued” and explicit accessible descriptions. A tooltip explains why a source page may span leaves. No virtual page totals or navigation changes.

## Alternatives rejected

Virtual leaf numbering is unstable after reflow. A separate page/spread numbering toggle adds another concept without improving source navigation. PDF-only wording is misleading for the sample. Repeated continuation suffixes add clutter.

## Reflow assessment

Short fragments are a real typography concern but not evidence of lost content. Do not merge content across source boundaries just to balance a spread. A separate narrowly bounded widow/orphan ticket is justified only with lossless, source-anchor, and fit tests. The current patch changes labels only.
