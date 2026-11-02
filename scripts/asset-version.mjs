import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Stable URLs (PDFs, fonts, icons) need cache invalidation when their bytes change.
export async function assetVersion(directory, assets) {
  const digest = createHash('sha256');
  for (const asset of [...assets].sort()) {
    const bytes = await readFile(path.join(directory, asset.replace(/^\//, '')));
    digest.update(JSON.stringify([asset, bytes.length])).update(bytes);
  }
  return digest.digest('hex').slice(0, 12);
}
