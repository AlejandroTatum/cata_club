/**
 * Generalizes `tipo-notificacion-parity.test.ts`, `estado-membresia-parity.
 * test.ts`, and `tipo-pago-parity.test.ts` (issue #792, criterion 2): 11 of
 * the backend's 14 `(str, enum.Enum)` classes had no guard at all before
 * this file. `TipoSangre` (medical data) and `EstadoPago` (money) are two
 * of them — a value added on either side could drift silently, exactly the
 * failure mode issue #935 already caught once for `EstadoMembresia` and
 * `TipoPago`.
 *
 * `ENUM_TABLE` below is the single place that decides, per backend enum,
 * either WHERE its frontend mirror lives or WHY it deliberately has none.
 * `it("classifies every backend enum")` makes that table exhaustive: adding
 * a 15th backend enum fails this file until someone adds it to the table,
 * so a new enum can never silently go unclassified the way the other 13
 * did before this file existed.
 *
 * Parses both sides as TEXT via `@/lib/enum-parity-helpers`, for the same
 * reason the three sibling files do — see that module's docblock.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  backendEnumClassNames,
  backendEnumMembers,
  frontendUnionMembers,
} from "@/lib/enum-parity-helpers";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const BACKEND_ENUMS = join(REPO_ROOT, "backend", "app", "dominio", "enums.py");
const FRONTEND_SRC = join(REPO_ROOT, "frontend", "src");

const BACKEND_ENUMS_SOURCE = readFileSync(BACKEND_ENUMS, "utf-8");

interface FrontendMirror {
  /** Path to the frontend file, relative to `frontend/src`. */
  file: string;
  /** The `export type Name = "A" | "B" | ...;` this enum mirrors. */
  type: string;
}

/**
 * One row per backend enum. `null` is an explicit, reasoned decision that
 * the enum has no frontend mirror to compare — never an oversight, because
 * the exhaustiveness test below would fail on a genuinely missing row.
 */
const ENUM_TABLE: Record<string, FrontendMirror | null> = {
  TipoRol: { file: "types/domain.ts", type: "BackendTipoRol" },
  // DIESTRO/ZURDO: not read, sent, or otherwise referenced anywhere under
  // frontend/src — the hand form is not yet surfaced by any screen.
  TipoManoDominante: null,
  EstadoMembresia: { file: "lib/membership-status.ts", type: "BackendEstadoMembresia" },
  DiaSemana: { file: "lib/server/attendance-adapter.ts", type: "BackendDiaSemana" },
  // The backend's own docstring (enums.py) says this enum is "NOT the
  // source of truth nor a validation gate" — `categoria_horario` is, and it
  // admits codes this enum doesn't. The frontend agrees on purpose:
  // `services/categorias.ts` types `Categoria` as a plain `string`, so
  // parity here would test a constraint neither side claims to have.
  Categoria: null,
  // "PERSONALIZADA"|"MENSUAL" appears only as an inline field-literal type
  // repeated across services/api.ts — no exported `type TipoModalidad` to
  // read a member list from.
  TipoModalidad: null,
  EstadoPago: { file: "lib/server/payments-adapter.ts", type: "BackendEstadoPago" },
  TipoPago: { file: "lib/server/payments-adapter.ts", type: "BackendTipoPago" },
  EstadoAsistencia: { file: "lib/server/attendance-adapter.ts", type: "BackendEstadoAsistencia" },
  // The four school-ownership options are hand-written JSX `<option>`/object
  // literals, duplicated identically across three enrollment forms — no
  // single exported mirror exists yet to compare against.
  TipoEscuela: null,
  // Not referenced anywhere under frontend/src.
  NivelTecnicoAlumno: null,
  TipoSangre: { file: "types/domain.ts", type: "TipoSangre" },
  // Only an inline field-literal type on `CorreccionPago.efectoCobertura`
  // in services/api.ts — no exported `type EfectoCoberturaCorreccion`.
  EfectoCoberturaCorreccion: null,
  TipoNotificacion: { file: "types/domain.ts", type: "TipoNotificacion" },
};

describe("enum-parity table — exhaustiveness over the backend's enums", () => {
  const classNames = backendEnumClassNames(BACKEND_ENUMS_SOURCE);

  it("the parser actually finds the backend's enum classes", () => {
    // Guard of the guard, same role as the sibling files' first two `it`s:
    // a broken regex would make every comparison below vacuously true.
    expect(classNames.length).toBeGreaterThanOrEqual(14);
  });

  it("classifies every backend enum, and no enum that does not exist", () => {
    expect(Object.keys(ENUM_TABLE).sort()).toEqual([...classNames].sort());
  });
});

const MIRRORED_ENTRIES = Object.entries(ENUM_TABLE).filter(
  (entry): entry is [string, FrontendMirror] => entry[1] !== null,
);

describe.each(MIRRORED_ENTRIES)("%s — frontend mirror stays in sync with the backend enum", (enumName, mirror) => {
  const backend = backendEnumMembers(BACKEND_ENUMS_SOURCE, enumName);
  const frontendSource = readFileSync(join(FRONTEND_SRC, mirror.file), "utf-8");
  const frontend = frontendUnionMembers(frontendSource, mirror.type);

  it("the parser finds real members on both sides", () => {
    expect(backend.length).toBeGreaterThan(0);
    expect(frontend.length).toBeGreaterThan(0);
  });

  it("every backend value has a matching frontend literal", () => {
    const missing = backend.filter((value) => !frontend.includes(value));
    expect(missing).toEqual([]);
  });

  it("the frontend mirror names no value the backend does not emit", () => {
    const extra = frontend.filter((value) => !backend.includes(value));
    expect(extra).toEqual([]);
  });
});
