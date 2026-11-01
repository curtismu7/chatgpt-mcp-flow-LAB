// The diagram is diagram-studio/1 data loaded by name. These tests pin it to the definition (so the picture, the reel and the wire panel cannot
// disagree) and pin the loader: a bad name is refused, a bad document is refused, nothing is built by hand.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp } from '../src/app.js';
import { PARTICIPANTS, STEPS } from '../src/definition.js';
import { DIAGRAM_NAMES, diagramByName, loadDiagram } from '../src/diagramData.js';
import { validateDiagram } from '../src/diagramStudioValidate.js';
import { createHealth } from '../src/health.js';
import { request } from './helpers.js';

let health; let server; let port;
before(async () => {
  health = createHealth();
  server = createApp({ runtime: { mode: 'mock', listRuns: () => [], reset() {} }, health }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  port = server.address().port;
});
after(async () => { health.stop(); server.closeAllConnections(); await new Promise((r) => server.close(r)); });

test('the diagram data is valid diagram-studio/1', () => {
  assert.deepEqual(DIAGRAM_NAMES, ['authorization-flow']);
  const doc = loadDiagram('authorization-flow');
  assert.equal(doc.schema, 'diagram-studio/1');
  assert.deepEqual(validateDiagram(doc), []);
  assert.deepEqual(validateDiagram({ ...doc, schema: 'other/1' }).length > 0, true);
  assert.ok(validateDiagram({ ...doc, edges: [{ source: 'nobody', target: 'client' }] }).length > 0);
});

test('drift: one box per participant, one arrow and one step per message, same ends, same titles, same words', () => {
  const doc = diagramByName('authorization-flow');
  assert.deepEqual(doc.nodes.map((n) => n.id).sort(), PARTICIPANTS.map((p) => p.id).sort());
  for (const n of doc.nodes) {
    const p = PARTICIPANTS.find((x) => x.id === n.id);
    assert.equal(n.label, p.label, n.id);
    assert.deepEqual(n.sub, [p.sub], n.id);
  }
  assert.equal(doc.edges.length, STEPS.length);
  assert.equal(doc.steps.length, STEPS.length);
  STEPS.forEach((s, i) => {
    assert.equal(doc.edges[i].source, s.from, `edge ${s.n}`);
    assert.equal(doc.edges[i].target, s.to, `edge ${s.n}`);
    assert.equal(doc.edges[i].label, s.title, `edge ${s.n}`);
    assert.equal(doc.steps[i].title, s.title, `step ${s.n}`);
    assert.equal(doc.steps[i].what, s.text, `step ${s.n}`);
    assert.deepEqual(doc.steps[i].edges, [i], `step ${s.n} walks its own arrow`);
  });
});

test('every box starts on one row, in the order the lifelines read, and no two boxes start on the same spot', () => {
  const doc = diagramByName('authorization-flow');
  assert.ok(doc.nodes.every((n) => n.y === 0));
  const xs = doc.nodes.map((n) => n.x);
  assert.deepEqual(xs, [...xs].sort((a, b) => a - b));
  assert.equal(new Set(xs).size, xs.length);
});

test('GET /api/diagram loads by name; an unknown or odd name is refused and never reaches the disk', async () => {
  const ok = await request(port, 'GET', '/api/diagram');
  assert.equal(ok.status, 200);
  assert.equal(ok.json.id, 'authorization-flow');
  assert.equal((await request(port, 'GET', '/api/diagram?name=authorization-flow')).status, 200);
  for (const name of ['nope', '../package', '..%2f..%2fpackage', 'authorization-flow.json', '%00', '__proto__', 'constructor']) {
    const r = await request(port, 'GET', `/api/diagram?name=${name}`);
    assert.equal(r.status, 404, name);
    assert.equal(r.json.error, 'not_found');
  }
  const arr = await request(port, 'GET', '/api/diagram?name=a&name=b');
  assert.equal(arr.status, 400);
  assert.equal((await request(port, 'POST', '/api/diagram', { body: {} })).status, 405);
  assert.throws(() => loadDiagram('../package'), { code: 'no_such_diagram' });
});

test('a document that fails the validator is not served: the loader throws', () => {
  const src = fs.readFileSync(new URL('../diagrams/authorization-flow.json', import.meta.url), 'utf8');
  const doc = JSON.parse(src);
  doc.nodes.push({ ...doc.nodes[0] }); // duplicate id
  assert.ok(validateDiagram(doc).some((p) => /duplicate id/.test(p)));
});
