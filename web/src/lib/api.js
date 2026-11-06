// Same-origin JSON calls to the control API. Nothing else is ever fetched.
async function call(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* not json */ }
  if (!res.ok) throw Object.assign(new Error(json?.message || json?.error || `HTTP ${res.status}`), { status: res.status, code: json?.error });
  return json;
}
export const getFlow = () => call("GET", "/api/flow");
export const getHealth = () => call("GET", "/api/health");
export const getInfo = () => call("GET", "/api/info");
export const postRun = (mistake) => call("POST", "/api/runs", { mistake: mistake ?? null });
export const postReset = () => call("POST", "/api/reset", {});
export const getDiagram = (name = "authorization-flow") => call("GET", `/api/diagram?name=${encodeURIComponent(name)}`);
// Real is refused by the server (409 real_not_available) with the honest message, which call() throws as the Error message.
export const postMode = (source) => call("POST", "/api/mode", { source });
