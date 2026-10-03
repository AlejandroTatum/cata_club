import { describe, it, expect } from "vitest";
import manifest from "../manifest";

describe("web manifest", () => {
  it("lists the 192 and 512 square icons", () => {
    const { icons = [] } = manifest();
    const sizes = icons.map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(icons.every((icon) => icon.src.startsWith("/brand/icons/"))).toBe(true);
  });

  it("names the club", () => {
    expect(manifest().name).toBe("Cata Club");
  });
});
