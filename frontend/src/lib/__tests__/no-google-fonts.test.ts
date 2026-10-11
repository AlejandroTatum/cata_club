/**
 * Every font is self-hosted.
 *
 * `next/font/google` downloads the family from fonts.googleapis.com and
 * fonts.gstatic.com at build time. That makes a build depend on a third party
 * being reachable, and it sends the build machine's address to Google.
 * Switzer, Anybody and the landing's faces are vendored under `app/fonts/` and
 * loaded through `next/font/local`; this scan keeps a Google import from coming
 * back in any source file, the landing included.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      found.push(...sourceFiles(full));
      continue;
    }
    if (/\.(tsx?|jsx?|mjs|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

describe("self-hosted fonts", () => {
  it("no source file imports next/font/google", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => /next\/font\/google/.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it("no stylesheet or source file points at the Google Fonts hosts", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) =>
        /fonts\.(googleapis|gstatic)\.com/.test(readFileSync(file, "utf8")),
      )
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});
