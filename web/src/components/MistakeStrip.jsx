import React from "react";

// "Mistake / attack" toggles: choose one, press Simulate, and the stub refuses where the standard says it must.
// While a run is busy the chips are aria-disabled, not disabled: a disabled radio drops keyboard focus.
export default function MistakeStrip({ mistakes, value, onChange, disabled }) {
  const all = [{ id: "", label: "None: happy path" }, ...mistakes];
  return (
    <fieldset className="strip" aria-disabled={disabled ? "true" : undefined}>
      <legend>Break it on purpose (mistake or attack)</legend>
      <div className="chips">
        {all.map((m) => (
          <label key={m.id || "none"} className="mchip" data-state={value === m.id ? "on" : "off"}>
            <input type="radio" name="mistake" value={m.id} checked={value === m.id} aria-disabled={disabled ? "true" : undefined}
              onChange={() => { if (!disabled) onChange(m.id); }} data-testid={`mistake-${m.id || "none"}`} />
            <span>{m.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
