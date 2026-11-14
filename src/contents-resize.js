export function contentsWidthBounds(workspaceWidth) {
  return { min: 260, max: Math.max(260, Math.min(480, workspaceWidth - 560)) };
}

export function effectiveContentsWidth(preferred, workspaceWidth) {
  const { min, max } = contentsWidthBounds(workspaceWidth);
  const fallback = workspaceWidth <= 1100 ? 270 : 280;
  const width = Number.isFinite(preferred) ? preferred : fallback;
  return Math.round(Math.max(min, Math.min(max, width)));
}

export function contentsWidthKey(key, width, bounds, shift = false) {
  if (key === 'Home') return bounds.min;
  if (key === 'End') return bounds.max;
  const step = shift ? 48 : 16;
  if (key === 'ArrowLeft') return Math.max(bounds.min, width - step);
  if (key === 'ArrowRight') return Math.min(bounds.max, width + step);
  return null;
}
