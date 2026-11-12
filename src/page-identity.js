/** Stable source identity, independent of viewport-dependent reflow leaves. */
export function sourcePageIdentity(page, end, count, continued = false) {
  const range = end > page;
  return {
    label: range ? 'Source pages' : 'Source page',
    tail: `${range ? `– ${end} ` : ''}of ${count}`,
    description: range
      ? `Source pages ${page} to ${end} of ${count}`
      : `Source page ${page}${continued ? ', continued' : ''} of ${count}`,
    leafDescription: `Source page ${page}${continued ? ', continued' : ''}`,
  };
}
