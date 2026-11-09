// Safety rules. Pure functions, no I/O.
//  1. Bind loopback only, unless MCP_FLOW_BIND opts in (the container does).
//  2. Every port this app uses is in 6650-6699: the control server on 6650, the five mock actors on 6651-6655.
//  3. Actors only ever talk to each other over 127.0.0.1 on those ports (wire.js enforces it). There is no URL input anywhere.
//  4. Only loopback hosts are Host-header-accepted, plus LAB_ALLOWED_HOSTS names with this lab's port on the control API (the
//     lab-proxy's name for this app); no credential header is accepted by the control API.

export const PORT_MIN = 6650;
export const PORT_MAX = 6699;
export const SERVER_PORT = 6650;
export const STUB_BASE_PORT = 6651;
export const STUB_COUNT = 5;

const OCTET = '(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)';
const LOOPBACK_V4 = new RegExp(`^127\\.${OCTET}\\.${OCTET}\\.${OCTET}$`);
export function isLoopbackHost(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || LOOPBACK_V4.test(h);
}

export const portInRange = (p) => Number.isInteger(p) && p >= PORT_MIN && p <= PORT_MAX;
// The WHATWG fetch used by the wire refuses these ports ("bad port": IRC), so no actor may listen on them.
export const FETCH_BLOCKED_PORTS = new Set([6665, 6666, 6667, 6668, 6669, 6679, 6697]);
export const actorPortOk = (p) => portInRange(p) && !FETCH_BLOCKED_PORTS.has(p);
// The mock actors' first port. MCP_FLOW_STUB_BASE moves the block of five when 6651-6655 is taken by another process.
export const stubBase = (env = process.env) => (env.MCP_FLOW_STUB_BASE === undefined ? STUB_BASE_PORT : Number(env.MCP_FLOW_STUB_BASE));
export const bindHost = (env = process.env) => env.MCP_FLOW_BIND || '127.0.0.1';
export const serverPort = (env = process.env) => (env.MCP_FLOW_PORT === undefined ? SERVER_PORT : Number(env.MCP_FLOW_PORT));

export function assertBindAllowed(host, env = process.env) {
  if (isLoopbackHost(host) || env.MCP_FLOW_BIND) return host;
  throw new Error(`refusing to bind ${host}: loopback only. Set MCP_FLOW_BIND to opt in (the container does).`);
}

// Strict Host parsing: "localhost", "127.x.y.z" (each octet 0-255) or "[::1]", optionally ":port". Anything else -> null.
const HOST_RE = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::(\d{1,5}))?$/i;
export function parseHost(hostHeader) {
  const m = HOST_RE.exec(String(hostHeader ?? '').trim());
  if (!m || !isLoopbackHost(m[1])) return null;
  if (m[2] !== undefined && Number(m[2]) > 65535) return null;
  return { hostname: m[1].toLowerCase().replace(/^\[|\]$/g, ''), port: m[2] === undefined ? null : Number(m[2]), host: `${m[1]}${m[2] === undefined ? '' : `:${m[2]}`}`.toLowerCase() };
}

// LAB_ALLOWED_HOSTS: comma-separated host names (no port) the family lab-proxy sends in Host. Unset = loopback only.
// Parsed once, before the server starts; a malformed entry stops the start.
export function parseAllowedHosts(env = process.env) {
  const names = String(env.LAB_ALLOWED_HOSTS || '').split(',').map((n) => n.trim().toLowerCase()).filter(Boolean);
  for (const n of names) if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/.test(n)) throw new Error(`LAB_ALLOWED_HOSTS: "${n.slice(0, 40)}" is not a host name`);
  return new Set(names);
}
// The Hosts that may carry the lab-proxy's forwarded origin: each allowed name with this lab's port. Never loopback.
export const proxyHostSet = (allowed = new Set(), port = SERVER_PORT) => new Set([...allowed].map((n) => `${n}:${port}`));

// Rejects a missing, malformed or non-loopback Host header (DNS rebinding): 421 Misdirected Request. An allowed name with
// this lab's port is also accepted.
export const makeHostGuard = ({ allowed = new Set(), port = SERVER_PORT } = {}) => {
  const proxyHosts = proxyHostSet(allowed, port);
  return function hostGuard(req, res, next) {
    if (!req.headers.host || !(parseHost(req.headers.host) || proxyHosts.has(String(req.headers.host).toLowerCase()))) {
      return res.status(421).json({ error: 'bad_host', message: 'this server answers loopback Host headers only' });
    }
    return next();
  };
};
export const hostGuard = makeHostGuard();

// Behind the lab-proxy the browser's Origin is the proxy's (https://local.ping-devops.com:8443) while Host is this lab's
// allowed name. X-Forwarded-Host/-Proto are believed only on such a Host, so a request on any other Host cannot use them.
export function isProxiedSameOrigin(headers, proxyHosts) {
  const xfh = String(headers['x-forwarded-host'] || '').trim().toLowerCase();
  const xfp = String(headers['x-forwarded-proto'] || '').trim().toLowerCase();
  return proxyHosts.has(String(headers.host || '').toLowerCase()) && xfh !== '' && (xfp === 'https' || xfp === 'http') && headers.origin === `${xfp}://${xfh}`;
}

// CSRF defence for anything that is not a plain read. A page on another site can send a "simple" POST to
// 127.0.0.1 without CORS permission, so the server refuses it itself.
//  - Sec-Fetch-Site: cross-site is refused (same-origin, same-site, none are fine);
//  - an Origin header must be an http loopback origin identical to the Host the request was sent to;
//  - a request with a body must be application/json.
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const makeOriginGuard = ({ allowed = new Set(), port = SERVER_PORT } = {}) => {
  const proxyHosts = proxyHostSet(allowed, port);
  return function originGuard(req, res, next) {
    if (READ_METHODS.has(req.method)) return next();
    const refuse = (status, error, message) => res.status(status).json({ error, message });
    if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return refuse(403, 'cross_site_refused', 'cross-site requests are refused');
    const origin = req.headers.origin;
    if (origin !== undefined) {
      let u = null;
      try { u = new URL(origin); } catch { /* refused below */ }
      const host = parseHost(req.headers.host);
      const same = isProxiedSameOrigin(req.headers, proxyHosts) || u && u.protocol === 'http:' && u.origin !== 'null' && isLoopbackHost(u.hostname) && host
        && u.host.toLowerCase() === host.host && !u.username && !u.password && u.pathname === '/' && origin === u.origin;
      if (!same) return refuse(403, 'bad_origin', 'this server accepts same-origin loopback requests only');
    }
    const hasBody = Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'] !== undefined;
    if (hasBody && !/^application\/json\s*(;|$)/i.test(req.headers['content-type'] || '')) return refuse(415, 'unsupported_media_type', 'a request body must be application/json');
    return next();
  };
};
export const originGuard = makeOriginGuard();

// The control API accepts no credential. A request that carries one is refused, not ignored.
// (The mock actors DO exchange mock bearer tokens with each other; that is a different listener and never this API.)
const CREDENTIAL_HEADERS = ['authorization', 'proxy-authorization', 'x-api-key', 'cookie'];
export function credentialGuard(req, res, next) {
  if (CREDENTIAL_HEADERS.some((h) => req.headers[h] !== undefined)) {
    return res.status(400).json({ error: 'credentials_not_accepted', message: 'this server accepts and uses no credentials' });
  }
  return next();
}
