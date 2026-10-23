export const artists = [
  { id: 'sample-khruangbin', name: 'Khruangbin', subtitle: 'Global grooves · Psychedelic soul', color: '#d6ee6a', tags: ['Global grooves', 'Analog warmth', 'Slow discovery'], theme: 'Golden Hour, Global Soul', music: 'Cymande', film: 'In the Mood for Love' },
  { id: 'sample-laufey', name: 'Laufey', subtitle: 'Jazz harmony · Modern romance', color: '#f3b0ad', tags: ['Jazz after dark', 'Modern romance', 'Intimate storytelling'], theme: 'A Little Romance, Live', music: 'Chet Baker', film: 'The Umbrellas of Cherbourg' },
  { id: 'sample-fred', name: 'Fred again..', subtitle: 'Collective joy · Electronic energy', color: '#ffa36e', tags: ['Collective joy', 'Electronic energy', 'City after dark'], theme: 'The City Comes Together', music: 'Jamie xx', film: 'Human Traffic' },
  { id: 'sample-mitski', name: 'Mitski', subtitle: 'Indie expression · Cinematic emotion', color: '#b7c5ed', tags: ['Indie expression', 'Cinematic emotion', 'Creative community'], theme: 'An Evening in Full Color', music: 'Japanese Breakfast', film: 'Perfect Days' },
];
// Every place below is fictional. Editorial pairings are authored examples, not Qloo data.
const places = [
  ['paper-lantern', 'Paper Lantern Listening Bar', 'Listening lounge', 'A warm vinyl-led arrival with a locally hosted listening corner.', ['Analog warmth', 'Jazz after dark', 'Slow discovery'], 'vinyl'],
  ['sunroom', 'Sunroom Kitchen', 'Food collaborator', 'A bright shared-table moment shaped around the evening’s cultural palette.', ['Global grooves', 'Modern romance', 'Collective joy'], 'food'],
  ['frame-house', 'Frame House Studio', 'Creative partner', 'A small-format poster and print activation guests can take home.', ['Indie expression', 'Creative community', 'Cinematic emotion'], 'art'],
  ['night-orchard', 'Night Orchard Social', 'Listening lounge', 'A playful pre-show gathering built around shared musical discoveries.', ['Electronic energy', 'City after dark', 'Collective joy'], 'vinyl'],
  ['citrus-table', 'Citrus Table Collective', 'Food collaborator', 'A colorful welcome menu concept with a relaxed neighborhood feel.', ['Global grooves', 'Slow discovery', 'Modern romance'], 'food'],
  ['film-window', 'Film Window Atelier', 'Creative partner', 'A cinematic mood wall and original visual storytelling prompt.', ['Cinematic emotion', 'Intimate storytelling', 'Analog warmth'], 'art'],
];
export function sampleCandidates(artist, city) {
  return places.map(([id, name, category, description, tags, icon], index) => ({
    id: `sample-${id}`, name, category, description, tags, icon, locality: city,
    rank: index + 1, editorialFit: tags.filter(t => artist.tags.includes(t)).length,
    source: 'Curated example', fictional: true,
  })).sort((a, b) => b.editorialFit - a.editorialFit || a.rank - b.rank);
}
