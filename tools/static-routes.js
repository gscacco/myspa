import { extname, isAbsolute, relative, resolve } from 'node:path';

const CONTENT_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
});

export function resolveStaticPath(root, requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname);
  const fullPath = resolve(root, `.${pathname}`);
  const fromRoot = relative(resolve(root), fullPath);
  if (fromRoot === '..' || fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(fromRoot)) return null;
  return fullPath;
}

export function directoryRedirect(requestUrl, isDirectory) {
  const url = new URL(requestUrl, 'http://localhost');
  if (!isDirectory || url.pathname === '/' || url.pathname.endsWith('/')) return null;
  return `${url.pathname}/${url.search}`;
}

export function contentTypeFor(filePath) {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
}
