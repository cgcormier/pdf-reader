import { build } from 'vite';
import { cp, readdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';

await build();
for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
  await cp(resolve('node_modules/pdfjs-dist', folder), resolve('dist/pdf-assets', folder), { recursive: true });
}

async function files(directory) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) results.push(...await files(path));
    else results.push(`/${relative(resolve('dist'), path).replaceAll('\\', '/')}`);
  }
  return results;
}
const assets = (await files(resolve('dist'))).filter(path => path !== '/sw.js');
await writeFile(resolve('dist/asset-list.json'), JSON.stringify(['/', ...assets]));
const version = createHash('sha256').update(JSON.stringify(assets)).update(await readFile(resolve('dist/index.html'))).digest('hex').slice(0, 12);
const worker = await readFile(resolve('dist/sw.js'), 'utf8');
await writeFile(resolve('dist/sw.js'), worker.replace('folio-v1', `folio-${version}`));
console.log('Local PDF fonts, character maps, and offline asset list are ready.');
