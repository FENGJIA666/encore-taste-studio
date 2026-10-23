import { AppError, getCandidates, draftWithModel } from './providers.js';

export function validateInput(raw) {
  if (!raw || typeof raw !== 'object') throw new AppError('Add your event details to create a night.');
  const mode = raw.mode ?? 'sample';
  if (!['sample', 'live'].includes(mode)) throw new AppError('Choose Sample studio or Live Qloo.');
  const artistId = String(raw.artistId || '').trim(), artistName = String(raw.artistName || '').trim(), city = String(raw.city || '').trim();
  if (!artistId || artistId.length > 120 || !artistName || artistName.length > 120) throw new AppError('Select a headliner from the artist search.');
  if (mode === 'live' && !/^[0-9a-f-]{32,36}$/i.test(artistId)) throw new AppError('Select a resolved Qloo artist to create a live plan.');
  if (city.length < 2 || city.length > 100) throw new AppError('Enter a neighborhood or city between 2 and 100 characters.');
  const budget = Number(raw.budget);
  if (!Number.isInteger(budget) || budget < 200 || budget > 100000) throw new AppError('Set a whole-number production budget from 200 to 100,000.');
  if (raw.rejectedIds !== undefined && (!Array.isArray(raw.rejectedIds) || raw.rejectedIds.length > 30 || raw.rejectedIds.some(x => typeof x !== 'string' || x.length > 120))) throw new AppError('Refresh the plan to start a new partner shortlist.');
  const currency = ['USD', 'SGD', 'GBP', 'EUR'].includes(raw.currency) ? raw.currency : 'USD';
  return { mode, artistId, artistName, city, budget, currency, rejectedIds: [...new Set(raw.rejectedIds || [])], useLlm: raw.useLlm === true };
}
export function allocateBudget(budget) {
  const buckets = [{ name: 'Partner activation', share: 35 }, { name: 'Food & welcome', share: 25 }, { name: 'Creative production', share: 20 }, { name: 'Community outreach', share: 10 }, { name: 'Flexible reserve', share: 10 }];
  let remaining = budget;
  return buckets.map((b, index) => { const amount = index === buckets.length - 1 ? remaining : Math.floor(budget * b.share / 100); remaining -= amount; return { ...b, amount }; });
}
export function choosePartners(candidates, rejectedIds, budget) {
  // Explicit studio policy, in the organizer's selected currency; never a vendor-cost estimate.
  const count = budget < 1800 ? 2 : 3;
  const remaining = candidates.filter(p => !rejectedIds.includes(p.id));
  const selected = [], categories = new Set();
  while (remaining.length && selected.length < count) {
    const ranked = remaining.map(p => {
      const rankSignal = 1 / Math.max(1, p.rank);
      const themeSignal = p.fictional ? Math.min(1, (p.editorialFit || 0) / 3) : rankSignal;
      const varietyBonus = categories.has(p.category) ? 0 : 0.3;
      return { candidate: p, score: themeSignal * 0.55 + rankSignal * 0.15 + varietyBonus, varietyBonus };
    }).sort((a, b) => b.score - a.score || a.candidate.rank - b.candidate.rank);
    const winner = ranked[0], p = winner.candidate;
    selected.push({ ...p, selection: { score: Math.round(winner.score * 1000) / 1000, scoreType: 'ENCORE selection score', rank: p.rank, categoryBonus: winner.varietyBonus, reason: p.fictional ? `${p.editorialFit || 0} shared editorial ${p.editorialFit === 1 ? 'theme' : 'themes'} · ${winner.varietyBonus ? 'adds a creative dimension' : 'extends the cultural direction'}` : `Qloo rank #${p.rank} · ${winner.varietyBonus ? 'adds a creative dimension' : 'extends the cultural direction'}` } });
    categories.add(p.category); remaining.splice(remaining.indexOf(p), 1);
  }
  if (!selected.length) throw new AppError('Your shortlist is ready for a fresh direction. Reset partner choices or explore a nearby neighborhood.', 422);
  return selected;
}
export function comparePlans(previous, current) {
  if (!previous || typeof previous !== 'object' || !previous.input || !Array.isArray(previous.partners)) return null;
  // A currency or provider change starts a new planning baseline; no conversion or source equivalence is inferred.
  if (previous.input.currency !== current.input.currency || previous.input.mode !== current.input.mode) return null;
  const oldIds = new Set(previous.partners.map(p => p.id)), newIds = new Set(current.partners.map(p => p.id));
  const added = current.partners.filter(p => !oldIds.has(p.id)).map(p => p.name);
  const replaced = previous.partners.filter(p => !newIds.has(p.id)).map(p => p.name);
  const retained = current.partners.filter(p => oldIds.has(p.id)).map(p => p.name);
  const excluded = previous.partners.filter(p => current.input.rejectedIds.includes(p.id)).map(p => p.name);
  const contextChanged = previous.input.artistId !== current.input.artistId || previous.input.city !== current.input.city;
  const rationale = contextChanged ? 'A new cultural starting point shapes this edition of your night.'
    : current.input.budget < previous.input.budget ? 'A focused format concentrates the production budget on the strongest cultural touchpoints.'
    : current.input.budget > previous.input.budget ? 'The expanded production budget creates more room for creative activation.'
    : added.length ? 'A fresh collaboration lead brings a new expression of the same cultural direction.'
    : 'Your cultural direction stays cohesive, with the same collaboration concepts and a balanced allocation.';
  return { oldBudget: Number(previous.input.budget), newBudget: current.input.budget, oldPartners: previous.partners.length, newPartners: current.partners.length, conceptCapacity: current.input.budget < 1800 ? 2 : 3, added, replaced, retained, excluded, rationale };
}
export function createRunOfShow(partners, artist) {
  const activationTimes = ['18:20', '18:45', '19:10'];
  const action = partner => partner.icon === 'vinyl' ? 'Shape a listening moment around the evening’s musical direction.'
    : partner.icon === 'food' ? 'Create a welcome-table concept around shared tastes and neighborhood conversation.'
    : partner.icon === 'art' ? 'Bring the visual mood to life through an original creative activation.'
    : 'Introduce a collaboration concept inspired by this cultural connection.';
  return [{ time: '18:00', title: 'Open the doors', detail: 'Welcome guests into the listening atmosphere.' },
    ...partners.map((partner, index) => ({ time: activationTimes[index], title: `Meet ${partner.name}`, detail: `${partner.category} · ${action(partner)}`, partnerId: partner.id, partnerName: partner.name, role: partner.category })),
    { time: '20:00', title: 'Take it to the stage', detail: `Carry the room’s energy into the ${artist.name} show.` }];
}
export async function createPlan(raw, deps = {}) {
  const input = validateInput(raw), data = await getCandidates(input, deps);
  const partners = choosePartners(data.places, input.rejectedIds, input.budget);
  const allocation = allocateBudget(input.budget);
  const plan = {
    id: `encore-${Date.now().toString(36)}`, createdAt: new Date().toISOString(), input, artist: data.artist,
    theme: data.artist.theme, format: input.budget < 1800 ? 'Intimate edition' : 'Full expression', partners, allocation,
    connections: [{ domain: 'Sound', name: data.music[0]?.name || data.artist.name, note: 'Listening direction', source: data.music[0]?.source || 'Organizer headliner' }, { domain: 'Cinema', name: data.films[0]?.name || 'Original visual storytelling', note: 'Visual mood reference', source: data.films[0]?.source || 'Editorial direction' }, { domain: 'Place', name: input.city, note: 'Neighborhood energy', source: input.mode === 'sample' ? 'Organizer input' : 'Qloo locality query' }],
    runOfShow: createRunOfShow(partners, data.artist),
    launchCopy: `Meet us in ${input.city} for ${data.artist.theme.toLowerCase()}: a proposed pre-show experience inspired by ${data.artist.name}. Discover ${data.artist.tags.join(', ').toLowerCase()}, connect with your neighborhood, and carry a new story into the live show.`,
    source: { mode: input.mode, label: input.mode === 'sample' ? 'Sample studio' : 'Live Qloo', detail: input.mode === 'sample' ? 'Fictional partners · curated example pairings' : 'Live cultural recommendations · collaboration leads', writing: 'Editorial template' },
    receipts: [{ tool: 'Artist resolver', status: 'complete', detail: `${data.artist.name} selected from ${input.mode === 'sample' ? 'the curated sample artist catalog' : 'Qloo artist search'}.` }, ...data.receipts, { tool: 'Experience planner', status: 'complete', detail: `${partners.length} collaboration leads selected using ${input.mode === 'sample' ? 'editorial theme fit, catalog rank and category variety' : 'within-query Qloo rank and category variety'}; excluded ${input.rejectedIds.length} previously refreshed choices.` }, { tool: 'Budget allocator', status: 'complete', detail: `Five organizer allocation buckets sum to ${input.currency} ${input.budget}.` }],
    proposalNote: 'Organizer planning allocations, proposed schedule and collaboration leads. Confirm participation, availability and rights with each partner before launch.',
  };
  if (input.useLlm) { const draft = await draftWithModel(plan, deps); plan.launchCopy = draft.text; plan.source.writing = draft.source; plan.receipts.push({ tool: 'Brief writer', status: 'complete', detail: draft.source }); }
  plan.comparison = comparePlans(raw.previous, plan);
  return plan;
}
