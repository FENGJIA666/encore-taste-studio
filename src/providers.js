import { createHash } from 'node:crypto';
import { artists, sampleCandidates } from './sample-data.js';

export class AppError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export function providerStatus(env = process.env) {
  return { qlooConfigured: Boolean(env.QLOO_API_KEY), llmConfigured: Boolean(env.LLM_API_KEY), sampleAvailable: true };
}
export function qlooUrl(path, params, env = process.env) {
  const base = env.QLOO_API_URL || 'https://hackathon.api.qloo.com';
  const url = new URL(path, base);
  if (url.protocol !== 'https:' || !['api.qloo.com', 'hackathon.api.qloo.com', 'staging.api.qloo.com'].includes(url.hostname)) throw new AppError('Set a supported Qloo API host in the server environment.', 500);
  Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== '') url.searchParams.set(key, String(value)); });
  return url;
}
export function createQlooCache({ ttlMs = 60000, maxEntries = 128 } = {}) {
  return { ttlMs, maxEntries, entries: new Map(), inFlight: new Map() };
}
const defaultQlooCache = createQlooCache();
const responseMetadata = new WeakMap();
function deliverQloo(data, meta) {
  const copy = structuredClone(data);
  responseMetadata.set(copy, meta);
  return copy;
}
export async function qlooGet(path, params, { env = process.env, fetcher = fetch, cache = fetcher === fetch ? defaultQlooCache : null, now = Date.now } = {}) {
  if (!env.QLOO_API_KEY) throw new AppError('Connect your Qloo key to explore live cultural matches, or choose Sample studio.', 503);
  // Resolve configuration before the network boundary so setup errors retain their useful message.
  const url = qlooUrl(path, params, env);
  url.searchParams.sort();
  const key = createHash('sha256').update(env.QLOO_API_KEY).update('\0').update(url.href).digest('hex');
  const hit = cache?.entries.get(key);
  if (hit && now() - hit.fetchedAt < cache.ttlMs) return deliverQloo(hit.data, { delivery: 'cache', fetchedAt: hit.fetchedAt });
  if (hit) cache.entries.delete(key);
  if (cache?.inFlight.has(key)) {
    const shared = await cache.inFlight.get(key);
    return deliverQloo(shared.data, { delivery: 'shared request', fetchedAt: shared.fetchedAt });
  }
  const request = (async () => {
    let response;
    try { response = await fetcher(url, { headers: { 'X-Api-Key': env.QLOO_API_KEY, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }); }
    catch { throw new AppError('Qloo is taking a little longer. Try the live request again.', 502); }
    // Qloo search documents 404 as an empty result, not an authentication or transport failure.
    if (response.status === 404 && path === '/search') return { data: { success: true, results: [] }, fetchedAt: now() };
    if (!response.ok) throw new AppError(response.status === 429 ? 'Qloo’s request window is full. Try again shortly.' : `Qloo returned status ${response.status}. Check the key’s assigned host and access.`, 502);
    let data;
    try { data = await response.json(); }
    catch { throw new AppError('Qloo returned an unreadable response. Try the live request again.', 502); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AppError('Qloo returned an unfamiliar result format. Try the live request again.', 502);
    if (data.success === false) throw new AppError('Qloo could not complete this query. Refine your artist or neighborhood.', 502);
    entitiesFrom(data);
    return { data, fetchedAt: now() };
  })();
  cache?.inFlight.set(key, request);
  try {
    const entry = await request;
    if (cache) {
      for (const [entryKey, value] of cache.entries) if (now() - value.fetchedAt >= cache.ttlMs) cache.entries.delete(entryKey);
      if (cache.entries.size >= cache.maxEntries) cache.entries.delete(cache.entries.keys().next().value);
      cache.entries.set(key, entry);
    }
    return deliverQloo(entry.data, { delivery: 'network', fetchedAt: entry.fetchedAt });
  } finally { cache?.inFlight.delete(key); }
}
export function entitiesFrom(data) {
  const result = data?.results;
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.entities)) return result.entities;
  throw new AppError('Qloo returned an unfamiliar result format. Keep the current plan and try again.', 502);
}
const collaborationCategories = new Set([
  'cafe', 'coffee shop', 'tea house', 'restaurant', 'bar', 'wine bar', 'brewery', 'bakery', 'dessert shop',
  'record store', 'book store', 'bookstore', 'art gallery', 'arts organization', 'cultural center', 'art center',
  'museum', 'art museum', 'modern art museum', 'sculpture museum', 'history museum', 'art studio', 'art school',
  'music store', 'music venue', 'live music venue', 'event venue', 'cinema', 'movie theater', 'neon sign shop',
  'pottery store', 'pottery classes',
].map(name => name.replaceAll(' ', '_')));
function normalizedEntity(entity, index, domain, requestedLocalities = []) {
  const properties = entity.properties || {};
  const rawTags = Array.isArray(entity.tags) ? entity.tags : Array.isArray(properties.tags) ? properties.tags : [];
  const primaryGenre = properties.primary_genre;
  const categoryTags = rawTags.filter(tag => typeof tag?.id === 'string' && tag.id.startsWith('urn:tag:category:place:') && typeof tag.name === 'string');
  const categoryEvidence = [primaryGenre, ...categoryTags].find(tag => typeof tag?.id === 'string' && /^urn:tag:(genre|category):place:/.test(tag.id) && collaborationCategories.has(tag.id.split(':').at(-1)) && typeof tag.name === 'string');
  const category = categoryEvidence?.name || (typeof primaryGenre?.name === 'string' ? primaryGenre.name : categoryTags[0]?.name) || domain;
  const localities = Array.isArray(properties.localities) ? properties.localities : [];
  const matchedLocality = requestedLocalities.find(requested => localities.some(place => place.entity_id === requested.entity_id));
  const geocode = properties.geocode || {};
  const neighborhood = typeof geocode.name === 'string' ? geocode.name : '';
  const broaderPlace = matchedLocality?.name || (typeof geocode.city === 'string' ? geocode.city : '');
  const locality = [...new Set([neighborhood, broaderPlace].filter(Boolean))].join(' · ');
  const culturalTags = rawTags.filter(tag => typeof tag === 'string' || /^urn:tag:(ambience|interests|genre|category|cuisine|activity_type|decor|specialty_dishes):/.test(tag?.type || ''));
  return {
    id: entity.entity_id || entity.id, name: entity.name, category,
    description: properties.description || properties.short_description || 'Explore this cultural connection as an event collaboration lead.',
    tags: [...new Set(culturalTags.map(tag => typeof tag === 'string' ? tag : tag?.name).filter(name => typeof name === 'string'))].slice(0, 4),
    locality, localityVerified: Boolean(matchedLocality),
    localityEvidence: matchedLocality ? { id: matchedLocality.entity_id, name: matchedLocality.name, source: 'Qloo returned locality membership' } : null,
    categorySource: categoryEvidence ? (categoryEvidence === primaryGenre ? 'Qloo primary genre' : 'Qloo category tag') : null,
    categoryId: categoryEvidence?.id || null,
    collaborationEligible: domain !== 'place' || Boolean(categoryEvidence) && properties.is_closed !== true,
    withinRequestedLocality: domain !== 'place' || !requestedLocalities.length || Boolean(matchedLocality),
    icon: /cafe|coffee|tea |restaurant|bar|brewery|bakery|dessert/.test(String(category).toLowerCase()) ? 'food' : /record|music/.test(String(category).toLowerCase()) ? 'vinyl' : 'art',
    rank: index + 1, source: 'Qloo live', fictional: false,
    affinity: entity.query?.affinity ?? entity.affinity ?? null,
    explainability: entity.query?.explainability ?? null,
  };
}
export async function searchArtists(query, mode, deps = {}) {
  if (mode === 'sample') return artists.filter(a => `${a.name} ${a.subtitle}`.toLowerCase().includes(query.toLowerCase())).map(a => ({ id: a.id, name: a.name, subtitle: a.subtitle }));
  if (mode !== 'live') throw new AppError('Choose Sample studio or Live Qloo.');
  const data = await qlooGet('/search', { query, types: 'urn:entity:artist', take: 6 }, deps);
  return entitiesFrom(data).filter(e => (e.entity_id || e.id) && (e.types?.includes('urn:entity:artist') || e.subtype === 'urn:entity:artist')).map(e => ({ id: e.entity_id || e.id, name: e.name, subtitle: 'Qloo artist' }));
}
export async function getCandidates(input, deps = {}) {
  if (input.mode === 'sample') {
    const artist = artists.find(a => a.id === input.artistId);
    if (!artist) throw new AppError('Choose one of the four artists in Sample studio.');
    return { artist, places: sampleCandidates(artist, input.city), music: [{ name: artist.music, source: 'Curated example' }], films: [{ name: artist.film, source: 'Curated example' }], receipts: [{ tool: 'Curated sample catalog', status: 'complete', detail: 'Fictional partners and editorial cultural pairings. No live Qloo request.' }], provider: 'sample' };
  }
  const common = { 'signal.interests.entities': input.artistId, 'feature.explainability': true, take: 12 };
  const requested = [{ type: 'place', more: { 'filter.location.query': input.city, 'filter.location.radius': 0, 'filter.exclude.entities': input.rejectedIds.join(',') } }, { type: 'artist', more: { 'filter.exclude.entities': input.artistId } }, { type: 'movie', more: {} }];
  const results = await Promise.all(requested.map(async ({ type, more }) => {
    const params = { ...common, 'filter.type': `urn:entity:${type}`, ...more };
    const data = await qlooGet('/v2/insights', params, deps);
    const metadata = responseMetadata.get(data);
    const requestedLocalities = Array.isArray(data.query?.localities?.filter) ? data.query.localities.filter : [];
    const normalized = entitiesFrom(data).map((entity, index) => normalizedEntity(entity, index, type, requestedLocalities)).filter(entity => entity.id && entity.name);
    const evidenceUse = metadata?.delivery === 'cache' ? 'reused recent Qloo evidence' : metadata?.delivery === 'shared request' ? 'shared Qloo request' : 'fresh Qloo response';
    return { type, entities: normalized, requestedLocalities, receipt: { tool: 'Qloo Insights', status: 'complete', detail: `${type} · ${entitiesFrom(data).length} results · ${evidenceUse}`, endpoint: '/v2/insights', parameters: params, delivery: metadata?.delivery || 'network', retrievedAt: metadata ? new Date(metadata.fetchedAt).toISOString() : null, explainability: data.query?.explainability ?? null } };
  }));
  const places = results[0].entities.filter(place => place.collaborationEligible && place.withinRequestedLocality);
  const matchedNames = results[0].requestedLocalities.map(locality => locality.name).filter(Boolean);
  const tags = [...new Set(places.flatMap(e => e.tags))].slice(0, 3);
  return { artist: { id: input.artistId, name: input.artistName, tags: tags.length ? tags : ['Cultural connection', 'Shared discovery', 'Live music'], theme: `${input.artistName}: Beyond the Stage` }, places, music: results[1].entities, films: results[2].entities, receipts: [...results.map(r => r.receipt), { tool: 'Locality review', status: 'complete', detail: `${places.length} business and cultural leads match the studio's collaboration categories. ${places.filter(place => place.localityVerified).length} have returned locality membership matching ${matchedNames.join(', ') || input.city}; the location query uses a strict boundary. Each lead retains its actual category and location evidence.` }], provider: 'live' };
}

