// The vendored shared/mode-modal files (ModeModal.jsx, mode-modal.css) match mode-modal.sha256 byte for byte, and the pins are the canonical hashes.
// They come from curtismu7/AI-DEMO-Standalone shared/mode-modal: change them there, re-pin, re-vendor; never edit them here.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "mode-modal");
const CANONICAL = { "ModeModal.jsx": "f2d194b30a310aaf91f7fbfab9a79a3a556b1bb5ee14b2e1ab6e8ced584d1f96", "mode-modal.css": "7d16164802521e3d1a1c8d84cbba73c45429fd6d797961f87acabe6022e01037" };

describe("vendored mode-modal", () => {
  it("matches mode-modal.sha256 and the canonical hashes", () => {
    const pins = Object.fromEntries(fs.readFileSync(path.join(dir, "mode-modal.sha256"), "utf8").split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.trim().split(/\s+/)).map(([h, f]) => [f, h]));
    expect(Object.keys(pins).sort()).toEqual(Object.keys(CANONICAL).sort());
    for (const [file, canonical] of Object.entries(CANONICAL)) {
      const actual = createHash("sha256").update(fs.readFileSync(path.join(dir, file))).digest("hex");
      expect(actual, file).toBe(pins[file]);
      expect(actual, `${file} vs canonical`).toBe(canonical);
    }
  });
});
