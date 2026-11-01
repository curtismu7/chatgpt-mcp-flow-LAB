import React from "react";
import { reveal } from "../lib/reveal.js";

// Everything shown from a run is rendered as React text, never as markup, and hidden characters become visible chips.
const CHIP = /(\[U\+[0-9A-F]{4,6}\])/;
export function Inert({ text, block = false }) {
  const Tag = block ? "pre" : "span";
  const parts = reveal(text).split(CHIP);
  return (
    <Tag className={`inert${block ? " inert--block" : ""}`}>
      {parts.map((p, i) => (i % 2 ? <span key={i} className="chip" title="Hidden character, shown instead of hidden">{p}</span> : <React.Fragment key={i}>{p}</React.Fragment>))}
    </Tag>
  );
}
export const pretty = (v) => (typeof v === "string" ? v : JSON.stringify(v, null, 2));
