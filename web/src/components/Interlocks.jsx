import React from "react";
import { Inert } from "./Untrusted.jsx";

// Every mistake as a card with the standard behind it, and a table of what this session's runs actually did.
export default function Interlocks({ mistakes, participants, results, onRun, onRunAll, busy }) {
  const label = (id) => participants.find((p) => p.id === id)?.label || id;
  return (
    <section aria-labelledby="interlocks-h">
      <h2 id="interlocks-h" tabIndex={-1}>Interlocks: who refuses, and why</h2>
      <p className="muted">Each row changes exactly one thing the client or an actor does. The run stops where an actor refuses. The table fills in from real runs against the mock actors.</p>
      <p><button type="button" className="primary" aria-disabled={busy ? "true" : undefined} onClick={() => { if (!busy) onRunAll(); }} data-testid="run-all">Run all {mistakes.length} checks</button></p>
      <div className="table-wrap" role="region" aria-label="Interlocks table" tabIndex={0}>
        <table className="inv">
          <thead><tr><th scope="col">Mistake</th><th scope="col">Standard</th><th scope="col">Expected refusal</th><th scope="col">Actual result</th><th scope="col"><span className="sr-only">Run</span></th></tr></thead>
          <tbody>
            {mistakes.map((m) => {
              const r = results[m.id];
              return (
                <tr key={m.id} data-testid={`row-${m.id}`}>
                  <th scope="row"><strong>{m.label}</strong><div className="small muted">{m.why}</div></th>
                  <td>{m.standard}</td>
                  <td>message {m.expected.step}, {label(m.expected.actor)}, <code>{m.expected.error}</code></td>
                  <td data-testid={`result-${m.id}`}>
                    {!r ? <span className="muted">not run</span> : r.refusal
                      ? <span className={`status status--${r.interlockHeld ? "ok" : "deny"}`}>{r.interlockHeld ? "✓ held" : "✗ differs"}: message {r.refusal.step}, {label(r.refusal.actor)}, <code><Inert text={r.refusal.error} /></code></span>
                      : <span className="status status--deny">{"✗"} not refused</span>}
                  </td>
                  <td><button type="button" aria-disabled={busy ? "true" : undefined} onClick={() => { if (!busy) onRun(m.id); }}>Run<span className="sr-only"> {m.label}</span></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
