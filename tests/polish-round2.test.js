import test from 'node:test';
import assert from 'node:assert/strict';
import { createQlooCache, qlooGet, searchArtists } from '../src/providers.js';
import { createPlan, comparePlans } from '../src/planner.js';

const sample = { mode: 'sample', artistId: 'sample-khruangbin', artistName: 'Khruangbin', city: 'Brooklyn', budget: 2400, currency: 'USD' };
const live = { ...sample, mode: 'live', artistId: '12345678-1234-1234-1234-123456789012' };
const env = { QLOO_API_KEY: 'round2-fixture-key', QLOO_API_URL: 'https://hackathon.api.qloo.com' };
function fixtureResponse(url) {
  const type = url.searchParams.get('filter.type') || 'artist';
  return new Response(JSON.stringify({ success: true, results: { entities: [1, 2, 3, 4].map(n => ({ entity_id: `${type}-${n}`, name: `${type} ${n}`, subtype: type, properties: { geocode: { city: 'Brooklyn' }, primary_genre: { id: 'urn:tag:genre:place:cafe', name: 'Cafe' } } })) } }));
}

test('round2: budget refinement reuses all Qloo evidence; refresh retrieves only the changed place query', async () => {
  const calls = [], cache = createQlooCache();
  const deps = { env, cache, fetcher: async url => { calls.push(url.href); return fixtureResponse(url); } };
  const initial = await createPlan(live, deps);
  assert.equal(calls.length, 3);
  const reduced = await createPlan({ ...live, budget: 1600, previous: initial }, deps);
  assert.equal(calls.length, 3);
  assert.ok(reduced.receipts.filter(r => r.tool === 'Qloo Insights').every(r => r.delivery === 'cache'));
  const refreshed = await createPlan({ ...live, budget: 1600, rejectedIds: [reduced.partners[0].id], previous: reduced }, deps);
  assert.equal(calls.length, 4);
  assert.match(calls[3], /filter.exclude.entities/);
  assert.ok(refreshed.partners.every(p => p.id !== reduced.partners[0].id));
  assert.equal(refreshed.receipts.filter(r => r.delivery === 'cache').length, 2);
  assert.ok(!JSON.stringify(refreshed).includes(env.QLOO_API_KEY));
});

test('round2: concurrent identical Qloo calls share one request and callers receive isolated results', async () => {
  const cache = createQlooCache(); let calls = 0, complete;
  const gate = new Promise(resolve => { complete = resolve; });
  const deps = { env, cache, fetcher: async url => { calls++; await gate; return fixtureResponse(url); } };
  const a = qlooGet('/search', { query: 'Laufey' }, deps), b = qlooGet('/search', { query: 'Laufey' }, deps);
  complete(); const [one, two] = await Promise.all([a, b]);
  assert.equal(calls, 1); one.results.entities[0].name = 'mutated by caller';
  assert.notEqual(two.results.entities[0].name, one.results.entities[0].name);
  const again = await qlooGet('/search', { query: 'Laufey' }, deps);
  assert.notEqual(again.results.entities[0].name, one.results.entities[0].name);
});

test('round2: cached evidence expires, stays bounded, and remains separated by API credential', async () => {
  let time = 0, calls = 0; const cache = createQlooCache({ ttlMs: 60, maxEntries: 2 });
  const deps = { env, cache, now: () => time, fetcher: async url => { calls++; return fixtureResponse(url); } };
  await qlooGet('/search', { query: 'a' }, deps); time = 59;
  await qlooGet('/search', { query: 'a' }, deps); assert.equal(calls, 1);
  time = 60; await qlooGet('/search', { query: 'a' }, deps); assert.equal(calls, 2);
  await qlooGet('/search', { query: 'a' }, { ...deps, env: { ...env, QLOO_API_KEY: 'second-fixture-key' } }); assert.equal(calls, 3);
  await qlooGet('/search', { query: 'b' }, deps); assert.equal(cache.entries.size, 2);
  assert.ok([...cache.entries.keys()].every(key => /^[a-f0-9]{64}$/.test(key)));
});

test('round2: provider failures are explicit and never cached; empty search is a real empty result', async () => {
  let calls = 0; const cache = createQlooCache();
  const deps = { env, cache, fetcher: async () => { calls++; return calls === 1 ? new Response('fixture failure', { status: 429 }) : new Response('{invalid JSON'); } };
  await assert.rejects(() => qlooGet('/search', { query: 'x' }, deps), /request window/);
  await assert.rejects(() => qlooGet('/search', { query: 'x' }, deps), /unreadable response/);
  assert.equal(calls, 2); assert.equal(cache.entries.size, 0); assert.equal(cache.inFlight.size, 0);
  const empty = await searchArtists('no matches', 'live', { env, fetcher: async () => new Response('', { status: 404 }) });
  assert.deepEqual(empty, []);
  await assert.rejects(() => qlooGet('/v2/insights', {}, { env, fetcher: async () => new Response('', { status: 404 }) }), /status 404/);
  await assert.rejects(() => qlooGet('/search', {}, { env: { ...env, QLOO_API_URL: 'https://wrong.example' } }), /supported Qloo API host/);
});

test('round2: each selected concept receives exactly one activation, through budget and partner changes', async () => {
  const first = await createPlan(sample);
  const reduced = await createPlan({ ...sample, budget: 1600, previous: first });
  const refreshed = await createPlan({ ...sample, budget: 1600, previous: reduced, rejectedIds: [reduced.partners[0].id] });
  for (const plan of [first, reduced, refreshed]) {
    assert.deepEqual(plan.runOfShow.filter(r => r.partnerId).map(r => r.partnerId), plan.partners.map(p => p.id));
    assert.equal(new Set(plan.runOfShow.map(r => r.time)).size, plan.runOfShow.length);
    for (const p of plan.partners) { const beat = plan.runOfShow.find(r => r.partnerId === p.id); assert.ok(beat.title.includes(p.name)); assert.ok(beat.detail.includes(p.category)); }
  }
  assert.ok(!JSON.stringify(refreshed.runOfShow).includes(reduced.partners[0].name));
});

test('round2: refinement reports actual retained, new and excluded concepts by identity', async () => {
  const first = await createPlan(sample);
  const reduced = await createPlan({ ...sample, budget: 1600, previous: first });
  assert.equal(reduced.comparison.retained.length, 2); assert.equal(reduced.comparison.replaced.length, 1); assert.equal(reduced.comparison.conceptCapacity, 2);
  const refreshed = await createPlan({ ...sample, budget: 1600, previous: reduced, rejectedIds: [reduced.partners[0].id] });
  assert.equal(refreshed.comparison.retained.length, 1); assert.equal(refreshed.comparison.added.length, 1); assert.deepEqual(refreshed.comparison.excluded, [reduced.partners[0].name]);
  const sameName = comparePlans({ input: sample, partners: [{ id: 'old-branch', name: 'Same name' }] }, { input: { ...sample, rejectedIds: [] }, partners: [{ id: 'new-branch', name: 'Same name' }] });
  assert.deepEqual(sameName.retained, []); assert.deepEqual(sameName.added, ['Same name']);
});

test('round2: unchanged plans celebrate continuity; provider changes start a fresh baseline', async () => {
  const first = await createPlan(sample);
  const unchanged = await createPlan({ ...sample, previous: first });
  assert.match(unchanged.comparison.rationale, /same collaboration concepts/);
  assert.equal(unchanged.comparison.added.length, 0);
  assert.equal(comparePlans(first, { ...first, input: { ...first.input, mode: 'live' } }), null);
});
