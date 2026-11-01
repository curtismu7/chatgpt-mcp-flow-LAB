import React, { useCallback, useMemo, useState } from "react";
import { Background, Controls, Handle, Position, ReactFlow, applyNodeChanges } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { STATUS_GLYPH, UNVERIFIED_PARTICIPANT } from "../lib/phases.js";

// A sequence diagram drawn from diagram-studio/1 DATA (server/diagrams/authorization-flow.json, loaded by name from /api/diagram):
// each box in the data is one draggable node (a box on top of a dashed lifeline), each arrow in the data is one numbered message,
// a straight edge between two handles placed at that message's row on the two lifelines. Nothing here lists boxes or arrows by hand.
export const NODE_GAP = 210; // the spacing of the boxes in the data; an edge label has to fit between the lifelines it crosses
export const ROW_TOP = 118;
export const ROW_GAP = 40;
const LIFE_END = 24;

// The data's arrows as numbered messages (arrow i is message i + 1), joined with the flow's phase for the same message.
export function messagesOf(diagram, steps = []) {
  return diagram.edges.map((e, i) => ({ n: i + 1, from: e.source, to: e.target, title: e.label || "", phase: steps.find((s) => s.n === i + 1)?.phase || "experience" }));
}

// An edge label must fit between its two lifelines, or it covers the arrow. The span is the lifelines it crosses; the
// title is shortened to fit (the reel and the wire panel always carry the full title).
const CHAR_PX = 6.8;
export function edgeLabel(n, title, glyph, lifelinesCrossed) {
  const room = Math.floor((Math.max(1, lifelinesCrossed) * NODE_GAP - 56) / CHAR_PX);
  const fixed = `${n}  `.length + (glyph ? glyph.length + 1 : 0);
  const budget = Math.max(6, room - fixed);
  const t = title.length > budget ? `${title.slice(0, budget - 1).trimEnd()}…` : title;
  return `${n}  ${t}${glyph ? ` ${glyph}` : ""}`;
}
const crossed = (diagram, m) => {
  const x = (id) => diagram.nodes.find((n) => n.id === id)?.x ?? 0;
  return Math.round(Math.abs(x(m.from) - x(m.to)) / NODE_GAP);
};

export const startPositions = (diagram) => Object.fromEntries((diagram?.nodes || []).map((n) => [n.id, { x: n.x, y: n.y }]));

// Positions live outside React Flow so Reset can put every box back exactly where the data put it.
export function useDiagramPositions(diagram) {
  const start = useMemo(() => startPositions(diagram), [diagram]);
  const [moved, setMoved] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const positions = useMemo(() => (Object.keys(moved).length ? { ...start, ...moved } : start), [start, moved]);
  const apply = useCallback((nodes, changes) => {
    // Selection is kept here too: a selected box is the one the arrow keys move.
    for (const c of changes) if (c.type === "select") setSelectedId((cur) => (c.selected ? c.id : cur === c.id ? null : cur));
    const next = applyNodeChanges(changes.filter((c) => c.type === "position" || c.type === "dimensions"), nodes);
    setMoved((prev) => {
      let out = prev;
      for (const n of next) {
        const at = prev[n.id] || start[n.id];
        if (n.position && at && (n.position.x !== at.x || n.position.y !== at.y)) out = { ...out, [n.id]: { x: n.position.x, y: n.position.y } };
      }
      return out; // the same object when nothing moved, so a dimensions-only change cannot loop
    });
  }, [start]);
  const reset = useCallback(() => { setMoved({}); setSelectedId(null); }, []);
  return { positions, selectedId, apply, reset };
}

function Lifeline({ data }) {
  return (
    <div className={`life${data.on ? " life--on" : ""}${data.dim ? " life--dim" : ""}`} data-testid={`box-${data.id}`} style={{ height: ROW_TOP + data.rows * ROW_GAP + LIFE_END }}>
      <div className="fbox" data-color={data.color} tabIndex={-1}>
        <strong>{data.label}</strong>
        <span className="fbox__sub">{data.sub}</span>
        {data.unverified && <span className="badge badge--unv" title={`UNVERIFIED against product documentation: ${data.unverified}`}>UNVERIFIED</span>}
      </div>
      <div className="lifeline" aria-hidden="true" />
      {data.handles.map((h) => (
        <Handle key={h.id} id={h.id} type={h.type} position={Position.Top} isConnectable={false} style={{ top: h.y, left: "50%", opacity: 0, pointerEvents: "none" }} />
      ))}
    </div>
  );
}
const nodeTypes = { life: Lifeline };

