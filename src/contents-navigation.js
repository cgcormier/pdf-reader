// Input is the normalized structure model; validation belongs to structureNodes.
export function indexContents(nodes) {
  const byId = new Map();
  const children = new Map();
  for (const node of nodes) {
    byId.set(node.id, node);
    if (!children.has(node.parentId)) children.set(node.parentId, []);
    children.get(node.parentId).push(node);
  }
  return { byId, children };
}

export function filterContents(index, query) {
  const term = query.trim().toLocaleLowerCase();
  const matches = new Set();
  const visible = new Set();
  for (const node of index.byId.values()) {
    if (term && !node.title.toLocaleLowerCase().includes(term)) continue;
    matches.add(node.id);
    let current = node;
    // Shared ancestors are visited once, including when every title matches.
    while (current && !visible.has(current.id)) {
      visible.add(current.id);
      current = index.byId.get(current.parentId);
    }
  }
  return { filtering: Boolean(term), matches, visible };
}
