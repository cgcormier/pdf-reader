# Reader design directions

The header's **Design** button opens four choices: **Current**, **Margin House**, **Signal Studio**, and **Common Ground**. Current remains the default and the fallback for an invalid saved value. Selecting a direction changes the real reader's surface styling, not the PDF implementation or the document being read.

The choice is stored as the separate `reader-design` preference. If browser storage is unavailable, the dialog explicitly reports that the choice lasts for this visit only. The dialog exposes pressed states, focuses the selected choice when opened, and restores focus to its trigger when closed. Its keyboard events do not reach reader shortcuts; native dialog cancellation handles Escape.

## Source and interpretation

These are production-reader adaptations of the previous design atelier, not pixel-identical recreations of its holistic HTML prototypes. The original `{margin-house,signal-studio,common-ground}/{index,reader,library,directions}.html` artifacts were not found in the current workspace. The prior Slack design contracts supply the verified visual direction. Prototype parsing, storage, PDF and installation demonstrations must not replace the current application's real behavior.

### Margin House: The Review

Literary/editorial direction: warm white `#FBFAF7`, near-black `#20201E`, and scarce oxblood `#8E292B`. Georgia and system-sans controls, fine rules, and unboxed catalogue treatment inform the adaptation.

Source: [Margin House atelier](https://newworkspace-kty2008.slack.com/archives/C0CEVBJD6QP/p1794440624485329).

### Signal Studio: Meridian + Index

The recommended combination was the Meridian reader and Index library: cool paper `#F4F6F9`, ink `#111827`, and cobalt `#2548F4`. Precise structure, square controls, and restrained catalogue styling inform the adaptation. The source's oversized identity numerals do not intrude on the reading surface.

Source: [Signal Studio atelier](https://newworkspace-kty2008.slack.com/archives/C0CEVBJD6QP/p1794440625770059).

### Common Ground: Reading Garden

Paper-first reading with pine structure and coral accents: paper `#F4F1E7`, pine `#193F35`, coral `#E77356`, and yellow `#E8C45A`. Normal text on coral uses the source review's corrected dark `#102C24`, rather than the insufficiently contrasting pine/coral pairing. Expressive surroundings should leave the document quiet.

Source: [Common Ground atelier](https://newworkspace-kty2008.slack.com/archives/C0CEVBJD6QP/p1794440626761179).

## Integration boundaries

- Theme selectors are scoped to `body[data-reader-design]`; Current has no theme overrides.
- Each direction supplies light and dark-paper colors.
- Existing controls and actual PDF functionality remain in place. Switching does not intentionally rerender, reset the book, or change its saved place.
- Existing page dimensions, reading text metrics, pagination, page-turn transforms, contents dragging and focus-mode visibility remain owned by the reader.
- The prototype's 64–80px desktop and 24px mobile gutters are deliberately not imposed on live reader geometry. Common Ground's prototype 19px reading default is likewise not forced onto an existing book.
- No new theme animation is introduced. Existing responsive and reduced-motion behavior remains authoritative.

This conservative integration prioritizes compatibility with the newer reader controls. It does not claim the full spatial composition of the original prototypes.

## Files

- `src/design-switcher.js`: validated choice, dialog and independent preference.
- `src/design-switcher.css`: dialog and trigger styling.
- `src/design-margin.css`, `src/design-signal.css`, `src/design-common.css`: scoped visual directions.
- `src/main.js`: initialization and stylesheet imports.
- `tests/design-switcher.test.mjs`: selector/helper checks.

## Verification status

Local verification: 299 Node tests and the production build passed. Selector coverage includes fake-DOM persistence, invalid values, storage denial, keyboard isolation and focus restoration. Browser verification was attempted but blocked: Chrome was missing and installed Chromium aborted with a socket permission error. No screenshots or browser assertions passed. The runnable matrix is `tests/design-switcher.browser.mjs`. Review corrected small page-furniture contrast in dark themes and compacted the narrow header without removing library access. Actual visual validation remains pending.

Pending browser checks include keyboard focus and Escape, 320/390px header fit, mobile dialog scrolling, every design in light/dark and text/original PDF modes, page/scroll layouts, immersive/focus transitions, hover bridge traversal, contents drag/close, reduced motion, and preserved reading position after switching. No deployment or publication is implied by this local document.
