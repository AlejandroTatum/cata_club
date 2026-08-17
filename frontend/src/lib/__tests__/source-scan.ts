/**
 * Shared "walk the app and pull out what a reader could see" scanner.
 *
 * Extracted out of ui-vocabulary.test.ts (the backend-vocabulary-leak lock)
 * so a second copy lock — usted-register.test.ts — doesn't reinvent the same
 * walker and the same "what counts as prose" heuristic. Both locks care
 * about the same thing: is this literal something a person reading the
 * screen would actually see? Only the word list changes between them.
 *
 * Lives inside a `__tests__` directory on purpose: `sourceFiles()` itself
 * skips every `__tests__` directory, so a shared helper that sat anywhere
 * else under `src` would have to scan (and specifically exclude) itself.
 * Putting it here means the walker's own exclusion rule keeps it out of
 * scope for free.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface SourceFilesOptions {
  /** Path substrings to exclude, beyond the built-in `__tests__`/`.test.` skip. */
  exclude?: string[];
}

/** Every `.ts`/`.tsx` source file under `dir`, test files and dirs excluded. */
export function sourceFiles(dir: string, opts: SourceFilesOptions = {}): string[] {
  const exclude = opts.exclude ?? [];
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      found.push(...sourceFiles(full, opts));
      continue;
    }
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(full);
  }
  return found.filter((path) => !exclude.some((ex) => path.includes(ex)));
}

/** A line of code, told apart from a line of prose by how it ends. */
const IS_A_STATEMENT = /[;,{}()]\s*$|=>|\s=\s/;

/**
 * Everything a reader could end up looking at: double-quoted literals AND JSX
 * text nodes. The text nodes are the half that matters most — copy can be
 * bare prose between two tags, with no quotes around it for a literal-only
 * scan to find.
 *
 * Deliberately does NOT extract backtick template literals: an interpolated
 * `${SOME_CONSTANT_NAME}` rides along as inert text in the OUTPUT, but its
 * raw source spelling can still contain a banned substring (e.g.
 * `EDAD_MAXIMA_ALUMNO` contains "ALUMNO") that never actually reaches the
 * screen — ui-vocabulary.test.ts's own consumer matches by substring, so
 * that false positive is real, not hypothetical. Callers that need template
 * literals (a stricter, word-boundary-only consumer can afford them) extract
 * them themselves instead of widening this shared, substring-matching one.
 */
export function readableText(text: string): string[] {
  const lines = text.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));
  return lines.flatMap((line) => [
    // Both patterns are line-bounded. Letting them span newlines made a single
    // match swallow a whole JSX block, which reports the offending file but
    // buries the sentence that is actually wrong.
    ...(line.match(/"[^"\n]{4,}"/g) ?? []),
    ...(line.match(/>[^<>{}\n]{4,}</g) ?? []),
    // A text node on its own line, between tags that sit on the lines around
    // it — the shape almost all of this product's copy is written in.
    //
    // `IS_A_STATEMENT` is what keeps a bare line of code out: a bare line of
    // code is indistinguishable from prose by its first character, but not
    // by its last one. Sentences do not end in a semicolon.
    ...(/^\s*[A-Za-zÁÉÍÓÚÑáéíóúñ][^<>{}"]{6,}$/.test(line) && !IS_A_STATEMENT.test(line)
      ? [line.trim()]
      : []),
  ]);
}
