import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../server/src/app.js';
import { createHealth } from '../server/src/health.js';
import { createRuntime } from '../server/src/runtime.js';
import { reset } from './reset.mjs';

test('the reset script clears the runs through the API and refuses a non-loopback host', async () => {
  const rt = await createRuntime({ stubBase: 6686 });
  const health = createHealth();
  const server = createApp({ runtime: rt, health }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    await rt.run(null);
    assert.equal(rt.listRuns().length, 1);
    const j = await reset(`http://127.0.0.1:${server.address().port}`);
    assert.deepEqual(j, { ok: true, mode: 'mock' });
    assert.deepEqual(rt.listRuns(), []);
    await assert.rejects(reset('http://example.invalid:6650'), /loopback only/);
    await assert.rejects(reset(`http://${['10', '0', '0', '5'].join('.')}:6650`), /loopback only/);
  } finally { health.stop(); server.closeAllConnections(); await new Promise((r) => server.close(r)); await rt.close(); }
});
