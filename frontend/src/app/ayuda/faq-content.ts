/**
 * The club's knowledge, typed for the help page.
 *
 * ## Why this file no longer holds any copy
 *
 * It used to hold its own transcription of the FAQ, beside a second one in the
 * assistant's `_FAQ_CONTENIDO` and a third in the chat's quick replies. Three
 * copies nobody synchronised: change a schedule or a price and you had to
 * remember all three, and touching one left the assistant contradicting this
 * page — answering the old value, confidently, with nothing turning red.
 *
 * There is a single definition now:
 * `backend/app/servicios_negocio/conocimiento_club.json`. This module is a
 * typed projection of it and nothing else — the strings live in the JSON, and
 * the interfaces below are what makes `tsc` reject a JSON whose shape drifted
 * (`resolveJsonModule` infers the literal type of the file's contents, so the
 * assignments at the bottom are real compile-time checks, not casts).
 *
 * ## Why the import points at a mirror inside `src/`
 *
 * Docker builds this app from the `./frontend` context alone
 * (`docker-compose.override.yml`, and the two image jobs in CI), so a file
 * outside this tree — including the canonical one in `backend/` — cannot be
 * imported at build time. `src/data/club-knowledge.json` is a byte-for-byte
 * copy written by `backend/scripts/sincronizar_conocimiento.py`.
 *
 * Two guards keep that copy honest, neither of which relies on anyone
 * remembering: the backend suite compares the two files byte for byte, and
 * `__tests__/knowledge-parity.test.tsx` compares this page's rendered DOM
 * against the exact bytes of the assistant's system prompt — a stale mirror
 * renders stale content and fails there too.
 */

import knowledge from "@/data/club-knowledge.json";

export interface FaqSchedule {
  /** The category, as the club names it. */
  category: string;
  /** Who it is for, in plain words. */
  ages: string;
  days: string;
  hours: string;
}

export interface FaqEntry {
  question: string;
  answer: string;
}

export interface FaqSection {
  /** Who this section is for, named the way the club would say it. */
  title: string;
  entries: FaqEntry[];
}

/** A club value: what it is called, and what the club means by it. */
export interface ClubValue {
  name: string;
  description: string;
}

/**
 * What the club says about itself, where it is, and how to reach it.
 *
 * The help page states these for a reader; the assistant is given the same
 * ones, so it can answer "¿dónde queda?" and "¿a qué número escribo?" — two
 * questions it used to refuse while the landing had been answering them for
 * months.
 */
export interface ClubProfile {
  summary: string;
  mission: string;
  vision: string;
  values: ClubValue[];
  address: string;
  landmark: string;
  plusCode: string;
  whatsapp: string[];
  facebook: string;
  instagram: string;
  contactNote: string;
}

/**
 * Fixed club training times. Kept in the same order the canonical file lists
 * them — youngest first — because that is the order a parent scans.
 */
export const FAQ_SCHEDULES: FaqSchedule[] = knowledge.horarios.map(
  (schedule): FaqSchedule => ({
    category: schedule.categoria,
    ages: schedule.edades,
    days: schedule.dias,
    hours: schedule.horas,
  }),
);

export const FAQ_SECTIONS: FaqSection[] = knowledge.faq.map(
  (section): FaqSection => ({
    title: section.titulo,
    entries: section.entradas.map(
      (entry): FaqEntry => ({ question: entry.pregunta, answer: entry.respuesta }),
    ),
  }),
);

export const CLUB_PROFILE: ClubProfile = {
  summary: knowledge.club.resumen,
  mission: knowledge.club.mision,
  vision: knowledge.club.vision,
  values: knowledge.club.valores.map(
    (value): ClubValue => ({ name: value.nombre, description: value.descripcion }),
  ),
  address: knowledge.ubicacion.direccion,
  landmark: knowledge.ubicacion.referencia,
  plusCode: knowledge.ubicacion.plus_code,
  whatsapp: knowledge.contacto.whatsapp,
  facebook: knowledge.contacto.facebook,
  instagram: knowledge.contacto.instagram,
  contactNote: knowledge.contacto.nota,
};
