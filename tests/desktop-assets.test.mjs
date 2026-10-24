import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { APP_URL, assetResponse, isAppUrl } from '../desktop/assets.mjs';

let root;
let dist;
before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'folio-assets-'));
  dist = path.join(root, 'dist');
  await mkdir(dist);
  await Promise.all([
    writeFile(path.join(dist, 'index.html'), '<title>Folio</title>'),
    writeFile(path.join(dist, 'reader.mjs'), 'export default 1'),
    writeFile(path.join(dist, 'reader.wasm'), Buffer.from([0, 97, 115, 109])),
    writeFile(path.join(root, 'private.txt'), 'outside the app'),
  ]);
});
after(async () => { await rm(root, { recursive: true, force: true }); });

test('desktop serves the bundled index, module and WASM with a local-only content policy', async () => {
  for (const [name, type] of [['', 'text/html'], ['reader.mjs', 'text/javascript'], ['reader.wasm', 'application/wasm']]) {
    const response = await assetResponse(new Request(`${APP_URL}${name}`), dist);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').startsWith(type));
    assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
    const bytes = await response.arrayBuffer();
    assert.equal(bytes.byteLength, Number(response.headers.get('content-length')));
    assert.ok(bytes.byteLength > 0);
  }
});

test('desktop rejects other origins, credentials, ports, malformed paths and writes', async () => {
  assert.equal(isAppUrl(APP_URL), true);
  assert.equal(isAppUrl(`${APP_URL}index.html#reading-area`), true);
  for (const url of ['https://example.com/', 'file:///etc/passwd', 'folio://other/', 'folio://app:123/', 'folio://user@app/', 'not a url']) {
    assert.equal(isAppUrl(url), false, url);
  }
  for (const pathname of ['..%2fprivate.txt', '..%5cprivate.txt', '%00', '%E0%A4%A', 'missing.js']) {
    const response = await assetResponse(new Request(`${APP_URL}${pathname}`), dist);
    assert.ok([400, 404].includes(response.status), pathname);
  }
  const foreign = await assetResponse(new Request('folio://other/index.html'), dist);
  assert.equal(foreign.status, 404);
  const write = await assetResponse(new Request(APP_URL, { method: 'POST', body: 'test' }), dist);
  assert.equal(write.status, 405);
  assert.equal(write.headers.get('allow'), 'GET, HEAD');
});

test('desktop handles HEAD and refuses directories or symlinks outside bundled assets', async t => {
  const head = await assetResponse(new Request(APP_URL, { method: 'HEAD' }), dist);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.ok(Number(head.headers.get('content-length')) > 0);
  await mkdir(path.join(dist, 'directory'));
  assert.equal((await assetResponse(new Request(`${APP_URL}directory`), dist)).status, 404);
  try {
    await symlink(path.join(root, 'private.txt'), path.join(dist, 'link.txt'));
  } catch (error) {
    if (error.code === 'EPERM') { t.diagnostic('Symlink check unavailable without Windows symlink permission'); return; }
    throw error;
  }
  assert.equal((await assetResponse(new Request(`${APP_URL}link.txt`), dist)).status, 404);
});
