import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DIAGRAM, FLOW, HAPPY, refusedRun } from "./fixtures.js";

vi.mock("../lib/api.js", () => ({
  getFlow: vi.fn(), getHealth: vi.fn(), getDiagram: vi.fn(), postMode: vi.fn(), postRun: vi.fn(), postReset: vi.fn(),
}));
import * as api from "../lib/api.js";
import App from "../App.jsx";

const LIVE_MESSAGE = "Live mode is not available in this lab: every actor is an in-process mock on 127.0.0.1 and no real provider is configured or contacted, so the page stays in Mock mode.";
const mount = async () => {
  render(<App baseMs={1000} />);
  await screen.findByTestId("simulate");
};
const flush = () => act(async () => { await Promise.resolve(); });

beforeEach(() => {
  api.getFlow.mockResolvedValue(FLOW);
  api.getHealth.mockResolvedValue({ state: "ready", runtime: "offline" });
  api.getDiagram.mockResolvedValue(DIAGRAM);
  api.postMode.mockRejectedValue(new Error(LIVE_MESSAGE));
  api.postRun.mockResolvedValue(HAPPY);
  api.postReset.mockResolvedValue({ ok: true });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

describe("chrome", () => {
  it("shows the DEMO badge, the mode header and the simulation banner on every tab", async () => {
    await mount();
    expect(screen.getByTestId("mode-badge")).toHaveTextContent("DEMO");
    expect(screen.getByTestId("mode-header")).toHaveTextContent("MODE: MOCK");
    for (const name of ["Sequence", "Interlocks", "What is real"]) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(screen.getByTestId("sim-banner")).toHaveTextContent(/SIMULATION/);
      expect(screen.getByTestId("sim-banner")).toHaveTextContent(/MOCK-ISSUED/);
    }
  });
  it("puts the simulation notice in a landmark, and the headings never skip a level", async () => {
    await mount();
    expect(screen.getByRole("region", { name: "Simulation notice" })).toBe(screen.getByTestId("sim-banner"));
    fireEvent.click(screen.getByTestId("step"));
    await screen.findByTestId("wire");
    const levels = screen.getAllByRole("heading").map((h) => Number(h.tagName[1]));
    let prev = 0;
    for (const l of levels) { expect(l - prev, levels.join(",")).toBeLessThanOrEqual(1); prev = l; }
  });
  it("the story vocabulary can be switched, and starts from the configured vertical", async () => {
    await mount();
    expect(screen.getByTestId("story-pack")).toHaveValue("default");
    expect(screen.getAllByText(/a member of Example Corp/).length).toBeGreaterThan(0); expect(screen.getAllByText(/a member of Example Corp/)[0]).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("story-pack"), { target: { value: "retail" } });
    expect(screen.getAllByText(/a shopper at Example Retail/)[0]).toBeInTheDocument();
    cleanup();
    api.getFlow.mockResolvedValue({ ...FLOW, config: { brand: "Example Corp", vertical: "finance", workspace: "default" } });
    await mount();
    expect(screen.getByTestId("story-pack")).toHaveValue("finance");
  });
  it("opens with the catalog phase: first story, organisational label and UNVERIFIED in the wire form", async () => {
    await mount();
    const items = document.querySelectorAll(".story li");
    expect(items[0].dataset.phase).toBe("catalog");
    expect(items[0]).toHaveTextContent(/catalog/);
    expect(items[0]).toHaveTextContent(/UNVERIFIED/);
    fireEvent.click(screen.getByTestId("simulate"));
    await waitFor(() => expect(screen.getByTestId("showall")).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(screen.getByTestId("showall"));
    fireEvent.click(screen.getByTestId("frame-2"));
    expect(screen.getByTestId("org-badge")).toHaveTextContent(/ORGANISATIONAL STEP/);
    expect(screen.getByTestId("wire")).toHaveTextContent(/UNVERIFIED/);
    fireEvent.click(screen.getByTestId("frame-6"));
    expect(screen.queryByTestId("org-badge")).toBeNull();
    expect(screen.getByRole("radio", { name: /Connector never listed/ })).toBeInTheDocument();
  });
  it("keeps the banner in presenter mode and hides the tabs", async () => {
    await mount();
    fireEvent.click(screen.getByTestId("presenter"));
    expect(screen.getByTestId("sim-banner")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Interlocks" })).toBeNull();
    expect(screen.getByTestId("presenter")).toHaveAttribute("aria-pressed", "true");
  });
  it("labels product behaviour UNVERIFIED and cites standards on the About tab", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "What is real" }));
    expect(screen.getAllByText(/UNVERIFIED/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/RFC 8693/)[0]).toBeInTheDocument();
  });
  it("offers the happy path plus every mistake as a radio, and the 20-frame reel", async () => {
    await mount();
    expect(screen.getAllByRole("radio")).toHaveLength(1 + FLOW.mistakes.length);
    expect(screen.getAllByTestId(/^frame-/)).toHaveLength(20);
  });
  it("shows an error when the control API is down", async () => {
    api.getFlow.mockRejectedValue(new Error("nope"));
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/did not answer/);
  });
});

