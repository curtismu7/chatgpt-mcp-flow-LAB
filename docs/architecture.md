# Architecture

```
control API  (server/src/app.js, 127.0.0.1:6650)
   |  POST /api/runs
orchestrator (server/src/flow.js)  = the user's browser + the AI assistant's MCP client
   |  real HTTP over the wire (server/src/wire.js), logical hosts -> loopback ports
   +--> public MCP gateway   https://mcp.example                127.0.0.1:6653  (protected resource, RFC 9728)
   +--> PingFederate (mock)  https://auth.example               127.0.0.1:6652  (AS + RFC 8693 STS)
   +--> Enterprise IdP (mock) https://idp.example               127.0.0.1:6651  (OIDC, authentication only)
   +--> Private MCP server   https://items-mcp.internal.example 127.0.0.1:6654  (price-lookup, items.read)
   +--> Connector catalog (mock) https://catalog.example        127.0.0.1:6655  (publish, list, member add; invented, UNVERIFIED)
```

Logical hostnames end in `.example`; the wire maps each to the loopback port of the actor that plays it and refuses any other origin. Each call is recorded
with its request, response and the validation checks the receiving actor made, and a step is cut from that record. State is in memory; **Reset** clears it.

## The catalog phase (messages 1 to 4)

The sequence opens with how the member gets the connector. It is a teaching model, not a description of any real catalog (UNVERIFIED): the manifest, the endpoints (`POST /connectors`, `GET /connectors/:id`, `POST /members/:member/connectors`, `GET /members/:member/connectors`) and the states are invented. The publisher lifeline is played by the orchestrator. Message 2 is an **organisational step**: the review has no protocol, the catalog flips the state in-process, and the status read shown is a stand-in. What a real review checks is not known here and no standard is cited. The connector record moves through `in review`, `listed`, `added, not signed in`, `sign-in required (first use)` (set when the first 401 happens) and `connected` (set when the access token is issued). The first 401 is called at the `mcp_server_url` from the catalog record.

## The 20 messages

| # | Phase | Arrow | What really happens |
| --- | --- | --- | --- |
| 1 | catalog | company to catalog | POST the connector manifest (name, publisher, https MCP server URL, tools) to the mock catalog; `202`, state `in review` |
| 2 | catalog | catalog to company | **organisational step**: the catalog reviews and lists it (UNVERIFIED); a status read shows `listed` |
| 3 | catalog | user to catalog | the member adds the listed connector, free, nothing to install (UNVERIFIED); `201`, or `409 connector_not_listed` if it was never listed |
| 4 | catalog | catalog to AI assistant | the agent lists the member's connectors: state `added, not signed in` |
| 5 | experience | user to AI assistant | the user asks for an item price |
| 6 | discovery | client to gateway | `tools/call` with no token; `401` + `WWW-Authenticate: Bearer resource_metadata=...` |
| 7 | discovery | client to gateway | GET protected-resource metadata; the client checks `resource` equals the server it called |
| 8 | discovery | client to PingFederate | GET AS metadata; issuer must equal the URL origin; S256 must be offered |
| 9 | authn | client to PingFederate | GET authorization endpoint with `code_challenge` (S256), `resource`, `scope`, `state`; redirect URI exact match |
| 10 | authn | PingFederate to IdP | `302` to the IdP; the browser follows; the IdP shows a login page |
| 11 | authn | user to IdP | POST credentials (password and one-time code redacted); `302` to PingFederate with the ID token |
| 12 | authn | IdP to PingFederate | PingFederate verifies the ID token (signature, iss, aud, nonce, exp) and shows consent |
| 13 | redemption | PingFederate to client | consent approved; `302` to the redirect URI with `code`, `state`, `iss`; the client checks all three |
| 14 | redemption | client to PingFederate | POST token endpoint with the code and the plaintext `code_verifier`; PKCE and single-use checks |
| 15 | redemption | PingFederate to client | the access token: ES256, `aud` = gateway, `scope` = `items.read`, 300 s |
| 16 | obo | client to gateway | `tools/call` with `Authorization: Bearer`; the gateway validates iss, aud, exp, scope |
| 17 | obo | gateway to PingFederate | RFC 8693 exchange (the gateway authenticates as its non-human identity); `act`, narrowed scope, new audience, 60 s |
| 18 | obo | gateway to private server | the private server re-validates iss, aud, exp, scope and `act`, then runs the tool |
| 19 | experience | private server to client | the structured result returns |
| 20 | experience | client to user | the answer |