export async function draftWithModel(plan, { env = process.env, fetcher = fetch } = {}) {
  if (!env.LLM_API_KEY) return { text: plan.launchCopy, source: 'Editorial template' };
  let response;
  try {
    response = await fetcher(env.LLM_API_URL || 'https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${env.LLM_API_KEY}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(25000),
      body: JSON.stringify({ model: env.LLM_MODEL || 'gpt-4.1-mini', temperature: 0.6, messages: [{ role: 'system', content: 'Write one upbeat event concept paragraph, 70 words maximum. Use only supplied facts. Present this as a proposed concept. Do not claim confirmed partners, bookings, availability, paid rights, ticket sales, measured results, or vendor quotes. Do not invent names, prices or dates. Return only the paragraph.' }, { role: 'user', content: JSON.stringify({ artist: plan.artist.name, city: plan.input.city, theme: plan.theme, partners: plan.partners.map(p => p.name), inspiration: plan.connections, dataSource: plan.source.label }) }] }),
    });
  } catch { throw new AppError('The writing provider took longer than expected. Try again, or use the editorial template.', 502); }
  if (!response.ok) throw new AppError(`The writing provider returned status ${response.status}. Check its server configuration.`, 502);
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new AppError('The writing provider returned an empty draft. Try again.', 502);
  return { text: text.trim().slice(0, 3000), source: `LLM draft · ${env.LLM_MODEL || 'gpt-4.1-mini'}` };
}
