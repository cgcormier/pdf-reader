// Keep each existing suite's independent report and exit status visible.
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp } from 'node:fs/promises';
import { createServer } from 'vite';
import { createServer as tcpServer } from 'node:net';

const scanOnly = process.argv.slice(2).length === 1 && process.argv[2] === '--scan-only';
if (process.argv.length > 2 && !scanOnly) throw new Error('Supported argument: --scan-only');
const checks = scanOnly ? [] : [
  ['display', ['tests/display/run.mjs']],
  ['fidelity and Hamlet', ['tests/fidelity-audit.browser.mjs', '14', '15', '16']],
];
const scanInputs = ['Folio-Scanned-Book.pdf', 'Folio-Mixed-Scan-Book.pdf', 'Folio-Mixed-Scan-First-Book.pdf'];
const missing = [];
for (const name of scanInputs) {
  try { await access(`output/playwright/${name}`); } catch { missing.push(name); }
}
if (!missing.length) checks.push(['scanned and mixed pages', ['tests/scan-fallback.browser.mjs']]);
else console.error(`INCOMPLETE scanned-page check: missing ${missing.join(', ')}. Generate fixtures with node tests/create-fixtures.mjs after checking existing output files.`);
const results = [];
for (const [name, args] of checks) {
  console.log(`\nRunning ${name}`);
  let server;
  const env = { ...process.env };
  if (name === 'display') delete env.FOLIO_DISPLAY_CASE;
  if (name === 'scanned and mixed pages') {
    await mkdir('output/playwright/display-suite', { recursive: true });
    const run = await mkdtemp('output/playwright/display-suite/scan-server-');
    const reserve = tcpServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
    const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
    server = await createServer({ cacheDir: `${run}/vite-cache`, server: { host: '127.0.0.1', port, strictPort: true, hmr: false, watch: null }, clearScreen: false });
    await server.listen();
    env.RECOVERY_BROWSER_URL = `http://127.0.0.1:${server.httpServer.address().port}/`;
  }
  const child = spawn(process.execPath, args, { stdio: 'inherit', env, windowsHide: true });
  const result = await new Promise(resolve => {
    child.once('error', error => resolve(error.message));
    child.once('exit', (code, signal) => resolve(signal || code));
  });
  await server?.close();
  results.push({ name, result });
}
console.log('\nExpanded display results:', JSON.stringify(results));
if (missing.length || results.some(result => result.result !== 0)) process.exitCode = 1;
