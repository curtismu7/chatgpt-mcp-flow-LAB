import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ShelfLink from "./components/ShelfLink.jsx";
import { getDiagram, getFlow, getHealth, getInfo, postMode, postReset, postRun } from "./lib/api.js";
import { STATUS_WORD } from "./lib/phases.js";
import Diagram, { useDiagramPositions } from "./components/Diagram.jsx";
import { DetailsRow, Reel } from "./components/Reel.jsx";
import WirePanel from "./components/WirePanel.jsx";
import MistakeStrip from "./components/MistakeStrip.jsx";
import StoryStrip from "./components/StoryStrip.jsx";
import Interlocks from "./components/Interlocks.jsx";
import About from "./components/About.jsx";

const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
const initialTheme = () => {
  const t = safe(() => localStorage.getItem("mcpflow-theme"), null);
  return ["auto", "light", "dark"].includes(t) ? t : "auto";
};
export const BASE_MS = 1700;
const SPEEDS = [["0.5", "0.5x"], ["1", "1x"], ["2", "2x"], ["4", "4x"]];
const FALLBACK_BANNER = "SIMULATION, MOCK mode. Every actor here is an in-process mock on 127.0.0.1. No product, tenant or identity provider is contacted. Tokens are MOCK-ISSUED and protect nothing.";
// A button that is "off" stays focusable and announced (aria-disabled) instead of being removed from the tab order, and does nothing when pressed.
const off = (cond, fn) => ({ "aria-disabled": cond ? "true" : undefined, onClick: cond ? undefined : fn });
// P and Esc are presenter shortcuts, but never while the visitor is typing or holding a modifier.
const typing = (el) => Boolean(el) && (el.isContentEditable || /^(TEXTAREA|SELECT)$/.test(el.tagName) || (el.tagName === "INPUT" && !/^(radio|checkbox|button|submit|reset)$/i.test(el.type || "text")));

