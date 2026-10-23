import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateBudget, choosePartners, createPlan, validateInput } from '../src/planner.js';
import { qlooUrl, qlooGet, entitiesFrom, searchArtists } from '../src/providers.js';
const input = { mode: 'sample', artistId: 'sample-khruangbin', artistName: 'Khruangbin', city: 'Brooklyn', budget: 2400, currency: 'USD' };
test('allocator preserves every unit across boundary budgets', () => { for (const n of [200, 201, 1599, 1600, 1799, 1800, 2400, 99999, 100000]) { const rows = allocateBudget(n); assert.equal(rows.reduce((a, b) => a + b.amount, 0), n); assert.ok(rows.every(r => Number.isInteger(r.amount) && r.amount >= 0)); } });
test('budget refinement and partner feedback are independent real decisions', async () => { const first = await createPlan(input); const smaller = await createPlan({ ...input, budget: 1600, previous: first }); assert.equal(first.partners.length, 3); assert.equal(smaller.partners.length, 2); assert.equal(smaller.comparison.newBudget, 1600); const replaced = await createPlan({ ...input, rejectedIds: [first.partners[0].id], previous: first }); assert.equal(replaced.partners.length, 3); assert.ok(!replaced.partners.some(p => p.id === first.partners[0].id)); assert.equal(replaced.input.budget, 2400); assert.ok(replaced.comparison.added.length > 0); });
test('selection consumes provider rank and diversity, with auditable reason', () => { const candidates = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, rank: i + 1, category: 'place' })); assert.equal(choosePartners(candidates, [], 1600)[0].id, 'a'); const changed = candidates.map(p => ({ ...p, rank: p.id === 'd' ? 1 : p.rank + 5 })); assert.equal(choosePartners(changed, [], 1600)[0].id, 'd'); assert.match(choosePartners(changed, [], 1600)[0].selection.reason, /Qloo rank #1/); assert.throws(() => choosePartners(candidates, ['a', 'b', 'c', 'd'], 2400), /fresh direction/); });
test('different taste seeds alter selected sample concepts', async () => { const global = await createPlan(input); const jazz = await createPlan({ ...input, artistId: 'sample-fred', artistName: 'Fred again..' }); assert.notEqual(global.partners[0].id, jazz.partners[0].id); assert.notEqual(global.theme, jazz.theme); });
test('Qloo URL preserves namespace, exclusions and never contains API key', () => { const url = qlooUrl('/v2/insights', { 'filter.type': 'urn:entity:place', 'signal.interests.entities': 'artist-id', 'filter.location.query': 'New York', 'filter.exclude.entities': 'place-id', 'feature.explainability': true }, { QLOO_API_URL: 'https://hackathon.api.qloo.com' }); assert.equal(url.hostname, 'hackathon.api.qloo.com'); assert.equal(url.searchParams.get('signal.interests.entities'), 'artist-id'); assert.equal(url.searchParams.get('filter.location.query'), 'New York'); assert.equal(url.searchParams.get('feature.explainability'), 'true'); assert.equal(url.searchParams.has('key'), false); assert.throws(() => qlooUrl('/search', {}, { QLOO_API_URL: 'https://untrusted.invalid' }), /supported Qloo/); });
test('live provider uses header authentication and source entities determine choices', async () => { const calls = []; const env = { QLOO_API_KEY: 'fixture-only-secret', QLOO_API_URL: 'https://hackathon.api.qloo.com' }; const fetcher = async (url, options) => { calls.push({ url, options }); const type = url.searchParams.get('filter.type'); return new Response(JSON.stringify({ success: true, results: { entities: [1, 2, 3, 4].map(n => ({ entity_id: `${type}-${n}`, name: `${type} ${n}`, subtype: type, properties: { geocode: { city: 'Brooklyn' } }, query: { affinity: 0.9 - n * 0.1 } })) } })); }; const live = await createPlan({ ...input, mode: 'live', artistId: '12345678-1234-1234-1234-123456789012' }, { env, fetcher }); assert.equal(calls.length, 3); assert.ok(calls.every(c => c.options.headers['X-Api-Key'] === env.QLOO_API_KEY)); assert.ok(calls.every(c => !c.url.toString().includes(env.QLOO_API_KEY))); assert.equal(live.source.label, 'Live Qloo'); assert.equal(live.partners[0].name, 'urn:entity:place 1'); assert.ok(!JSON.stringify(live).includes(env.QLOO_API_KEY)); });
test('live mode never silently returns sample results without a key', async () => { await assert.rejects(() => createPlan({ ...input, mode: 'live', artistId: '12345678-1234-1234-1234-123456789012' }, { env: {} }), /Connect your Qloo key/); });
test('Qloo error payload secrets do not escape, and response shapes are checked', async () => { await assert.rejects(() => qlooGet('/search', {}, { env: { QLOO_API_KEY: 'fixture-only' }, fetcher: async () => new Response('private provider diagnostic', { status: 401 }) }), error => /status 401/.test(error.message) && !error.message.includes('private')); assert.throws(() => entitiesFrom({ success: true }), /unfamiliar result/); assert.deepEqual(entitiesFrom({ results: [] }), []); });
test('sample search supports discoverability and validation rejects ambiguous inputs', async () => { assert.equal((await searchArtists('laufey', 'sample'))[0].id, 'sample-laufey'); assert.throws(() => validateInput({ ...input, budget: -1 }), /production budget/); assert.throws(() => validateInput({ ...input, rejectedIds: 'x' }), /Refresh/); assert.throws(() => validateInput({ ...input, mode: 'live' }), /resolved Qloo/); });

test('AM-01: USD-to-SGD refinement starts a fresh baseline without a currency conversion claim', async () => {
  const usd = await createPlan(input);
  const sgd = await createPlan({ ...input, currency: 'SGD', budget: 1600, previous: usd });
  assert.equal(usd.input.currency, 'USD');
  assert.equal(sgd.input.currency, 'SGD');
  assert.equal(sgd.input.budget, 1600);
  assert.equal(sgd.comparison, null);
  assert.equal(sgd.allocation.reduce((sum, bucket) => sum + bucket.amount, 0), 1600);
});
test('AM-01: unchanged USD currency preserves the verified 2400-to-1600 refinement', async () => {
  const usd = await createPlan(input);
  const refined = await createPlan({ ...input, budget: 1600, previous: usd });
  assert.equal(refined.input.currency, 'USD');
  assert.equal(refined.comparison.oldBudget, 2400);
  assert.equal(refined.comparison.newBudget, 1600);
  assert.equal(refined.comparison.oldPartners, 3);
  assert.equal(refined.comparison.newPartners, 2);
  assert.match(refined.comparison.rationale, /focused format/);
});
