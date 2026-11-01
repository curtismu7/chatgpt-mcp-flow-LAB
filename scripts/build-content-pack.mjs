#!/usr/bin/env node
/**
 * Generates content-pack.json (repo root), format demo-content-pack/1 (docs/content-pack.schema.json, a copy of the
 * Learning Hub kit schema). Glossary from content/terms.json; stories from web/src/data/stories.js (the same data the UI
 * story strip renders, default vocabulary); cards for the app's tabs. Deterministic: lists sorted by id, 2-space JSON,
 * no timestamps. The git commit is recorded only when passed (--commit=<sha>).
 *
 *   node scripts/build-content-pack.mjs [--commit=<sha>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PACK_PATH = path.join(ROOT, 'content-pack.json');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const { PACKS, STORIES, fillStory } = await import(pathToFileURL(path.join(ROOT, 'web/src/data/stories.js')));
const { PHASES } = await import(pathToFileURL(path.join(ROOT, 'server/src/definition.js')));

const CARDS = [
  { id: 'sequence', label: 'The 20-message flow', description: 'Press Simulate to walk the real mock exchange, from the catalog (publish, list, add for free (UNVERIFIED)) through sign-in on first use to the answer, message by message, with the wire form of each.', group: 'try-it', href: '/', terms: ['connector-catalog', 'connector-manifest', 'added-not-signed-in', 'protected-resource-metadata', 'authorization-server-metadata', 'pkce', 'token-exchange'], story: 'S01' },
  { id: 'interlocks', label: 'Mistakes and interlocks', description: 'Replay a connector that was never listed, a wrong verifier, wrong audience, missing resource, expired token or replayed code and see which actor refuses.', group: 'try-it', href: '/', terms: ['interlock', 'resource-indicator', 'iss-parameter', 'state'], story: 'S05' },
  { id: 'real', label: 'What is real and what is not', description: 'Which parts are real HTTP and crypto between mock actors, which product behaviour is UNVERIFIED, and which RFCs apply.', group: 'concept', href: '/', terms: ['mock-issued', 'nhi', 'catalog-review'], story: 'S06' },
];

export function buildPack({ commit } = {}) {
  const pkg = readJson('package.json');
  const stories = PHASES.map((p, i) => {
    const s = STORIES.find((x) => x.phase === p.id);
    return { id: `S${String(i + 1).padStart(2, '0')}`, title: s.title, say: fillStory(s.text, PACKS.default) };
  }).sort(byId);
  const ids = new Set(stories.map((s) => s.id));
  const pack = {
    schema: 'demo-content-pack/1',
    id: 'chatgpt-mcp-flow',
    title: 'AI assistant to MCP: authorization flow',
    version: pkg.version,
    ...(commit ? { source: { repo: 'chatgpt-mcp-flow', commit } } : {}),
    demo: { id: 'chatgpt-mcp-flow', name: 'AI assistant to MCP: authorization flow', catalog: 'D25', baseUrl: 'http://localhost:6650', doctor: '/api/health', tags: ['mcp', 'oauth', 'pkce', 'token-exchange', 'pingfederate'] },
    glossary: readJson('content/terms.json').sort(byId),
    sources: [],
    cards: CARDS.map(({ href, ...c }) => ({ ...c, action: { type: 'route', href } })).sort(byId),
    diagrams: [{ id: 'sequence', label: 'Sequence diagram', href: '/' }],
    stories,
  };
  for (const c of pack.cards) if (c.story && !ids.has(c.story)) throw new Error(`card ${c.id} names unknown story ${c.story}`);
  return pack;
}

export const serialize = (pack) => `${JSON.stringify(pack, null, 2)}\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const commit = process.argv.find((a) => a.startsWith('--commit='))?.slice(9);
  fs.writeFileSync(PACK_PATH, serialize(buildPack({ commit })));
  console.log(`wrote ${path.relative(process.cwd(), PACK_PATH) || PACK_PATH}`);
}
