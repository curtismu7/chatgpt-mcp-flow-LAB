# AI assistant to MCP authorization flow LAB

How a remote MCP server behind an enterprise front door is authorized when a public AI assistant calls it on behalf of a signed-in user: a 20-message sequence diagram backed by real exchanges between in-process mock actors.

Tier: Demo
Repo: https://github.com/curtismu7/chatgpt-mcp-flow-LAB
Catalog: D25

The catalog id D25 is carried over from the old `chatgpt-mcp-flow` repo, where the plan marked it "to confirm". It is still a placeholder until the owner confirms or replaces it. No other catalog row is claimed.

## What is simulated

**Everything is simulated.** Every actor is an in-process mock on 127.0.0.1. No product, tenant or identity provider is contacted. Tokens are signed with an in-memory ES256 key, are labelled **MOCK-ISSUED**, and protect nothing. Each message that crosses an HTTP boundary is a real request and response between the mock actors on loopback (messages 5, 15, 19 and 20 are the user's question, the token the client holds and the answer going back, so they carry values but no request of their own; the checks behind the other messages are made by the receiving actor).

- **Mock mode** (the default and the only mode): the whole flow runs offline. The five mock actors are the connector catalog, the enterprise IdP, PingFederate (authorization server and RFC 8693 token exchange), the public MCP gateway and the private MCP server.
- **Live mode** (owner-run): this app has none. There is no real provider to call, so the Live button in the header is refused with a message and the page stays in Mock.

The sequence **opens with a catalog phase**: the company publishes its connector to the assistant's catalog once, the catalog reviews and lists it, a member adds it from the catalog for free (nothing to install), and it appears in the member's own agent **not signed in yet**. Sign-in and consent come on first use, which is when the discovery phase starts. This phase is an invented teaching model: the manifest, the catalog endpoints and the add call are mocks on loopback, **message 2 (the review) is an organisational step with no protocol behind it**, and what a real catalog's review checks is **UNVERIFIED** (no standard or source is cited). No claim is made that any real assistant's catalog works this way. Then, on first use:

1. the MCP client calls a protected tool with no token and gets `401` + `WWW-Authenticate: resource_metadata` (RFC 9728);
2. it reads the protected-resource metadata and the authorization-server metadata (RFC 8414);
3. it starts an authorization-code flow with PKCE S256, a resource indicator (RFC 8707) and scopes;
4. **PingFederate** owns no user directory, so it redirects the front channel to the **Enterprise IdP** (OIDC, authentication only) and gets a signed ID token back;
5. PingFederate shows consent and returns the code with `state` and `iss` (RFC 9207) to an allow-listed redirect URI;
6. the client redeems the code with the plaintext `code_verifier` (the PKCE interlock) and receives a short-lived access token (`aud` = the public MCP gateway, narrow scope);
7. the **public MCP gateway** validates `iss`, `aud`, `exp` and scope, then performs an RFC 8693 on-behalf-of exchange (`act` = the gateway's non-human identity, narrowed scope, new audience);
8. the **private MCP server** re-validates the on-behalf-of token and enforces the per-API scope before the tool runs.

The story is neutral and fictional: "Example Corp", an end user, and a generic `price-lookup` tool with the scope `items.read`. Hosts end in `.example` or `.invalid`.

### Honesty

- **Standards** are cited by RFC number only (6749, 6750, 7636, 8414, 8693, 8707, 9068, 9207, 9728).
- **Connector catalog** (the whole catalog phase): an invented teaching model, UNVERIFIED. What a catalog review checks, how a member adds a connector for free, and how an added connector shows before sign-in are not sourced.
- **Product behaviour** (client identity by CIMD or DCR, the non-human-identity store, exact PingFederate endpoint names, the front-channel hand-off to an external IdP) is *as described in the source proposal, UNVERIFIED against product documentation*.
- **Neutrality.** This repo contains no customer, company, person, identity-provider or product-of-a-customer name, no real hostname and no customer-specific scope or business term. A test (`scripts/neutrality.test.mjs`) fails if one appears.

### The UI

- **Diagram**: eight draggable lifelines and 20 numbered messages coloured by phase (catalog, discovery, authentication + PKCE challenge, code redemption + token minting, OBO exchange + downstream authorization, user experience). It is drawn from diagram-studio/1 data (`server/diagrams/authorization-flow.json`, loaded by name from `GET /api/diagram`).
- **Simulate** runs the flow for real, then walks the messages at the chosen **step speed** (0.5x to 4x). **Step**, **Pause/Resume** and **Show all** give manual control. **Reset** (in the header, on every page) clears the run, clears the mistake choice, asks the server to reset, and puts every box back where the data put it.
- **Movie reel** under the diagram: one frame per message. Choosing a frame fills the **details row** (what each of the two participants does) and the **wire form** panel (the real request, response, checks, and tokens labelled MOCK-ISSUED).
- **Break it on purpose**: radio chips for the 12 mistakes (`unlisted_connector`, `wrong_verifier`, `replayed_code`, `bad_redirect`, `missing_resource`, `wrong_audience`, `expired_token`, `wrong_scope`, `missing_iss`, `forged_iss`, `wrong_state`, `passthrough`). The run stops at the refusing actor, and a panel says which actor refused, with which error, under which standard, and why. See [docs/architecture.md](docs/architecture.md) for the table.
- **Interlocks** tab: every mistake with its expected refusal, and a "Run all" that fills in what the stubs actually did. **What is real** tab: the standards and the UNVERIFIED product claims.
- Every tab, and presenter mode, carries the simulation banner. Dark and light themes, usable at 375px.
- **Keyboard**: Tab to a box, press Enter to select it, then the arrow keys move it (Shift for larger steps); Escape deselects. **P** turns presenter mode on and off and **Esc** leaves it (the banner stays; keys with Ctrl, Cmd or Alt are ignored). At phone width the diagram scrolls sideways inside its own frame instead of shrinking, so the boxes after the first two need a pan.

## Run from a clone

Prerequisites: Node 26 or newer. Docker only if you use the Docker form.

```sh
git clone https://github.com/curtismu7/chatgpt-mcp-flow-LAB.git
cd chatgpt-mcp-flow-LAB
npm ci
npm run build       # builds web/dist, which the server serves at /
npm start           # control API and UI on http://127.0.0.1:6650/ (mock actors on 127.0.0.1:6651-6655)
```

Open http://127.0.0.1:6650/ . Everything works in Mock mode with no setup at all: no settings file, no account, no network. The repos are internal, so you need access to the `ping-sandbox` org to clone.

Try the API:

```sh
curl -s http://127.0.0.1:6650/api/health
curl -s -X POST -H 'content-type: application/json' -d '{}' http://127.0.0.1:6650/api/runs                      # the happy path, 20 steps
curl -s -X POST -H 'content-type: application/json' -d '{"mistake":"wrong_verifier"}' http://127.0.0.1:6650/api/runs
```

| Route | What it does |
| --- | --- |
| `GET /api/health` | `demo-health/1` for the demo shelf |
| `GET /api/flow` | participants (with details), phases, the 20 messages, the mistake catalogue, standards, provenance labels |
| `GET /api/diagram` | the diagram-studio/1 document, by `?name=` (only `authorization-flow`) |
| `GET /api/mode` | the mode (always `mock`) and why Live is not supported |
| `POST /api/mode` | `{ "mode": "mock" }` is accepted; `{ "mode": "live" }` is refused with 409 `live_not_supported` |
| `POST /api/runs` | run the flow; body `{}` or `{ "mistake": "<id>" }`. Returns every step's real request, response, validation checks and mock tokens |
| `GET /api/runs` | summaries of the last 20 runs |
| `GET /api/runs/:id` | one stored run |
| `POST /api/reset` | clear runs, injected faults and actor state (queued behind any run in flight, so it never corrupts one; run ids keep counting) |

All JSON, loopback only, no credentials accepted.

## Settings file

All standalone apps read one settings file, `~/Development/.env` (mode 600). `STANDALONE_ENV` points the app at another path. This app takes one key from it and ignores everything else (`util.parseEnv`, in `server/src/settings.js`); a real environment variable wins. The file is optional and the app never writes it. There is no per-app `.env`.

- `MCP_FLOW_WORKSPACE` (optional): the workspace id, 1 to 32 characters of `a-z`, `0-9` and `-`, default `default`. It scopes the run ids and the trace sink (sent on every hop as `tracestate: mcpflow=<id>`).

No credential of any kind is read, held or accepted. Branding and the story vocabulary come from `customer.config.json` (brand, vertical, workspace id; all fictional).

## Ports, and what to do if the port is taken

```
Ports: chatgpt-mcp-flow-LAB listens on 6650 (set with MCP_FLOW_PORT, default 6650).
Port range for this app: 6650-6699.

If the port is taken:
1. Find what is using it:
   lsof -iTCP:6650 -sTCP:LISTEN -n -P
2. If it is an old copy of this app, stop that process: kill <PID>.
3. If it is something else, stop it, or start this app on another port:
   MCP_FLOW_PORT=<other port> npm start
4. Do not use 8080, 5173, 3000, 4000, 4400, 4510, 4600-4601, 18080, 19080 or 19090.
```

Other variables: `MCP_FLOW_STUB_BASE` (the first of the five mock-actor ports, default 6651; the block of five must avoid 6665-6669, 6679 and 6697), `VITE_PORT` (Vite dev server, default 6660, `npm run dev`), `HOST_PORT` (Docker host port, default 6650), and the e2e script uses 6670 (`E2E_PORT`). Keep all of them inside 6650-6699.

## Mock and live modes

The header of every page, including presenter mode, has a **Mock | Live** toggle and a `MODE: MOCK` badge, and the simulation banner names the same mode. Mock is the only mode: the whole flow runs against the in-process mock actors. Live is refused with this message, and the page stays in Mock: "Live mode is not available in this lab: every actor is an in-process mock on 127.0.0.1 and no real provider is configured or contacted, so the page stays in Mock mode." (`POST /api/mode` answers 409 `live_not_supported`.) The browser logs that deliberate 409, and the refusals the mistake runs show, as console messages.

## Health, doctor and reset

```
npm run doctor   # checks Node, bind, ports, config, crypto, the diagram data, the netguard self-test, and one real run of the flow
npm run reset    # clears the runs and the mock actors' state of a running server; saved settings are kept
```

`GET /api/health` answers `demo-health/1` (public, GET only, no detail). `npm run reset` calls `POST /api/reset` on the running server (default `http://127.0.0.1:6650`, loopback only). The diagram box positions live in the browser, so the **Reset** button in the header (or a reload) puts the boxes back; the script cannot reach them. `npm run talk-track` regenerates `docs/talk-track.md` from the talk-track data, and a test fails if the file drifts from it.

## Docker (optional)

```sh
docker compose up --build -d
```

Docker on OrbStack, never Docker Desktop. It publishes `127.0.0.1:6650` only (`HOST_PORT` changes the host side). The image is `node:26-alpine`, multi-stage (the web build stage is not shipped), runs as the non-root `node` user with a read-only root filesystem and no capabilities, has a `HEALTHCHECK` on `/api/health`, mounts nothing, and bakes in no key material (the signing key is created in memory at start). `.dockerignore` keeps git data, `.env` and key files out of the build context.

## Tests

```sh
npm test            # server tests, web tests (vitest), and the repo checks
npm run e2e         # headless Chromium against the server on 6670 (needs npm run build and a Playwright Chromium)
```

On Node 26 the suite passes with 122 server tests, 43 web tests (vitest) and 55 repo-script tests (220 in all). Run these by hand too: `bash <AI-DEMO-Standalone>/scripts/check-drift.sh .`, `check-css.sh .`, and `node <demo-kit-base>/scripts/conformance.mjs . --new` (rule 18 only warns: there is no k8s build, deferred by the owner).

## Troubleshooting

1. **Port is taken**: see "Ports, and what to do if the port is taken" above.
2. **`npm start` says `refusing to start`**: run `npm run doctor`; it names the check that failed (Node older than 26, a port outside 6650-6699, a bad `customer.config.json`).
3. **The page says the control API did not answer**: the server is not running, or you opened the Vite dev port without starting the server. Run `npm start` and open http://127.0.0.1:6650/ .
4. **A blank page at `/`**: run `npm run build` first; the server only serves `web/dist` when it exists (otherwise `GET /` is a JSON 404).
5. **Live does nothing**: that is by design, see "Mock and live modes".

## Ownership

- Owner: the Ping demo family owner (repo owner of `ping-sandbox`).
- License: MIT (see `LICENSE`).
- Found a problem? Open an issue on the repo.

Docs: [docs/architecture.md](docs/architecture.md), [docs/safety.md](docs/safety.md), [docs/talk-track.md](docs/talk-track.md), [CHANGELOG.md](CHANGELOG.md).
