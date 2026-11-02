import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assetVersion } from '../scripts/asset-version.mjs';

test('offline version changes for stable-path bytes and is independent of enumeration order', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(),'folio-asset-version-'));
  try {
    await writeFile(path.join(directory,'index.html'),'<title>unchanged app</title>');
    await writeFile(path.join(directory,'sample.pdf'),'fixture version A');
    const assets=['/index.html','/sample.pdf'];
    const before=await assetVersion(directory,assets);
    assert.equal(await assetVersion(directory,[...assets].reverse()),before);
    await writeFile(path.join(directory,'sample.pdf'),'fixture version B');
    assert.notEqual(await assetVersion(directory,assets),before);
    assert.notEqual(await assetVersion(directory,['/index.html']),before);
    await assert.rejects(assetVersion(directory,['/missing.pdf']),{code:'ENOENT'});
  } finally { await rm(directory,{recursive:true,force:true}); }
});
