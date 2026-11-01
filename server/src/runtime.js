// Builds what the API serves from: five mock actors on 127.0.0.1 (6651-6655 by default), the wire, the clock and a
// bounded run store. Always mock mode; state is in memory only. Runs and resets are serialised and the queue is capped.
import crypto from 'node:crypto';
import { createClock } from './clock.js';
import { MISTAKE_IDS, ORIGINS } from './definition.js';
import { runFlow } from './flow.js';
import { createKeyPair } from './jwt.js';
import { presentValue } from './present.js';
import { STUB_BASE_PORT, STUB_COUNT, actorPortOk } from './safety.js';
import { createWire } from './wire.js';
import { createCatalog } from './actors/catalog.js';
import { createAuthServer } from './actors/authserver.js';
import { listenActor } from './actors/base.js';
import { createGateway } from './actors/gateway.js';
import { createIdp } from './actors/idp.js';
import { createPrivateServer } from './actors/private.js';

export const MAX_RUNS = 20;
export const MAX_PENDING = 2;

export async function createRuntime({ stubBase = STUB_BASE_PORT, clock = createClock(), workspace = 'default' } = {}) {
  for (let i = 0; i < STUB_COUNT; i += 1) if (!actorPortOk(stubBase + i)) throw new Error(`actor port ${stubBase + i} is outside 6650-6699 or blocked by fetch`);
  const ports = { idp: stubBase, pf: stubBase + 1, gateway: stubBase + 2, private: stubBase + 3, catalog: stubBase + 4 };
  const routes = new Map([[ORIGINS.idp, ports.idp], [ORIGINS.as, ports.pf], [ORIGINS.gateway, ports.gateway], [ORIGINS.private, ports.private], [ORIGINS.catalog, ports.catalog]]);
  const wire = createWire({ routes, workspace });
  const gatewaySecret = crypto.randomBytes(24).toString('base64url'); // MOCK client secret, never returned by any API
  const asKey = createKeyPair('as-key-1');
  const idpKey = createKeyPair('idp-key-1');
  const asJwks = { keys: [asKey.publicJwk] };
  const idpJwks = { keys: [idpKey.publicJwk] };

  const idp = createIdp({ keyPair: idpKey, clock, wire });
  const pf = createAuthServer({ keyPair: asKey, idpJwks, clock, wire, gatewaySecret });
  const gateway = createGateway({ asJwks, clock, wire, gatewaySecret });
  const priv = createPrivateServer({ asJwks, clock, wire });
  const catalog = createCatalog({ wire });
  const listeners = [];
  try {
    listeners.push(await listenActor(idp.app, ports.idp), await listenActor(pf.app, ports.pf), await listenActor(gateway.app, ports.gateway), await listenActor(priv.app, ports.private), await listenActor(catalog.app, ports.catalog));
  } catch (e) { await Promise.all(listeners.map((l) => l.close())); throw e; }

  let runs = [];
  let counter = 0;
  let running = Promise.resolve();
  let pending = 0;

  async function execute(mistake) {
    wire.reset();
    const result = await runFlow({ wire, clock, pf, gateway, catalog, mistake });
    const id = `run-${String(counter += 1).padStart(4, '0')}`;
    const run = presentValue({ id, mode: 'mock', ...result });
    runs.push(run);
    if (runs.length > MAX_RUNS) runs = runs.slice(-MAX_RUNS);
    return run;
  }

  return {
    mode: 'mock', ports, wire, workspace,
    actors: { idp, pf, gateway, private: priv, catalog },
    async run(mistake = null) {
      if (mistake !== null && !MISTAKE_IDS.includes(mistake)) throw Object.assign(new Error('unknown mistake'), { code: 'unknown_mistake' });
      if (pending >= MAX_PENDING) throw Object.assign(new Error('run queue full'), { code: 'run_queue_full' });
      pending += 1;
      const r = running.then(() => execute(mistake));
      running = r.catch(() => {}).then(() => { pending -= 1; });
      return r;
    },
    getRun: (id) => runs.find((r) => r.id === id) ?? null,
    listRuns: () => runs.map((r) => ({ id: r.id, mistake: r.mistake?.id ?? null, status: r.status, refusal: r.refusal ? { step: r.refusal.step, actor: r.refusal.actor, error: r.refusal.error } : null })),
    // Queued behind every run already accepted, so a reset never clears state a run is still using. Run ids keep
    // counting (a stale id never resolves to a different run).
    reset() {
      const done = running.then(() => {
        runs = [];
        wire.reset(); clock.reset();
        for (const a of [idp, pf, gateway, priv, catalog]) a.reset();
      });
      running = done;
      return done;
    },
    close: () => Promise.all(listeners.map((l) => l.close())),
  };
}
