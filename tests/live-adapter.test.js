import test from 'node:test';
import assert from 'node:assert/strict';
import { getCandidates, searchArtists } from '../src/providers.js';
const input = { mode: 'live', artistId: '12345678-1234-1234-1234-123456789012', artistName: 'Fixture artist', city: 'Brooklyn', rejectedIds: [] };
const env = { QLOO_API_KEY: 'synthetic-live-adapter-test-only' };
const locality = { entity_id: 'locality-brooklyn', name: 'Brooklyn' };
function place(id, slug, options = {}) {
  return { entity_id: id, name: id, subtype: 'urn:entity:place', tags: [], properties: { primary_genre: { id: `urn:tag:genre:place:${slug}`, name: slug.replaceAll('_', ' ') }, geocode: { name: 'Williamsburg', city: 'New York' }, localities: [locality], ...options } };
}
async function candidates(places, query = { localities: { filter: [locality] } }) {
  const calls=[];
  const data=await getCandidates(input, { env, fetcher: async url => { calls.push(Object.fromEntries(url.searchParams)); return Response.json({ results: { entities: url.searchParams.get('filter.type') === 'urn:entity:place' ? places : [] }, query }); } });
  return { data, calls };
}
test('live adapter: strict locality and collaboration taxonomy preserve original Qloo ranks', async () => {
  const {data,calls}=await candidates([place('water','water'),place('channel','channel'),place('cafe','cafe'),place('other-borough','art_gallery',{localities:[{entity_id:'queens',name:'Queens'}]}),place('arts','arts_organization')]);
  assert.deepEqual(data.places.map(p=>p.id),['cafe','arts']);
  assert.deepEqual(data.places.map(p=>p.rank),[3,5]);
  assert.equal(calls[0]['filter.location.radius'],'0');
  assert.ok(data.places.every(p=>p.localityVerified&&p.localityEvidence.id===locality.entity_id));
  assert.equal(data.places[0].locality,'Williamsburg · Brooklyn');
  assert.equal(data.places[0].categoryId,'urn:tag:genre:place:cafe');
});
test('live adapter: category tags work without primary genre and incidental tags never establish eligibility',async()=>{
  const arts=place('arts','unknown',{primary_genre:null});arts.tags=[{id:'urn:tag:category:place:arts_organization',type:'urn:tag:category:place',name:'Arts organization'}];
  const incidental=place('water','water');incidental.tags=[{id:'urn:tag:amenity:qloo:restaurant',type:'urn:tag:amenity:qloo',name:'Restaurant'}];
  const {data}=await candidates([incidental,arts,place('closed','cafe',{is_closed:true})]);
  assert.deepEqual(data.places.map(p=>p.id),['arts']);assert.equal(data.places[0].categorySource,'Qloo category tag');
});
test('live adapter: cultural cues exclude demographic and operational tags',async()=>{
  const cafe=place('cafe','cafe');cafe.tags=[{name:'30 34',type:'urn:tag:age:qloo'},{name:'Onsite services',type:'urn:tag:service_options:place'},{name:'Cozy',type:'urn:tag:ambience:qloo'},{name:'Contemporary art',type:'urn:tag:interests:qloo'},{name:'Paid parking',type:'urn:tag:parking:qloo'}];
  const {data}=await candidates([cafe]);assert.deepEqual(data.places[0].tags,['Cozy','Contemporary art']);
});
test('live adapter: nullable tags, missing geocode and unknown subtype retain explicit location evidence',async()=>{
  const cafe=place('cafe','cafe',{geocode:null,localities:null});cafe.subtype=['urn:entity:place'];cafe.tags=null;
  const {data}=await candidates([cafe],{});assert.equal(data.places.length,1);assert.equal(data.places[0].localityVerified,false);assert.equal(data.places[0].locality,'');assert.deepEqual(data.places[0].tags,[]);
});
test('live adapter: artist search retains only typed artists',async()=>{
  const found=await searchArtists('Fixture','live',{env,fetcher:async()=>Response.json({results:[{entity_id:'a',name:'Fixture',types:['urn:entity:artist']},{entity_id:'p',name:'Fixture place',types:['urn:entity:place']}]})});assert.deepEqual(found.map(a=>a.id),['a']);
});
