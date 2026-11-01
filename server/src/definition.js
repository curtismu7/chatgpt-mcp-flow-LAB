// The static teaching definition: participants, phases, the 20 messages, the mistake toggles, constants.
// Neutral and fictional: "Example Corp", an end user, a generic price-lookup tool. Hostnames end in .example or .invalid.

export const ORIGINS = {
  client: 'https://client.example',
  gateway: 'https://mcp.example',
  as: 'https://auth.example',
  idp: 'https://idp.example',
  private: 'https://items-mcp.internal.example',
  otherResource: 'https://other-mcp.example',
  attackerAs: 'https://attacker.invalid',
  catalog: 'https://catalog.example',
};
export const CONNECTOR_NAME = 'Example Corp price lookup';
export const MEMBER_ID = 'member-1';
// The connector states the mock catalog shows the member. The last two are set by the orchestrator when the first 401 and
// the first access token happen.
export const CONNECTOR_STATES = { review: 'in review', listed: 'listed', added: 'added, not signed in', signin: 'sign-in required (first use)', connected: 'connected' };
export const CONNECTOR_MANIFEST = {
  name: CONNECTOR_NAME,
  publisher: 'Example Corp',
  description: 'Looks up the price of an item for a signed-in member.',
  mcp_server_url: `${ORIGINS.gateway}/mcp`,
  tools: ['price-lookup'],
  authorization: 'discovered on first use (RFC 9728), not stored in the catalog',
};
export const CLIENT_ID = `${ORIGINS.client}/.well-known/mcp-client.json`; // a CIMD-style client identifier URL
export const REDIRECT_URI = `${ORIGINS.client}/oauth/callback`;
export const PF_RP_CLIENT_ID = 'pingfederate-rp';
export const GATEWAY_NHI = 'gateway-nhi';
export const TOOL = 'price-lookup';
export const SCOPE_TOOL = 'items.read';
export const SCOPE_OTHER = 'profile.read';
export const TOKEN_TTL_SEC = 300;
export const OBO_TTL_SEC = 60;
export const CODE_TTL_SEC = 60;
export const ITEM = 'widget-100';

export const PARTICIPANTS = [
  { id: 'publisher', label: 'Example Corp', sub: 'connector publisher', details: 'The company that owns the MCP server. It publishes its connector to the assistant\'s catalog once. This is an organisational role: in this demo the orchestrator plays it, and no real publishing console is modelled.' },
  { id: 'catalog', label: 'Connector catalog', sub: 'the assistant\'s catalog (mock)', details: 'A mock catalog on 127.0.0.1 that accepts a connector manifest, lists it, and lets a member add it for free. The manifest format, the review and the add call are invented for teaching: no real assistant\'s catalog is claimed to work this way (UNVERIFIED).' },
  { id: 'user', label: 'User', sub: 'in the AI assistant', details: 'The signed-in end user of Example Corp, using a public AI assistant on the internet. Never sees a token.' },
  { id: 'client', label: 'AI assistant', sub: 'MCP client, OAuth public client', details: 'OAuth 2.1 public client with a CIMD-style identity (or DCR). Generates the code_verifier and holds the access token. No client secret: PKCE S256 is the only client proof.' },
  { id: 'pf', label: 'PingFederate', sub: 'OAuth 2.1 authorization server, STS', details: 'OAuth 2.1 authorization server and RFC 8693 security token service. Owns no user directory. Verifies the PKCE challenge, mints the access token (aud = the public gateway), and exchanges it for a narrowed on-behalf-of token.' },
  { id: 'idp', label: 'Enterprise IdP', sub: 'OIDC, authentication only', details: 'OIDC identity provider. Password, passkey and MFA produce a signed ID token. Authentication only: it makes no authorization decision.' },
  { id: 'gateway', label: 'Public MCP gateway', sub: 'protected resource, OBO exchange', details: 'Protected resource at the enterprise edge. Serves protected-resource metadata, answers 401 with a WWW-Authenticate challenge, validates iss, aud, exp and scope, triggers the RFC 8693 exchange, then routes to the private MCP server.' },
  { id: 'private', label: 'Private MCP server', sub: 'tools, internal network', details: 'Domain MCP server on the private network. Re-validates the on-behalf-of token (iss, aud, exp, scope, act) and enforces the per-API scope before any tool runs.' },
];

export const PHASES = [
  { id: 'catalog', label: 'Catalog: publish, list, add', tone: 'gold' },
  { id: 'experience', label: 'User experience', tone: 'neutral' },
  { id: 'discovery', label: 'Discovery', tone: 'grey' },
  { id: 'authn', label: 'Authentication + PKCE challenge', tone: 'navy' },
  { id: 'redemption', label: 'Code redemption + token minting', tone: 'orange' },
  { id: 'obo', label: 'OBO exchange + downstream authorization', tone: 'teal' },
];

