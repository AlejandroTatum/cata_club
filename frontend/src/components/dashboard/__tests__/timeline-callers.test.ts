/**
 * The admin dashboard and the trainer page draw the day with the one shared
 * `Timeline`, so both inherit its sticker identity. Neither page may re-skin
 * the track or its "Ahora" marker from the outside (the admin used to paint the
 * pill coal with an arbitrary-variant override).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string): string => readFileSync(join(__dirname, "../../..", relative), "utf8");

describe.each([
  ["admin dashboard", "app/dashboard/page.tsx"],
  ["trainer page", "app/trainer/page.tsx"],
])("%s timeline", (_name, file) => {
  const source = read(file);

  it("renders the shared Timeline", () => {
    expect(source).toMatch(/<Timeline\b/);
  });

  it("does not restyle the track's blocks, legend or Ahora marker from outside", () => {
    expect(source).not.toContain("timeline-now-label");
    expect(source).not.toContain("timeline-block");
    expect(source).not.toMatch(/Timeline[^]{0,400}className="[^"]*\bbg-(state|cuenta)-/);
  });
});
