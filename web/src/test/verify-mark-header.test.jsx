import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { DIAGRAM, FLOW } from "./fixtures.js";

vi.mock("../lib/api.js", () => ({
  getFlow: vi.fn(), getHealth: vi.fn(), getDiagram: vi.fn(), getInfo: vi.fn(), postMode: vi.fn(), postRun: vi.fn(), postReset: vi.fn(),
}));
import * as api from "../lib/api.js";
import App from "../App.jsx";

// The header shows this lab's own Verified / In progress mark, read from the same /api/shelf call the Shelf link makes (through the lab-proxy that call
// reaches the shelf, whose payload lists every demo with its mark). The lab's own /api/shelf has only { shelfUrl }, so there is no mark then.
const mark = (status, label, extra = {}) => ({ status, label, note: "", updatedAt: "2026-11-15", source: "shipped", ...extra });
const realFetch = globalThis.fetch;
function withShelf(payload) {
  globalThis.fetch = vi.fn((url) => Promise.resolve(url === "/api/shelf" ? new Response(JSON.stringify(payload)) : new Response("{}", { status: 404 })));
}

beforeEach(() => {
  api.getFlow.mockResolvedValue(FLOW);
  api.getHealth.mockResolvedValue({ state: "ready", runtime: "offline" });
  api.getDiagram.mockResolvedValue(DIAGRAM);
  api.getInfo.mockResolvedValue({ source: "mock", realAvailable: false, realReason: "x" });
});
afterEach(() => { cleanup(); globalThis.fetch = realFetch; vi.clearAllMocks(); });

describe("verification mark in the header", () => {
  it("shows this lab's own mark beside the Shelf link, and no other lab's", async () => {
    withShelf({ shelfUrl: "http://shelf.example", demos: [{ id: "other-lab", verification: mark("in-progress", "In progress") }, { id: "chatgpt-mcp-flow", verification: mark("verified", "Verified", { note: "Every phase run on the mock" }) }] });
    render(<App baseMs={1000} />);
    await screen.findByTestId("simulate");
    const bar = within(await screen.findByTestId("top-menu"));
    expect(await bar.findByText("Verified")).toBeInTheDocument();
    expect(bar.getByRole("link", { name: "Shelf" })).toBeInTheDocument();
    expect(bar.queryByText("In progress")).toBeNull();
    expect(document.querySelectorAll(".verify")).toHaveLength(1);
    expect(bar.getByText("Verified").closest(".verify")).toHaveAttribute("title", expect.stringContaining("Every phase run on the mock"));
  });

  it("shows nothing when the lab is opened on its own port (its /api/shelf has only shelfUrl), or the shelf has no mark for it", async () => {
    for (const payload of [{ shelfUrl: "http://shelf.example" }, { shelfUrl: "http://shelf.example", demos: [{ id: "chatgpt-mcp-flow", verification: null }] }]) {
      withShelf(payload);
      const { unmount } = render(<App baseMs={1000} />);
      await screen.findByTestId("simulate");
      const bar = within(await screen.findByTestId("top-menu"));
      expect(await bar.findByRole("link", { name: "Shelf" })).toBeInTheDocument(); // the shelf answered, and still no badge
      expect(document.querySelector(".verify")).toBeNull();
      unmount();
    }
  });
});
