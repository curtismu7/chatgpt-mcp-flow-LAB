# Changelog

## LAB-2 (fix pass after review)
- Neutrality scan: `github.com` is no longer an allowed host. Only this repo's own `ping-sandbox` URL and the gitleaks release download path pass; any other `github.com` URL is a finding (new test).
- Server health test now closes its listener in `t.after`, so a failing assertion fails fast instead of hanging the run (checked by mutating the health schema: 3 tests fail, exit 1, no hang).
- Mock | Live toggle web test also asserts both buttons are visible, enabled and not inside a `hidden` or `aria-hidden` ancestor (a `hidden` attribute on Live is now caught).
- The guards test slice widened from 6671-6675 to 6671-6678 so one foreign listener no longer fails the suite.

## LAB-1 (brought to the -LAB standard; one clean commit, no old history)
- New repo name `chatgpt-mcp-flow-LAB` under `ping-sandbox` (not created yet). Node 26 only (`engines`, `node:26-alpine`, CI), hosted GitHub CI copied from a sibling LAB (build, test, doctor, forbidden-strings, gitleaks), `.env.example`, MIT licence.
- Deleted the SE k8s build (`k8s/`, `docs/k8s.md`, its test): deferred by the owner. There is no `MODE` switch.
- Shared stylesheet `web/src/styles/standalone-ui.css` vendored byte-for-byte; the app stylesheet rewritten on tokens (no colour literal, no `!important`, no `prefers-color-scheme`, breakpoints 600/900). Phase colours are tokens, the arrowheads are our own SVG markers.
- The diagram is diagram-studio/1 data (`server/diagrams/authorization-flow.json`) loaded by name from `GET /api/diagram` and checked with a copy of the studio validator; a drift test pins it to `definition.js`. Rule 17 passes.
- Mock | Live toggle in the header of every page (Mock default; Live is refused with 409 and an honest message, the app has no live mode). Reset moved to the header. Presenter mode on P / Esc (modifier keys ignored), banner kept.
- Run buttons and the mistake chips use `aria-disabled` instead of `disabled`, so keyboard focus stays; the interlocks table is a focusable scroll region.
- Netguard (`server/src/netguard.js`) with a self-test that includes UDP send and connect; the flow suite runs under it. Settings come from the one shared `~/Development/.env` only (`MCP_FLOW_WORKSPACE`); the per-app `.env` loader is gone.
- `npm run reset` (script), talk track generated from data (`server/src/talkTrack.js`, `npm run talk-track`) with a drift test, doctor extended (diagram, netguard self-test, one real run), README in the 12-section standard, shelf entry with a relative `composeFile`.
- Catalog id D25 is still a placeholder (carried over, "to confirm").

## MF4 (catalog phase)
- The sequence opens with a catalog phase (new messages 1 to 4, now 20 messages in six phases): the company publishes its connector to a mock catalog actor (6655), the catalog reviews and lists it (message 2 is an organisational step, no protocol), the member adds it for free, and it appears in the agent as `added, not signed in`. The first 401 is called at the address in the catalog record. The existing 16 messages are renumbered 5 to 20.
- New toggle `unlisted_connector`, new lifelines (company, catalog), new phase colour, story, glossary terms, docs. The catalog behaviour is an invented teaching model and UNVERIFIED. The actor block grew from four to five ports (6651-6655).

## MF3 (packaging)
- Dockerfile `HEALTHCHECK` on `/api/health` and a `.dockerignore`, both pinned by the compose test. Real OrbStack run: build, up, healthy, UI, API run, 421 and 403 guards, loopback-only publish, down, image removed.
- The shelf entry was also checked once, read-only, against the shelf's own `validateDemos`.

## MF2 (fix pass)
- A reset is queued behind the runs in flight (it used to clear actor state under a running flow). Run ids keep counting across resets.
- Actors: browser-originated cross-site calls and cookie/API-key/proxy credentials refused, maps bounded at 200 entries, bind address exposed and pinned.
- Control API refuses a Cookie header. Tool arguments are no longer cut off by the depth cap.
- Wire: timeout and response cap are testable and pinned; `traceparent` and `tracestate` on every hop.
- UI: boxes can be selected with Enter and moved with the arrow keys; edge labels fit between their lifelines; attribution contrast; banner landmark and heading order; the diagram scrolls inside its frame at phone width.
- Rulebook: content pack, shelf entry, `customer.config.json` with workspace id, three vertical story vocabularies, k8s manifests; `MCP_FLOW_STUB_BASE` moves the actor ports.

## 0.1.0 (unreleased)

- MF0: server core. Four in-process mock actors on 127.0.0.1:6651-6654 (public MCP gateway / protected resource, PingFederate-like authorization server and RFC 8693 token exchange, enterprise OIDC IdP stub, private MCP server) that perform the real flow: PKCE S256, state, iss (RFC 9207), redirect-URI exact match, resource indicator, ES256 mock tokens from an in-memory key, iss/aud/exp/scope/act validation, single-use codes, on-behalf-of exchange with scope narrowing. A 16-step orchestrator returns every step's request, response, checks and mock tokens. 11 mistake toggles. Control API (`health`, `flow`, `runs`, `reset`), doctor, Docker files with a pinned loopback publish, gitleaks pre-commit hook, CI copied from the family pattern.
