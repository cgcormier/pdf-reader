import { createReadStream } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PORT = 4173;
export const HOST = '127.0.0.1';
export const APPLICATION_ID = 'folio-reader';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultDistDirectory = path.resolve(scriptDirectory, '..', 'dist');

const contentTypes = new Map([
  ['.bcmap', 'application/octet-stream'],
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

function sendText(response, status, body, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function assertBuildExists(distDirectory = defaultDistDirectory) {
  const indexPath = path.join(distDirectory, 'index.html');
  if (!(await exists(indexPath))) {
    throw new Error(`Folio's production build is missing at ${distDirectory}. Run "npm run build" from the Folio folder, then start Folio again.`);
  }
  return indexPath;
}

function resolveRequestPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  // Treat Windows separators and NULs as invalid instead of allowing path APIs
  // to interpret them differently from URL paths.
  if (decoded.includes('\\') || decoded.includes('\0')) return null;

  const segments = decoded.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..')) return null;

  return decoded === '/' ? '/index.html' : decoded;
}

async function resolveInsideDist(distRealPath, requestPath) {
  const relativePath = requestPath.replace(/^\/+/, '');
  const candidate = path.resolve(distRealPath, relativePath);
  const relative = path.relative(distRealPath, candidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;

  let actualPath;
  try {
    actualPath = await realpath(candidate);
  } catch {
    return null;
  }

  const actualRelative = path.relative(distRealPath, actualPath);
  if (actualRelative === '..' || actualRelative.startsWith(`..${path.sep}`) || path.isAbsolute(actualRelative)) return null;

  try {
    const fileInfo = await stat(actualPath);
    return fileInfo.isFile() ? { filePath: actualPath, fileInfo } : null;
  } catch {
    return null;
  }
}

export function createServer({ distDirectory = defaultDistDirectory } = {}) {
  const server = createHttpServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      sendText(response, 405, 'Method not allowed');
      return;
    }

    let requestUrl;
    try {
      requestUrl = new URL(request.url ?? '/', `http://${HOST}:${PORT}`);
    } catch {
      sendText(response, 400, 'Bad request');
      return;
    }

    if (requestUrl.pathname === '/health') {
      const body = JSON.stringify({ application: APPLICATION_ID, status: 'ok' });
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(request.method === 'HEAD' ? undefined : body);
      return;
    }

    const requestPath = resolveRequestPath(requestUrl.pathname);
    if (requestPath === null) {
      sendText(response, 400, 'Bad request');
      return;
    }

    const distRealPath = await realpath(distDirectory).catch(() => null);
    if (distRealPath === null) {
      sendText(response, 503, 'Folio production files are missing. Run "npm run build" from the Folio folder.');
      return;
    }

    const resolved = await resolveInsideDist(distRealPath, requestPath);
    if (!resolved) {
      sendText(response, 404, 'Not found');
      return;
    }

    const contentType = contentTypes.get(path.extname(resolved.filePath).toLowerCase()) ?? 'application/octet-stream';
    response.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': resolved.fileInfo.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    const stream = createReadStream(resolved.filePath);
    stream.on('error', () => {
      if (!response.headersSent) sendText(response, 500, 'Unable to read file');
      else response.destroy();
    });
    stream.pipe(response);
  });

  return server;
}

async function run() {
  try {
    await assertBuildExists();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  const server = createServer();
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Folio cannot start because ${HOST}:${PORT} is already in use. Close the other app or start it on another port.`);
    } else {
      console.error(`Folio server failed: ${error.message}`);
    }
    process.exitCode = 1;
  });
  server.listen(PORT, HOST, () => {
    console.log(`Folio is serving locally at http://${HOST}:${PORT}/`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run();
}
