/**
 * The destination registry — every place in the product that has a NAME, and
 * the one place that name is written.
 *
 * ## Why a registry and not eleven strings
 *
 * The rail drew "Mi día" while a back control on the same screen said "Panel
 * del Entrenador" and the empty state below it said "Panel". One destination,
 * three names, none of them wrong on its own — that is simply what happens when
 * copy is written where it is rendered. Across the eleven back controls the
 * product had, four spellings of the same idea shipped: "Volver a Iniciar
 * Sesión", "Volver a Mi Cuenta", "Volver a la cola", "Volver al inicio".
 *
 * So the name moves to the data. `getNavGroupsForRoles` builds the rail's rows
 * from this table and `backLabel` builds the back control's sentence from the
 * same row, which makes "the rail and the back control agree" a property of the
 * registry rather than something eleven files have to keep remembering. D12b of
 * `docs/ux/rediseno-visual-2026-08.md` is the approved decision.
 *
 * ## It is DATA, not a grammar engine
 *
 * Two fields, and the second exists for exactly one reason: Spanish contracts
 * *a + el* into *al*, so "Volver a el Panel" is not a sentence. There is no
 * gender field, no article field and no pluralisation — a destination's
 * preposition is a fact about that destination, written down once, not derived
 * from its label at runtime. A table that can only be wrong per row is worth
 * more than a rule that can be wrong everywhere at once.
 *
 * ## What the rail does not draw
 *
 * `/` (the public site) and `/login` are here even though the authenticated
 * rail filters them out — `AppShell` drops `/`, and a signed-in user is never
 * offered `/login`. They are still destinations: the auth screens' back control
 * points at `/`, and `/forgot-password` and `/reset-password` point at
 * `/login`. The public `Header` does draw both, from this same table.
 *
 * Pure module — no React, no browser APIs, so the naming contract is unit
 * testable without mounting anything. Same reason `shell-routes.ts` next door
 * is a plain module.
 */

/** One named place: what it is called, and how a sentence reaches it. */
export interface Destination {
  /**
   * The name the rail draws. It is also the name every back control says, and
   * that is the whole point — there is no second, "friendlier" spelling for
   * prose. Capitalisation is the destination's own and is never re-cased by a
   * caller, which is what collapses the four spellings into one.
   */
  label: string;
  /**
   * `"a"` or `"al"` — see the module doc. `"al"` is the contraction, already
   * contracted; nothing downstream joins an article to anything.
   */
  preposition: "a" | "al";
}

/**
 * Keyed by the exact pathname, because that is what both consumers already
 * hold: the rail carries an `href` and the back control is GIVEN one. Matching
 * is exact rather than prefix-based (`shell-routes.ts` does the prefix work,
 * for a different question) — `/trainer/attendance` is its own destination with
 * its own name, not a descendant of `/trainer` that inherits one.
 */
