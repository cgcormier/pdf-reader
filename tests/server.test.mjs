import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { APPLICATION_ID, assertBuildExists, createServer } from '../scripts/server.mjs';

let fixtureRoot;
let distDirectory;
let server;
let baseUrl;

before(async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'folio-server-test-'));
  distDirectory = path.join(fixtureRoot, 'dist');
  await mkdir(distDirectory);
  await Promise.all([
    writeFile(path.join(distDirectory, 'index.html'), '<!doctype html><title>Folio</title>'),
    writeFile(path.join(distDirectory, 'app.mjs'), 'export default true;'),
    writeFile(path.join(distDirectory, 'app.js'), 'console.log("Folio");'),
    writeFile(path.join(distDirectory, 'reader.wasm'), Buffer.from([0, 97, 115, 109])),
    writeFile(path.join(distDirectory, 'cover.png'), Buffer.from([137, 80, 78, 71])),
    writeFile(path.join(distDirectory, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>'),
    writeFile(path.join(distDirectory, 'manifest.webmanifest'), '{"name":"Folio"}'),
    writeFile(path.join(distDirectory, 'Adobe-Identity-H.bcmap'), Buffer.from([1, 2, 3])),
    writeFile(path.join(fixtureRoot, 'outside.txt'), 'outside dist'),
  ]);
  server = createServer({ distDirectory });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
});

test('serves the production index and unique Folio health identity', async () => {
  const index = await fetch(`${baseUrl}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /^text\/html;/);
  assert.match(await index.text(), /Folio/);

  const healthResponse = await fetch(`${baseUrl}/health`);
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), { application: APPLICATION_ID, status: 'ok' });
  assert.equal(APPLICATION_ID, 'folio-reader');
});

test('serves bundled assets with browser-safe MIME types', async () => {
  const expectedTypes = new Map([
    ['/app.js', /^text\/javascript;/],
    ['/app.mjs', /^text\/javascript;/],
    ['/reader.wasm', /^application\/wasm$/],
    ['/cover.png', /^image\/png$/],
    ['/icon.svg', /^image\/svg\+xml$/],
    ['/manifest.webmanifest', /^application\/manifest\+json;/],
    ['/Adobe-Identity-H.bcmap', /^application\/octet-stream$/],
  ]);

  for (const [assetPath, expectedType] of expectedTypes) {
    const response = await fetch(`${baseUrl}${assetPath}`);
    assert.equal(response.status, 200, assetPath);
    assert.match(response.headers.get('content-type'), expectedType, assetPath);
  }
});

test('returns 404 for missing assets without falling back to the app shell', async () => {
  const response = await fetch(`${baseUrl}/missing.js`);
  assert.equal(response.status, 404);
  assert.equal(await response.text(), 'Not found');
});

test('rejects encoded traversal and malformed URL escapes', async () => {
  for (const requestPath of ['/..%2foutside.txt', '/%2e%2e/outside.txt', '/..%5coutside.txt', '/%E0%A4%A']) {
    const response = await fetch(`${baseUrl}${requestPath}`);
    assert.notEqual(response.status, 200, requestPath);
  }

  const traversal = await fetch(`${baseUrl}/%2e%2e/outside.txt`);
  assert.ok([400, 404].includes(traversal.status));
});

test('supports HEAD and rejects write methods', async () => {
  const head = await fetch(`${baseUrl}/app.mjs`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');

  const post = await fetch(`${baseUrl}/`, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
});

test('gives an actionable build message when production files are missing', async () => {
  const missingDist = path.join(fixtureRoot, 'missing-dist');
  await assert.rejects(assertBuildExists(missingDist), /npm run build/);

  const missingServer = createServer({ distDirectory: missingDist });
  await new Promise((resolve, reject) => {
    missingServer.once('error', reject);
    missingServer.listen(0, '127.0.0.1', resolve);
  });
  try {
    const missingResponse = await fetch(`http://127.0.0.1:${missingServer.address().port}/`);
    assert.equal(missingResponse.status, 503);
    assert.match(await missingResponse.text(), /npm run build/);
  } finally {
    await new Promise((resolve) => missingServer.close(resolve));
  }
});
