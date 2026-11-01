import React from "react";
import { STATUS_GLYPH, STATUS_WORD } from "../lib/phases.js";

// The movie reel: one frame per message, coloured by phase. The details row under it names the two participants
// involved in the chosen message and says what each one does.
export function Reel({ steps, statusOf, selectedN, currentN, onPick, phaseLabel }) {
  return (
    <ol className="reel" aria-label={`Movie reel of the ${steps.length} messages`}>
      {steps.map((s) => {
        const st = statusOf(s.n);
        return (
          <li key={s.n}>
            <button
              type="button" className="frame" data-phase={s.phase} data-selected={s.n === selectedN ? "true" : "false"} data-now={s.n === currentN ? "true" : "false"}
              aria-current={s.n === selectedN ? "step" : undefined} data-testid={`frame-${s.n}`} data-status={st}
              onClick={() => onPick(s.n)}
              aria-label={`Message ${s.n}: ${s.title}. Phase: ${phaseLabel(s.phase)}. ${s.organisational ? "Organisational step. " : ""}${STATUS_WORD[st]}.`}
            >
              <span className="frame__n">{s.n}</span>
              <span className="frame__t">{s.title}</span>
              <span className="frame__s" aria-hidden="true">{STATUS_GLYPH[st]}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function DetailsRow({ def, participants, phaseLabel }) {
  if (!def) return <div className="details card" data-testid="details-row"><p className="muted">Choose a frame to see who is involved and what each participant does.</p></div>;
  const cards = [def.from, def.to].map((id) => participants.find((p) => p.id === id)).filter(Boolean);
  return (
    <div className="details" data-testid="details-row" aria-label={`Participants in message ${def.n}`} role="group">
      <p className="phase-tag"><span className="dot" data-phase={def.phase} aria-hidden="true" /> {phaseLabel(def.phase)}: message {def.n} runs from <strong>{cards[0]?.label}</strong> to <strong>{cards[1]?.label}</strong>{def.organisational ? <> <span className="badge badge--org" data-testid="org-badge">ORGANISATIONAL STEP</span></> : null}</p>
      <div className="pcards">
        {cards.map((p, i) => (
          <article key={`${p.id}${i}`} className="card pcard">
            <h2>{p.label} <span className="muted small">{p.sub}</span></h2>
            <p>{p.details}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
