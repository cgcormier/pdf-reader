import { preference, savePreference } from './storage.js';

export const DESIGN_PREFERENCE = 'reader-design';
export const READER_DESIGNS = Object.freeze([
  Object.freeze({ id: 'current', label: 'Current', description: 'The familiar, quiet reading room.' }),
  Object.freeze({ id: 'margin-house', label: 'Margin House', description: 'Literary whites, fine rules and an oxblood accent.' }),
  Object.freeze({ id: 'signal-studio', label: 'Signal Studio', description: 'Precise structure, cool paper and cobalt details.' }),
  Object.freeze({ id: 'common-ground', label: 'Common Ground', description: 'Warm paper, pine structure and playful coral.' }),
]);

export function normalizeReaderDesign(value) {
  return READER_DESIGNS.some(design => design.id === value) ? value : 'current';
}

// Only surface styling changes. No book, pagination, scroll or PDF state is touched.
export function applyReaderDesign(body, value) {
  const design = normalizeReaderDesign(value);
  body.dataset.readerDesign = design;
  return design;
}

export function attachDesignSwitcher({ document: doc = document } = {}) {
  const host = doc.querySelector('.header-actions');
  if (!host || doc.getElementById('reader-design-button')) return null;
  let selected = applyReaderDesign(doc.body, preference(DESIGN_PREFERENCE, 'current'));
  const button = doc.createElement('button');
  button.id = 'reader-design-button';
  button.className = 'quiet-button reader-design-button';
  button.type = 'button';
  button.textContent = 'Design';
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-controls', 'reader-design-dialog');
  button.title = 'Choose a reader design';

  const dialog = doc.createElement('dialog');
  dialog.id = 'reader-design-dialog';
  dialog.className = 'reader-design-dialog';
  dialog.setAttribute('aria-labelledby', 'reader-design-title');
  dialog.setAttribute('aria-describedby', 'reader-design-description');
  const heading = doc.createElement('div');
  heading.className = 'reader-design-heading';
  const title = doc.createElement('h2');
  title.id = 'reader-design-title';
  title.textContent = 'Reader design';
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'reader-design-close';
  close.textContent = 'Close';
  close.setAttribute('aria-label', 'Close reader design');
  heading.append(title, close);
  const description = doc.createElement('p');
  description.id = 'reader-design-description';
  description.textContent = 'A different atmosphere. Your book, place and reading controls stay the same.';
  const options = doc.createElement('div');
  options.className = 'reader-design-options';
  options.setAttribute('role', 'group');
  options.setAttribute('aria-label', 'Reader designs');
  const status = doc.createElement('p');
  status.className = 'reader-design-status';
  status.setAttribute('role', 'status');
  const choices = READER_DESIGNS.map(design => {
    const choice = doc.createElement('button');
    choice.type = 'button';
    choice.className = 'reader-design-option';
    choice.dataset.designChoice = design.id;
    choice.setAttribute('aria-pressed', String(selected === design.id));
    const label = doc.createElement('strong');
    label.textContent = design.label;
    const detail = doc.createElement('span');
    detail.textContent = design.description;
    choice.append(label, detail);
    choice.addEventListener('click', () => {
      selected = applyReaderDesign(doc.body, design.id);
      choices.forEach(item => item.setAttribute('aria-pressed', String(item.dataset.designChoice === selected)));
      const saved = savePreference(DESIGN_PREFERENCE, selected);
      status.textContent = `${design.label} selected.${saved ? '' : ' Saved for this visit only; browser storage is unavailable.'}`;
    });
    options.append(choice);
    return choice;
  });
  dialog.append(heading, description, options, status);
  doc.body.append(dialog);
  host.prepend(button);
  button.addEventListener('click', () => {
    if (!dialog.open) dialog.showModal();
    choices.find(choice => choice.dataset.designChoice === selected)?.focus();
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => button.focus());
  // Keep reader shortcuts (including Escape-to-exit-focus) out of this modal.
  // Native dialog cancel handles Escape without preventing its default behavior.
  dialog.addEventListener('keydown', event => event.stopPropagation());
  return { button, dialog };
}
