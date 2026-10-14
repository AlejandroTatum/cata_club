import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The launch notice of the payment block (#1787-f) stores a negative
 * `entidad_relacionada_id` (the player id, negated) as an idempotency mark.
 * That is only safe while no production code dereferences the field to build
 * a link or a lookup, so this pins that it stays a type-only field.
 */
const SRC = join(__dirname, "..", "..");

function productionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" ? [] : productionFiles(path);
    }
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("notification entidadRelacionadaId", () => {
  it("is only declared in the domain type, never read to build a link", () => {
    const users = productionFiles(SRC)
      .filter((file) => readFileSync(file, "utf8").includes("entidadRelacionadaId"))
      .map((file) => relative(SRC, file));

    expect(users).toEqual(["types/domain.ts"]);
  });
});
