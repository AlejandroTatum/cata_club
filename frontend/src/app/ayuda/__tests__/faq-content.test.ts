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

  it("names sections the way the menu does, never by route", () => {
    // The assistant is under explicit instruction never to mention a path;
    // a help page that does would contradict it in the same breath.
    const everything = FAQ_SECTIONS.flatMap((s) => s.entries.map((e) => `${e.question} ${e.answer}`));

    for (const text of everything) {
      expect(text).not.toMatch(/\/(student|trainer|payments|groups|members|admin)\b/);
    }
  });
});
