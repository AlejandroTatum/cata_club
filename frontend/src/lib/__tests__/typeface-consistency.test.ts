/**
 * One typeface, everywhere in the panel.
 *
 * The owner reported text that "looks like another typeface" (sentence-case
 * "Representado por …" on /members/carnets). Nothing had changed face: the
 * `2xs` size step bundled `letterSpacing: 0.12em`, designed for uppercase
 * micro-labels, so every sentence-case use of `text-2xs` rendered with
 * label-wide letter gaps. The scans here keep that class of drift out:
 *
 *  · the `2xs` step is size + leading only; tracking is always asked for;
 *  · wide tracking is only written together with `uppercase`;
 *  · no monospace or serif face is reachable: the club's voice is Anybody.
 *
 * The landing has its own sheet and its own `--font-landing-*` faces.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import tailwindConfig from "../../../tailwind.config";

const SRC = join(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "landing") continue;
      found.push(...sourceFiles(full));
      continue;
    }
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Every string literal that could hold a class list. */
function classLiterals(code: string): string[] {
  return [...code.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
}

/** Stylesheets of the panel (the landing owns its own). */
function styleFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "landing") continue;
      found.push(...styleFiles(full));
      continue;
    }
    if (/\.css$/.test(entry)) found.push(full);
  }
  return found;
}

const WIDE_TRACKING = /(?<![\w-])tracking-(?:wide|wider|widest|caps|caps-wide)(?![\w-])/;
const UPPERCASE = /(?<![\w-])uppercase(?![\w-])/;

/** Digits with deliberate spacing, not words: the printed carnet number. */
const WIDE_TRACKING_WITHOUT_UPPERCASE = ["app/student/MemberCard.tsx"];

describe("typeface consistency", () => {
  it("the 2xs size step carries no letter spacing of its own", () => {
    const fontSize = tailwindConfig.theme?.extend?.fontSize as Record<string, [string, Record<string, string>]>;
    const [, options] = fontSize["2xs"];
    expect(options.lineHeight).toBeDefined();
    expect(options).not.toHaveProperty("letterSpacing");
  });

  it("wide tracking is only written together with uppercase", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const path = relative(SRC, file);
      if (WIDE_TRACKING_WITHOUT_UPPERCASE.includes(path)) continue;
      for (const literal of classLiterals(stripComments(readFileSync(file, "utf8")))) {
        if (WIDE_TRACKING.test(literal) && !UPPERCASE.test(literal)) offenders.push(`${path}: ${literal.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every uppercase 2xs label declares its own tracking", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const path = relative(SRC, file);
      for (const literal of classLiterals(stripComments(readFileSync(file, "utf8")))) {
        const isLabel = /(?<![\w-])text-2xs(?![\w-])/.test(literal) && UPPERCASE.test(literal);
        if (isLabel && !/(?<![\w-])tracking-/.test(literal)) offenders.push(`${path}: ${literal.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no monospace face is reachable: the product has one sans and one display face", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const code = stripComments(readFileSync(file, "utf8"));
      if (/(?<![\w-])font-mono(?![\w-])|ui-monospace|monospace|fontFamily\s*:/.test(code)) {
        offenders.push(relative(SRC, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("elements Tailwind's preflight sets in monospace opt back into the sans face", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const code = stripComments(readFileSync(file, "utf8"));
      for (const tag of code.matchAll(/<(?:kbd|code|pre|samp)\b[^>]*>/g)) {
        if (!/(?<![\w-])font-sans(?![\w-])/.test(tag[0])) offenders.push(`${relative(SRC, file)}: ${tag[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no serif face is reachable from an authenticated or auth page: the club's voice is Anybody (T14I)", () => {
    // The landing (app/landing/**, app/page.tsx) loads its own Playfair under
    // `--font-landing-playfair`; everything else is one sans and one display.
    const LANDING_ENTRY = "app/page.tsx";
    const offenders: string[] = [];
    for (const file of [...sourceFiles(SRC), ...styleFiles(SRC)]) {
      const path = relative(SRC, file);
      if (path === LANDING_ENTRY) continue;
      const code = stripComments(readFileSync(file, "utf8"));
      if (/playfair|(?<![\w-])font-serif(?![\w-])|\bGeorgia\b|\bserif\b(?!-)/i.test(code.replace(/sans-serif/gi, ""))) {
        offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);

    const families = tailwindConfig.theme?.extend?.fontFamily as Record<string, string[]>;
    expect(Object.keys(families).sort()).toEqual(["display", "sans"]);
    expect(JSON.stringify(families)).not.toMatch(/playfair/i);
  });

  it("the motto and the enrolment welcome line take their voice from Anybody weight and width", () => {
    for (const path of ["components/auth/AuthShell.tsx", "app/student/enroll/EnrollConfirmation.tsx"]) {
      const code = stripComments(readFileSync(join(SRC, path), "utf8"));
      const voice = classLiterals(code).filter((l) => /(?<![\w-])text-voice(?![\w-])/.test(l));
      expect(voice, path).toHaveLength(1);
      expect(voice[0], path).toMatch(/(?<![\w-])font-display(?![\w-])/);
      expect(voice[0], path).toMatch(/(?<![\w-])font-voice(?![\w-])/);
    }
  });

  it("draws no flag emoji and names no emoji font: an OS-dependent glyph is another typeface (RC15)", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const code = stripComments(readFileSync(file, "utf8"));
      if (/[\u{1F1E6}-\u{1F1FF}]/u.test(code) || /(?:Noto|Apple|Segoe)[ _]\w*[ _]?Emoji/i.test(code)) {
        offenders.push(relative(SRC, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
