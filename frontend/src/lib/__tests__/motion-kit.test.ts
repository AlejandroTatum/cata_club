/**
 * The motion budget (T4; S3 own identity, S4 reduced motion), kept honest by
 * reading the sources:
 *
 *  · the duration tokens exist, are short, and are ALL zeroed under
 *    `prefers-reduced-motion: reduce`;
 *  · every keyframe moves `opacity`/`transform` only (no layout shift);
 *  · every animation and transition the panel declares in its stylesheet or in
 *    the Tailwind config is built from the tokens, never from a literal time,
 *    and never `all`;
 *  · the panel names no `animate-*` class outside the kit (plus the spinner);
 *  · the landing keeps its own sheet and is out of scope.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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

const GLOBALS = readFileSync(join(SRC, "app", "globals.css"), "utf8");
const extend = tailwindConfig.theme?.extend as Record<string, Record<string, unknown>>;

/** `--motion-*: <value>` declarations of a CSS block. */
function motionTokens(css: string): Record<string, string> {
  return Object.fromEntries([...css.matchAll(/(--motion-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const KIT_ANIMATIONS = ["overlay-in", "dialog-in", "sheet-in", "toast-in", "reveal", "disclose"];

describe("motion tokens", () => {
  const rootBlock = GLOBALS.match(/:root\s*\{\s*--motion-fast[^}]*\}/)?.[0] ?? "";
  const reduceBlock = GLOBALS.match(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{[^}]*\}/)?.[0] ?? "";
  const tokens = motionTokens(rootBlock);

  it("declares fast, base and overlay durations within the budget", () => {
    expect(Object.keys(tokens).sort()).toEqual(["--motion-base", "--motion-fast", "--motion-overlay"]);
    const ms = (name: string): number => Number.parseInt(tokens[name], 10);
    expect(ms("--motion-fast")).toBeLessThanOrEqual(200);
    expect(ms("--motion-base")).toBeLessThanOrEqual(200);
    expect(ms("--motion-overlay")).toBeLessThanOrEqual(300);
    expect(ms("--motion-fast")).toBeLessThan(ms("--motion-overlay"));
    expect(GLOBALS).toMatch(/--ease-out:\s*cubic-bezier\(/);
  });

  it("zeroes every duration token under prefers-reduced-motion", () => {
    expect(reduceBlock).not.toBe("");
    const zeroed = motionTokens(reduceBlock);
    for (const name of Object.keys(tokens)) expect(zeroed[name], name).toBe("0ms");
  });

  it("exposes the tokens to Tailwind as the only duration and easing words", () => {
    expect(extend.transitionDuration).toEqual({
      DEFAULT: "var(--motion-fast)",
      fast: "var(--motion-fast)",
      base: "var(--motion-base)",
      overlay: "var(--motion-overlay)",
    });
    expect(extend.transitionTimingFunction).toEqual({ "out-expo": "var(--ease-out)" });
  });
});

describe("motion kit", () => {
  it("defines the kit's animations from tokens, and nothing else", () => {
    const animation = extend.animation as Record<string, string>;
    expect(Object.keys(animation).sort()).toEqual([...KIT_ANIMATIONS].sort());
    for (const [name, value] of Object.entries(animation)) {
      expect(value, name).toMatch(/var\(--motion-(?:fast|base|overlay)\)/);
      expect(value, name).toContain("var(--ease-out)");
      expect(value, name).not.toMatch(/\d+m?s\b/);
    }
  });

  it("moves only opacity and transform in every keyframe", () => {
    const keyframes = extend.keyframes as Record<string, Record<string, Record<string, string>>>;
    for (const [name, frames] of Object.entries(keyframes)) {
      for (const [step, props] of Object.entries(frames)) {
        for (const prop of Object.keys(props)) expect(["opacity", "transform"], `${name}.${step}`).toContain(prop);
      }
    }
  });

  it("writes no literal time and no `transition: all` in the panel stylesheet", () => {
    const css = stripComments(GLOBALS);
    const declarations = [...css.matchAll(/(?<![\w-])(transition|animation)(?:-duration)?\s*:\s*([^;]+);/g)];
    expect(declarations.length).toBeGreaterThan(0);
    for (const [, prop, value] of declarations) {
      if (value.trim() === "none") continue;
      expect(value, `${prop}: ${value}`).toMatch(/var\(--motion-/);
      expect(value, `${prop}: ${value}`).not.toMatch(/(?<![\w-])all(?![\w-])|\d+(?:\.\d+)?m?s\b/);
    }
    expect(css).not.toMatch(/@apply[^;]*transition-all/);
  });

  it("uses no animate-* class in the panel outside the kit (the spinner is the one loop that stays)", () => {
    const allowed = new Set([...KIT_ANIMATIONS.map((n) => `animate-${n}`), "animate-spin", "animate-pulse"]);
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      for (const literal of classLiterals(stripComments(readFileSync(file, "utf8")))) {
        for (const [cls] of literal.matchAll(/(?<![\w-])animate-[\w-]+/g)) {
          if (!allowed.has(cls)) offenders.push(`${file.slice(SRC.length + 1)}: ${cls}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("motion kit placement", () => {
  const read = (path: string): string => stripComments(readFileSync(join(SRC, path), "utf8"));
  const OVERLAYS = [
    "components/ConfirmDialog.tsx",
    "components/PhotoViewerDialog.tsx",
    "components/ReportProblemDialog.tsx",
    "components/legal/LegalReviewDialog.tsx",
    "components/legal/LegalReacceptGate.tsx",
    "components/shell/AppShell.tsx",
    "app/groups/MoverAlumnosDialog.tsx",
    "app/payments/page.tsx",
    "app/trainer/attendance/AttendanceCorrectionDialog.tsx",
    "app/trainer/attendance/EmergencyCardDialog.tsx",
    "app/trainer/students/ScheduleDialog.tsx",
  ];

  it("every modal backdrop fades in and every panel lands or slides in", () => {
    for (const path of OVERLAYS) {
      const code = read(path);
      expect(code, path).toContain("animate-overlay-in");
      expect(code, path).toMatch(/animate-(?:dialog|sheet)-in/);
    }
  });

  it("the toast, the empty and error states and both disclosures use the kit", () => {
    expect(read("components/ToastContainer.tsx")).toContain("animate-toast-in");
    expect(read("components/ui/EmptyState.tsx").match(/animate-reveal/g)).toHaveLength(2);
    expect(read("components/ui/ErrorState.tsx")).toContain("animate-reveal");
    expect(read("components/ui/InfoPanel.tsx")).toContain("animate-disclose");
    expect(read("components/ui/Accordion.tsx")).toContain("animate-disclose");
  });

  it("names no literal duration and no transition-all anywhere in the panel", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      for (const literal of classLiterals(stripComments(readFileSync(file, "utf8")))) {
        for (const [cls] of literal.matchAll(/(?<![\w-])(?:[\w-]+:)*(?:duration-\[?\d+|delay-\d+|transition-all)/g)) {
          offenders.push(`${file.slice(SRC.length + 1)}: ${cls}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("data tables never animate: no kit class, no transition on rows while paging", () => {
    for (const path of ["components/ui/Table.tsx", "components/ui/ResponsiveListTable.tsx", "components/ui/ScrollableTable.tsx", "components/ui/Pagination.tsx"]) {
      expect(read(path), path).not.toMatch(/animate-(?:overlay-in|dialog-in|sheet-in|toast-in|reveal|disclose)/);
    }
  });

  it("the press travels on transform only and gives the travel back under reduced motion", () => {
    const button = read("components/ui/Button.tsx");
    expect(button).toContain("transition-[color,background-color,border-color,transform] duration-fast ease-out-expo");
    expect(button).not.toMatch(/box-shadow\]|duration-\d/);
    expect(button).toContain("motion-reduce:active:translate-x-0");
    expect(GLOBALS).toMatch(/\.card-hover:active\s*\{/);
    expect(GLOBALS).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.card-hover:hover,\s*\.card-hover:active/);
  });
});
