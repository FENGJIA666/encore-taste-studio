import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createApiHandler, securityHeaders } from './src/api.js';

const root = fileURLToPath(new URL('./public/', import.meta.url));
const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
  '/film.html': ['film.html', 'text/html; charset=utf-8'],
  '/film.css': ['film.css', 'text/css; charset=utf-8'],
  '/media/encore-product-film-v2.mp4': ['media/encore-product-film-v2.mp4', 'video/mp4'],
  '/media/encore-poster-v2.jpg': ['media/encore-poster-v2.jpg', 'image/jpeg'],
  '/media/encore-product-film-v3.mp4': ['media/encore-product-film-v3.mp4', 'video/mp4'],
  '/media/encore-poster-v3.jpg': ['media/encore-poster-v3.jpg', 'image/jpeg'],
};

export function createServer(deps = {}) {
  const api = createApiHandler(deps);
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return api(req, res);
    for (const [name, value] of Object.entries(securityHeaders)) res.setHeader(name, value);
    if (req.method === 'GET' && files[url.pathname]) {
      try {
        const [file, type] = files[url.pathname];
        const body = await readFile(root + file);
        res.writeHead(200, { 'Content-Type': type });
        return res.end(body);
      } catch { /* Missing assets use the same explicit 404 boundary. */ }
    }
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'This route is not available.' }));
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) createServer().listen(Number(process.env.PORT || 4173), process.env.HOST || '127.0.0.1', () => console.log(`ENCORE studio ready at http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 4173}`));
