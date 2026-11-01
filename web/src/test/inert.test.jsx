import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Inert } from "../components/Untrusted.jsx";
import { reveal } from "../lib/reveal.js";

describe("inert text", () => {
  it("shows hidden characters as visible chips", () => {
    expect(reveal("a​b‮c")).toBe("a[U+200B]b[U+202E]c");
    const { container } = render(<Inert text={"x​y"} />);
    expect(container.querySelector(".chip")).toHaveTextContent("[U+200B]");
  });
  it("never renders markup from a payload", () => {
    const { container } = render(<Inert block text={'<img src=x onerror="alert(1)"><script>1</script>'} />);
    expect(container.querySelector("img, script")).toBeNull();
    expect(container.textContent).toContain("<img");
  });
});
