/**
 * The public site's navigation — one definition, two renderings.
 *
 * Why this exists: the same six-item menu was written twice, as a literal in
 * `app/landing/LandingPage.tsx` and another in `components/Header.tsx`, and the
 * two drifted apart (issue #771). The landing offered Inicio · Horarios ·
 * Valores · Logros · Galería · Contacto; every other page offered Inicio ·
 * Nosotros · Formación · Competencias · Galería · Contacto, three of whose
 * links pointed back at `#inicio` and one at `#proposito`, an id no page has.
 * A visitor stepping from `/` to `/terminos` watched the menu change.
 *
 * The landing's list won: it is what a new visitor meets first and its sections
 * are real. `NavScrollSpy` reads the same list, so the highlight can never track
 * a set of sections the navbar no longer draws.
 *
 * ## Why the href is not stored here
 *
 * Every entry names a section OF THE LANDING, and how you reach it depends on
 * where the click happens:
 *
 *  - on the landing, the section is part of the current document, so a bare
 *    `#horarios` is a same-document jump: no route change, no remount, no
 *    scroll position thrown away, and `NavScrollSpy`'s `a[href^="#"]` still
 *    matches;
 *  - from `/terminos`, that same bare fragment would name a section of the
 *    legal page, which has none — the click would do nothing at all. `/#horarios`
 *    is the whole destination: go to the landing, then to the section.
 *
 * So the list is the shared part and the href is the caller's. `siteSectionHref`
 * is correct from the landing too (same path, fragment-only difference), but the
 * landing keeps `landingSectionHref` so its anchors stay exactly what they were.
 *
 * Pure module (no React, no browser APIs).
 */

export interface SiteNavSection {
  /** The `id` of the landing element this entry scrolls to. */
  readonly id: string;
  /** The label, in the product's own language. */
  readonly label: string;
}

/**
 * The approved order. `Palmares` answers to "Logros" and `Location` to
 * "Contacto"; `#nosotros` (Misión y Visión) is deliberately not here — the
 * footer's "Nosotros" column is where that section is named.
 */
export const SITE_NAV_SECTIONS: readonly SiteNavSection[] = [
  { id: "inicio", label: "Inicio" },
  { id: "horarios", label: "Horarios" },
  { id: "valores", label: "Valores" },
  { id: "logros", label: "Logros" },
  { id: "galeria", label: "Galería" },
  { id: "contacto", label: "Contacto" },
];

/** Href for a link rendered ON the landing: a same-document fragment. */
export function landingSectionHref(section: SiteNavSection): string {
  return `#${section.id}`;
}

/** Href for a link rendered anywhere else: the landing, then the section. */
export function siteSectionHref(section: SiteNavSection): string {
  return `/#${section.id}`;
}
