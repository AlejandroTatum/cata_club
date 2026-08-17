/**
 * IdentityCell — the initial, the name, and what the person IS at the club.
 *
 * D9 of `docs/ux/rediseno-visual-2026-08.md` settles this one in a sentence:
 * "La celda de identidad —inicial, nombre arriba, roles abajo— es una pieza
 * compartida, no un maquetado suelto: se repite en seis pantallas." Miembros,
 * the payments queue, pasar lista, the member search and the trainer's two
 * screens all open with the same cell. Existing once is the whole feature —
 * the sixth drawing of a layout is where it comes out wrong, and this file is
 * the reason there is no sixth drawing.
 *
 * ## What it is NOT
 *
 * It is not a table cell. `TableNameCell` wraps this kind of content in a
 * `<td>` and a card wraps it in nothing; a primitive that assumed one of those
 * would be a primitive half the callers had to opt out of. It renders inline
 * content and lets the surface decide what holds it.
 *
 * ## The two lines are stacked, mechanically
 *
 * The name and its companion line shipped once as two inline `<span>`s and
 * rendered on ONE row, because nothing in the markup said they were two lines.
 * So the name carries `block`, and the companion line is a `<ul>` — a
 * block-level element by the user agent stylesheet, which keeps the stacking
 * even if a caller's `className` ever fights the utility class.
 *
 * ## Why a list and not a sentence
 *
 * A person is several things at once: a representative who also plays wears
 * both labels. Rendered as running text that needs a separator invented at the
 * call site, which is precisely the drift D9 was written against.
 */

import type { ReactElement } from "react";
import type { BackendTipoRol } from "@/types/domain";
import { getUserInitials } from "@/lib/auth-utils";
import DataBox from "./DataBox";
import { cn } from "./cn";

/**
 * A role as the product already holds it — `RolesResponse.roles`, the members
 * screen's `ALL_BACKEND_ROLES`, `useAccountRolesAndStatus`. The cell accepts
 * the shape the data has rather than a prettier one invented for it; this map
 * IS the translation from the roles table to the club's vocabulary, so the
 * backend spelling is exactly what belongs on the left of it.
 */
export type MemberRole = BackendTipoRol;

/**
 * THE map. Every word this cell can say about a person is in here, and
 * changing one is a one-line change to this object.
 *
 * The four defaults are nouns, per D9's vocabulary ruling: the product had
 * three words for the same person — *Jugador* when enrolling, *alumno* in the
 * table, *estudiante* in the role — and unified on **Jugador**, the word the
 * person read the day they walked into the club.
 *
 * If the owner later prefers VERBS — "Juega", "Representa a X", "Entrena" —
 * that is this object and nothing else:
 *
 *     ALUMNO: () => "Juega",
 *     REPRESENTANTE: (of) => `Representa a ${joinWithY(of)}`,
 *     ENTRENADOR: () => "Entrena",
 *
 * It is a map of FUNCTIONS rather than of strings because one label takes an
 * argument — a representative is a representative OF someone — and a template
 * string with a `{nombre}` hole would still need a rule for the case where no
 * name came with it. A function answers both in the one place the wording
 * lives.
 *
 * Two things the rules forbid, and neither can be reintroduced here without
 * being seen: no abbreviation ("Rep.", "Admin" — the latter is what
 * `members/useAccountRolesAndStatus.ts:29` ships today), and no label that is
 * deducible from another. There is no "Menor" entry on purpose: if the
 * representative is named, saying the player is a minor adds nothing.
 */
export const MEMBER_ROLE_LABELS: Record<MemberRole, (represents: readonly string[]) => string> = {
  ALUMNO: () => "Jugador",
  REPRESENTANTE: (represents) => {
    // CUÁNTOS, no quiénes. Nombrarlos a todos hacía crecer la celda con la
    // familia: una cuenta de siete entraba a la grilla como siete nombres
    // unidos por comas en una sola línea, y la fila se amontonaba. El conteo
    // ocupa lo mismo con uno que con siete.
    //
    // El resumen NO reemplaza a los nombres, los aplaza: la fila de la grilla
    // se despliega y los nombra a todos, enteros, y el diálogo de la cuenta
    // los lista en "Estudiantes a cargo". La excepción a la regla de las
    // palabras está escrita en `docs/ux/rediseno-visual-2026-08.md`, al lado
    // de la de las siete letras de los días.
    //
    // Un solo formato para la columna, también con un jugador: alternar
    // "Representante de Sofía González" en una fila y
    // "Representante · 7 jugadores" en la de al lado es exactamente lo que la
    // regla del formato prohíbe.
    const count = represents.length;
    // La relación sin su objeto. Una fila cuyos representados el llamador no
    // tiene sigue siendo un representante — la etiqueta degradada es el rol
    // solo, nunca una suposición y nunca una ausencia.
    if (count === 0) return "Representante";
    return `Representante · ${count} ${count === 1 ? "jugador" : "jugadores"}`;
  },
  ENTRENADOR: () => "Entrenador",
  ADMINISTRADOR: () => "Administrador",
};

