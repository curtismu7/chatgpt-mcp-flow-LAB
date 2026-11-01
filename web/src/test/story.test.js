import { describe, expect, it } from "vitest";
import { CAST, PACKS, PACK_LABELS, STORIES, fillStory } from "../data/stories.js";
import { VERTICALS } from "../../../server/src/definition.js";
import { PHASES } from "../../../server/src/definition.js";

describe("stories as data", () => {
  it("every {{token}} in every story has a cast entry", () => {
    for (const s of STORIES) {
      for (const [, key] of s.text.matchAll(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g)) expect(CAST, `${s.phase}: {{${key}}}`).toHaveProperty(key);
      expect(() => fillStory(s.text)).not.toThrow();
      expect(fillStory(s.text)).not.toMatch(/\{\{/);
    }
  });
  it("there are exactly the server's verticals, each with a label, and every pack defines every token any story uses", () => {
    expect(Object.keys(PACKS).sort()).toEqual([...VERTICALS].sort());
    expect(Object.keys(PACK_LABELS).sort()).toEqual([...VERTICALS].sort());
    const tokens = new Set(STORIES.flatMap((s) => [...s.text.matchAll(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g)].map((m) => m[1])));
    for (const [id, cast] of Object.entries(PACKS)) {
      for (const t of tokens) expect(cast, `${id}: {{${t}}}`).toHaveProperty(t);
      for (const s of STORIES) expect(() => fillStory(s.text, cast), `${id}/${s.phase}`).not.toThrow();
    }
    expect(new Set(Object.values(PACKS).map((c) => c.org)).size).toBe(4);
  });
  it("a pack that misses a token fails the story fill (what the pack test above would catch)", () => {
    const broken = { ...PACKS.retail }; delete broken.org;
    expect(() => STORIES.forEach((s) => fillStory(s.text, broken))).toThrow(/org/);
  });
  it("fails loudly on an undefined token", () => {
    expect(() => fillStory("hello {{nobody}}")).toThrow(/nobody/);
  });
  it("every sentence after a full stop starts with a capital once the cast is filled, in every pack", () => {
    for (const [id, cast] of Object.entries(PACKS)) {
      for (const s of STORIES) {
        const filled = fillStory(s.text, cast);
        expect(filled, `${id}/${s.phase}`).not.toMatch(/[.!?]\s+[a-z]/);
      }
    }
  });
  it("covers every phase exactly once", () => {
    expect(STORIES.map((s) => s.phase).sort()).toEqual(PHASES.map((p) => p.id).sort());
  });
});
