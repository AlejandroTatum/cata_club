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
 *  · no monospace or serif face is reachable outside the declared exceptions.
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

  it("the serif face is spent only on the club's voice phrase", () => {
    const users: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const code = stripComments(readFileSync(file, "utf8"));
      for (const literal of classLiterals(code)) {
        if (/(?<![\w-])font-serif(?![\w-])/.test(literal)) {
          expect(literal).toMatch(/(?<![\w-])text-voice(?![\w-])/);
          users.push(relative(SRC, file));
        }
      }
    }
    expect(users.sort()).toEqual(["app/student/enroll/EnrollConfirmation.tsx", "components/auth/AuthShell.tsx"]);
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