/**
 * The order the labels are drawn in, taken from the map's own key order rather
 * than declared a second time — `attendance-utils.ts:421` reads a week's day
 * order off `DIA_SEMANA_LABELS` the same way. It runs from what the person is
 * on the field to what they are in the system, because the first line of the
 * companion is the one that gets read.
 */
const ROLE_ORDER = Object.keys(MEMBER_ROLE_LABELS) as MemberRole[];

export interface IdentityCellProps {
  /** The full name, already assembled — "Ana Pérez". */
  name: string;
  /**
   * Everything this person is at the club. Duplicates and order do not matter;
   * an empty list draws no companion line at all, which is the correct answer
   * for a row whose roles the screen has not loaded. It is never an occasion
   * to invent a word.
   */
  roles?: readonly MemberRole[];
  /**
   * The players this person represents, when `roles` holds `REPRESENTANTE`.
   *
   * A list, because `MemberAccount.estudiantes` is a list: the members screen's
   * own mock fixtures already carry accounts with two and three players under
   * one representative, so a single-name prop would have been a field that is
   * wrong for a third of the real rows.
   *
   * La celda ya NO los nombra: cuenta. Este comentario decía que la regla de
   * las palabras gasta ancho en la verdad antes que en "Ana y 2 más", y esa
   * afirmación dejó de ser cierta el día que la fila pasó a resumir — una
   * familia de siete llenaba la celda de nombres. Sigue recibiendo la lista
   * entera porque el conteo sale de ella, y porque el largo es lo único que
   * decide si la cuenta representa a alguien.
   *
   * Los nombres no se perdieron: quien los necesita despliega la fila
   * (`members/page.tsx`, `AccountRow`) o abre el diálogo de la cuenta. La
   * excepción está escrita en `docs/ux/rediseno-visual-2026-08.md`.
   */
  represents?: readonly string[];
  className?: string;
}

/**
 * The identity accent is `coal`, never the brand red — red is reserved for the
 * primary CTA and for destructive intent (`cata.red`'s own doc comment in
 * `tailwind.config.ts`). The value is the one `members/page.tsx:485` already
 * ships for the same avatar, at the dense size a table row can carry: 32px,
 * the system's own `h-ctl-sm`.
 */
const INITIALS =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-coal/[0.08] text-xs font-bold text-coal";

export default function IdentityCell({
  name,
  roles = [],
  represents = [],
  className,
}: IdentityCellProps): ReactElement {
  const labels = ROLE_ORDER.filter((role) => roles.includes(role)).map((role) =>
    MEMBER_ROLE_LABELS[role](represents),
  );

  return (
    <div className={cn("flex items-center gap-3", className)}>
      {/* The initials ARE the name, drawn smaller. Announcing them makes a
          screen reader say the person twice, the second time as two letters. */}
      <span aria-hidden="true" className={INITIALS}>
        {getUserInitials(name)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-ink">{name}</span>
        {labels.length > 0 ? (
          <ul className="mt-1 flex flex-wrap items-center gap-1">
            {labels.map((label) => (
              <li key={label}>
                {/* `DataBox` is the product's box-for-a-standalone-value, and a
                    role is exactly that. Its `sunken` fill is also the one that
                    survives the measurement: the table stands on `paper` AND on
                    `canvas`, and the quieter `state-neutral-bg` tint falls to
                    1.063:1 on the canvas — see `color-contrast.test.ts`. */}
                <DataBox>{label}</DataBox>
              </li>
            ))}
          </ul>
        ) : null}
      </span>
    </div>
  );
}
