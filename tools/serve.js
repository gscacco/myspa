#!/usr/bin/env node
/**
 * tools/serve.js — Server statico minimo per lo sviluppo.
 *
 * I moduli ES non possono essere caricati da `file://`, quindi durante lo
 * sviluppo si usa questo server: `npm run dev` e poi aprire l'indirizzo
 * indicato (per impostazione predefinita http://localhost:8080/).
 *
 * Serve i file statici dalla radice del progetto: spreadsheet, timetable e artefatti `dist/`.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { contentTypeFor, directoryRedirect, resolveStaticPath } from './static-routes.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8080);

/** Risolve il percorso richiesto impedendo di uscire dalla radice. */
export function resolveRequest(urlPath) {
  let p = new URL(urlPath, 'http://localhost').pathname;
  if (p === '/' || p === '') p = '/index.html';
  return resolveStaticPath(ROOT, p);
}

const server = createServer(async (req, res) => {
  const full = resolveRequest(req.url);
  if (!full) { res.writeHead(403).end('403'); return; }
  try {
    const info = await stat(full);
    const redirect = directoryRedirect(req.url, info.isDirectory());
    if (redirect) { res.writeHead(301, { location: redirect }).end(); return; }
    const target = info.isDirectory() ? join(full, 'index.html') : full;
    const body = await readFile(target);
    res.writeHead(200, { 'content-type': contentTypeFor(target) }).end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 — non trovato');
  }
});

server.listen(PORT, () => {
  console.log('Server di sviluppo: http://localhost:' + PORT + '/');
  console.log('  timetable: http://localhost:' + PORT + '/timetable/');
  console.log('  sorgenti:  http://localhost:' + PORT + '/src/index.html');
  console.log('  artefatto: http://localhost:' + PORT + '/dist/foglio.html  (richiede npm run build)');
});
