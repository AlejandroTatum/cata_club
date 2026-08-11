/**
 * One place for a screen's primary action.
 *
 * It used to have three. The action sat in the header's `actions` slot on
 * attendance, groups and discounts; loose in the body on members (wedged
 * against the search field), dashboard (inside the hero) and reports (inside
 * the filter card); and was absent on payments. An admin who learned "the
 * button is at the top right" was right on three screens out of eight.
 *
 * ## Why a source rule
 *
 * Rendering the eight screens of today proves nothing about the ninth, and the
 * failure is not "this screen renders it wrong" — it is "this screen never
 * reached for the slot". `AppShell` has offered `actions` since `PageHeader`
 * existed; three screens simply did not use it. That is a shape you can read
 * off the source and cannot see in a snapshot.
 *
 * The exceptions are NAMED, not inferred. A screen with no header action has to
 * be a decision someone made, with the reason next to it — otherwise the rule
 * decays back into "some screens have one".
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..");

/** Every admin surface that draws its own `AppShell`. */
const ADMIN_SCREENS = [
  "app/dashboard/page.tsx",
  "app/members/page.tsx",
  "app/groups/page.tsx",
  "app/discounts/page.tsx",
  "app/attendance/page.tsx",
  "app/reports/page.tsx",
];

/**
 * The trainer and student surfaces that carry one, added by #43.
 *
 * Only two of the seven do, and the reason is measured rather than assumed. The
 * prototypes put a header action on five of their twelve screens and all five
 * are admin lists — `19-entrenador:62`, `21-entrenador-historial:55`,
 * `22-alumno-cuenta:60`, `23-alumno-pagos:59` and `24-alumno-asistencia:59` all
 * draw a bare `h-page` row with nothing beside it. #74 already overrode that for
 * `/dashboard` and `/reports`, on the record and for a stated reason, so the
 * question here was never "does the prototype have one" — it was "does this
 * screen's action move".
 */
const FAMILY_SCREENS = [
  // "Pasar lista" lived in two places on one screen: `.btn.xl` in the coal hero
  // when a next session existed, in the empty state's action when none did.
  "app/trainer/page.tsx",
  // Its admin twin `/attendance` has carried the identical link since #74, and
  // this screen offered no way to pass a list unless the table came back empty.
  "app/trainer/attendance/history/page.tsx",
];

/**
 * Screens whose primary action is legitimately NOT in the header, each with the
 * reason it is not. Adding a line here is the deliberate act; forgetting the
 * slot is not.
 */
const NO_HEADER_ACTION: Record<string, string> = {
  // A validation queue: the actions are per row, and the batch bar only exists
  // when there are reviewed rows to flush.
  "app/payments/page.tsx": "queue — actions are per row",
  // --- The five family screens, decided in #43 -----------------------------
  // A wizard. Its buttons are "Continuar" and "Confirmar Asistencia": they move
  // through the steps rather than act on the page, and which one is showing is
  // the step's business. A header slot would name whichever verb happened to be
  // live, or a third one that is neither.
  "app/trainer/attendance/page.tsx": "wizard — the buttons are step navigation",
  // Same shape, same reason.
  "app/student/add-dependent/page.tsx": "wizard — the buttons are step navigation",
  // The action depends on the state of the account — finish an enrolment, cover
  // a membership, nothing at all — and it is the band naming that state that
  // explains why it is being offered. Hoisted to the header it would arrive
  // without the sentence that justifies it.
  "app/student/page.tsx": "the action depends on the account state the band explains",
  // Read-only. The student consults sessions the trainer recorded; there is no
  // verb on this screen to promote.
  "app/student/attendance/page.tsx": "read-only — there is no action to hoist",
  // "Registrar un pago" is a DISCLOSURE: it opens a form in place, inside the
  // membership card that says what is being paid for. It is also absent
  // whenever a payment is already awaiting validation. A header button would be
  // missing much of the time and, when present, would point 400px down the page
  // at the form it opened.
  "app/student/payments/page.tsx": "a disclosure bound to the membership it pays",
  // Both role branches (representante's picker, estudiante's own record) end
  // in the same reused `MedicalRecordEditor` card — the same admin-owned
  // component `/members` embeds inline, with the same "Guardar ficha médica"
  // button in the same place. A header action here would duplicate a button
  // the editor already draws, for either branch.
  "app/student/medical-record/page.tsx": "the save action lives inside the reused MedicalRecordEditor card",
};

function read(path: string): string {
  return readFileSync(join(SRC, path), "utf8");
}

describe("the primary action lives in the header slot", () => {
  it.each([...ADMIN_SCREENS, ...FAMILY_SCREENS])("%s passes an actions slot", (path) => {
    expect(read(path)).toMatch(/\bactions=\{/);
  });

  it.each(Object.entries(NO_HEADER_ACTION))(
    "%s deliberately passes none — %s",
    (path) => {
      // Asserted in the negative on purpose: if one of these grows a header
      // action, the exception is stale and should be deleted rather than left
      // to describe something that is no longer true.
      expect(read(path)).not.toMatch(/\bactions=\{/);
    },
  );

  it("names every screen that draws an AppShell, so none can be forgotten", () => {
    // The guard is only as good as its list. This is what fails when a new
    // admin screen appears and nobody adds it above — the exact way the three
    // body-CTA screens went unnoticed in the first place.
    const known = new Set([
      ...ADMIN_SCREENS,
      ...FAMILY_SCREENS,
      ...Object.keys(NO_HEADER_ACTION),
    ]);

    // What is left out, and why. `/profile` and `/ayuda` reach the user through
    // their own wrappers rather than a route-level `AppShell`, and
    // `/admin/crear-cuenta` is the wizard `/members` launches. None of the three
    // has been claimed by an issue that decided its action model, and asserting
    // one here would be this file inventing a rule instead of recording one.
    const outOfScope = /^app\/(admin|ayuda|profile)\//;

    const drawsShell = sourceFiles(join(SRC, "app"))
      .map((p) => p.slice(SRC.length + 1))
      .filter((p) => /<AppShell\b/.test(read(p)))
      .filter((p) => !outOfScope.test(p));

    expect(drawsShell.filter((p) => !known.has(p))).toEqual([]);
  });
});

function sourceFiles(dir: string): string[] {
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      found.push(...sourceFiles(full));
      continue;
    }
    if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) found.push(full);
  }
  return found;
}
