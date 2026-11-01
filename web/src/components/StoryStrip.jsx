import React, { useState } from "react";
import { PACKS, PACK_LABELS, STORIES, fillStory } from "../data/stories.js";

export default function StoryStrip({ phases, activePhase, vertical = "default" }) {
  const [pack, setPack] = useState(Object.hasOwn(PACKS, vertical) ? vertical : "default");
  return (
    <section className="story" aria-label="The story in six phases">
      <label className="field">Story vocabulary
        <select value={pack} onChange={(e) => setPack(e.target.value)} data-testid="story-pack">
          {Object.keys(PACKS).map((id) => <option key={id} value={id}>{PACK_LABELS[id]}</option>)}
        </select>
      </label>
      <ol>
        {STORIES.map((s) => (
          <li key={s.phase} data-phase={s.phase} data-now={activePhase === s.phase ? "true" : "false"} aria-current={activePhase === s.phase ? "step" : undefined}>
            <strong>{phases.find((p) => p.id === s.phase)?.label || s.title}</strong>
            <span>{fillStory(s.text, PACKS[pack])}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
