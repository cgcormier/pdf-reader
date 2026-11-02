# Local test assets

This directory contains two retained assets with different roles:

- `Hamlet.pdf` is a shared regression document. Browser tests import it in
  `tests/desktop.browser.mjs`, `tests/fidelity-desktop.browser.mjs` and
  `tests/fidelity-audit.browser.mjs`; the
  optional PDF.js runtime test also reads it in
  `tests/document-structure-runtime.test.mjs`. The fidelity and layout notes
  in `docs/fidelity-pagination.md`,
  `docs/layout-interpretation-agent-prompt.md`, and
  `docs/navigation-performance.md` describe the pages and behaviors used for
  review. It first appears in `90ef1a8` (October 19, 2026); the repository
  does not establish the original download URL or redistribution terms.
  Its SHA-256 is `61b29ecdfc84ebb24e9b919dfcb7faa435f4886d289f34ea3c6191010577e5e3`.
  Keep the original bytes stable while those tests depend on it; inclusion
  here does not establish rights for a new external evidence package.
- `download.jpg` is an illustration of stacked books. It has no source-code or
  test consumer in this checkout. Git history shows it first appeared in
  `9f36105` (October 23, 2026), alongside the page-flip work, but does not
  establish its original source or license. Keep it while that provenance is
  unresolved; do not treat the lack of a code reference as authorization to
  remove it.

The directory name is historical. These are retained inputs, not a destination
for new browser downloads. Synthetic browser PDFs are generated separately by
`node tests/create-fixtures.mjs` under ignored `output/playwright/`.
