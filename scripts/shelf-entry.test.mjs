import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { shelfProblems } from './lib/shelf-registry-rules.mjs';

const read = (f) => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
const entry = JSON.parse(read('../docs/shelf-entry.json'));
const REPO = 'chatgpt-mcp-flow-LAB';

test('docs/shelf-entry.json is portable: a relative composeFile (repo folder / file), no machine path, and it passes the shelf registry rules once the shelf root is put in front', () => {
  const d = entry.demos[0];
  assert.equal(d.composeFile, `${REPO}/docker-compose.yml`);
  assert.ok(!path.isAbsolute(d.composeFile), 'composeFile is relative');
  assert.ok(!/\/Users\/|\/home\/|C:\\|<path-to/.test(JSON.stringify(entry)), 'no machine path and no placeholder to fill in');
  const resolved = entry.demos.map((x) => ({ ...x, composeFile: path.posix.join('/shelf-root', x.composeFile) }));
  assert.deepEqual(shelfProblems(resolved), []);
  assert.ok(fs.existsSync(new URL('../docker-compose.yml', import.meta.url)), 'the compose file named by the entry exists in this checkout');
});

test('the entry matches this app: id, catalog D25 (a placeholder to confirm), kind Demo, port 6650, /api/health, loopback publish', () => {
  const [d] = entry.demos;
  assert.equal(d.id, 'chatgpt-mcp-flow');
  assert.equal(d.catalogId, 'D25');
  assert.equal(d.kind, 'Demo');
  assert.equal(d.url, 'http://localhost:6650');
  assert.equal(d.healthPath, '/api/health');
  assert.match(d.notes, /placeholder/);
  const pkg = JSON.parse(read('../package.json'));
  assert.ok(pkg.scripts.start && pkg.scripts.doctor && pkg.scripts.reset);
  assert.match(read('../docker-compose.yml'), /127\.0\.0\.1:\$\{HOST_PORT:-6650\}:6650/);
});

test('the catalog id is the same in the shelf entry and the content pack', () => {
  const pack = JSON.parse(read('../content-pack.json'));
  assert.equal(pack.demo.catalog, entry.demos[0].catalogId);
});

test('the copied rules reject a bad entry', () => {
  const bad = [{ ...entry.demos[0], url: 'http://evil.example:6650', healthPath: '//x', composeFile: 'relative.yml' }];
  assert.ok(shelfProblems(bad).length >= 3);
  assert.ok(shelfProblems(entry.demos).length >= 1, 'a relative composeFile is not accepted by the shelf rules until the shelf root is put in front');
});
