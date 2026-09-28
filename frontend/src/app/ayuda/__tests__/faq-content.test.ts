/**
 * Content locks for the help page's copy.
 *
 * The club's knowledge has one definition, and the drift check that guards it
 * lives in `knowledge-parity.test.tsx`, which compares this page's RENDERED
 * DOM against the exact bytes of the system prompt — a stronger check than
 * parsing a source literal ever proved.
 *
 * What stays here is the other half: the specific things this copy is not
 * allowed to say again. Each one is a sentence that shipped, was wrong, and
 * was corrected — a shared definition does not stop the copy from being
 * rewritten into the same mistake.
 *
 * Schedules are no longer copy anywhere in this page's sources (#1374): the
 * table renders the live catalog fetched from `GET /api/schedules`, so the
 * schedule literals this file used to lock were removed with their surface.
 */

import { describe, it, expect } from "vitest";
import { CLUB_PROFILE, FAQ_SECTIONS } from "../faq-content";

describe("CLUB_PROFILE", () => {
  it("quotes no price, because the club's plans are not written down here", () => {
    // Plans are priced in the database (`tipo_membresia`) and change between
    // seasons. A figure typed into shared knowledge is a figure the assistant
    // would state with total confidence long after it stopped being true.
    const everything = [
      CLUB_PROFILE.summary,
      CLUB_PROFILE.mission,
      CLUB_PROFILE.vision,
      CLUB_PROFILE.contactNote,
      ...FAQ_SECTIONS.flatMap((s) => s.entries.map((e) => e.answer)),
    ].join(" ");

    expect(everything).not.toMatch(/\$\s?\d|USD\s?\d|\d+\s?(dólares|d[oó]lares)/i);
  });

  it("keeps the two ways to reach a person the landing already publishes", () => {
    expect(CLUB_PROFILE.whatsapp.length).toBeGreaterThan(0);
    for (const number of CLUB_PROFILE.whatsapp) {
      expect(number).toMatch(/^09\d{8}$/);
    }
  });
});

describe("FAQ_SECTIONS", () => {
  it("covers every role that has a screen", () => {
    expect(FAQ_SECTIONS.map((s) => s.title)).toEqual([
      "Para empezar",
      "Si es estudiante o representante",
      "Si es entrenador",
      "Si es administrador",
    ]);
  });

  it("asks a question in every entry, and answers it", () => {
    for (const section of FAQ_SECTIONS) {
      expect(section.entries.length).toBeGreaterThan(0);
      for (const entry of section.entries) {
        expect(entry.question).toMatch(/\?$|\. ¿|¿/);
        expect(entry.answer.length).toBeGreaterThan(20);
      }
    }
  });

  it("states who can correct the medical record, in the owner-approved words (#1374 C3)", () => {
    const entry = FAQ_SECTIONS.flatMap((s) => s.entries).find(
      (e) => e.question === "Necesito corregir la ficha médica. ¿Puedo hacerlo yo?",
    );
    expect(entry).toBeDefined();
    // The approved copy opens with the condition and names both people who
    // can act — the old copy's lie (a flat "No") must not come back.
    expect(entry!.answer).toMatch(/^Sí, si gestiona su propia cuenta o representa al estudiante\./);
    expect(entry!.answer).toContain("su representante o un administrador");
    expect(entry!.answer.toLowerCase().trim().startsWith("no:")).toBe(false);
  });

  it("keeps the condition in the medical-record answer's first breath (#315 hallazgo #69)", () => {
    // A minor's own account reads this: the condition must ride in the first
    // sentence, never after a flat "Sí". The approved copy satisfies it by
    // opening with the condition itself.
    const entry = FAQ_SECTIONS.flatMap((s) => s.entries).find(
      (e) => e.question === "Necesito corregir la ficha médica. ¿Puedo hacerlo yo?",
    );
    expect(entry).toBeDefined();
    expect(entry!.answer.trim().startsWith("Sí.")).toBe(false);
    expect(entry!.answer.trim().startsWith("Sí, si gestiona")).toBe(true);
  });

  it("never teaches the batch-approval flow /payments does not have (#315 hallazgo #13)", () => {
    // PR #298 removed the payment queue's batch-selection affordance.
    // /payments itself has a regression proving no checkbox/lote UI exists
    // (PaymentsPage.test.tsx, "sumar a un lote" / "aprobación por lote"); this
    // is the FAQ-side half — the copy that kept teaching the removed flow.
    const entry = FAQ_SECTIONS.flatMap((s) => s.entries).find(
      (e) => e.question === "Tengo muchos pagos iguales. ¿Debo aprobarlos de a uno?",
    );
    expect(entry).toBeDefined();
    expect(entry!.answer).not.toMatch(/selecciona(r)? varios|lote|aprobarlos juntos/i);
  });

  it("names the schedules screen the way the nav does, never 'Gestión de Horarios' (#315 hallazgo #37)", () => {
    // The nav entry and the page title are both exactly "Horarios"
    // (`lib/auth-utils.ts`, `app/groups/layout.tsx`) — no screen in the menu
    // is called "Gestión de Horarios".
    const entry = FAQ_SECTIONS.flatMap((s) => s.entries).find(
      (e) => e.question === "¿Quién define los horarios?",
    );
    expect(entry).toBeDefined();
    expect(entry!.answer).not.toMatch(/Gestión de Horarios/i);
  });

  it("names sections the way the menu does, never by route", () => {
    // The assistant is under explicit instruction never to mention a path;
    // a help page that does would contradict it in the same breath.
    const everything = FAQ_SECTIONS.flatMap((s) => s.entries.map((e) => `${e.question} ${e.answer}`));

    for (const text of everything) {
      expect(text).not.toMatch(/\/(student|trainer|payments|groups|members|admin)\b/);
    }
  });
});
