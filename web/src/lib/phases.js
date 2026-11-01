export const STATUS_GLYPH = { ok: "✓", refused: "✗", skipped: "↷", blocked: "–", pending: "•" };
export const STATUS_WORD = { ok: "ok", refused: "refused", skipped: "skipped", blocked: "not reached", pending: "pending" };

// Product-specific behaviour the source proposal describes but nobody here verified against product documentation.
export const UNVERIFIED_PARTICIPANT = {
  catalog: "how any real assistant's connector catalog accepts, reviews, lists and offers a connector",
  client: "client identity by CIMD document or DCR",
  pf: "exact PingFederate endpoint names and token-exchange behaviour",
  gateway: "a non-human-identity (NHI) store for the gateway identity",
};
export const UNVERIFIED_STEP = {
  1: "the manifest and submission call are invented; a real catalog's format is not known here",
  2: "what a real catalog's review checks (no standard or source is cited)",
  3: "how a real catalog lets a member add a connector for free (UNVERIFIED)",
  4: "how a real assistant shows an added connector before sign-in",
  8: "client identity by CIMD or DCR",
  9: "exact PingFederate endpoint names",
  10: "PingFederate hands the browser to an external OIDC IdP as drawn",
  14: "exact PingFederate endpoint names",
  17: "PingFederate performs the exchange exactly as drawn; NHI store for the gateway identity",
};
