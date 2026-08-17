/**
 * The help page and the assistant must not disagree about the club.
 *
 * `_FAQ_CONTENIDO` in `backend/app/servicios_negocio/chatbot_servicio.py` is
 * the authority — the same text the assistant is grounded in — and there is no
 * endpoint that serves it, so the page holds a copy. This is what keeps the
 * copy honest about the part that would actually hurt: the training times a
 * family plans their week around. A page that says 15:00 while the assistant
 * says 16:00 is worse than a page that says nothing.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FAQ_SCHEDULES, FAQ_SECTIONS } from "../faq-content";

const BACKEND_FAQ = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "backend",
  "app",
  "servicios_negocio",
  "chatbot_servicio.py",
);

describe("FAQ_SCHEDULES", () => {
  it("can see the backend's FAQ at all", () => {
    // If this fails the path moved, and every assertion below is vacuous.
    expect(existsSync(BACKEND_FAQ)).toBe(true);
  });

  it("lists every category the club actually trains", () => {
    expect(FAQ_SCHEDULES.map((s) => s.category)).toEqual([
      "Formativo",
      "Infantil",
      "Juvenil",
      "Competitivo",
      "Adultos",
    ]);
  });

  it("states the same times the assistant states", () => {
    const backend = readFileSync(BACKEND_FAQ, "utf8");

    for (const schedule of FAQ_SCHEDULES) {
      // The backend writes each row as "Categoría (edades): Días, de HH:MM a
      // HH:MM." — the times are what must match; the prose around them is
      // free to be worded differently on a page than in a chat answer.
      const line = backend
        .split("\n")
        .find((candidate) => candidate.trim().startsWith(`- ${schedule.category} (`));

      expect(line, `no schedule line for ${schedule.category}`).toBeDefined();
      expect(line, `${schedule.category} hours drifted`).toContain(schedule.hours);
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
