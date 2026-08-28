/**
 * Content locks for the help page's copy.
 *
 * This file used to also carry the drift check against the assistant, by
 * parsing `_FAQ_CONTENIDO` out of `chatbot_servicio.py`. There is no such
 * constant any more: the club's knowledge has one definition, and the drift
 * check moved to `knowledge-parity.test.tsx`, which compares this page's
 * RENDERED DOM against the exact bytes of the system prompt — strictly more
 * than parsing a Python literal ever proved.
 *
 * What stays here is the other half: the specific things this copy is not
 * allowed to say again. Each one is a sentence that shipped, was wrong, and
 * was corrected — a shared definition does not stop the copy from being
 * rewritten into the same mistake.
 */

import { describe, it, expect } from "vitest";
import { CLUB_PROFILE, FAQ_SCHEDULES, FAQ_SECTIONS } from "../faq-content";

describe("FAQ_SCHEDULES", () => {
  it("lists every category the club actually trains", () => {
    expect(FAQ_SCHEDULES.map((s) => s.category)).toEqual([
      "Formativo",
      "Infantil",
      "Juvenil",
      "Competitivo",
      "Adultos",
    ]);
  });

  it("says who each category is for, on what days, at what time", () => {
    for (const schedule of FAQ_SCHEDULES) {
      expect(schedule.ages.trim().length, schedule.category).toBeGreaterThan(0);
      expect(schedule.days.trim().length, schedule.category).toBeGreaterThan(0);
      expect(schedule.hours, schedule.category).toMatch(/\d{2}:\d{2} a \d{2}:\d{2}/);
    }
  });
});

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

  it("no longer tells a representante they cannot correct the medical record themselves", () => {
    // FIC-4: the backend already authorized a representante to read/correct a
    // representado's ficha médica, and `/student/medical-record` now mounts
    // the screen — this entry used to flatly say "No", which became a lie the
    // moment the screen shipped. See `docs/archive/fixes/13-ficha-medica-representante.md`.
    const entry = FAQ_SECTIONS.flatMap((s) => s.entries).find(
      (e) => e.question === "Necesito corregir la ficha médica. ¿Puedo hacerlo yo?",
    );
    expect(entry).toBeDefined();
    expect(entry!.answer).toMatch(/representante.*(s[ií]|puede)/i);
    expect(entry!.answer.toLowerCase().trim().startsWith("no:")).toBe(false);
  });

  it("opens the medical-record answer with the condition, not with a flat 'Sí' (#315 hallazgo #69)", () => {
    // The account reading this can be a minor's own — for that reader the
    // true answer is "no". Opening with "Sí." teaches the wrong thing before
    // the sentence that corrects it ever arrives.
    const entry = FAQ_SECTIONS.flatMap((s) => s.entries).find(
      (e) => e.question === "Necesito corregir la ficha médica. ¿Puedo hacerlo yo?",
    );
    expect(entry).toBeDefined();
    expect(entry!.answer.trim().startsWith("Sí.")).toBe(false);
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
