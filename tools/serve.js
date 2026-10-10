#!/usr/bin/env node
/**
 * tools/serve.js — Server statico minimo per lo sviluppo.
 *
 * I moduli ES non possono essere caricati da `file://`, quindi durante lo
 * sviluppo si usa questo server: `npm run dev` e poi aprire l'indirizzo
 * indicato (per impostazione predefinita http://localhost:8080/).
 *
 * Serve `src/` (modalità sviluppo) e anche `dist/` (artefatto costruito).
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/** Risolve il percorso richiesto impedendo di uscire dalla radice. */
export function resolveRequest(urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  const full = normalize(join(ROOT, p));
  if (!full.startsWith(ROOT)) return null;
  return full;
}

const server = createServer(async (req, res) => {
  const full = resolveRequest(req.url);
  if (!full) { res.writeHead(403).end('403'); return; }
  try {
    const info = await stat(full);
    const target = info.isDirectory() ? join(full, 'index.html') : full;
    const body = await readFile(target);
    const ext = target.slice(target.lastIndexOf('.'));
    res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 — non trovato');
  }
});

server.listen(PORT, () => {
  console.log('Server di sviluppo: http://localhost:' + PORT + '/');
  console.log('  sorgenti:  http://localhost:' + PORT + '/src/index.html');
  console.log('  artefatto: http://localhost:' + PORT + '/dist/foglio.html  (richiede npm run build)');
});
