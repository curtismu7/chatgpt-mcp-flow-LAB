import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { PACK_PATH, buildPack, serialize } from './build-content-pack.mjs';
import { validatePack } from './validate-content-pack.mjs';

test('content-pack.json is exactly what the generator produces (run: npm run content-pack)', () => {
  assert.equal(fs.readFileSync(PACK_PATH, 'utf8'), serialize(buildPack()), 'content-pack.json is stale; regenerate it and commit the result');
});

test('the generator is deterministic', () => assert.equal(serialize(buildPack()), serialize(buildPack())));

test('content-pack.json validates against docs/content-pack.schema.json', () => {
  assert.deepEqual(validatePack(JSON.parse(fs.readFileSync(PACK_PATH, 'utf8'))), []);
});

test('the validator rejects a broken pack', () => {
  const pack = buildPack();
  pack.cards[0].terms = ['no-such-term'];
  delete pack.title;
  assert.ok(validatePack(pack).length >= 2);
});

test('the pack covers the app: PKCE, metadata, resource indicators, iss, token exchange, act, the enterprise IdP, interlocks, MOCK-ISSUED', () => {
  const pack = buildPack();
  for (const id of ['pkce', 'protected-resource-metadata', 'authorization-server-metadata', 'resource-indicator', 'iss-parameter', 'token-exchange', 'act-claim', 'enterprise-idp', 'interlock', 'mock-issued', 'nhi', 'connector-catalog', 'connector-manifest', 'catalog-review', 'added-not-signed-in']) assert.ok(pack.glossary.some((g) => g.id === id), id);
  assert.deepEqual(pack.sources, []);
  assert.equal(pack.demo.baseUrl, 'http://localhost:6650');
  assert.equal(pack.demo.catalog, 'D25');
  assert.equal(pack.stories.length, 6);
});

test('every story says exactly what the UI story strip says in the default vocabulary, and no {{token}} survives', async () => {
  const { PACKS, STORIES, fillStory } = await import('../web/src/data/stories.js');
  const said = buildPack().stories.map((s) => s.say);
  for (const s of STORIES) assert.ok(said.includes(fillStory(s.text, PACKS.default)), s.phase);
  for (const t of said) assert.ok(!t.includes('{{'), t);
});

test('a commit is recorded only when passed', () => {
  assert.equal(buildPack().source, undefined);
  assert.equal(buildPack({ commit: 'abc1234' }).source.commit, 'abc1234');
});

test('the catalog terms and the first story say the catalog is a teaching model and UNVERIFIED, and the first story opens with the catalog', () => {
  const pack = buildPack();
  for (const id of ['connector-catalog', 'connector-manifest', 'catalog-review']) assert.match(pack.glossary.find((g) => g.id === id).definition, /UNVERIFIED/, id);
  assert.match(pack.stories[0].say, /catalog/);
  assert.match(pack.stories[0].say, /UNVERIFIED/);
  assert.equal(pack.stories[0].title, 'Getting the connector');
  assert.equal(pack.cards.find((c) => c.id === 'sequence').story, 'S01');
});