describe("simulation", () => {
  it("walks the messages one tick at a time and finishes on message 20", async () => {
    await mount();
    vi.useFakeTimers({ shouldAdvanceTime: false });
    fireEvent.click(screen.getByTestId("simulate"));
    await flush();
    expect(api.postRun).toHaveBeenCalledWith(null);
    expect(screen.getByTestId("run-status")).toHaveAttribute("aria-live", "polite");
    for (let i = 1; i <= 20; i += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(screen.getByTestId("run-status")).toHaveTextContent(`Message ${i} of 20`);
    }
    expect(screen.getByTestId("outcome")).toHaveTextContent(/All 20 messages passed/);
    expect(screen.getByTestId("outcome")).toHaveTextContent(/widget-100 costs/);
  });
  it("speed changes the delay between messages", async () => {
    await mount();
    vi.useFakeTimers({ shouldAdvanceTime: false });
    fireEvent.change(screen.getByTestId("speed"), { target: { value: "4" } });
    fireEvent.click(screen.getByTestId("simulate"));
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(screen.getByTestId("run-status")).toHaveTextContent("Message 1 of 20");
    for (let i = 0; i < 4; i += 1) await act(async () => { await vi.advanceTimersByTimeAsync(250); }); // one tick per act: React batches inside one
    const n = Number(/Message (\d+) of 20/.exec(screen.getByTestId("run-status").textContent)[1]);
    expect(n).toBeGreaterThanOrEqual(4); // 4x: one message per 250 ms, where 1x would still be at message 1
    expect(n).toBeLessThanOrEqual(6);
  });
  it("Step advances one message and Pause stops the walk", async () => {
    await mount();
    vi.useFakeTimers({ shouldAdvanceTime: false });
    fireEvent.click(screen.getByTestId("step"));
    await flush();
    expect(screen.getByTestId("run-status")).toHaveTextContent("Message 1 of 20");
    fireEvent.click(screen.getByTestId("step"));
    expect(screen.getByTestId("run-status")).toHaveTextContent("Message 2 of 20");
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.getByTestId("run-status")).toHaveTextContent("Message 2 of 20");
  });
  it("a mistake run stops at the refusing actor and says which one and why", async () => {
    api.postRun.mockResolvedValue(refusedRun("wrong_verifier"));
    await mount();
    fireEvent.click(screen.getByTestId("mistake-wrong_verifier"));
    fireEvent.click(screen.getByTestId("simulate"));
    await waitFor(() => expect(api.postRun).toHaveBeenCalledWith("wrong_verifier"));
    await waitFor(() => expect(screen.getByTestId("showall")).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(screen.getByTestId("showall"));
    const out = screen.getByTestId("outcome");
    expect(out).toHaveTextContent(/interlock held/i);
    expect(out).toHaveTextContent(/PingFederate refused message 14/);
    expect(out).toHaveTextContent(/invalid_grant/);
    expect(out).toHaveTextContent(/stolen authorization code/);
    expect(screen.getByTestId("run-status")).toHaveTextContent(/Refused by PingFederate with invalid_grant/);
    expect(screen.getByTestId("frame-14")).toHaveAttribute("data-status", "refused");
    expect(screen.getByTestId("frame-15")).toHaveAttribute("data-status", "blocked");
  });
  it("a queue-full answer is shown, not swallowed", async () => {
    api.postRun.mockRejectedValue(Object.assign(new Error("busy"), { code: "run_queue_full" }));
    await mount();
    fireEvent.click(screen.getByTestId("simulate"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/already in progress/);
  });
  it("the wire form shows the real request and a MOCK-ISSUED token, labelled UNVERIFIED where product behaviour is described", async () => {
    await mount();
    fireEvent.click(screen.getByTestId("simulate"));
    await waitFor(() => expect(screen.getByTestId("showall")).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(screen.getByTestId("showall"));
    fireEvent.click(screen.getByTestId("frame-14"));
    expect(screen.getByTestId("wire")).toHaveTextContent(/code_verifier/);
    expect(screen.getByTestId("wire")).toHaveTextContent(/UNVERIFIED/);
    expect(screen.getByTestId("details-row")).toHaveTextContent(/AI assistant/);
    expect(screen.getByTestId("details-row")).toHaveTextContent(/PingFederate/);
    fireEvent.click(screen.getByTestId("frame-15"));
    expect(screen.getByTestId("wire")).toHaveTextContent(/MOCK-ISSUED/);
    expect(screen.getByTestId("wire").querySelector(".badge--mock")).toHaveTextContent("MOCK-ISSUED");
  });
  it("Reset clears the run, the mistake choice, and asks the server to reset", async () => {
    await mount();
    fireEvent.click(screen.getByTestId("mistake-expired_token"));
    fireEvent.click(screen.getByTestId("step"));
    await waitFor(() => expect(screen.getByTestId("run-status")).toHaveTextContent("Message 1 of 20"));
    fireEvent.click(screen.getByTestId("reset"));
    await waitFor(() => expect(api.postReset).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("run-status")).toHaveTextContent(/^Ready/);
    expect(screen.getByTestId("mistake-none")).toBeChecked();
  });
  it("Interlocks tab: Run all fills the table from real runs and flags a difference", async () => {
    api.postRun.mockImplementation(async (id) => refusedRun(id));
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Interlocks" }));
    fireEvent.click(screen.getByRole("button", { name: /Run all/ }));
    await waitFor(() => expect(screen.getByTestId("result-passthrough")).toHaveTextContent(/held/));
    expect(api.postRun).toHaveBeenCalledTimes(FLOW.mistakes.length);
  });
});

describe("Mock | Live toggle, presenter keys, Reset and aria-disabled", () => {
  it("shows the Mock | Live toggle in the header on every tab and in presenter mode; Mock is pressed", async () => {
    await mount();
    const check = () => {
      for (const id of ["mode-mock", "mode-live"]) { // a hidden attribute or a disabled button would break the rule that both modes are always offered
        expect(screen.getByTestId(id)).toBeVisible();
        expect(screen.getByTestId(id)).toBeEnabled();
        expect(screen.getByTestId(id)).not.toHaveAttribute("hidden");
        expect(screen.getByTestId(id).closest("[hidden],[aria-hidden='true']")).toBeNull();
      }
      expect(screen.getByTestId("mode-mock")).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByTestId("mode-live")).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByTestId("mode-header")).toHaveTextContent("MODE: MOCK");
      expect(screen.getByTestId("sim-banner")).toHaveTextContent(/MOCK mode/);
      expect(screen.getByTestId("reset")).toBeInTheDocument();
    };
    for (const name of ["Sequence", "Interlocks", "What is real"]) { fireEvent.click(screen.getByRole("button", { name })); check(); }
    fireEvent.click(screen.getByTestId("presenter"));
    check();
  });
  it("Live is refused with the server's honest message and the page stays in Mock", async () => {
    await mount();
    expect(screen.getByTestId("mode-note")).toBeEmptyDOMElement();
    fireEvent.click(screen.getByTestId("mode-live"));
    await waitFor(() => expect(screen.getByTestId("mode-note")).toHaveTextContent(/Live mode is not available/));
    expect(api.postMode).toHaveBeenCalledWith("live");
    expect(screen.getByTestId("mode-note")).toHaveTextContent(/stays in Mock mode/);
    expect(screen.getByTestId("mode-mock")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("mode-live")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("mode-header")).toHaveTextContent("MODE: MOCK");
    fireEvent.click(screen.getByTestId("mode-mock"));
    expect(screen.getByTestId("mode-note")).toBeEmptyDOMElement();
  });
  it("P toggles presenter mode, Esc leaves it, the banner stays, and modifier keys and typing are ignored", async () => {
    await mount();
    const press = (key, init = {}, target = document.body) => fireEvent.keyDown(target, { key, ...init });
    expect(screen.getByTestId("presenter")).toHaveAttribute("aria-pressed", "false");
    press("p");
    expect(screen.getByTestId("presenter")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("sim-banner")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Interlocks" })).toBeNull();
    press("Escape");
    expect(screen.getByTestId("presenter")).toHaveAttribute("aria-pressed", "false");
    press("P");
    expect(screen.getByTestId("presenter")).toHaveAttribute("aria-pressed", "true");
    press("p");
    expect(screen.getByTestId("presenter")).toHaveAttribute("aria-pressed", "false");
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) { press("p", init); expect(screen.getByTestId("presenter"), JSON.stringify(init)).toHaveAttribute("aria-pressed", "false"); }
    press("p", { repeat: true });
    expect(screen.getByTestId("presenter")).toHaveAttribute("aria-pressed", "false");
    const select = screen.getByTestId("speed");
    press("p", {}, select);
    expect(screen.getByTestId("presenter")).toHaveAttribute("aria-pressed", "false");
    press("Escape");
    expect(screen.getByTestId("presenter")).toHaveAttribute("aria-pressed", "false");
  });
  it("Run buttons are aria-disabled, not disabled, while a run is busy: they keep focus and do nothing", async () => {
    let release;
    api.postRun.mockImplementation(() => new Promise((res) => { release = () => res(HAPPY); }));
    await mount();
    const sim = screen.getByTestId("simulate");
    sim.focus();
    fireEvent.click(sim);
    await waitFor(() => expect(sim).toHaveAttribute("aria-disabled", "true"));
    expect(sim).not.toBeDisabled();
    expect(document.activeElement).toBe(sim);
    fireEvent.click(sim);
    fireEvent.click(screen.getByTestId("step"));
    expect(api.postRun).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("mistake-expired_token"));
    expect(screen.getByTestId("mistake-none")).toBeChecked();
    await act(async () => { release(); });
    await waitFor(() => expect(sim).not.toHaveAttribute("aria-disabled"));
    expect(document.activeElement).toBe(sim);
  });
  it("the page keeps one main landmark", async () => {
    await mount();
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });
});