export default function App({ baseMs = BASE_MS }) {
  const [theme, setTheme] = useState(initialTheme);
  const [tab, setTab] = useState("sequence");
  const [presenter, setPresenter] = useState(false);
  const [flow, setFlow] = useState(null);
  const [health, setHealth] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [mistake, setMistake] = useState("");
  const [speed, setSpeed] = useState("1");
  const [run, setRun] = useState(null);
  const [shown, setShown] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState({});
  const [diagram, setDiagram] = useState(null);
  const [modeNote, setModeNote] = useState("");
  const [modeInfo, setModeInfo] = useState(null);
  const { positions, selectedId, apply, reset: resetPositions } = useDiagramPositions(diagram);
  const epoch = useRef(0);

  useEffect(() => {
    if (theme === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    safe(() => localStorage.setItem("mcpflow-theme", theme));
  }, [theme]);

  useEffect(() => {
    let live = true;
    getFlow().then((f) => live && setFlow(f)).catch((e) => live && setLoadError(e.message));
    getDiagram().then((d) => live && setDiagram(d)).catch((e) => live && setLoadError(e.message));
    getHealth().then((h) => live && setHealth(h)).catch(() => {});
    getInfo().then((i) => live && setModeInfo(i)).catch(() => {});
    return () => { live = false; };
  }, []);

  const steps = flow?.steps || [];
  const total = steps.length;
  const runSteps = run?.steps || [];

  // Advance one revealed message per tick; the delay is the base time divided by the speed.
  useEffect(() => {
    if (!playing || !run) return undefined;
    if (shown >= runSteps.length) { setPlaying(false); return undefined; }
    const id = setTimeout(() => { setPicked(null); setShown((n) => n + 1); }, baseMs / Number(speed));
    return () => clearTimeout(id);
  }, [playing, run, shown, speed, runSteps.length, baseMs]);

  const statusOf = useCallback((n) => {
    if (!run) return "pending";
    const idx = runSteps.findIndex((s) => s.n === n);
    if (idx >= 0) return idx < shown ? runSteps[idx].status : "pending";
    return shown >= runSteps.length ? "blocked" : "pending";
  }, [run, runSteps, shown]);

  const currentN = shown > 0 ? runSteps[shown - 1]?.n ?? null : null;
  const selectedN = picked ?? currentN;
  const def = steps.find((s) => s.n === selectedN) || null;
  const stepData = run && def ? runSteps.findIndex((s) => s.n === def.n) < shown ? runSteps.find((s) => s.n === def.n) : null : null;
  const phaseLabel = useCallback((id) => flow?.phases.find((p) => p.id === id)?.label || id, [flow]);
  const participants = flow?.participants || [];
  const label = (id) => participants.find((p) => p.id === id)?.label || id;
  const answer = runSteps.find((s) => s.n === total)?.data?.assistant_says;
  const finished = Boolean(run) && shown >= runSteps.length;

  const caption = useMemo(() => {
    if (!run) return "Ready. Pick a mistake if you like, then press Simulate. Each message is a real exchange between the mock actors.";
    if (shown === 0) return `Run ${run.id} is ready: ${runSteps.length} of ${total} messages happened. Press Step or Simulate to walk them.`;
    const s = runSteps[shown - 1];
    const base = `Message ${s.n} of ${total}, ${s.title}: ${STATUS_WORD[s.status]}.`;
    if (s.status === "refused" && s.refusal) return `${base} Refused by ${label(s.refusal.actor)} with ${s.refusal.error}.`;
    if (finished && !run.refusal) return `${base} Run finished: every check passed.`;
    return base;
  }, [run, shown, runSteps, total, finished, participants]); // eslint-disable-line react-hooks/exhaustive-deps

  const startRun = useCallback(async (which) => {
    setBusy(true); setError("");
    const my = (epoch.current += 1);
    try {
      const r = await postRun(which || null);
      if (my !== epoch.current) return null;
      return r;
    } catch (e) {
      if (my === epoch.current) setError(e.code === "run_queue_full" ? "A run is already in progress. Try again in a moment." : `The run failed: ${e.message}`);
      return null;
    } finally { setBusy(false); }
  }, []);

  const simulate = useCallback(async () => {
    setPlaying(false); setPicked(null); setShown(0); setRun(null);
    const r = await startRun(mistake);
    if (r) { setRun(r); setPlaying(true); }
  }, [mistake, startRun]);

  const step = useCallback(async () => {
    setPlaying(false); setPicked(null);
    if (!run) {
      const r = await startRun(mistake);
      if (r) { setRun(r); setShown(1); }
    } else setShown((n) => Math.min(n + 1, runSteps.length));
  }, [run, mistake, startRun, runSteps.length]);

  const reset = useCallback(async () => {
    epoch.current += 1;
    setPlaying(false); setRun(null); setShown(0); setPicked(null); setError(""); setResults({}); setMistake("");
    resetPositions();
    try { await postReset(); } catch (e) { setError(`Reset could not reach the server: ${e.message}`); }
  }, [resetPositions]);

  const chooseMistake = (id) => { epoch.current += 1; setMistake(id); setRun(null); setShown(0); setPlaying(false); setPicked(null); setBusy(false); };

  const runOne = useCallback(async (id) => {
    const r = await startRun(id);
    if (r) setResults((prev) => ({ ...prev, [id]: { refusal: r.refusal, interlockHeld: r.interlockHeld, status: r.status } }));
  }, [startRun]);
  const runAll = useCallback(async () => { for (const m of flow.mistakes) await runOne(m.id); }, [flow, runOne]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeTab = (t) => { setTab(t); };
  const togglePresenter = useCallback(() => { setPresenter((p) => { if (!p) setTab("sequence"); return !p; }); }, []);

  // Mock | Real. Mock is the only mode this lab has: Real asks the server, which refuses with an honest message, and the page stays in Mock.
  const chooseMock = () => setModeNote("");
  const chooseReal = async () => {
    try { await postMode("real"); setModeNote(""); } catch (e) { setModeNote(e.message); }
  };

  useEffect(() => {
    const on = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || typing(e.target)) return;
      if (e.key === "p" || e.key === "P") togglePresenter();
      else if (e.key === "Escape") setPresenter(false);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [togglePresenter]);

  const modeName = (flow?.mode || "mock").toUpperCase();
  const bannerText = flow?.provenance?.standIn ? `SIMULATION, ${modeName} mode. ${flow.provenance.standIn}` : FALLBACK_BANNER;
  const mistakeDef = flow?.mistakes.find((m) => m.id === run?.mistake?.id) || null;

  return (
    <div className={`app${presenter ? " presenter" : ""}`}>
      <a className="skip" href="#main">Skip to content</a>
      <div className="banner" role="region" aria-label="Simulation notice" data-state="mock" data-testid="sim-banner"><strong>{bannerText}</strong></div>
      <header className="top">
        <h1>AI assistant to MCP: how the call is authorized</h1>
        <div className="top__tools">
            <ShelfLink />
          <span className="mode-badge" data-testid="mode-badge" title="This is a teaching demo">DEMO</span>
          <div className="mode-toggle" role="group" aria-label="Mode: Mock or Real">
            <button type="button" aria-pressed="true" onClick={chooseMock} data-testid="mode-mock">Mock</button>
            <button type="button" aria-pressed="false" aria-disabled={modeInfo?.realAvailable === false ? "true" : undefined}
              title={modeInfo?.realAvailable === false && modeInfo?.realReason ? modeInfo.realReason : undefined}
              onClick={chooseReal} data-testid="mode-real">Real</button>
          </div>
          <span className="mode-chip" data-testid="mode-header">MODE: {modeName} <span className="muted">in-process stubs on 127.0.0.1{health ? ` · health ${health.state}` : ""}</span></span>
          <button type="button" onClick={reset} data-testid="reset">Reset</button>
          <button type="button" aria-pressed={presenter} onClick={togglePresenter} data-testid="presenter">{presenter ? "Exit presenter (Esc)" : "Presenter (P)"}</button>
          <label className="inline">Theme
            <select value={theme} onChange={(e) => setTheme(e.target.value)} data-testid="theme">
              <option value="auto">Auto</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>
        <p className="top__note" role="status" aria-live="polite" data-testid="mode-note">{modeNote}</p>
      </header>
      {!presenter && (
        <nav className="tabs" aria-label="Sections">
          {[["sequence", "Sequence"], ["interlocks", "Interlocks"], ["about", "What is real"]].map(([id, text]) => (
            <button key={id} type="button" aria-pressed={tab === id} onClick={() => changeTab(id)}>{text}</button>
          ))}
        </nav>
      )}
      <main id="main" className="page" tabIndex={-1}>
        {loadError && <div className="alert" role="alert">The control API did not answer: {loadError}</div>}
        {!(flow && diagram) && !loadError && <p className="muted">Loading the flow definition...</p>}
        {flow && diagram && tab === "sequence" && (
          <>
            {!presenter && <StoryStrip phases={flow.phases} activePhase={def?.phase} vertical={flow.config?.vertical} />}
            <section className="card controls" aria-label="Simulation controls">
              <MistakeStrip mistakes={flow.mistakes} value={mistake} onChange={chooseMistake} disabled={busy} />
              <div className="row controls-row">
                <button type="button" className="primary" {...off(busy, simulate)} data-testid="simulate">Simulate</button>
                <button type="button" {...off(busy || (finished && Boolean(run)), step)} data-testid="step">Step</button>
                <button type="button" {...off(!run || finished, () => setPlaying((p) => !p))} data-testid="pause">{playing ? "Pause" : "Resume"}</button>
                <button type="button" {...off(!run || finished, () => { setPlaying(false); setShown(runSteps.length); })} data-testid="showall">Show all</button>
                <label className="field">Step speed
                  <select value={speed} onChange={(e) => setSpeed(e.target.value)} data-testid="speed">
                    {SPEEDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                  </select>
                </label>
              </div>
              {error && <div className="alert" role="alert">{error}</div>}
              <p className="caption" role="status" aria-live="polite" aria-atomic="true" data-testid="run-status">{caption}</p>
              {finished && run && (
                <div className="outcome" data-state={run.refusal ? "refused" : "ok"} data-testid="outcome">
                  {run.refusal ? (
                    <>
                      <strong>{"✓"} The interlock held. {label(run.refusal.actor)} refused message {run.refusal.step} with <code>{run.refusal.error}</code>{run.refusal.standard ? ` (${run.refusal.standard})` : ""}.</strong>
                      {mistakeDef && <p>{mistakeDef.why}</p>}
                      {run.interlockHeld === false && <p className="alert">This differs from the expected refusal (message {run.mistake?.expected?.step}, {label(run.mistake?.expected?.actor)}, {run.mistake?.expected?.error}).</p>}
                      <p className="small muted">Messages after {run.refusal.step} never happen. They stay dimmed.</p>
                    </>
                  ) : (
                    <strong>{"✓"} All {total} messages passed. {answer ? <>The assistant answers: {answer}</> : null}</strong>
                  )}
                </div>
              )}
            </section>
            <Diagram diagram={diagram} steps={steps} positions={positions} selectedId={selectedId} onApply={apply} statusOf={statusOf} currentN={currentN} theme={theme} presenter={presenter} />
            <Reel steps={steps} statusOf={statusOf} selectedN={selectedN} currentN={currentN} onPick={setPicked} phaseLabel={phaseLabel} />
            <ul className="legend plain" aria-label="Phase colours">
              {flow.phases.map((p) => <li key={p.id}><span className="dot" data-phase={p.id} aria-hidden="true" /> {p.label}</li>)}
            </ul>
            <DetailsRow def={def} participants={participants} phaseLabel={phaseLabel} />
            <div className="hide-presenter"><WirePanel step={stepData} def={def} status={def ? statusOf(def.n) : "pending"} participants={participants} hasRun={Boolean(run)} /></div>
          </>
        )}
        {flow && diagram && tab === "interlocks" && !presenter && <Interlocks mistakes={flow.mistakes} participants={participants} results={results} onRun={runOne} onRunAll={runAll} busy={busy} />}
        {flow && diagram && tab === "about" && !presenter && <About flow={flow} />}
      </main>
    </div>
  );
}