const rowY = (n) => ROW_TOP + (n - 1) * ROW_GAP;

export function buildNodes({ diagram, messages, positions, activeIds = [], dimOthers = false, selectedId = null }) {
  const rows = messages.length;
  return diagram.nodes.map((p) => {
    const handles = [];
    for (const s of messages) {
      if (s.from === p.id) handles.push({ id: `o${s.n}`, type: "source", y: rowY(s.n) });
      if (s.to === p.id) handles.push({ id: `i${s.n}`, type: "target", y: rowY(s.n) });
    }
    const sub = (p.sub || []).join(" ");
    return {
      id: p.id, type: "life", position: positions[p.id] || { x: p.x, y: p.y }, dragHandle: ".fbox", selected: selectedId === p.id,
      ariaLabel: `${p.label}: ${sub}. Drag it, or press Enter to select it and then the arrow keys to move it.`,
      data: { id: p.id, label: p.label, sub, color: diagram.groups[p.group]?.color || "dark", handles, rows, unverified: UNVERIFIED_PARTICIPANT[p.id], on: activeIds.includes(p.id), dim: dimOthers && !activeIds.includes(p.id) },
    };
  });
}

// Colour comes from CSS (msg-phase--<phase> on the edge, arrow--<phase> on the marker), so every colour is a theme token.
export function buildEdges({ diagram, messages, statusOf, currentN }) {
  return messages.map((s) => {
    const st = statusOf(s.n);
    const faded = st === "pending" || st === "blocked";
    return {
      id: `m${s.n}`, source: s.from, target: s.to, sourceHandle: `o${s.n}`, targetHandle: `i${s.n}`, type: "straight",
      label: edgeLabel(s.n, s.title, st === "ok" || st === "pending" ? "" : STATUS_GLYPH[st], crossed(diagram, s)),
      labelStyle: { fontSize: 12, fontWeight: 600, fill: "var(--text)" },
      labelBgStyle: { fill: "var(--surface)", fillOpacity: 0.92 }, labelBgPadding: [5, 2], labelBgBorderRadius: 3,
      markerEnd: `arrow-${st === "refused" ? "refused" : s.phase}`,
      className: `msg msg--${st} msg-phase--${st === "refused" ? "refused" : s.phase}${s.n === currentN ? " msg--current" : ""}`,
      style: { strokeWidth: s.n === currentN ? 3.5 : 2, opacity: faded ? 0.3 : 1, strokeDasharray: st === "refused" || st === "skipped" ? "7 5" : undefined },
      selectable: false, focusable: false,
    };
  });
}

// Arrowheads are our own SVG markers so their fill can be a token (React Flow's built-in ones take a colour literal).
function ArrowDefs({ phases }) {
  return (
    <svg className="flow-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        {[...phases, "refused"].map((id) => (
          <marker key={id} id={`arrow-${id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" className={`arrow arrow--${id}`} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

export default function Diagram({ diagram, steps = [], positions, selectedId = null, onApply, statusOf, currentN, theme, presenter }) {
  const messages = useMemo(() => messagesOf(diagram, steps), [diagram, steps]);
  const cur = messages.find((s) => s.n === currentN);
  const activeIds = cur ? [cur.from, cur.to] : [];
  const nodes = useMemo(() => buildNodes({ diagram, messages, positions, activeIds, dimOthers: false, selectedId }), [diagram, messages, positions, currentN, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps
  const edges = useMemo(() => buildEdges({ diagram, messages, statusOf, currentN }), [diagram, messages, statusOf, currentN]);
  const phases = useMemo(() => [...new Set(messages.map((m) => m.phase))], [messages]);
  const onNodesChange = useCallback((changes) => onApply(nodes, changes), [nodes, onApply]);
  return (
    <div className="flow-scroll" role="region" aria-label="Sequence diagram scroll area" tabIndex={0}>
      <ArrowDefs phases={phases} />
      <div className={`flow-wrap${presenter ? " flow-wrap--big" : ""}`} data-testid="diagram" role="group" aria-label="Sequence diagram. The reel and the step buttons below give the same content as text.">
        <ReactFlow
          nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange}
          nodesConnectable={false} nodesDraggable elementsSelectable fitView fitViewOptions={{ padding: 0.06 }}
          minZoom={0.25} maxZoom={1.6} colorMode={theme} proOptions={{ hideAttribution: false }}
        >
          <Background gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
