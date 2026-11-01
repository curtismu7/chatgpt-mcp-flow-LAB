import React from "react";

export default function About({ flow }) {
  const prov = flow.provenance;
  return (
    <section aria-labelledby="about-h">
      <h2 id="about-h" tabIndex={-1}>What is real here, and what is not</h2>
      <div className="card"><h3>Stand-in actors</h3><p>{prov.standIn}</p></div>
      <div className="card"><h3>Standards <span className="badge badge--std">cited by RFC number</span></h3>
        <p className="muted">{prov.standards}</p>
        <ul className="plain std-list">{flow.standards.map((s) => <li key={s.rfc}><strong>{s.rfc}</strong> {s.title}</li>)}</ul>
      </div>
      <div className="card"><h3>Product behaviour <span className="badge badge--unv">UNVERIFIED</span></h3>
        <p>{prov.unverifiedLabel}</p>
        <ul>{prov.unverified.map((u) => <li key={u}>{u}</li>)}</ul>
      </div>
      <div className="card"><h3>Mock and Live</h3><p>The Mock | Live toggle is in the header of every page. Mock is the only mode this lab has, and it works offline. Live is refused with a message, because no real provider is configured or contacted here: the page stays in Mock.</p></div>
      <div className="card"><h3>Keyboard</h3><p>Tab reaches every control. Simulate, Step, Pause, Reset and the mistake chips are buttons or radios; the reel frames are buttons. Boxes in the diagram can be dragged, or focused with Tab, selected with Enter and moved with the arrow keys. Reset puts them back. P turns presenter mode on and off, and Esc leaves it; the simulation banner stays.</p></div>
    </section>
  );
}
