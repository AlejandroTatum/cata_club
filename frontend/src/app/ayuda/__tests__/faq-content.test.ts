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
import { buildUstedRegisterRegex } from "@/lib/__tests__/usted-register-lock";

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
      "Si eres jugador o representante",
      "Si eres entrenador",
      "Si eres administrador",
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
    expect(entry!.answer).toMatch(/^Sí, si gestionas tu propia cuenta o representas al jugador\./);
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
    expect(entry!.answer.trim().startsWith("Sí, si gestionas")).toBe(true);
  });

  it("never teaches the batch-approval flow /payments does not have (#315 hallazgo #13)", () => {
    // PR #298 removed the payment queue's batch-selection affordance.
    // /payments itself has a regression proving no checkbox/lote UI exists
    // (PaymentsPage.test.tsx, "sumar a un lote" / "aprobación por lote"); this
    // is the FAQ-side half — the copy that kept teaching the removed flow.
    const entry = FAQ_SECTIONS.flatMap((s) => s.entries).find(
      (e) => e.question === "Tengo muchos pagos iguales. ¿Debo aprobarlos uno por uno?",
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

describe("FAQ screen names (TXT-14, ENT-18)", () => {
  const everything = FAQ_SECTIONS.flatMap((s) => s.entries.flatMap((e) => [e.question, e.answer])).join("\n");

  it.each(["Membresías y Pagos", "Historial Asistencia", "Abre Asistencia", "Mi Cuenta", "de a uno", "en Horarios"])(
    "never says «%s», which is not what the menu or the club says",
    (phrase) => {
      expect(everything).not.toContain(phrase);
    },
  );

  it("names the real screens", () => {
    expect(everything).toContain("Abre Pagos");
    expect(everything).toContain("Pasar lista → Historial");
    expect(everything).toContain("Abre Pasar lista");
    expect(everything).toContain("Grupos y horarios");
    expect(everything).toContain("uno por uno");
  });

  it("tells the trainer who corrects a saved list", () => {
    expect(everything).toMatch(/solo administración puede corregirla/);
  });
});

describe("admin answers for the catalog, the public site and the activity screen (QA4 ADMB-18)", () => {
  const admin = FAQ_SECTIONS.find((s) => s.title === "Si eres administrador")!;
  const answerOf = (question: string): string => {
    const entry = admin.entries.find((e) => e.question === question);
    expect(entry, question).toBeDefined();
    return entry!.answer;
  };

  it.each([
    "¿Qué pasa si oculto una tarifa?",
    "¿Por qué no puedo eliminar una tarifa?",
    "¿Qué pasa si oculto un descuento?",
    "¿Por qué no puedo eliminar un descuento?",
    "¿Cómo oculto una categoría de la página pública?",
    "¿Cómo cambio las fotos de la página pública?",
    "¿Qué muestra «Actividad del club»?",
  ])("answers «%s» in the administrator section", (question) => {
    expect(answerOf(question).length).toBeGreaterThan(40);
  });

  it("says a hidden tariff keeps charging whoever already has it, and can come back", () => {
    const answer = answerOf("¿Qué pasa si oculto una tarifa?");
    expect(answer).toContain("siguen pagando igual");
    expect(answer).toContain("Mostrar");
  });

  it("explains that only a tariff or discount nobody used can be deleted, and offers hiding instead", () => {
    for (const question of ["¿Por qué no puedo eliminar una tarifa?", "¿Por qué no puedo eliminar un descuento?"]) {
      const answer = answerOf(question);
      expect(answer).toMatch(/nadie|nunca se usó/);
      expect(answer).toContain("Ocultar");
    }
  });

  it("says a hidden discount cannot go to anyone new but stays on whoever has it", () => {
    const answer = answerOf("¿Qué pasa si oculto un descuento?");
    expect(answer).toContain("a nadie nuevo");
    expect(answer).toContain("ya lo tienen");
  });

  it("says a new category starts hidden and where to show or hide it", () => {
    const answer = answerOf("¿Cómo oculto una categoría de la página pública?");
    expect(answer).toContain("Grupos y horarios");
    expect(answer).toContain("Ocultar del sitio");
    expect(answer).toMatch(/nueva.*oculta/i);
  });

  it("names the gallery and sponsors screens, the file rule, and that a photo is replaced by deleting and uploading", () => {
    const answer = answerOf("¿Cómo cambio las fotos de la página pública?");
    expect(answer).toContain("Galería");
    expect(answer).toContain("Patrocinadores");
    expect(answer).toContain("JPG o PNG");
    expect(answer).toContain("5 MB");
  });

  it("describes the activity screen's two views and its periods", () => {
    const answer = answerOf("¿Qué muestra «Actividad del club»?");
    expect(answer).toContain("Resumen");
    expect(answer).toContain("Métricas avanzadas");
    expect(answer).toContain("solo lectura");
  });

  it("keeps the new copy in «tú»", () => {
    const text = admin.entries.map((e) => `${e.question} ${e.answer}`).join(" ");
    expect(text).not.toMatch(buildUstedRegisterRegex());
  });
});