export const DESTINATIONS: Record<string, Destination> = {
  /** The public site. `AuthShell`'s way out, and `/ayuda`'s. */
  "/": { label: "Inicio", preposition: "al" },
  /**
   * Sentence case, corrected here: the rail shipped "Iniciar Sesión" while
   * every other multi-word row in the product ("Mi día", "Pasar lista", "Ficha
   * médica") capitalises only the first word. It is a verb phrase, not a title.
   */
  "/login": { label: "Iniciar sesión", preposition: "a" },

  // --- Admin ---------------------------------------------------------------
  "/dashboard": { label: "Panel de Control", preposition: "al" },
  "/members": { label: "Miembros", preposition: "a" },
  "/groups": { label: "Horarios", preposition: "a" },
  "/payments": { label: "Membresías y Pagos", preposition: "a" },
  "/discounts": { label: "Descuentos", preposition: "a" },
  "/attendance": { label: "Asistencias", preposition: "a" },
  "/reports": { label: "Reportes", preposition: "a" },

  // --- Entrenador ----------------------------------------------------------
  /**
   * ONE name, and this is it. "Panel del Entrenador" and "Panel" were the other
   * two in circulation, both only ever on back controls; "Mi día" is what the
   * trainer's own rail has always drawn and what the screen titles itself, so
   * it is the name the trainer has actually learned.
   */
  "/trainer": { label: "Mi día", preposition: "a" },
  "/trainer/attendance": { label: "Pasar lista", preposition: "a" },
  "/trainer/attendance/history": { label: "Historial", preposition: "al" },
  /**
   * "Alumnos del club", no "Sus alumnos" ni "Mis alumnos".
   *
   * El club NO asigna entrenadores a horarios —
   * `backend/app/presentacion/routers/ficha_medica_router.py` lo deja escrito:
   * cualquier entrenador puede pasar lista de cualquier sesión, y por eso el
   * permiso de la ficha de emergencia es por DATO, no por "sus" alumnos. Un
   * posesivo acá prometería un recorte que el backend no hace y que el padrón
   * no trae: la pantalla muestra el club entero porque eso es lo que hay.
   */
  "/trainer/students": { label: "Alumnos del club", preposition: "a" },

  // --- Alumno / representante ----------------------------------------------
  "/student": { label: "Mi cuenta", preposition: "a" },
  "/student/payments": { label: "Pagos", preposition: "a" },
  "/student/attendance": { label: "Asistencias", preposition: "a" },
  "/student/medical-record": { label: "Ficha médica", preposition: "a" },
};

/**
 * The registered name of a destination.
 *
 * This is the guard `BackLink` used to carry against a bare "Volver", moved to
 * where the label is now made: a control that cannot say where it goes is not a
 * promise, and an href nobody registered is that control.
 *
 * ## Why it stays a development-only throw
 *
 * The obvious reading is that this can only be reached by a pathname a
 * developer wrote, never by a user's data, so it should be loud everywhere. The
 * premise is true and the conclusion still does not follow, because the two
 * failures are not the same size:
 *
 *   · throwing in production costs the visitor THE WHOLE SCREEN — this renders
 *     inside the page, so an unregistered pathname white-screens whatever the
 *     person was doing;
 *   · falling back costs them a vaguer word on one control that still
 *     navigates to the right place.
 *
 * A missing table row is worth a broken build, not a broken session. So it
 * throws where it gets caught — dev, the suite and `next build`, all three of
 * which render every screen this can appear on — and degrades where the person
 * on the other side would pay for it.
 *
 * The fallback is deliberately the WORST acceptable label rather than a clever
 * one derived from the pathname: a guessed name would read like a real promise
 * and hide the missing row for months. "Volver" alone is exactly what the rule
 * forbids, which is the point — it is visible, it is wrong, and it is survivable.
 */
export function destinationLabel(href: string): string {
  const destination = DESTINATIONS[href];
  if (!destination) {
    const message =
      `No destination is registered for "${href}" — add it to DESTINATIONS in lib/destinations.ts ` +
      "so the rail and the back control name it the same way.";
    if (process.env.NODE_ENV !== "production") throw new Error(message);
    console.error(message);
    return "";
  }
  return destination.label;
}

/**
 * The sentence a back control says when it points at `href` — "Volver a Mi
 * día", "Volver al Panel de Control".
 *
 * The verb is fixed here rather than passed in: a back control that says
 * anything other than "Volver" is a different control, and the moment the verb
 * is a parameter the destination stops being the only variable.
 */
export function backLabel(href: string): string {
  // `destinationLabel` is the one that reports, so the unregistered-href message
  // is written once and both entry points behave identically.
  const label = destinationLabel(href);
  // Only reachable in production, and only for an href nobody registered — see
  // the note above. The bare verb is the degraded state, not a supported one.
  if (!label) return "Volver";
  return `Volver ${DESTINATIONS[href].preposition} ${label}`;
}
