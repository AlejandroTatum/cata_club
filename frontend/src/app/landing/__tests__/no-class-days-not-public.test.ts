import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Issue #1665 — the owner decided no-class days are for signed-in members only,
 * never the public landing. The API route is session-gated; this guard makes
 * sure nothing under the landing ever starts reading or rendering them.
 */
const LANDING_DIR = join(__dirname, "..");
const FORBIDDEN = /dias-sin-clase|DiaSinClase|no-class-days|diasSinClase/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sources(path);
    return /\.(ts|tsx|css)$/.test(name) ? [path] : [];
  });
}

describe("landing does not show no-class days", () => {
  it("no landing source references them", () => {
    const offenders = [...sources(LANDING_DIR), join(LANDING_DIR, "..", "page.tsx")].filter((file) =>
      FORBIDDEN.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
