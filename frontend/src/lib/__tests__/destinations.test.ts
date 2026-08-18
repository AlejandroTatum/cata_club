/**
 * The destination registry, and the two things it exists to make impossible.
 *
 * ## What was wrong
 *
 * Every back control in the product wrote its own label by hand, so the same
 * destination answered to as many names as it had callers. `/trainer` had
 * THREE — "Mi día" in the trainer's rail, "Panel del Entrenador" on the roll
 * call's top control, "Panel" on the same screen's empty state — and the four
 * back labels that named a section did it in four capitalisations ("Iniciar
 * Sesión", "Mi Cuenta", "la cola", "inicio"). None of that was a bug anyone
 * introduced; it is what hand-written copy does across eleven files.
 *
 * ## The two locks below
 *
 * 1. **`backLabel` reads off the registry.** The expected phrases are written
 *    out in full here rather than derived from the same two fields the
 *    implementation reads — a test that recomputes `Volver ${preposition}
 *    ${label}` would agree with any preposition the registry happened to hold,
 *    including the wrong one. `a + el` contracts in Spanish and the contraction
 *    is the part a table can get wrong, so the table is the assertion.
 *
 * 2. **Nothing may hand-write a label again.** `BackLink` no longer offers the
 *    prop, so TypeScript already refuses it — but the prop is one commit away
 *    from coming back, and the sweep is what notices. Same shape and same
 *    reason as `components/ui/__tests__/button-variants.test.ts`: fixing the
 *    ten call sites proves nothing about the eleventh.
 *
 * And the agreement that makes both worth having: the rail draws its rows from
 * this registry too, so "the rail and the back control say the same name" is a
 * property of the data, not a habit someone has to keep.
 */

import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DESTINATIONS, backLabel, destinationLabel } from "../destinations";
import { getNavGroupsForRoles, type NavLinkDef } from "../auth-utils";
import type { UserRole } from "@/types/domain";

