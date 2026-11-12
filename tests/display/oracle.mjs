export const normalize = text => text.replace(/\s+/g, ' ').trim();
export function compare(expected, actual) {
  const failures = [];
  if (normalize(actual.text) !== normalize(expected.text)) failures.push('displayed text differs from expected ordered text');
  if (JSON.stringify(actual.headings.map(normalize)) !== JSON.stringify(expected.headings.map(normalize))) failures.push('displayed heading roles differ');
  if (JSON.stringify((actual.introductions || []).map(normalize)) !== JSON.stringify((expected.introductions || []).map(normalize))) failures.push('generated chapter introductions differ');
  if (!Array.isArray(actual.visibility) || !actual.visibility.length || actual.visibility.some(v => !v.ok)) failures.push('text is hidden or clipped');
  return failures;
}
export function compareContents(expected, actual) {
  return JSON.stringify(actual.map(({ title, page, y }) => ({ title, page, y: y == null ? null : Math.round(y * 1000) / 1000 }))) === JSON.stringify(expected)
    ? [] : ['Contents titles, pages, or source baselines differ'];
}
export function comparePartial(expected, actual) {
  const failures = [];
  if (!normalize(actual.text).includes(expected.contains)) failures.push('expected passage missing');
  if (expected.forbidden.some(text => actual.text.includes(text))) failures.push('running header appears in reading text');
  if (actual.headings.length) failures.push('unexpected heading on continuation page');
  if (!actual.visibility.length || actual.visibility.some(v => !v.ok)) failures.push('text is hidden or clipped');
  return failures;
}
export function compareTableRows(rows, blocks) {
  return rows.filter(row => !blocks.some(block => normalize(block.text).includes(row) && block.singleLine)).map(row => `table row cells separated: ${row}`);
}
