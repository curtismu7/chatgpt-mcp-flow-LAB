# Safety, honesty and provenance

## This is a simulation (stand-in statement)

Every actor in this demo is an **in-process mock** listening on 127.0.0.1 (ports 6651-6655). The "public MCP gateway", "PingFederate", the "Enterprise IdP", the
"private MCP server" and the "connector catalog" are small Express apps written for this repo. No product, tenant, identity provider or network service is contacted, and nothing here is
evidence of how any product is configured. Tokens are signed with an ES256 key created in memory at start-up, are labelled **MOCK-ISSUED**, and protect nothing.
They are shown raw on purpose: this is education. There are no real secrets to leak.

## Provenance: what is a standard and what is unverified

- **Standards** are cited by RFC number only and implemented as the RFC text describes: 6749 (OAuth), 6750 (bearer tokens), 7636 (PKCE), 8414 (AS metadata),
  8693 (token exchange), 8707 (resource indicators), 9068 (JWT access token profile), 9207 (`iss` in the authorization response), 9728 (protected-resource metadata).
- **Product behaviour is UNVERIFIED against product documentation.** The following are *as described in the source proposal, UNVERIFIED against product documentation*:
  client identity by a CIMD document or by DCR (and which one the product supports); a non-human-identity (NHI) store for the gateway identity; the exact PingFederate
  endpoint names and configuration objects (this stub uses `/as/authorization.oauth2` and `/as/token.oauth2`); and that PingFederate hands the front channel to an external OIDC IdP
  and performs the RFC 8693 exchange exactly as drawn. Do not quote this demo as proof of product behaviour.

- **The connector catalog phase is an invented teaching model and is UNVERIFIED.** The company publishing a connector once, a catalog review, a member adding it for free with nothing to install, and the connector appearing in the member's agent not signed in yet are drawn the way the owner's explanation of the pattern describes them. What a real catalog's review checks is UNVERIFIED: no standard or source is cited. The manifest, the catalog endpoints, the states and the add call are mocks on loopback, and message 2 (the review) is an organisational step with no protocol behind it. Nothing here claims that any real assistant's catalog works this way.

## Deliberate simplifications

- The IdP returns the ID token on the front channel to PingFederate's callback instead of through a code exchange, to keep the stand-in to one hop.
- The authorization server does not revoke tokens when a code is replayed (tokens are stateless JWTs here); real servers should (RFC 6749 section 4.1.2).
- Trust in each issuer's key is configured in process rather than fetched from a JWKS endpoint (the endpoints exist but the actors do not call them).
- The gateway's exchange request is drawn from the gateway to PingFederate (it is the gateway that calls the token endpoint), which is the reverse of the arrow in the source diagram.

## Guards

- Control API and actors bind **127.0.0.1** only (`MCP_FLOW_BIND` is the explicit opt-in the container sets; compose publishes `127.0.0.1` only, pinned by a test).
- **Host guard**: non-loopback, malformed or missing `Host` gets 421 (DNS rebinding).
- **CSRF guard**: `Sec-Fetch-Site: cross-site` is refused, an `Origin` must equal the loopback `Host`, a body must be `application/json`.
- The control API accepts **no credential header**; a request that carries one is refused, not ignored.
- The run endpoint takes only `{ "mistake": "<id>" }`. There is no URL, token or host input anywhere, and the wire (`server/src/wire.js`) refuses any origin that is not one of the five mock actors.
- **Bounded**: 2 kB control bodies, 8 kB actor bodies, 64 kB recorded responses, 20 retained runs, a run queue of one running plus one waiting (a third gets 429).
- **Inert text**: every string in a stored run passes `server/src/sanitize.js` (hidden and control characters shown as `[U+XXXX]`, depth and size capped).
- **Redaction**: passwords, one-time codes, the gateway client secret, Basic credentials and secret-shaped strings are replaced by `[REDACTED]` (`server/src/redaction.js`). Mock tokens, codes and verifiers are not secret.
- **500s never leak**: the client sees `{ "error": "server_error" }` only.
- **Netguard** (`server/src/netguard.js`): installed before anything listens. Every non-loopback socket, DNS lookup, `fetch` and UDP send or connect is refused and recorded. A self-test (run by `npm run doctor` and a test) tries each route out and checks it is refused, and the flow test runs the whole suite under the guard and asserts zero attempts.
- **Mock | Live**: Mock is the only mode. `POST /api/mode` with `live` is refused with 409 and an honest message; nothing real is configured or contacted.
- **Settings**: only the one shared file `~/Development/.env` (or `STANDALONE_ENV`) is read, and only the key `MCP_FLOW_WORKSPACE` is taken from it (`util.parseEnv`). There is no per-app `.env` loader, and no credential of any kind is read or held.
- Keys use `createECDH` + JWK import; `crypto.generateKeyPair(Sync)` is never used (it aborts on Node 20 in CI).

## Red checks (what each pin was verified against)

Each safety check was removed once and the named test failed: PKCE comparison, `state` check, `iss` check, redirect-URI exact match, audience / expiry / scope validation,
single-use codes, the `act` claim and scope narrowing in the exchange, the Host guard and the CSRF guard. The list and results are in the commit that added the pins.
