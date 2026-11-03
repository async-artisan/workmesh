#!/usr/bin/env node
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createServer, request as proxyRequest } from 'node:http';

const args = process.argv.slice(2);
function value(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}
const root = resolve(value('--root', '.'));
const port = Number(value('--port', '5173'));
const host = value('--host', '127.0.0.1');
const apiHost = value('--api-host', '127.0.0.1');
const apiPort = Number(value('--api-port', '3000'));
const downloadsRoot = resolve(value('--downloads-root', join(root, '..', '..', 'downloads')));
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};
const realRoot = realpathSync(root);
const realDownloadsRoot = existsSync(downloadsRoot) ? realpathSync(downloadsRoot) : downloadsRoot;
const indexFile = resolveFile(root, realRoot, '/index.html').file;
if (!indexFile) throw new Error(`web dist does not contain a safe index.html: ${root}`);

function isWithin(base, candidate) {
  const rel = relative(base, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function decodePath(pathname) {
  try {
    return decodeURIComponent(pathname.split('?')[0] || '/');
  } catch {
    return null;
  }
}

function resolveFile(base, realBase, decodedPath) {
  const candidate = resolve(base, `.${decodedPath}`);
  if (!isWithin(base, candidate) || !existsSync(candidate)) return { invalid: !isWithin(base, candidate), file: null };
  try {
    const actual = realpathSync(candidate);
    if (!isWithin(realBase, actual) || !statSync(actual).isFile()) return { invalid: !isWithin(realBase, actual), file: null };
    return { invalid: false, file: actual };
  } catch {
    return { invalid: false, file: null };
  }
}

function badRequest(response) {
  response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Malformed URL encoding');
}

createServer((request, response) => {
  const pathname = request.url ?? '/';
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    const proxy = proxyRequest(
      { hostname: apiHost, port: apiPort, path: pathname, method: request.method, headers: request.headers },
      (upstream) => {
        response.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(response);
      },
    );
    proxy.on('error', () => {
      if (!response.headersSent) response.writeHead(502);
      response.end('API unavailable');
    });
    request.pipe(proxy);
    return;
  }

  const decoded = decodePath(pathname);
  if (decoded === null) {
    badRequest(response);
    return;
  }
  if (decoded === '/download' || decoded === '/download/') {
    const page = resolveFile(downloadsRoot, realDownloadsRoot, '/index.html');
    if (page.file === null) { response.writeHead(404); response.end('Download page unavailable'); return; }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    createReadStream(page.file).on('error', () => response.end()).pipe(response);
    return;
  }
  if (decoded.startsWith('/download/')) {
    const result = resolveFile(downloadsRoot, realDownloadsRoot, decoded.slice('/download'.length));
    if (result.invalid || result.file === null) { response.writeHead(404); response.end('Not found'); return; }
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('Content-Disposition', `attachment; filename="${result.file.split(/[\\/]/).pop()}"`);
    createReadStream(result.file).on('error', () => response.end()).pipe(response);
    return;
  }

  const result = resolveFile(root, realRoot, decoded);
  if (result.invalid) { response.writeHead(404); response.end('Not found'); return; }
  const file = result.file ?? indexFile;
  response.setHeader('Cache-Control', file === indexFile ? 'no-cache' : 'public, max-age=31536000, immutable');
  response.setHeader('Content-Type', mime[extname(file).toLowerCase()] ?? 'application/octet-stream');
  createReadStream(file).on('error', () => response.end()).pipe(response);
}).listen(port, host, () => {
  console.log(`WorkMesh Web listening on http://${host}:${port}`);
});
