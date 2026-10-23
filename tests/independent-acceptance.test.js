import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlan, allocateBudget } from '../src/planner.js';
import { createServer } from '../server.js';

const base = { mode: 'sample', artistId: 'sample-khruangbin', artistName: 'Khruangbin', city: 'Brooklyn', budget: 2400, currency: 'USD' };
const live = { ...base, mode: 'live', artistId: '12345678-1234-1234-1234-123456789abc' };
const fakeSecret = 'acceptance-only-synthetic-secret';
const names = plan => plan.partners.map(partner => partner.name);

test('independent: budget reduction changes format and partner scope, and allocations remain exact', async () => {
  const original = await createPlan(base);
  const reduced = await createPlan({ ...base, budget: 1600, previous: original });
  assert.equal(original.partners.length, 3);
  assert.equal(reduced.partners.length, 2);
  assert.notEqual(original.format, reduced.format);
  assert.equal(reduced.allocation.reduce((sum, item) => sum + item.amount, 0), 1600);
  assert.equal(reduced.comparison.oldBudget, 2400);
  assert.equal(reduced.comparison.newBudget, 1600);
  for (const amount of [200, 201, 1799, 1800, 99999, 100000]) {
    const allocation = allocateBudget(amount);
    assert.equal(allocation.reduce((sum, item) => sum + item.amount, 0), amount);
    assert.ok(allocation.every(item => Number.isInteger(item.amount) && item.amount >= 0));
  }
});

test('independent: changing cultural seed changes at least one actual partner and cultural reference', async () => {
  const first = await createPlan(base);
  const changed = await createPlan({ ...base, artistId: 'sample-fred', artistName: 'Fred again..' });
  assert.notDeepEqual(names(first), names(changed));
  assert.notEqual(first.connections[0].name, changed.connections[0].name);
  assert.notEqual(first.theme, changed.theme);
  assert.ok(changed.partners.every(partner => partner.fictional && partner.source === 'Curated example'));
});

test('independent: rejected partners remain excluded across multiple recomputations', async () => {
  const original = await createPlan({ ...base, budget: 1600 });
  const rejectedIds = [original.partners[0].id];
  const refreshed = await createPlan({ ...base, budget: 1600, rejectedIds, previous: original });
  assert.ok(refreshed.partners.every(partner => !rejectedIds.includes(partner.id)));
  assert.equal(refreshed.partners.length, 2);
  assert.ok(refreshed.comparison.replaced.includes(original.partners[0].name));
  rejectedIds.push(...refreshed.partners.map(partner => partner.id));
  const third = await createPlan({ ...base, budget: 1600, rejectedIds, previous: refreshed });
  assert.ok(third.partners.every(partner => !rejectedIds.includes(partner.id)));
});

test('independent: unsupported sample artist and invalid budget cannot become a valid plan', async () => {
  await assert.rejects(() => createPlan({ ...base, artistId: 'sample-unknown' }), /four artists/);
  for (const budget of [199, 100001, 2400.5, NaN]) await assert.rejects(() => createPlan({ ...base, budget }), /whole-number/);
  await assert.rejects(() => createPlan({ ...base, city: 'X' }), /city/);
});

test('independent: arbitrary sample city stays explicitly organizer input with fictional partners', async () => {
  const plan = await createPlan({ ...base, city: 'Unlisted Example City' });
  assert.equal(plan.connections.find(item => item.domain === 'Place').source, 'Organizer input');
  assert.equal(plan.source.mode, 'sample');
  assert.match(plan.source.detail, /Fictional/);
  assert.ok(plan.partners.every(partner => partner.fictional));
  assert.match(plan.receipts.find(receipt => receipt.tool === 'Curated sample catalog').detail, /No live Qloo request/);
});

test('independent: no key, authentication rejection, and quota failure never fall back to sample', async () => {
  let calls = 0;
  await assert.rejects(() => createPlan(live, { env: {}, fetcher: async () => { calls++; throw new Error('unexpected'); } }), /Connect your Qloo key/);
  assert.equal(calls, 0);
  for (const status of [401, 429]) {
    await assert.rejects(() => createPlan(live, {
      env: { QLOO_API_KEY: fakeSecret },
      fetcher: async () => new Response(JSON.stringify({ secret: fakeSecret }), { status }),
    }), error => error.status === 502 && !error.message.includes(fakeSecret));
  }
});

test('independent: live fixture ranking affects chosen partners and requests retain artist/locality', async () => {
  const requests = [];
  const plan = await createPlan(live, {
    env: { QLOO_API_KEY: fakeSecret },
    fetcher: async (url, options) => {
      assert.equal(options.headers['X-Api-Key'], fakeSecret);
      requests.push(String(url));
      const type = url.searchParams.get('filter.type').split(':').at(-1);
      return Response.json({ results: { entities: [0, 1, 2].map(index => ({
        entity_id: `${type}-fixture-${index}`, name: `${type} fixture ${index}`, subtype: `urn:entity:${type}`,
        tags: [{ name: 'Independent acceptance fixture' }], query: { affinity: 0.8 - index / 10 },
      })) } });
    },
  });
  assert.deepEqual(names(plan), ['place fixture 0', 'place fixture 1', 'place fixture 2']);
  assert.equal(plan.source.mode, 'live');
  assert.equal(requests.length, 3);
  assert.ok(requests.every(request => new URL(request).searchParams.get('signal.interests.entities') === live.artistId));
  assert.equal(new URL(requests.find(request => request.includes('urn%3Aentity%3Aplace'))).searchParams.get('filter.location.query'), 'Brooklyn');
  assert.ok(!JSON.stringify(plan).includes(fakeSecret));
  assert.ok(plan.partners.every(partner => partner.source === 'Qloo live' && !partner.fictional));
});

test('independent: empty live cultural domains identify editorial fallbacks accurately', async () => {
  const plan = await createPlan(live, {
    env: { QLOO_API_KEY: fakeSecret },
    fetcher: async url => Response.json({ results: { entities: url.searchParams.get('filter.type') === 'urn:entity:place' ? [{ entity_id: 'fixture-place', name: 'Fixture place' }] : [] } }),
  });
  assert.equal(plan.connections.find(item => item.domain === 'Sound').source, 'Organizer headliner');
  assert.equal(plan.connections.find(item => item.domain === 'Cinema').source, 'Editorial direction');
  assert.ok(plan.partners.every(partner => !partner.fictional));
});

test('independent: public server discloses readiness only, rejects invalid input/origin, and hides internal files', async t => {
  const server = createServer({ env: { QLOO_API_KEY: fakeSecret, LLM_API_KEY: 'synthetic-model-secret' }, fetcher: async () => new Response('', { status: 401 }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const status = await fetch(`${url}/api/status`).then(response => response.json());
  assert.deepEqual(status, { qlooConfigured: true, llmConfigured: true, sampleAvailable: true });
  for (const path of ['/.env', '/src/providers.js', '/package.json']) assert.equal((await fetch(url + path)).status, 404);
  assert.equal((await fetch(`${url}/api/plan`, { method: 'POST', body: '{' })).status, 400);
  assert.equal((await fetch(`${url}/api/plan`, { method: 'POST', headers: { Origin: 'https://unrelated.example' }, body: JSON.stringify(base) })).status, 403);
  const failure = await fetch(`${url}/api/plan`, { method: 'POST', body: JSON.stringify(live) });
  assert.equal(failure.status, 502);
  assert.ok(!(await failure.text()).includes(fakeSecret));
});
