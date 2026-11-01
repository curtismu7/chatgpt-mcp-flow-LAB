// Fixtures built from the server's own definition so they cannot drift from it.
import { MISTAKES, PARTICIPANTS, PHASES, PROVENANCE, STANDARDS, STEPS } from "../../../server/src/definition.js";

export const FLOW = {
  mode: "mock", participants: PARTICIPANTS, phases: PHASES, steps: STEPS,
  mistakes: MISTAKES.map(({ id, label, expected, standard, why }) => ({ id, label, expected, standard, why })),
  standards: STANDARDS, provenance: PROVENANCE,
};

const okStep = (s) => ({ ...s, status: "ok", exchanges: [{ from: s.from, to: s.to, request: { method: "GET", url: "https://auth.example/x", headers: {}, body: s.n === 14 ? { code_verifier: "abc" } : null }, response: { status: 200, headers: {}, body: { ok: true } } }], checks: [{ actor: s.to, name: "a check", ok: true, detail: "fine" }],
  ...(s.n === 15 ? { tokens: [{ label: "Access token - MOCK-ISSUED (in-memory key, protects nothing)", jwt: "h.p.s", header: { alg: "ES256" }, claims: { aud: "https://mcp.example" }, scopes: ["items.read"] }] } : {}),
  ...(s.n === STEPS.length ? { data: { assistant_says: "widget-100 costs 12.50 USD" } } : {}) });

export const HAPPY = { id: "run-0001", mode: "mock", mistake: null, status: "completed", refusal: null, interlockHeld: null, stepsPlanned: STEPS.length, steps: STEPS.map(okStep) };

export function refusedRun(id) {
  const m = MISTAKES.find((x) => x.id === id);
  const steps = STEPS.slice(0, m.expected.step).map(okStep);
  const refusal = { step: m.expected.step, actor: m.expected.actor, error: m.expected.error, description: "refused in a test", standard: m.standard };
  steps[steps.length - 1] = { ...steps[steps.length - 1], status: "refused", refusal };
  return { id: "run-0002", mode: "mock", mistake: { id: m.id, label: m.label, why: m.why, standard: m.standard, expected: m.expected }, status: "refused", refusal, interlockHeld: true, stepsPlanned: STEPS.length, steps };
}

// The diagram-studio/1 document the server serves at /api/diagram, imported from the same data file.
export { default as DIAGRAM } from "../../../server/diagrams/authorization-flow.json";
