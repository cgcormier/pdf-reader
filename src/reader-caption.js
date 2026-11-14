/** Original mode omits supplemental captions to avoid competing with source content.
 * Keep the app's contextual caption for reflowed books only; never edit source text.
 */
export function updateReaderCaption(caption, mode) {
  caption.hidden = mode === 'original';
}
