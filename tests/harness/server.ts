/*
 * Local test server. Not used in production.
 * Serves the real React page (bundled with esbuild instead of Next.js) and runs the real
 * API handlers from lib/server against stand-in Redis and Brevo (tests/fakes.ts).
 * What this does NOT cover: Next.js's own build, routing and server rendering.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { build } from 'esbuild';
import * as fakes from '../fakes';
import { routes } from '../../lib/server/handlers';

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'tests', '.build');

export const PASSWORD = 'test-pass';

async function bundle(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  await build({
    entryPoints: [path.join(__dirname, 'client.tsx')],
    bundle: true, outfile: path.join(OUT, 'app.js'), format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'error'
  });
  fs.copyFileSync(path.join(ROOT, 'app', 'globals.css'), path.join(OUT, 'app.css'));
  fs.writeFileSync(path.join(OUT, 'index.html'),
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Notices Calendar</title>' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
    '<link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
}

export async function start(port?: number) {
  fakes.setTestEnv(PASSWORD);
  await bundle();
  const srv = http.createServer(function (req, res) {
    const p = (req.url || '/').split('?')[0];
    const route = routes[p];
    if (route) {
      const handler = route[req.method || 'GET'];
      if (!handler) { res.statusCode = 405; res.end('{"error":"method-not-allowed"}'); return; }
      const chunks: Buffer[] = [];
      req.on('data', function (c) { chunks.push(c); });
      req.on('end', async function () {
        const headers = new Headers();
        Object.keys(req.headers).forEach(function (k) { const v = req.headers[k]; if (typeof v === 'string') headers.set(k, v); });
        const body = chunks.length && req.method !== 'GET' ? Buffer.concat(chunks) : undefined;
        const r = await handler(new Request('http://127.0.0.1' + req.url, { method: req.method, headers: headers, body: body }));
        res.statusCode = r.status;
        r.headers.forEach(function (v, k) { res.setHeader(k, v); });
        res.end(Buffer.from(await r.arrayBuffer()));
      });
      return;
    }
    const files: Record<string, [string, string]> = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/app.css': ['app.css', 'text/css'] };
    const f = files[p];
    if (f) { res.setHeader('Content-Type', f[1]); res.end(fs.readFileSync(path.join(OUT, f[0]))); return; }
    res.statusCode = 404; res.end('not found');
  });
  return new Promise<{ srv: http.Server; port: number; fakes: typeof fakes }>(function (ok) {
    srv.listen(port || 0, '127.0.0.1', function () { ok({ srv: srv, port: (srv.address() as { port: number }).port, fakes: fakes }); });
  });
}
