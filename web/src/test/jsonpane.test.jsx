import React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import WirePanel from "../components/WirePanel.jsx";
import { setJsonView } from "../components/JsonPane.jsx";
import { PARTICIPANTS, STEPS } from "../../../server/src/definition.js";

// Every place the wire form shows JSON goes through the shared JsonPane: a Form | JSON toggle, the important keys stood out, no scroll box.
const JWT = "eyJhbGciOiJFUzI1NiJ9.eyJhdWQiOiJ4In0.c2lnbmF0dXJl";
const def = STEPS.find((s) => s.n === 15);
const step = {
  n: def.n, status: "ok",
  exchanges: [{
    from: def.from, to: def.to,
    request: { method: "POST", url: "https://auth.example/token", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=authorization_code&code=abc" },
    response: { status: 200, headers: { "cache-control": "no-store" }, body: '{"token_type":"Bearer","expires_in":300}' },
  }],
  tokens: [{ label: "Access token", jwt: JWT, header: { alg: "ES256" }, claims: { aud: "https://mcp.example", connector_state: "signed in" }, scopes: ["items.read"] }],
  data: { connector_id: "c1", note: "x​y" },
};
const mount = () => render(<WirePanel step={step} def={def} status="ok" participants={PARTICIPANTS} hasRun />);

beforeEach(() => { cleanup(); setJsonView("form"); });

describe("the wire form's JSON panes (rule 24)", () => {
  it("shows headers, bodies, token header and claims and values through JsonPane, with a Form | JSON toggle on each", () => {
    mount();
    const toggles = screen.getAllByRole("group").filter((g) => /view$/.test(g.getAttribute("aria-label") || ""));
    // request headers, response headers, response body (a JSON string), token header, token claims, values; the form-encoded request body stays text
    expect(toggles.map((g) => g.getAttribute("aria-label"))).toEqual(["Request headers view", "Response headers view", "Response body view", "Token header view", "Token claims view", "Values view"]);
    for (const g of toggles) expect([...g.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Form", "JSON"]);
    expect(document.querySelectorAll(".inert--block")).toHaveLength(0);
  });
  it("a body that is not JSON stays text, a JSON string body is parsed, and a token is shown whole in its three colours", () => {
    mount();
    expect(screen.getByLabelText("Request body")).toHaveTextContent("grant_type=authorization_code&code=abc");
    expect(document.querySelector('[aria-label="Request body"]').closest(".jsonbox")).toHaveAttribute("data-view", "text");
    expect(document.querySelector('[aria-label="Response body"]').closest(".jsonbox")).toHaveAttribute("data-view", "form");
    const jwt = screen.getByLabelText("Token (compact JWT)");
    expect(jwt).toHaveTextContent(JWT);
    expect(jwt.querySelectorAll(".jtok--jwt1, .jtok--jwt2, .jtok--jwt3")).toHaveLength(3);
  });
  it("the JSON view is the exact text, with this lab's important keys stood out, and the hidden-character guard still applies", () => {
    mount();
    fireEvent.click(screen.getAllByRole("button", { name: "JSON" })[0]);
    const claims = screen.getByLabelText("Token claims");
    expect(claims.tagName).toBe("PRE");
    expect(claims).toHaveTextContent('"connector_state": "signed in"');
    const hot = [...claims.querySelectorAll(".jtok--hot")].map((n) => n.textContent);
    expect(hot).toContain('"aud"');
    expect(hot).toContain('"connector_state"');
    expect(screen.getByLabelText("Values")).toHaveTextContent("x[U+200B]y");
  });
  it("the Form view marks the important rows, and no JSON pane or its wrapper is a scroll box", () => {
    mount();
    const claims = screen.getByLabelText("Token claims");
    expect([...claims.querySelectorAll('[data-hot="true"] > dt')].map((n) => n.textContent)).toEqual(["aud", "connector_state"]);
    for (const el of document.querySelectorAll(".jsonbox, .json")) {
      expect(el.style.maxHeight).toBe("");
      expect(el.style.overflow).toBe("");
    }
  });
});