## Mistake toggles

A run with a mistake changes one thing, then stops at the step where an actor refuses. `interlockHeld` is true when the refusal happened at the expected step, by the expected actor, with the expected error.

| Id | What changes | Refused at | By | Error |
| --- | --- | --- | --- | --- |
| `unlisted_connector` | the catalog review has not finished, so the connector is never listed | 3 | catalog | `connector_not_listed` |
| `wrong_verifier` | a different `code_verifier` at redemption | 14 | PingFederate | `invalid_grant` |
| `replayed_code` | the code is redeemed twice | 14 | PingFederate | `invalid_grant` |
| `bad_redirect` | redirect URI is a near match of the registered one | 9 | PingFederate | `invalid_request` |
| `missing_resource` | no `resource` parameter | 9 | PingFederate | `invalid_target` |
| `wrong_audience` | the token is issued for another registered resource | 16 | gateway | `invalid_token` |
| `expired_token` | the injectable clock is advanced past the token lifetime | 16 | gateway | `invalid_token` |
| `wrong_scope` | the token carries `profile.read`, not `items.read` | 16 | gateway | `insufficient_scope` |
| `missing_iss` | the authorization response has no `iss` | 13 | AI assistant (client) | `iss_missing` |
| `forged_iss` | the response carries another issuer (mix-up attack) | 13 | AI assistant (client) | `iss_mismatch` |
| `wrong_state` | the response `state` is altered | 13 | AI assistant (client) | `state_mismatch` |
| `passthrough` | the gateway forwards the user token with no exchange | 18 | private server | `invalid_token` |

## Run shape (`POST /api/runs`)

`{ id, mode: "mock", mistake, status: "completed" | "refused", refusal: { step, actor, error, description, standard } | null, interlockHeld, stepsPlanned: 20, steps: [...] }`.
A step is `{ n, from, to, phase, title, text, status: "ok" | "refused" | "skipped", exchanges: [{ from, to, viaBrowser?, request, response }], checks: [{ actor, name, ok, detail }], tokens?, data?, note? }`.
`tokens` entries are labelled MOCK-ISSUED and carry the raw JWT, decoded header and claims.

## Web UI (`web/`)

React + Vite. `App.jsx` holds the run, the reveal cursor (`shown`), the speed and the picked frame. `components/Diagram.jsx` draws the diagram-studio/1 document from `GET /api/diagram` (`server/diagrams/authorization-flow.json`, loaded by name and checked with `server/src/diagramStudioValidate.js`): one tall lifeline node per box in the data, with one handle per message at that message's row, and one straight edge per arrow in the data. The phase of each message comes from `GET /api/flow`; a drift test (`server/test/diagram.test.js`) pins the data to `definition.js`. Colours are theme tokens in `web/src/app.css`; the shared stylesheet is `web/src/styles/standalone-ui.css`. The server serves `web/dist` (`server/src/app.js`, `UI_CSP`: same-origin only, no framing, no inline script).

## Files

`server/src/flow.js` (orchestrator), `server/src/definition.js` (steps, participants, phases, mistakes), `server/src/actors/` (the five mocks), `server/src/tokens.js` (bearer validation),
`server/src/pkce.js`, `server/src/jwt.js` (ES256 from ECDH), `server/src/wire.js`, `server/src/runtime.js`, `server/src/app.js`, `server/src/safety.js`,
`server/src/netguard.js`, `server/src/settings.js`, `server/src/diagramData.js`, `server/src/talkTrack.js` (the data `docs/talk-track.md` is generated from).
