const chapterPrefix = /^(?:chapter|part|book)\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+|[ivxlcdm]+)\b\s*/i;
const normalized = value => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Remove a duplicate standalone heading only. Never discard a heading that
// was merged with body text: text fidelity takes precedence over typography.
export function removeRepeatedChapterHeading(paragraphs, title) {
  if (!paragraphs.length) return paragraphs;
  const source = normalized(paragraphs[0]).replace(chapterPrefix, '');
  const heading = normalized(title).replace(chapterPrefix, '');
  return source && source === heading ? paragraphs.slice(1) : paragraphs;
}

// Source-page navigation also works when a chapter jump starts on an even page.
// Stop when the visible spread already contains the last page.
export function sourcePageNavigation(page, count, spreadSize = 1) {
  const end = Math.min(count, page + spreadSize - 1);
  return {
    end,
    previous: page > 1 ? Math.max(1, page - spreadSize) : null,
    next: end < count ? Math.min(count, page + spreadSize) : null,
  };
}

export function swipePageDirection({ x, y, elapsed, hasSelection = false }) {
  if (hasSelection || elapsed > 900 || elapsed < 0 || Math.abs(x) < 60 || Math.abs(x) <= Math.abs(y) * 1.5) return null;
  return x < 0 ? 'next' : 'previous';
}
