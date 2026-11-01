import React from "react";
import { Inert, pretty } from "./Untrusted.jsx";
import { STATUS_GLYPH, STATUS_WORD, UNVERIFIED_STEP } from "../lib/phases.js";

const label = (participants, id) => participants.find((p) => p.id === id)?.label || id;

function Exchange({ ex, participants, i }) {
  const hdrs = (h) => (h && Object.keys(h).length ? h : null);
  return (
    <section className="exchange" aria-label={`Exchange ${i + 1}`}>
      <h3>{label(participants, ex.from)} {"→"} {label(participants, ex.to)}{ex.viaBrowser ? " (front channel, via the browser)" : ""}</h3>
      <p className="mono req"><strong>{ex.request?.method}</strong> <Inert text={ex.request?.url} /></p>
      {hdrs(ex.request?.headers) && <Inert block text={pretty(ex.request.headers)} />}
      {ex.request?.body !== undefined && ex.request?.body !== null && <Inert block text={pretty(ex.request.body)} />}
      <p className="mono res"><strong>{ex.response?.status}</strong> response</p>
      {hdrs(ex.response?.headers) && <Inert block text={pretty(ex.response.headers)} />}
      {ex.response?.body !== undefined && ex.response?.body !== null && ex.response.body !== "" && <Inert block text={pretty(ex.response.body)} />}
    </section>
  );
}

function Token({ t }) {
  return (
    <section className="token" aria-label={t.label}>
      <h3><span className="badge badge--mock">MOCK-ISSUED</span> <Inert text={t.label} /></h3>
      <p className="muted small">Signed with a key that exists only in this server's memory. It protects nothing and opens nothing.</p>
      <Inert block text={t.jwt} />
      {t.header && <Inert block text={pretty(t.header)} />}
      {t.claims && <Inert block text={pretty(t.claims)} />}
      {t.scopes?.length ? <p className="small">scopes: <code>{t.scopes.join(" ")}</code></p> : null}
    </section>
  );
}

export default function WirePanel({ step, def, status, participants, hasRun }) {
  if (!def) return <div className="card wire" data-testid="wire"><h2>Wire form</h2><p className="muted">Choose a message in the reel or the diagram. Run Simulate to see the real request and response behind it.</p></div>;
  const unv = UNVERIFIED_STEP[def.n];
  return (
    <div className="card wire" data-testid="wire">
      <div className="wire-head">
        <h2 id="wire-title">Wire form: message {def.n}, {def.title}</h2>
        <span className={`status status--${status}`}>{STATUS_GLYPH[status]} {STATUS_WORD[status]}</span>
        {def.organisational && <span className="badge badge--org" title="A company or product step with no wire protocol behind it">ORGANISATIONAL STEP</span>}
        {unv && <span className="badge badge--unv" title={`As described in the source proposal, UNVERIFIED against product documentation: ${unv}`}>UNVERIFIED</span>}
      </div>
      <p>{def.text}</p>
      {unv && <p className="small muted">Product detail drawn from the source proposal and not checked against product documentation: {unv}.</p>}
      {!step ? (
        <p className="muted">{hasRun ? (status === "blocked" ? "This message was never sent: an earlier step was refused." : "Not reached yet in this walk-through.") : "No run yet. The payloads below the diagram are real: they are produced by the mock actors when you press Simulate."}</p>
      ) : (
        <>
          {step.refusal && (
            <div className="refusal" role="group" aria-label="Refusal">
              <strong>{"✗"} Refused by {label(participants, step.refusal.actor)}: <code>{step.refusal.error}</code></strong>
              {step.refusal.description && <div><Inert text={step.refusal.description} /></div>}
              {step.refusal.standard && <div className="small">Standard: {step.refusal.standard}</div>}
            </div>
          )}
          {step.note && <p className="small"><Inert text={step.note} /></p>}
          {step.checks?.length > 0 && (
            <ul className="checks plain" aria-label="Checks made at this step">
              {step.checks.map((c, i) => (
                <li key={i} className={c.ok ? "ck ck--ok" : "ck ck--bad"}>
                  <span aria-hidden="true">{c.ok ? "✓" : "✗"}</span> <span className="sr-only">{c.ok ? "passed" : "failed"}: </span>
                  <strong>{label(participants, c.actor)}</strong> checks: <Inert text={c.name} /> <span className="muted">(<Inert text={c.detail} />)</span>
                </li>
              ))}
            </ul>
          )}
          {step.exchanges?.map((ex, i) => <Exchange key={i} ex={ex} participants={participants} i={i} />)}
          {step.tokens?.map((t, i) => <Token key={i} t={t} />)}
          {step.data && <section aria-label="Values at this step"><h3>Values</h3><Inert block text={pretty(step.data)} /></section>}
        </>
      )}
    </div>
  );
}
