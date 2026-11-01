import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { MISTAKES } from '../server/src/definition.js';

const root = new URL('..', import.meta.url).pathname;
const docs = ['README.md', 'CLAUDE.md', 'docs/safety.md', 'docs/architecture.md', 'docs/talk-track.md'];
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('all documents exist and relative links resolve', () => {
  for (const d of [...docs, 'CHANGELOG.md', 'LICENSE']) assert.ok(fs.existsSync(path.join(root, d)), d);
  for (const d of docs) {
    for (const m of read(d).matchAll(/\]\((?!https?:|#|mailto:)([^)#\s]+)/g)) {
      assert.ok(fs.existsSync(path.resolve(path.dirname(path.join(root, d)), m[1])), `${d} links to missing ${m[1]}`);
    }
  }
});

test('every npm script and source file the docs name exists', () => {
  const pkg = JSON.parse(read('package.json'));
  const serverPkg = JSON.parse(read('server/package.json'));
  for (const d of docs) {
    const text = read(d);
    for (const m of text.matchAll(/npm run ([\w-]+)(?! -w)/g)) assert.ok(pkg.scripts[m[1]] || serverPkg.scripts[m[1]], `${d}: npm run ${m[1]} does not exist`);
    for (const m of text.matchAll(/`((?:server|scripts)\/[\w./-]+\.(?:js|mjs))`/g)) assert.ok(fs.existsSync(path.join(root, m[1])), `${d} names missing file ${m[1]}`);
  }
});

test('every API route the README names exists in app.js', () => {
  const app = read('server/src/app.js');
  for (const m of read('README.md').matchAll(/`(GET|POST) \/api\/([\w/:]+)/g)) {
    const route = `/${m[2].replace(/\/$/, '')}`.replace(/\/:\w+/g, '/:');
    const pattern = route.split('/').filter(Boolean).map((seg) => (seg === ':' ? ':\\w+' : seg)).join('/');
    assert.match(app, new RegExp(`'/${pattern}'`), `app.js has no ${m[1]} ${route}`);
  }
});

test('README declares tier Demo, the neutrality statement and the simulation honesty; the docs name every mistake id', () => {
  const readme = read('README.md');
  assert.match(readme, /^Tier: Demo$/m);
  assert.match(readme, /Neutrality\./);
  assert.match(readme, /MOCK-ISSUED/);
  assert.match(readme, /UNVERIFIED against product documentation/);
  assert.match(read('CLAUDE.md'), /Tier \*\*Demo\*\*/);
  for (const m of MISTAKES) {
    assert.ok(readme.includes(`\`${m.id}\``), `README names ${m.id}`);
    assert.ok(read('docs/architecture.md').includes(`\`${m.id}\``), `architecture names ${m.id}`);
  }
});

test('docs/safety.md carries the stand-in statement, the UNVERIFIED provenance and the guard list', () => {
  const s = read('docs/safety.md');
  assert.match(s, /in-process mock/);
  assert.match(s, /UNVERIFIED against product documentation/);
  assert.match(s, /MOCK-ISSUED/);
  for (const w of ['Host guard', 'CSRF guard', 'Netguard', 'Inert text', 'Redaction']) assert.ok(s.includes(w), w);
});

test('the talk track has the numbered beats and the honest close', () => {
  const t = read('docs/talk-track.md');
  assert.ok((t.match(/^\d+\. \*\*/gm) || []).length >= 6);
  assert.match(t, /still to be verified against product documentation/);
});

test('the definition has 20 messages and the architecture table lists all 20', () => {
  const a = read('docs/architecture.md');
  for (let n = 1; n <= 20; n++) assert.match(a, new RegExp(`^\\| ${n} \\|`, 'm'), `message ${n}`);
});

test('the ci.yml is GitHub-hosted, Node 26 only, and has the family jobs: build, test, doctor, forbidden-strings and gitleaks', () => {
  const ci = read('.github/workflows/ci.yml');
  for (const k of ['npm ci', 'npm test', 'npm run build', 'npm run doctor', 'validate-content-pack', 'forbidden-strings', 'gitleaks', 'actions/checkout@v5', 'actions/setup-node@v5']) assert.ok(ci.includes(k), k);
  assert.match(ci, /runs-on: ubuntu-latest/);
  assert.ok(!/self-hosted|RUNS_ON/.test(ci));
  const versions = [...ci.matchAll(/node-version: (\S+)/g)].map((m) => m[1]);
  assert.ok(versions.length >= 3 && versions.every((v) => v === '26'), versions.join());
});

test('engines.node, the license and the .gitignore are in place', () => {
  assert.equal(JSON.parse(read('package.json')).engines.node, '>=26');
  assert.match(read('LICENSE'), /^MIT License/);
  assert.match(read('.gitignore'), /^node_modules\/$/m);
  assert.match(read('.gitignore'), /^\.env$/m);
});

test('the README does not claim all 20 messages are real requests, and describes the keyboard that works', () => {
  const readme = read('README.md');
  assert.doesNotMatch(readme, /Every one of the 20 messages is a real request/);
  assert.match(readme, /messages 5, 15, 19 and 20/);
  assert.match(readme, /Enter to select/);
  assert.match(read('web/src/components/About.jsx'), /selected with Enter/);
});

test('the catalog phase is documented honestly: opens the sequence, organisational step, UNVERIFIED, no claim about a real catalog', () => {
  const readme = read('README.md'); const arch = read('docs/architecture.md'); const safety = read('docs/safety.md'); const talk = read('docs/talk-track.md');
  assert.match(readme, /opens with a catalog phase/);
  assert.match(readme, /organisational step/);
  assert.match(readme, /No claim is made that any real assistant's catalog works this way/);
  assert.match(arch, /organisational step/);
  assert.match(safety, /catalog phase is an invented teaching model and is UNVERIFIED/);
  assert.match(safety, /no standard or source is cited/);
  assert.match(talk, /organisational step with no protocol/);
  assert.ok(read('CLAUDE.md').includes('catalog'));
});
