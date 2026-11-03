#!/usr/bin/env node
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { request as proxyRequest } from 'node:http';

const args = process.argv.slice(2);
function value(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}
const root = resolve(value('--root', '.'));
const port = Number(value('--port', '5173'));
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
const indexFile = join(root, 'index.html');
if (!existsSync(indexFile)) throw new Error(`web dist 不存在 index.html: ${root}`);

function safeFile(pathname) {
  const decoded = decodeURIComponent(pathname.split('?')[0] || '/');
  const candidate = resolve(root, `.${decoded}`);
  return candidate.startsWith(root) ? candidate : null;
}

createServer((request, response) => {
  const pathname = request.url ?? '/';
  if (pathname === '/download' || pathname === '/download/') {
    const file = join(downloadsRoot, 'index.html');
    if (!existsSync(file)) { response.writeHead(404); response.end('Download page unavailable'); return; }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    createReadStream(file).pipe(response);
    return;
  }
  if (pathname.startsWith('/download/')) {
    const relative = decodeURIComponent(pathname.slice('/download/'.length));
    const file = resolve(downloadsRoot, relative);
    if (!file.startsWith(downloadsRoot) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404); response.end('Not found'); return;
    }
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('Content-Disposition', `attachment; filename="${file.split(/[\\\\/]/).pop()}"`);
    createReadStream(file).pipe(response);
    return;
  }
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
  const candidate = safeFile(pathname);
  const file = candidate && existsSync(candidate) && statSync(candidate).isFile() ? candidate : indexFile;
  response.setHeader('Cache-Control', file === indexFile ? 'no-cache' : 'public, max-age=31536000, immutable');
  response.setHeader('Content-Type', mime[extname(file).toLowerCase()] ?? 'application/octet-stream');
  createReadStream(file).on('error', () => response.end()).pipe(response);
}).listen(port, '0.0.0.0', () => {
  console.log(`WorkMesh Web listening on http://127.0.0.1:${port}`);
});
