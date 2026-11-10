// Serial portable rendering gate. Performance calibration is a separate run.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const real = process.argv.includes('--real');
if (process.env.FOLIO_FIDELITY_BASELINE === '1' || process.env.FOLIO_EXECUTABLE
  || process.env.RECOVERY_BROWSER_URL || process.env.RECOVERY_ISSUE || process.env.FOLIO_TEST_NO_SANDBOX === '1') {
  throw new Error('Acceptance requires the current build, normal sandbox, isolated origin, and no baseline-diagnostic override');
}
await mkdir('output/playwright/audit-gate', { recursive:true });
const run = await mkdtemp('output/playwright/audit-gate/run-');
const report = { status:'running', matrix:real ? 'core-and-real' : 'portable-core',
  commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  diffSha256:createHash('sha256').update(execFileSync('git',['diff','HEAD'])).digest('hex'), checks:[] };
const inputs = execFileSync('git',['ls-files','--cached','--others','--exclude-standard'],{encoding:'utf8'}).trim().split(/\r?\n/)
  .filter(file => /^(src|tests|scripts|desktop)\//.test(file) || /^(package.*json|index.html|public\/sw.js)$/.test(file));
report.inputs = Object.fromEntries(await Promise.all(inputs.map(async file => [file,createHash('sha256').update(await readFile(file)).digest('hex')])));
if (real) {
  const missing = [];
  for (const key of ['FOLIO_FRANKENSTEIN_PDF','FOLIO_NIETZSCHE_PDF']) {
    try { if (!process.env[key]) throw new Error(); await access(process.env[key]); } catch { missing.push(key); }
  }
  if (missing.length) {
    report.status='incomplete'; report.missing=missing;
    await writeFile(`${run}/report.json`,JSON.stringify(report,null,2));
    console.error(`Required real corpus unavailable: ${missing.join(', ')} (${run})`);
    process.exit(2);
  }
}
const commands = [
  ['--test','tests/*.test.mjs'], ['scripts/build.mjs'], ['tests/create-fixtures.mjs'],
  ['tests/reader-recovery.browser.mjs','5'], ['tests/reader-recovery.browser.mjs','7'],
  ['tests/scan-fallback.browser.mjs'], ['tests/structure-audit.browser.mjs'],
  ['tests/fidelity-audit.browser.mjs', ...(real ? ['--real'] : [])],
  ['tests/reader-compat.browser.mjs'], ['tests/desktop.browser.mjs'],
  ['tests/fidelity-desktop.browser.mjs', ...(real ? ['--real'] : [])],
  ['tests/bookmark-persistence.browser.mjs'],
  ['tests/offline.browser.mjs'],
];
console.log(`Audit evidence: ${run}`);
for (const [index,args] of commands.entries()) {
  const log = `${run}/${index}.log`, stream = createWriteStream(log);
  const started = Date.now(); let timedOut = false;
  const child = spawn(process.execPath,args,{stdio:['ignore','pipe','pipe'],windowsHide:true,env:{...process.env,FOLIO_HEADLESS:'1'}});
  child.stdout.pipe(stream,{end:false}); child.stderr.pipe(stream,{end:false});
  const timer = setTimeout(() => {
    timedOut = true;
    // Only this runner's child and descendants; never a user's browser/app.
    if (process.platform === 'win32') spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true});
    else child.kill('SIGTERM');
  }, 12 * 60 * 1000);
  const result = await new Promise(resolve => {
    child.once('error', error => resolve({error:error.message}));
    child.once('close', (code,signal) => resolve({code,signal}));
  });
  clearTimeout(timer); await new Promise(resolve => stream.end(resolve));
  report.checks.push({ args,log,...result,timedOut,elapsedMs:Date.now()-started });
  const passed = result.code === 0 && !timedOut;
  console.log(`${passed ? 'PASS' : 'FAIL'} node ${args.join(' ')} (${log})`);
  report.status = passed ? 'running' : 'failed';
  await writeFile(`${run}/report.json`,JSON.stringify(report,null,2));
  if (!passed) { process.exitCode=1; break; }
}
if (report.status === 'running') report.status='passed';
await writeFile(`${run}/report.json`,JSON.stringify(report,null,2));
