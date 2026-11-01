import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { NODE_GAP, buildEdges, buildNodes, edgeLabel, messagesOf, startPositions, useDiagramPositions } from "../components/Diagram.jsx";
import { DIAGRAM, FLOW } from "./fixtures.js";
import fs from "node:fs";
import path from "node:path";

describe("diagram model (drawn from the diagram-studio/1 data)", () => {
  const messages = messagesOf(DIAGRAM, FLOW.steps);
  const positions = startPositions(DIAGRAM);
  const nodes = buildNodes({ diagram: DIAGRAM, messages, positions });
  const edges = buildEdges({ diagram: DIAGRAM, messages, statusOf: () => "pending", currentN: null });

  it("has one lifeline per box in the data and one numbered message per arrow in the data", () => {
    expect(nodes).toHaveLength(DIAGRAM.nodes.length);
    expect(nodes).toHaveLength(8);
    expect(edges).toHaveLength(DIAGRAM.edges.length);
    expect(edges).toHaveLength(20);
    expect(edges[13].label).toMatch(/^14 /);
    expect(messages[13]).toMatchObject({ n: 14, from: "client", to: "pf", phase: "redemption" });
  });
  it("the start positions are the data's, and nothing about the boxes is written in the code", () => {
    expect(positions.pf).toEqual({ x: DIAGRAM.nodes.find((n) => n.id === "pf").x, y: 0 });
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/components/Diagram.jsx"), "utf8");
    expect(src).not.toMatch(/"publisher"|"gateway"|"private"/);
  });
  it("a changed diagram document changes the drawing (the data is the source)", () => {
    const moved = { ...DIAGRAM, nodes: DIAGRAM.nodes.map((n) => (n.id === "pf" ? { ...n, label: "Renamed box", x: 999 } : n)) };
    const n = buildNodes({ diagram: moved, messages, positions: startPositions(moved) }).find((x) => x.id === "pf");
    expect(n.data.label).toBe("Renamed box");
    expect(n.position.x).toBe(999);
  });
  it("every edge connects handles that exist on its two lifelines", () => {
    for (const e of edges) {
      expect(nodes.find((n) => n.id === e.source).data.handles.some((h) => h.id === e.sourceHandle && h.type === "source")).toBe(true);
      expect(nodes.find((n) => n.id === e.target).data.handles.some((h) => h.id === e.targetHandle && h.type === "target")).toBe(true);
    }
  });
  it("messages are drawn in order, top to bottom", () => {
    const ys = messages.map((s) => nodes.find((n) => n.id === s.from).data.handles.find((h) => h.id === `o${s.n}`).y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  });
  it("each box takes its colour from its group in the data, and a message its phase from the flow, as class names (no colour in code)", () => {
    expect(nodes.find((n) => n.id === "pf").data.color).toBe(DIAGRAM.groups[DIAGRAM.nodes.find((n) => n.id === "pf").group].color);
    expect(edges[0].className).toMatch(/msg-phase--catalog/);
    expect(edges[13].className).toMatch(/msg-phase--redemption/);
    expect(edges[13].markerEnd).toBe("arrow-redemption");
    const e = buildEdges({ diagram: DIAGRAM, messages, statusOf: (n) => (n === 14 ? "refused" : "ok"), currentN: 14 });
    expect(e[13].className).toMatch(/msg-phase--refused/);
    expect(e[13].markerEnd).toBe("arrow-refused");
    const all = JSON.stringify(e);
    expect(all).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb|hsl/);
  });
  it("marks a refused message with a dash and a glyph, not by colour alone", () => {
    const e = buildEdges({ diagram: DIAGRAM, messages, statusOf: (n) => (n === 14 ? "refused" : "ok"), currentN: 14 });
    expect(e[13].style.strokeDasharray).toBeTruthy();
    expect(e[13].label).toMatch(/✗/);
    expect(e[0].style.strokeDasharray).toBeUndefined();
  });
  it("Reset restores dragged box positions to the data's", () => {
    const { result } = renderHook(() => useDiagramPositions(DIAGRAM));
    act(() => result.current.apply(nodes, [{ type: "position", id: "client", position: { x: 500, y: 90 }, dragging: false }]));
    expect(result.current.positions.client).toEqual({ x: 500, y: 90 });
    act(() => result.current.reset());
    expect(result.current.positions).toEqual(startPositions(DIAGRAM));
  });
  it("before the data has loaded there are no positions, and nothing breaks", () => {
    const { result } = renderHook(() => useDiagramPositions(null));
    expect(result.current.positions).toEqual({});
  });
  it("a dimensions-only change keeps the same positions object (no render loop)", () => {
    const { result } = renderHook(() => useDiagramPositions(DIAGRAM));
    const before = result.current.positions;
    act(() => result.current.apply(nodes, [{ type: "dimensions", id: "client", dimensions: { width: 150, height: 80 } }]));
    expect(result.current.positions).toBe(before);
  });
  it("every edge label fits between its two lifelines, so it never covers the arrow", () => {
    const x = (id) => DIAGRAM.nodes.find((n) => n.id === id).x;
    const span = (s) => Math.abs(x(s.from) - x(s.to));
    for (const status of ["ok", "refused"]) {
      const e = buildEdges({ diagram: DIAGRAM, messages, statusOf: () => status, currentN: null });
      messages.forEach((s, i) => expect(e[i].label.length * 6.8, `message ${s.n} ${status}`).toBeLessThanOrEqual(span(s) - 40));
    }
    const long = edgeLabel(14, "Route to the private MCP server", "", 1);
    expect(long.endsWith("…")).toBe(true);
    expect(long.length * 6.8).toBeLessThanOrEqual(NODE_GAP - 40);
    expect(edgeLabel(1, "Short", "", 3)).toBe("1  Short");
    expect(edgeLabel(2, "Refused thing", "✗", 4)).toBe("2  Refused thing ✗");
  });
  it("a select change is remembered, so the arrow keys have a selected box to move; Reset clears it", () => {
    const { result } = renderHook(() => useDiagramPositions(DIAGRAM));
    expect(result.current.selectedId).toBeNull();
    act(() => result.current.apply(nodes, [{ type: "select", id: "pf", selected: true }]));
    expect(result.current.selectedId).toBe("pf");
    expect(buildNodes({ diagram: DIAGRAM, messages, positions, selectedId: "pf" }).find((n) => n.id === "pf").selected).toBe(true);
    expect(nodes.every((n) => n.selected === false)).toBe(true);
    act(() => result.current.apply(nodes, [{ type: "select", id: "client", selected: true }]));
    expect(result.current.selectedId).toBe("client");
    act(() => result.current.apply(nodes, [{ type: "select", id: "client", selected: false }]));
    expect(result.current.selectedId).toBeNull();
    act(() => result.current.apply(nodes, [{ type: "select", id: "pf", selected: true }]));
    act(() => result.current.reset());
    expect(result.current.selectedId).toBeNull();
  });
  it("the box names tell the truth about the keyboard, and the stylesheet keeps the narrow scroll, with tokens only", () => {
    expect(nodes[0].ariaLabel).toMatch(/Enter to select/);
    const css = fs.readFileSync(path.resolve(process.cwd(), "src/app.css"), "utf8");
    expect(css).toMatch(/\.flow-scroll \{ overflow-x: auto/);
    expect(css).toMatch(/min-width: 760px/);
    expect(css).toMatch(/\.flow-wrap \.react-flow__attribution a \{ color: var\(--muted\)/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
  });
});

describe("diagram component", () => {
  it("renders selectable, keyboard-focusable boxes (the arrow keys only move a selected box) and the arrow markers", async () => {
    const { render } = await import("@testing-library/react");
    const React = (await import("react")).default;
    const Diagram = (await import("../components/Diagram.jsx")).default;
    globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
    const { container } = render(<Diagram diagram={DIAGRAM} steps={FLOW.steps} positions={startPositions(DIAGRAM)} onApply={() => {}} statusOf={() => "pending"} currentN={null} theme="light" presenter={false} />);
    const node = container.querySelector('.react-flow__node[data-id="pf"]');
    expect(node).not.toBeNull();
    expect(node.className).toMatch(/\bselectable\b/);
    expect(node.getAttribute("tabindex")).toBe("0");
    expect(container.querySelector(".flow-scroll").getAttribute("tabindex")).toBe("0");
    for (const id of ["catalog", "experience", "discovery", "authn", "redemption", "obo", "refused"]) expect(container.querySelector(`marker#arrow-${id}`), id).not.toBeNull();
  });
});
