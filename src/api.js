import { createPlan } from './planner.js';
import { AppError, providerStatus, searchArtists } from './providers.js';

export const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  // Vercel parses JSON before the handler; the local server supplies a stream.
  if (req.body !== undefined) {
    const raw = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? String(req.body) : JSON.stringify(req.body);
    if (Buffer.byteLength(raw || '') > 64000) throw new AppError('Keep event details concise.', 413);
    try { return JSON.parse(raw); } catch { throw new AppError('Send valid event details.'); }
  }
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 64000) throw new AppError('Keep event details concise.', 413);
  }
  try { return JSON.parse(body); } catch { throw new AppError('Send valid event details.'); }
}

export function createApiHandler(deps = {}) {
  return async (req, res) => {
    for (const [name, value] of Object.entries(securityHeaders)) res.setHeader(name, value);
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, providerStatus(deps.env));
      if (req.method === 'GET' && url.pathname === '/api/search') {
        const q = (url.searchParams.get('q') || '').trim().slice(0, 100), mode = url.searchParams.get('mode') || 'sample';
        if (mode === 'live' && q.length < 2) return json(res, 200, []);
        return json(res, 200, await searchArtists(q, mode, deps));
      }
      if (req.method === 'POST' && url.pathname === '/api/plan') {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) throw new AppError('Open ENCORE directly to create your plan.', 403);
        return json(res, 200, await createPlan(await readBody(req), deps));
      }
      return json(res, 404, { error: 'This route is not available.' });
    } catch (error) {
      return json(res, error.status || 500, { error: error instanceof AppError ? error.message : 'The studio could not complete that step. Please try again.' });
    }
  };
}