// The 20 numbered messages. `from`/`to` are the arrow of the diagram. `organisational: true` marks a step that is a
// company or product step with no wire protocol behind it; the exchange shown there (if any) is a mock stand-in.
export const STEPS = [
  { n: 1, from: 'publisher', to: 'catalog', phase: 'catalog', title: 'Company publishes the connector', text: 'Once, the company submits its connector (a manifest: name, publisher, MCP server URL, tool list) to the assistant\'s catalog. The manifest and the call are a MOCK; no real catalog\'s submission format is claimed (UNVERIFIED)' },
  { n: 2, from: 'catalog', to: 'publisher', phase: 'catalog', organisational: true, title: 'Catalog reviews and lists it', text: 'Organisational step, no protocol: the catalog reviews the submission and lists it. What a real catalog\'s review checks is UNVERIFIED (no standard or source is cited). The mock simply lists it; the status read shown is a stand-in' },
  { n: 3, from: 'user', to: 'catalog', phase: 'catalog', title: 'Member adds it from the catalog', text: 'The member picks the connector in the catalog and adds it, free, with nothing to install (a MOCK call; real catalogs differ and this is UNVERIFIED)' },
  { n: 4, from: 'catalog', to: 'client', phase: 'catalog', title: 'It appears in the member\'s agent', text: 'The connector shows up in the member\'s own agent, not signed in yet: state "added, not signed in". Sign-in and consent come on first use, which is when the next phase starts' },
  { n: 5, from: 'user', to: 'client', phase: 'experience', title: 'Asks a price question', text: 'The user asks the assistant what an item costs' },
  { n: 6, from: 'client', to: 'gateway', phase: 'discovery', title: 'Tool call with no token', text: 'Calls the protected MCP tool with no token, gets 401 + WWW-Authenticate: resource_metadata (RFC 9728)' },
  { n: 7, from: 'client', to: 'gateway', phase: 'discovery', title: 'Protected-resource metadata', text: 'GET /.well-known/oauth-protected-resource: authorization_servers lists PingFederate (RFC 9728)' },
  { n: 8, from: 'client', to: 'pf', phase: 'discovery', title: 'Authorization-server metadata', text: 'GET /.well-known/oauth-authorization-server: endpoints, S256, client identity (RFC 8414)' },
  { n: 9, from: 'client', to: 'pf', phase: 'authn', title: 'Authorization request', text: 'GET the authorization endpoint with code_challenge, method S256, resource and scopes (RFC 7636, RFC 8707)' },
  { n: 10, from: 'pf', to: 'idp', phase: 'authn', title: 'Front-channel redirect to the IdP', text: 'PingFederate owns no user directory, so the browser is redirected to the enterprise IdP' },
  { n: 11, from: 'user', to: 'idp', phase: 'authn', title: 'User authenticates', text: 'The user authenticates at the enterprise IdP (password, passkey, MFA)' },
  { n: 12, from: 'idp', to: 'pf', phase: 'authn', title: 'Signed ID token', text: 'Signed ID token (JWT) back to PingFederate, which then shows consent' },
  { n: 13, from: 'pf', to: 'client', phase: 'redemption', title: 'Authorization code + iss', text: 'authorization_code, state and iss (RFC 9207) to the allow-listed redirect URI' },
  { n: 14, from: 'client', to: 'pf', phase: 'redemption', title: 'Code redemption', text: 'POST the token endpoint with the code and the plaintext code_verifier (PKCE interlock)' },
  { n: 15, from: 'pf', to: 'client', phase: 'redemption', title: 'Access token', text: 'access_token: aud = the public gateway, narrow scope, short TTL' },
  { n: 16, from: 'client', to: 'gateway', phase: 'obo', title: 'MCP request with bearer token', text: 'MCP request with the access token; the gateway validates iss, aud, exp and scope' },
  { n: 17, from: 'gateway', to: 'pf', phase: 'obo', title: 'RFC 8693 token exchange', text: 'On-behalf-of token: act = the gateway identity, narrowed scopes, new audience (RFC 8693)' },
  { n: 18, from: 'gateway', to: 'private', phase: 'obo', title: 'Route to the private MCP server', text: 'The private server re-validates the OBO token and enforces the per-API scope' },
  { n: 19, from: 'private', to: 'client', phase: 'experience', title: 'Result returns', text: 'The structured result returns up the chain to the assistant' },
  { n: 20, from: 'client', to: 'user', phase: 'experience', title: 'Answer', text: 'The assistant answers the user' },
];

