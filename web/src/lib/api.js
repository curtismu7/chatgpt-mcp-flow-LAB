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
export const postRun = (mistake) => call("POST", "/api/runs", { mistake: mistake ?? null });
export const postReset = () => call("POST", "/api/reset", {});
export const getDiagram = (name = "authorization-flow") => call("GET", `/api/diagram?name=${encodeURIComponent(name)}`);
// Live is refused by the server (409 live_not_supported) with the honest message, which call() throws as the Error message.
export const postMode = (mode) => call("POST", "/api/mode", { mode });
