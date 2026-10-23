import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiHandler } from '../src/api.js';
import { createServer } from '../server.js';

const base = { mode: 'sample', artistId: 'sample-khruangbin', artistName: 'Khruangbin', city: 'Brooklyn', budget: 2400, currency: 'USD' };
async function platformRequest(body, origin = 'https://encore.example') {
  const result = { headers: {} };
  const response = {
    setHeader(name, value) { result.headers[name] = value; },
    writeHead(status, headers) { result.status = status; Object.assign(result.headers, headers); },
    end(data) { result.body = JSON.parse(data); },
  };
  await createApiHandler({ env: {} })({ url: '/api/plan', method: 'POST', headers: { host: 'encore.example', origin }, body }, response);
  return result;
}

test('deployment: parsed platform JSON preserves the complete sample refinement journey', async () => {
  const first = await platformRequest(base);
  assert.equal(first.status, 200);
  assert.equal(first.body.partners.length, 3);
  assert.equal(first.body.source.label, 'Sample studio');
  const smaller = await platformRequest({ ...base, budget: 1600, previous: first.body });
  assert.equal(smaller.status, 200);
  assert.equal(smaller.body.partners.length, 2);
  const refreshed = await platformRequest({ ...base, budget: 1600, previous: smaller.body, rejectedIds: [smaller.body.partners[0].id] });
  assert.equal(refreshed.status, 200);
  assert.ok(refreshed.body.partners.every(partner => partner.id !== smaller.body.partners[0].id));
  assert.equal(refreshed.headers['Cache-Control'], 'no-store');
});

test('deployment: raw platform JSON, byte limit and malformed data retain the input boundary', async () => {
  assert.equal((await platformRequest(JSON.stringify(base))).status, 200);
  assert.equal((await platformRequest(Buffer.from(JSON.stringify(base)))).status, 200);
  assert.equal((await platformRequest('{')).status, 400);
  assert.equal((await platformRequest({ ...base, extra: '夜'.repeat(22000) })).status, 413);
});

test('deployment: the platform adapter preserves the same-origin boundary', async () => {
  assert.equal((await platformRequest(base, 'https://unrelated.example')).status, 403);
  assert.equal((await platformRequest(base, '')).status, 200);
});

test('deployment: local film routes serve only the declared public assets with correct MIME', async t => {
  const server = createServer({ env: {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  for (const [path, type] of [['/film.html', 'text/html'], ['/film.css', 'text/css'], ['/media/encore-product-film-v2.mp4', 'video/mp4'], ['/media/encore-poster-v2.jpg', 'image/jpeg']]) {
    const response = await fetch(url + path);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').startsWith(type));
    await response.arrayBuffer();
  }
  assert.equal((await fetch(url + '/internal/source-manifest.json')).status, 404);
});
