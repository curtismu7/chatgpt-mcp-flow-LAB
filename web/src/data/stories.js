// The story is data: one sentence per phase, with {{cast}} tokens. A token with no cast entry throws (and a test pins that).
const BASE = {
  assistant: "the AI assistant",
  gateway: "the public MCP gateway",
  pf: "PingFederate",
  idp: "the enterprise IdP",
  private: "the private MCP server",
  tool: "price-lookup",
  scope: "items.read",
  item: "widget-100",
};
// Three vertical vocabularies besides the default. All names are fictional; the protocol identifiers do not change.
export const PACKS = {
  default: { ...BASE, org: "Example Corp", user: "a member of Example Corp" },
  retail: { ...BASE, org: "Example Retail", user: "a shopper at Example Retail" },
  finance: { ...BASE, org: "Example Bank", user: "a customer of Example Bank" },
  industrial: { ...BASE, org: "Example Works", user: "an engineer at Example Works" },
};
export const PACK_LABELS = { default: "Default", retail: "Retail", finance: "Finance", industrial: "Industrial" };
export const CAST = PACKS.default;

export const STORIES = [
  { phase: "catalog", title: "Getting the connector", text: "{{org}} publishes its connector to the assistant's catalog once. The catalog reviews and lists it (what a real review checks is UNVERIFIED). {{org}}'s members add it from the catalog for free, with nothing to install (UNVERIFIED), and it appears in their own agent, not signed in yet." },
  { phase: "experience", title: "The ask", text: "{{user}} asks {{assistant}} what {{item}} costs. Answering needs the {{tool}} tool, which lives behind {{org}}'s front door." },
  { phase: "discovery", title: "Finding the rules", text: "{{assistant}} calls {{tool}} with no token, is told where the rules are, and learns which authorization server to use. Nothing was pre-configured except the tool's address." },
  { phase: "authn", title: "Proving who is asking", text: "{{pf}} owns no users, so it sends the browser to {{idp}}. The user signs in there; {{pf}} gets a signed ID token and asks the user to consent to {{scope}}." },
  { phase: "redemption", title: "Trading the code", text: "{{assistant}} checks state and iss, then redeems the code with the secret it kept (the PKCE verifier) and receives a short-lived token for {{gateway}} only." },
  { phase: "obo", title: "Acting on the user's behalf", text: "{{gateway}} validates the token, swaps it for a narrower token that names itself as the acting party, and {{private}} checks everything again before {{tool}} runs." },
];

export function fillStory(text, cast = CAST) {
  return text.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_m, key) => {
    if (!Object.prototype.hasOwnProperty.call(cast, key)) throw new Error(`story token {{${key}}} has no cast entry`);
    return cast[key];
  });
}
