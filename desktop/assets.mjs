import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export const APP_URL = 'folio://app/';

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.pdf', 'application/pdf'],
  ['.wasm', 'application/wasm'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

export function isAppUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'folio:' && url.hostname === 'app'
      && !url.port && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isWithin(root, file) {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

// Only packaged app assets are exposed to the renderer. No HTTP server or
// arbitrary file:// access is needed, and the origin stays stable across updates.
export async function assetResponse(request, distDirectory) {
  if (!isAppUrl(request.url)) return new Response('Not found', { status: 404 });
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  if (pathname.includes('\\') || pathname.includes('\0')
    || pathname.split('/').some(part => part === '.' || part === '..')) {
    return new Response('Bad request', { status: 400 });
  }

  try {
    const root = await realpath(distDirectory);
    const candidate = path.resolve(root, pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''));
    if (!isWithin(root, candidate)) return new Response('Not found', { status: 404 });
    const file = await realpath(candidate);
    if (!isWithin(root, file)) return new Response('Not found', { status: 404 });
    const info = await stat(file);
    if (!info.isFile()) return new Response('Not found', { status: 404 });
    return new Response(request.method === 'HEAD' ? null : await readFile(file), {
      headers: {
        'Content-Type': contentTypes.get(path.extname(file)) ?? 'application/octet-stream',
        'Content-Length': String(info.size),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      },
    });
  } catch (error) {
    return new Response('Unable to read app asset', { status: ['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 500 });
  }
}