// expected = where the stub must refuse: the step, the refusing actor and the error code.
export const MISTAKES = [
  { id: 'unlisted_connector', label: 'Connector never listed', expected: { step: 3, actor: 'catalog', error: 'connector_not_listed' }, standard: 'no standard, UNVERIFIED', why: 'The catalog has not finished reviewing the connector, so it is not listed and the member cannot add it. Nothing reaches the member\'s agent, and no 401 or sign-in ever happens.' },
  { id: 'wrong_verifier', label: 'Wrong code_verifier', expected: { step: 14, actor: 'pf', error: 'invalid_grant' }, standard: 'RFC 7636', why: 'The verifier sent at redemption does not hash to the challenge sent in step 9, so a stolen authorization code is useless without the original verifier.' },
  { id: 'replayed_code', label: 'Replayed authorization code', expected: { step: 14, actor: 'pf', error: 'invalid_grant' }, standard: 'RFC 6749', why: 'An authorization code is single use. The second redemption is refused.' },
  { id: 'bad_redirect', label: 'Redirect URI not allow-listed', expected: { step: 9, actor: 'pf', error: 'invalid_request' }, standard: 'RFC 6749', why: 'The redirect URI must match a registered one exactly. A near match is refused without redirecting, so the code can never be sent to an attacker.' },
  { id: 'missing_resource', label: 'Missing resource indicator', expected: { step: 9, actor: 'pf', error: 'invalid_target' }, standard: 'RFC 8707', why: 'Without a resource indicator the authorization server cannot bind the token to one audience, so this server refuses to issue one.' },
  { id: 'wrong_audience', label: 'Token for another audience', expected: { step: 16, actor: 'gateway', error: 'invalid_token' }, standard: 'RFC 8707', why: 'A token issued for a different resource is refused by the gateway: a token is only good at the resource it was issued for.' },
  { id: 'expired_token', label: 'Expired token', expected: { step: 16, actor: 'gateway', error: 'invalid_token' }, standard: 'RFC 6750', why: 'The access token is short lived. Presented after exp, the gateway refuses it.' },
  { id: 'wrong_scope', label: 'Token without the tool scope', expected: { step: 16, actor: 'gateway', error: 'insufficient_scope' }, standard: 'RFC 6750', why: 'The token is valid but carries a different scope than the tool needs, so the gateway answers 403 insufficient_scope.' },
  { id: 'missing_iss', label: 'Missing iss in the authorization response', expected: { step: 13, actor: 'client', error: 'iss_missing' }, standard: 'RFC 9207', why: 'The authorization server advertises that it sends iss. The client treats a response without it as a possible mix-up attack.' },
  { id: 'forged_iss', label: 'Forged iss (mix-up attack)', expected: { step: 13, actor: 'client', error: 'iss_mismatch' }, standard: 'RFC 9207', why: 'The iss in the authorization response is not the issuer the client started with, so the client refuses to redeem the code anywhere.' },
  { id: 'wrong_state', label: 'Wrong state', expected: { step: 13, actor: 'client', error: 'state_mismatch' }, standard: 'RFC 6749', why: 'The state returned is not the one the client sent, so the response is not an answer to its own request (CSRF defence).' },
  { id: 'passthrough', label: 'Gateway forwards the user token (no exchange)', expected: { step: 18, actor: 'private', error: 'invalid_token' }, standard: 'RFC 8693', why: 'The private server accepts only an on-behalf-of token for itself. The user token is for the gateway, so passing it through is refused.' },
];
// Story vocabularies (web/src/data/stories.js carries the wording for each). All are fictional and neutral.
export const VERTICALS = ['default', 'retail', 'finance', 'industrial'];
export const MISTAKE_IDS = MISTAKES.map((m) => m.id);

export const STANDARDS = [
  { rfc: 'RFC 6749', title: 'The OAuth 2.0 Authorization Framework' },
  { rfc: 'RFC 6750', title: 'Bearer Token Usage' },
  { rfc: 'RFC 7636', title: 'Proof Key for Code Exchange (PKCE)' },
  { rfc: 'RFC 8414', title: 'Authorization Server Metadata' },
  { rfc: 'RFC 8693', title: 'OAuth 2.0 Token Exchange' },
  { rfc: 'RFC 8707', title: 'Resource Indicators' },
  { rfc: 'RFC 9068', title: 'JWT Profile for Access Tokens' },
  { rfc: 'RFC 9207', title: 'Authorization Server Issuer Identification' },
  { rfc: 'RFC 9728', title: 'Protected Resource Metadata' },
];

export const PROVENANCE = {
  standards: 'Standards are cited by RFC number only and implemented as the RFC text describes them.',
  unverified: [
    'Client identity by a CIMD document or DCR, and which of the two the product supports',
    'A non-human-identity (NHI) store for the gateway identity',
    'How any real assistant\'s connector catalog accepts, reviews, lists and offers a connector, and what its review checks (no standard or source is cited; the catalog phase is an invented teaching model)',
    'The exact PingFederate endpoint names and configuration objects (the stub uses /as/authorization.oauth2 and /as/token.oauth2)',
    'That PingFederate performs the front-channel redirect to an external OIDC IdP and the RFC 8693 exchange exactly as drawn',
  ],
  unverifiedLabel: 'As described in the source proposal, UNVERIFIED against product documentation.',
  standIn: 'Every actor here is an in-process mock on 127.0.0.1. No product, tenant or identity provider is contacted. Tokens are MOCK-ISSUED with an in-memory key and protect nothing.',
};