const SRC = join(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// 1. The phrase, written out rather than recomputed
// ---------------------------------------------------------------------------

/**
 * Every destination the registry names, with the sentence a back control says
 * when it points there. Transcribed by hand on purpose — see the module doc.
 */
const EXPECTED_PHRASES: Record<string, string> = {
  "/": "Volver al Inicio",
  "/login": "Volver a Iniciar sesión",
  "/dashboard": "Volver al Panel de Control",
  "/members": "Volver a Miembros",
  "/groups": "Volver a Horarios",
  "/payments": "Volver a Membresías y Pagos",
  "/discounts": "Volver a Descuentos",
  "/attendance": "Volver a Asistencias",
  "/reports": "Volver a Reportes",
  "/trainer": "Volver a Mi día",
  // Sin "/trainer/attendance": el asistente para tomar la lista dejó de
  // ofrecerse desde la interfaz mientras se rehace dentro del área de
  // miembros, así que el registro ya no lo nombra. La ausencia se sostiene
  // sola — la prueba de abajo compara las dos listas en los dos sentidos.
  "/trainer/attendance/history": "Volver al Historial",
  // Plural común, sin artículo: la preposición es "a", igual que "Volver a
  // Miembros". El nombre dice "del club" a propósito — el club no asigna
  // entrenadores a horarios, así que "Sus alumnos" sería una promesa que el
  // dato no respalda (ver `ficha_medica_router.py`).
  "/trainer/students": "Volver a Alumnos del club",
  "/student": "Volver a Mi cuenta",
  "/student/payments": "Volver a Pagos",
  "/student/attendance": "Volver a Asistencias",
  "/student/medical-record": "Volver a Ficha médica",
};

describe("backLabel names the destination, with the contraction where Spanish wants one", () => {
  it("covers exactly the destinations the registry holds, no more and no fewer", () => {
    // A registry entry with no expected phrase here is an entry nobody spelled
    // out; a phrase with no entry is a destination that was deleted and left a
    // caller behind. Both are the same failure from opposite ends.
    expect(Object.keys(DESTINATIONS).sort()).toEqual(Object.keys(EXPECTED_PHRASES).sort());
  });

  it.each(Object.entries(EXPECTED_PHRASES))("says %s → %s", (href, phrase) => {
    expect(backLabel(href)).toBe(phrase);
  });

  it("contracts a + el into al, and never writes the two words apart", () => {
    // The one rule the `preposition` field encodes. If it ever regressed the
    // table above would already be red, but this states WHAT is being asserted
    // rather than leaving it implicit in sixteen strings.
    for (const phrase of Object.values(EXPECTED_PHRASES)) {
      expect(phrase).not.toMatch(/\bVolver a el\b/);
    }
  });
});

describe("backLabel refuses a destination it cannot name", () => {
  // The guard `BackLink` used to carry against a bare "Volver", moved to where
  // the label is now made. A control that does not say where it goes is not a
  // promise, and an href nobody registered is exactly that control.
  it("throws for an href that is not in the registry", () => {
    expect(() => backLabel("/queue")).toThrow(/\/queue/);
  });

  it("names the registry in the message, so the fix is obvious from the failure", () => {
    expect(() => backLabel("/nowhere")).toThrow(/destinations/i);
  });

  it("does not fall back to a bare Volver", () => {
    let thrown = "";
    try {
      backLabel("/nowhere");
    } catch (error) {
      thrown = (error as Error).message;
    }
    expect(thrown).not.toBe("Volver");
    expect(thrown.length).toBeGreaterThan(0);
  });

  /**
   * The other half of the guard, and the reason it is not a throw everywhere.
   *
   * This runs INSIDE the page, so throwing in production would cost the visitor
   * the whole screen over a missing table row — while the degraded label costs
   * them one vaguer word on a control that still navigates correctly. The
   * failure is worth a broken build, not a broken session, so it is loud in
   * dev, in this suite and in `next build`, and survivable in front of a person.
   *
   * `vi.stubEnv` rather than assigning `process.env.NODE_ENV` by hand: Node
   * refuses a non-enumerable descriptor there, and leaving the whole suite in
   * production mode from here on would silence every other guard written this
   * way. The `finally` restores it even if the assertion fails.
   */
  it("degrades to the bare verb in production instead of taking down the page", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.stubEnv("NODE_ENV", "production");
      expect(backLabel("/nowhere")).toBe("Volver");
      // Degraded, not silent: the missing row still has to be findable.
      expect(errors).toHaveBeenCalledWith(expect.stringContaining("/nowhere"));
    } finally {
      vi.unstubAllEnvs();
      errors.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. One destination, one name — the rail reads the same registry
// ---------------------------------------------------------------------------

const ROLE_SETS: (UserRole[] | null)[] = [
  null,
  ["admin"],
  ["trainer"],
  ["representante"],
  ["estudiante"],
  ["unsupported"],
  // A merged group is still made of rows, and a row that only ever appears for
  // someone with two roles can drift from the registry like any other.
  ["trainer", "estudiante"],
  ["representante", "estudiante"],
];

/**
 * Every row the rail can draw, for every role set, flattened out of its groups.
 *
 * `true` so the age-gated student row is drawn too — a destination that only
 * appears for adults is still a destination that can drift.
 */
function railRows(): NavLinkDef[] {
  return ROLE_SETS.flatMap((roles) =>
    getNavGroupsForRoles(roles, true).flatMap((group) => group.links),
  );
}

describe("no destination in the registry answers to two names", () => {
  it("draws every rail row from the registry, so the rail cannot disagree with it", () => {
    const disagreements = railRows().flatMap((link) =>
      // An unregistered href is the NEXT test's failure, not this one's —
      // `destinationLabel` throws on one, which would replace this list of
      // disagreements with a stack trace naming a different defect.
      !(link.href in DESTINATIONS) || link.label === destinationLabel(link.href)
        ? []
        : [
            `${link.href}: rail says "${link.label}", registry says "${destinationLabel(link.href)}"`,
          ],
    );
    expect(disagreements).toEqual([]);
  });

  it("has a registry entry for every row the rail can draw", () => {
    const unregistered = railRows()
      .map((link) => link.href)
      .filter((href) => !(href in DESTINATIONS));
    expect(unregistered).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. The sweep — nothing in src/ writes a back label by hand
// ---------------------------------------------------------------------------

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

/**
 * Prose is not code, and the note above `student/enroll`'s back control is nine
 * lines long explaining which destination it picks and why. A guard that fires
 * on the explanation of its own rule teaches people to delete the explanation.
 *
 * Blanked in place rather than cut out, so the line numbers reported below are
 * the line numbers an editor will jump to. Lifted verbatim from
 * `components/ui/__tests__/button-variants.test.ts`, which needs the same
 * treatment for the same reason.
 */
function blankComments(text: string): string {
  const blank = (match: string): string => match.replace(/[^\n]/g, " ");
  return text
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])(\/\/.*)$/gm, (_m, before: string, comment: string) => before + blank(comment));
}

describe("no file in src/ hand-writes a back label", () => {
  const offenders = sourceFiles(SRC).flatMap((path) => {
    const source = blankComments(readFileSync(path, "utf8"));
    const found: string[] = [];
    // The opening tag only — non-greedy to the first `>`, which covers both
    // `<BackLink … />` and a hypothetical `<BackLink …>`. Attributes are all
    // simple expressions here, so no `>` hides inside one.
    for (const element of source.matchAll(/<BackLink\b[\s\S]*?>/g)) {
      const attribute = /\blabel\s*=/.exec(element[0]);
      if (!attribute) continue;
      const at = (element.index ?? 0) + attribute.index;
      const line = source.slice(0, at).split("\n").length;
      found.push(`${path.slice(SRC.length + 1)}:${line}`);
    }
    return found;
  });

  it("names the file and the line of anything that does", () => {
    // Reported as `path:line` rather than as a count: the fix is per site — the
    // label comes off the href now, and whoever reads the site is the only one
    // who can confirm the href is the destination the copy used to claim.
    expect(offenders).toEqual([]);
  });

  it("does not offer the prop that would let one back in", () => {
    const props = /export interface BackLinkProps \{([\s\S]*?)\n\}/.exec(
      readFileSync(join(SRC, "components", "ui", "BackLink.tsx"), "utf8"),
    )?.[1];
    expect(props).toBeDefined();
    expect(props).not.toMatch(/^\s*label\??:/m);
  });
});
