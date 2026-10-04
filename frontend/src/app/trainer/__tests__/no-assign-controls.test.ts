/**
 * QA4 ENT-N1 (front): only administration assigns a student to a category, and
 * the backend refuses a trainer. No trainer screen may call the assign or
 * unassign client, nor offer the control: a button that always 403s is a lie.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const TRAINER_DIR = join(__dirname, "..");

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourcesUnder(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("trainer screens never offer assign/unassign (QA4 ENT-N1)", () => {
  const files = sourcesUnder(TRAINER_DIR);

  it("scans the trainer sources", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map((file) => [file.slice(TRAINER_DIR.length + 1), file]))(
    "%s does not use the assign/unassign client or copy",
    (_name, file) => {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/asignarAlumnoAHorario|desasignarAlumnoDeHorario|assignStudent|unassignStudent|asignar-alumno/);
      expect(source).not.toMatch(/>\s*(Asignar|Desasignar|Quitar) (alumno|de la categoría)/i);
    },
  );
});
