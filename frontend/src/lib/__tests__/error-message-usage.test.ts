/**
 * No screen in this product writes its own error text.
 *
 * The unit test next door proves the translator is right. This one proves it
 * is the ONLY door — which is the half that rots. A translator nobody is
 * obliged to call gets bypassed by the next `catch` block somebody writes, and
 * the bypass is invisible: `err instanceof Error ? err.message : "…"` reads
 * like careful code. It was written 28 times.
 *
 * ## What is being detected, and why it is the read and not the render
 *
 * The thing that reaches a user is `error.message` — a string the frontend did
 * not author. Three criteria were considered:
 *
 *   · **By render** — find the JSX that prints the string. Hopeless: the value
 *     travels through `setError`, a toast, a reducer, a `message:` field in a
 *     state object, and is printed several files away. Every one of the 28
 *     sites separated the read from the render.
 *   · **By import** — require every file with a `catch` to import the
 *     translator. Both wrong: a file can import it and still render raw next
 *     to the call, and a file can catch, log, and rethrow without owing
 *     anybody a message.
 *   · **By the read itself** — the moment `.message` comes off an error. This
 *     is the one. It is the narrow waist: the string cannot reach a screen
 *     without passing through it, and it is one grep-able act.
 *
 * So the rule is: reading `.message` off a caught error is the translator's
 * privilege, and the roster below is who has it.
 *
 * ## What this deliberately does NOT check
 *
 * **`.message` on things that are not errors.** `bff-helpers.ts` and the
 * `app/api/ranking/*` route handlers read `(data as …).message` and
 * `(value as …).message` off a parsed JSON body. That is a payload field, not
 * a thrown error, and it never becomes screen text — so the patterns below are
 * anchored to error-shaped bindings (`err`, `error`, `e`) rather than to the
 * property name.
 *
 * **Whether the fallback sentence is any good.** This guard cannot judge
 * Spanish. It only enforces that whatever the user reads was written in this
 * repository, by a person, on purpose.
 *
 * **`error.status`, `error.name`, `error instanceof`.** Branching on an error
 * is fine and common (`ChatWidget` reads `.status` to pick a retry hint).
 * Only the human-readable payload is restricted.
 *
 * **A new leak that invents a fourth spelling.** Two spellings are covered —
 * the direct read and the `as`-cast read — because those are the two the
 * codebase actually used. A third would slip through until someone adds it
 * here, which is the standing price of a pattern-based guard.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..");

/**
 * The bindings a caught error is given in this codebase. Anchoring on the NAME
 * rather than on `.message` is what keeps a JSON payload's `message` field out
 * of the guard; `errorBody.message` in `api.ts` is deliberately not a match,
 * because the lookbehind demands the name END at the dot.
 */
const ERROR_BINDING = String.raw`(?:err|error|e)\d?`;

const RAW_READS: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  {
    label: "err.message",
    pattern: new RegExp(String.raw`(?<![\w.])${ERROR_BINDING}\.message\b`, "g"),
  },
  {
    // `const message = (error as Record<string, unknown>).message;` — the
    // spelling all three hand-rolled `getXErrorMessage` helpers used.
    label: "(error as …).message",
    pattern: new RegExp(
      String.raw`\([^()]{0,120}\b${ERROR_BINDING}\s+as\b[^()]{0,120}\)\.message\b`,
      "g",
    ),
  },
];

/** `error.message = "…"` writes a message; it does not show one. */
const IS_WRITE = /^\s*=[^=]/;

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      found.push(...sourceFiles(full));
      continue;
    }
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

/** Prose about `err.message` is not a read of it. */
function stripComments(text: string): string {
  return text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Every raw read of a caught error's message in one file. */
export function rawErrorMessageReads(code: string): string[] {
  const source = stripComments(code);
  const found: string[] = [];
  for (const { label, pattern } of RAW_READS) {
    for (const match of source.matchAll(pattern)) {
      const after = source.slice(match.index + match[0].length);
      if (IS_WRITE.test(after)) continue;
      found.push(label);
    }
  }
  return found;
}

const FILES = sourceFiles(SRC).map((path) => ({
  path: path.slice(SRC.length + 1).replace(/\\/g, "/"),
  code: readFileSync(path, "utf8"),
}));

const OFFENDERS = FILES.map(({ path, code }) => ({ path, reads: rawErrorMessageReads(code) }))
  .filter(({ reads }) => reads.length > 0)
  .map(({ path, reads }) => `${path}: ${reads.length} × raw error message`);

/**
 * Who may read an error's message. Exactly one file, and adding a second has
 * to be argued for here — which is the point of a roster over a glob.
 */
const ALLOWED: readonly string[] = ["lib/error-message.ts"];

describe("only the translator reads an error's message", () => {
  it("finds source files to check at all", () => {
    // Guards the guard: a broken walk makes the assertion below vacuous.
    expect(FILES.length).toBeGreaterThan(100);
  });

  it("leaves no screen rendering a message the repo did not write", () => {
    const unlisted = OFFENDERS.filter(
      (offender) => !ALLOWED.some((allowed) => offender.startsWith(`${allowed}:`)),
    );

    expect(unlisted).toEqual([]);
  });

  it("actually routes those sites through the translator", () => {
    // The other half. Deleting a `catch` block would satisfy the assertion
    // above just as well as translating it, so count the real call sites: the
    // 28 raw reads became at least this many translated ones.
    const callers = FILES.filter(({ code }) => /\btoUserMessage\s*\(/.test(stripComments(code)));

    expect(callers.length).toBeGreaterThanOrEqual(15);
  });

  it("still catches a leak — the assertions above are not vacuous", () => {
    // The exact line that existed 28 times.
    expect(
      rawErrorMessageReads('setError(err instanceof Error ? err.message : "No se pudo.");'),
    ).toEqual(["err.message"]);
    // …and the cast spelling the three hand-rolled helpers used.
    expect(
      rawErrorMessageReads("const m = (error as Record<string, unknown>).message;"),
    ).toEqual(["(error as …).message"]);

    // A translated site is clean.
    expect(rawErrorMessageReads('setError(toUserMessage(err, "No se pudo."));')).toEqual([]);
  });

  it("does not mistake a payload field or a branch for a leak", () => {
    // `api.ts` reads the parsed body, not the error — this must stay legal or
    // the guard would push the leak back into the client.
    expect(rawErrorMessageReads("message = errorBody.detail ?? errorBody.message ?? message;")).toEqual([]);
    expect(rawErrorMessageReads('typeof (data as Record<string, unknown>).message === "string"')).toEqual([]);
    // Branching on an error is not showing it.
    expect(rawErrorMessageReads("const status = error instanceof ApiClientError ? error.status : null;")).toEqual([]);
    // Writing a message is not reading one.
    expect(rawErrorMessageReads('error.message = "reemplazado";')).toEqual([]);
    // Prose about the pattern is not the pattern.
    expect(rawErrorMessageReads("// never render err.message raw\nconst a = 1;")).toEqual([]);
  });
});
