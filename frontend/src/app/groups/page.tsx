/**
 * Grupos y horarios — Admin page for managing training schedules.
 *
 * NAMING (three names, one thing — read this before renaming anything):
 *   - USER-FACING name: **Grupos y horarios**. That is what the nav says
 *     (`lib/auth-utils.ts`), what the page title says, and what the approved
 *     prototype says (`docs/archive/prototypes/prototipos/14-horarios.html`). It is the only
 *     name a user ever sees.
 *   - ROUTE: `/groups`, kept because it is linked from bookmarks, tests and
 *     the middleware route table.
 *   - DOMAIN TYPE: `HorarioEntrenamiento`, mirroring the backend's own
 *     vocabulary.
 * Renaming the route or the domain type is a refactor with a blast radius
 * across the API layer and the backend; it is deliberately NOT part of the
 * consistency pass. The user-facing name is the one that had to converge.
 *
 * Lists all HorarioEntrenamiento records with day, time and categoría. Shows
 * which students belong to each schedule based on direct alumno↔horario
 * assignment. Allows creating, editing, and deleting schedules.
 *
 * Rebuilt for issue #43 — replaces the old NivelRanking-as-Grupo placeholder
 * with real HorarioEntrenamiento management. The ranking feature itself was
 * later removed from the MVP entirely (see the "ranking / nivel" removal).
 *
 * v2 (Gestión de Horarios): once a `categoria` is picked, its day-set and
 * time range are LOCKED (not just pre-filled) — sourced live from the
 * backend's `categoria_horario` table via `@/services/categorias`
 * (`cargarCategorias`, fetched in `loadData` alongside `horarios`/
 * `allStudents`), not from a static frontend copy. The backend derives and
 * validates `hora_inicio`/`hora_fin`/`dia_semana` server-side; the client
 * never submits them as freeform values anymore.
 *
 * v3 (one card per training group): the display unit is the CATEGORÍA, not the
 * `Horario` row. The club runs five fixed groups, each meeting Monday–Friday at
 * a fixed hour, and the backend stores that as one row per categoría × weekday
 * — twenty-six rows for five groups. Rendering a card per row produced
 * twenty-six near-identical cards ("Lunes 15:00 — 16:00 · Formativo · 44
 * inscriptos", then the same for Martes, …) describing the same students five
 * times over. The weekday filter went with it: five cards do not need filtering.
 *
 * What the card must never do is round the data to the ideal. The day set and
 * time range are derived from the rows that actually exist — so the live
 * Saturday `COMPETITIVO` row reads as "Lunes a viernes + sábado" rather than
 * being rounded to the norm. There is no entrenador anywhere on the card: the
 * club does not assign trainers to schedules (issue #13).
 *
 * v4 (full-width rows): five cards in an auto-fill grid left the screen mostly
 * empty — five small boxes across the top of a 1400px page. The collapse to five
 * groups was right; the container was not. The group is a full-width row now,
 * and the width it gains is spent on facts that were cramped or invisible
 * before: the categoría's whole week as día markers (so "Competitivo also trains
 * on Saturday" and "these rows skip Martes" are readable without parsing prose).
 * Below `xl` the five columns stack and each one carries the label the header
 * strip carries on desktop — five columns on a 390px phone is five squashed
 * columns.
 *
 * v5 (full-month enrollment): the club enrolls by full month, never by a
 * loose weekday (owner's rule). Assigning/unassigning a student now hits the
 * categoría's horarios atomically on the backend — every row or none — so a
 * student can no longer be enrolled in only SOME of a categoría's días, and
 * the footnote that used to flag that state is gone with the state itself.
 *
 * v6 (ABM de categorías, docs/archive/fixes/24-abm-categorias.md): the owner's
 * request, verbatim — "quisiera que se cree directo el horario y categoría,
 * no diferentes". "Nuevo Horario" is gone as a loose concept: it could not
 * create anything (the five categorías already had every día) and only ever
 * produced the lock error. The create/edit form now owns the categoría
 * itself — nombre, franja, días — and one submit creates or edits the
 * `categoria_horario` row AND a `horario_entrenamiento` per día in a SINGLE
 * backend transaction (`AsistenciaServicio.crear_categoria`/
 * `actualizar_categoria`), replacing the old per-día `crearHorario`/
 * `actualizarHorario`/`eliminarHorario` diff loop that could partially fail
 * mid-sequence. `categoria`/`horaInicio`/`horaFin` are no longer locked to a
 * fixed catalog entry chosen from a `<select>` — the admin types them, and
 * the categoria catalog (`cargarCategorias`) now exists only to LABEL
 * existing cards (`categoriaLabel`), not to gate what a form can submit.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/contexts/ToastContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import StudentSearch from "@/components/StudentSearch";
import AppShell from "@/components/shell/AppShell";
import Link from "next/link";
import {
  Calendar,
  Plus,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  UserPlus,
  UserMinus,
} from "lucide-react";
import { ICON } from "@/lib/icon-size";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button, Badge, EmptyState, ErrorState, InfoPanel, LoadingState, PAGE_RAIL, Pagination, STAT_GRID, StatCard, TimePicker24 } from "@/components/ui";
import { DIA_SEMANA_LABELS, getTotalPages, paginateRecords } from "@/app/attendance/attendance-utils";
import { useGroupRoster } from "./useGroupRoster";
import MoverAlumnosDialog from "./MoverAlumnosDialog";
import {
  fetchHorarios,
  crearCategoria,
  actualizarCategoria,
  eliminarCategoria,
  moverYEliminarCategoria,
  moverAlumnosDeCategoria,
  cambiarPublicacionCategoria,
  fetchMembers,
  fetchAlumnosPorHorario,
  fetchConteosPorHorario,
} from "@/services/api";
import type { Horario, AlumnoHorario } from "@/services/api";
import {
  groupHorarios,
  type StudentRef,
  type HorarioGroup,
  type HorarioGroupRow,
} from "@/lib/groups-utils";
import { cargarCategorias, type Categoria, type CategoriaInfo } from "@/services/categorias";
import {
  alumnosInscritosLabel,
  mensajeCategoriaConAlumnos,
  countUniqueAlumnos,
  uniqueAlumnos,
  buildCategoriaCards,
  buildCatalogoSinHorarios,
  findCategoriaDuplicada,
  findCodigoPorLabel,
  formatDiaSet,
  countInscriptos,
  buildDiaTrack,
  DIA_ORDER,
  DIA_LABELS,
  formatTime,
  toStripDias,
  puedeEliminarCategoria,
  type CategoriaCard,
  type CategoriaSinHorarios,
  type PersonasPorHorario,
  personasPorHorarioFromConteos,
} from "./groups-page-utils";
import { toUserMessage } from "@/lib/error-message";
import { joinWithY } from "@/lib/format-utils";
import LinkifiedText from "@/components/LinkifiedText";

/**
 * The días of a destructive confirmation, in whole words.
 *
 * This was `shortDiaLabel` — `DIA_LABELS[dia].slice(0, 3)` — and the dialog is
 * where that hurt most. Inside the row's strip the abbreviation was at least
 * `aria-hidden`, with the schedule sentence stating the same days in prose
 * right above it. Here it was the ONLY statement of which días are about to be
 * destroyed: "Se eliminará la categoría completa (todos sus días: Lun, Mar,
 * Mié…)". "La interfaz no abrevia. Si algo no entra, entra menos información,
 * nunca una palabra cortada" — and in a dialog that unassigns students, the
 * word that does not fit is not the one to cut.
 *
 * `joinWithY` is the product's one way of listing things in a sentence, the
 * same one `WeekStrip` uses for its accessible label, so the dialog and the
 * strip name a week identically.
 */
function diaListLabel(dias: readonly string[]): string {
  return joinWithY(dias.map((dia) => DIA_LABELS[dia] ?? dia));
}

/** The dialog's body. With students enrolled the server will refuse (409), so
 *  the copy says what to do first (ADMB-04) and the dialog offers to move them;
 *  without them it is the plain irreversible-delete warning. */
function pendingDeletionsMessage(
  pending: { diaSemana: string; alumnos: AlumnoHorario[] }[],
  scope: "days" | "group",
): string {
  const alumnos = countUniqueAlumnos(pending);
  const dias = diaListLabel(pending.map((p) => p.diaSemana));
  if (alumnos > 0) {
    return scope === "group"
      ? mensajeCategoriaConAlumnos({ accion: "eliminar", alumnos })
      : mensajeCategoriaConAlumnos({ accion: "quitar-dias", dias, alumnos });
  }
  return `Se eliminará la categoría completa (todos sus días: ${dias}). Esta acción no se puede deshacer.`;
}

/** ADMB-13: a new categoría starts hidden; the form says so up front. */
const NUEVA_CATEGORIA_OCULTA_NOTA =
  "Se creará oculta en la página pública; podrá mostrarla cuando quiera.";

function extractErrorMessage(err: unknown, fallback: string): string {
  return toUserMessage(err, fallback);
}

/**
 * The column track the header strip and every group row share — declared once
 * so the labels above the list keep pointing at the values below them.
 *
 * Only from `xl` up. The five tracks need ~834px of content width and the
 * shell's sidebar takes 236px of the viewport, so below `xl` the columns would
 * be pushed past the card's edge (and clipped by its `overflow-hidden`). There
 * the row is a stack instead, and each cell carries its own label
 * (`CellLabel`) — five columns squeezed into 390px is five unreadable columns.
 *
 * The action column is a fixed width, not `auto`: the header strip and the
 * rows are separate grid containers, so an `auto` track would size itself to
 * each container's own content and the labels would stop lining up with the
 * values under them.
 */
const ROW_COLUMNS =
  "2xl:grid 2xl:grid-cols-[minmax(170px,0.95fr)_minmax(200px,1.25fr)_minmax(92px,0.5fr)_244px] " +
  "2xl:items-center 2xl:gap-x-5";

/** `.tbl thead th` typography — the header strip and the stacked cell labels. */
const CELL_LABEL = "text-2xs font-bold uppercase text-ink-3-strong";

/**
 * The four column names, declared ONCE.
 *
 * They used to be typed twice — in the header strip and again in each cell's
 * `CellLabel` — which is how two of the four came to exist in only one of the
 * two places. `Grupo` had a strip entry and no cell label, and the strip is
 * `aria-hidden`, so the first column of every row went unnamed for assistive
 * tech AT EVERY WIDTH: below `xl` there was no strip to read, and from `xl` up
 * the strip is hidden from the accessibility tree on purpose. The action column
 * had neither.
 *
 * One source, read by both, so the strip above and the labels below cannot say
 * different things or forget each other.
 */
// "Categoría", not "Grupo" (#315 hallazgo #41): this column shows
// `categoriaLabel(card.categoria)`, the exact value the "Nueva categoría" /
// "Editar categoría" controls on this same screen already name — a third
// word for the same thing was the finding, not the column itself. The
// user-facing screen name stays "Grupos y horarios" (see the NAMING note at the top
// of this file): that rename is deliberately out of scope, this one is not.
const COLUMNS = ["Categoría", "Horario", "Jugadores", "Acciones"] as const;

/**
 * A cell's own label. Visible below `xl`, where the stacked row has no header
 * strip above it; from `xl` up it goes `sr-only` rather than `hidden`, because
 * the visible header strip is `aria-hidden` and a bare value with no label
 * announced before it is not a row a screen reader can read.
 */
function CellLabel({ children }: { children: React.ReactNode }): React.ReactElement {
  return <span className={`mb-1 block ${CELL_LABEL} 2xl:sr-only`}>{children}</span>;
}

/**
 * The categoría's week — now the product's one week strip.
 *
 * This used to be a local `DiaTrack`: a `<ul>` of capsules, one per día of the
 * categoría's TRACK, labelled with a 3-letter slice of the day's name. Two
 * rules of the system were broken at once.
 *
 * The first is the RULE OF FORMAT — "los días son siempre siete casillas fijas
 * en el mismo orden". The track is 5 días for four of the club's categorías and
 * 6 for Competitivo, so the column held rows of two different widths whose
 * boxes did not line up: comparing two categorías meant reading both, which is
 * exactly the free-text problem `WeekStrip` was built to end. It was built, and
 * then never called — this screen is its first consumer.
 *
 * The second is the RULE OF WORDS. "Lun", "Mié", "Sáb" are abbreviations, and
 * the one declared exception covers letters read as POSITIONS ON A SCALE, which
 * these were not: they were the day's name, cut.
 *
 * The three-state fact survives the move — a día the categoría runs, a día it
 * is allowed to run and does not, and a día outside its track — because that is
 * information an admin decides with, not decoration. It is `permitidos` on the
 * strip now.
 */
const WEEK_BOX =
  "flex h-5 w-5 items-center justify-center rounded-[3px] text-2xs font-bold tracking-flat";
const WEEK_BOX_TONE = {
  activo: "bg-coal text-white",
  disponible: "border border-dashed border-line-2 bg-sunken text-ink-3-strong",
  inactivo: "bg-sunken text-ink-3-strong",
} as const;

/**
 * Screen-local week strip: same seven fixed boxes and `data-day`/`data-state`
 * contract as `ui/WeekStrip`, but the days that run are carbon, not red. Five
 * red boxes per row, five rows, next to a red row action is the oversaturation
 * the admin audit flagged; red stays for the one primary action.
 */
function WeekTrack({
  dias,
  permitidos,
}: {
  dias: readonly string[];
  permitidos: readonly string[];
}): React.ReactElement {
  const running = (Object.keys(DIA_SEMANA_LABELS) as Array<keyof typeof DIA_SEMANA_LABELS>).filter((d) =>
    dias.includes(d),
  );
  const names = running.map((d, i) =>
    i === 0 ? DIA_SEMANA_LABELS[d] : DIA_SEMANA_LABELS[d].toLocaleLowerCase("es"),
  );
  return (
    <span
      role="img"
      data-testid="week-strip"
      aria-label={joinWithY(names) || "Sin horario"}
      className="inline-flex items-center gap-0.5"
    >
      {(Object.keys(DIA_SEMANA_LABELS) as Array<keyof typeof DIA_SEMANA_LABELS>).map((day) => {
        const state = dias.includes(day) ? "activo" : permitidos.includes(day) ? "disponible" : "inactivo";
        return (
          <span
            key={day}
            data-day={day}
            data-state={state}
            title={DIA_SEMANA_LABELS[day]}
            aria-hidden="true"
            className={`${WEEK_BOX} ${WEEK_BOX_TONE[state]}`}
          >
            {DIA_SEMANA_LABELS[day].charAt(0)}
          </span>
        );
      })}
    </span>
  );
}

function DiaTrack({ track, dias }: { track: string[]; dias: string[] }): React.ReactElement {
  return (
    <WeekTrack dias={toStripDias(dias)} permitidos={toStripDias(track)} />
  );
}

/** The categoría's own editable fields (v6, docs/archive/fixes/24-abm-categorias.md)
 *  — `nombre`/`horaInicio`/`horaFin` are typed input now, not a `<select>`
 *  locked to an existing catalog entry. `dias` lives separately in
 *  `selectedDias` (a `Set`, shared with the checkbox toggling logic). */
interface HorarioFormData {
  nombre: string;
  horaInicio: string;
  horaFin: string;
  /**
   * The optional ages label (#789), always a string here even for a categoría
   * that has none — `""` is what an empty text input holds, and it is also
   * what CLEARS a stored label on save (the backend normalises blank to NULL).
   */
  edades: string;
}

/** One día-group row pending deletion after student-safety check, awaiting user confirmation. */
interface PendingDayDeletion {
  id: number;
  diaSemana: string;
  alumnos: AlumnoHorario[];
}

/**
 * Single accordion state — at most one card's panel is expanded at a time.
 *
 * `key` is the expanded card's `categoria`, or `NEW_GROUP_KEY` for the
 * create-new flow, which has no existing card to nest under. The card is the
 * categoría now, so both panels act on the whole categoría: the roster is the
 * union across every weekday row, and editing walks the categoría's editable
 * `HorarioGroup`s (normally exactly one).
 */
interface ExpandedGroupState {
  key: string;
  tab: "editar" | "alumnos";
}

/** Sentinel `expandedGroup.key` for "Nuevo Horario" — no existing card to nest under. */
const NEW_GROUP_KEY = "__new__";

/**
 * Rows per page in the "Ver alumnos" roster.
 *
 * Ten, matching every other paged list in the product (attendance, reports).
 * The biggest categoría carries 44 students, which is four pages —
 * short enough that paging is navigation rather than a search substitute.
 */
const ALUMNOS_PAGE_SIZE = 10;

const EMPTY_FORM: HorarioFormData = {
  nombre: "",
  horaInicio: "",
  horaFin: "",
  edades: "",
};

/**
 * The club's training window and its día cap, MIRRORED from the backend
 * (issue #861). Source of truth: `backend/app/dominio/reglas_negocio.py`
 * (`HORA_MINIMA_ENTRENAMIENTO`, `HORA_MAXIMA_ENTRENAMIENTO`,
 * `MAXIMO_DIAS_POR_CATEGORIA`), enforced by
 * `AsistenciaServicio._validar_ventana_de_entrenamiento` /
 * `_validar_tope_de_dias` on create AND edit.
 *
 * The duplication across languages is deliberate and it is not a shortcut
 * around a shared module: there is no build step that can hand a Python
 * constant to this bundle, and the alternative — asking the server what the
 * limits are before drawing the form — would trade a two-line mirror for a
 * round trip on every open. What the mirror buys is that the admin learns
 * about a 02:00 franja while the field is still under the cursor, instead of
 * after a rejected save.
 *
 * The mirror is FEEDBACK, never the enforcement. Any caller that skips this
 * form (the API directly, a future screen) is still refused by the backend,
 * so a drift here can only ever make the screen more permissive than the
 * server — which shows up as the server's own message in `formError`, not as
 * a bad row in the database. If these values ever move, the Python side is
 * what moves first.
 *
 * Kept as "HH:MM" strings, the exact shape an `<input type="time">` holds, so
 * the comparisons below are plain lexicographic ones on zero-padded 24h time —
 * no parsing, no timezone, no `Date`.
 */
const HORA_MINIMA_ENTRENAMIENTO = "06:00";
const HORA_MAXIMA_ENTRENAMIENTO = "22:00";

/** The backend returns "HH:MM:SS"; the form and the picker hold "HH:MM". */
function aHoraCorta(hora: string): string {
  return hora.slice(0, 5);
}

/** Minutes since midnight of an "HH:MM" string. */
function minutosDelDia(hora: string): number {
  const [h, m] = hora.split(":");
  return Number(h) * 60 + Number(m);
}

/** "1 h 15 min", "1 h", "45 min" — or null while the franja is not computable. */
function duracionLabel(inicio: string, fin: string): string | null {
  if (!inicio || !fin) return null;
  const minutos = minutosDelDia(fin) - minutosDelDia(inicio);
  if (minutos <= 0) return null;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return [horas > 0 ? `${horas} h` : "", resto > 0 ? `${resto} min` : ""].filter(Boolean).join(" ");
}

/** Field skin shared with the tarifas/discounts forms. */
const FIELD_LABEL = "block text-2xs font-bold uppercase text-ink-3";
const FIELD_CONTROL =
  "h-ctl w-full rounded-ctl border border-line-2 bg-paper px-3 text-sm text-ink outline-none focus:border-cata-red";
const MAXIMO_DIAS_POR_CATEGORIA = 6;

/**
 * Ids for the categoría form's per-field error slots.
 *
 * `-error` suffix, matching every other per-field mark in the app
 * (`email-error` on `/login`, `tipo-sangre-error-${personaId}` in
 * `MedicalRecordEditor`). The form is a singleton on this screen — at most one
 * accordion panel is open — so the ids need no instance suffix.
 *
 * `FRANJA_ERROR_ID` is the odd one out: it belongs to the PAIR of time inputs
 * rather than to either of them (see `validarCategoria`).
 */
const NOMBRE_ERROR_ID = "categoria-nombre-error";
const HORA_INICIO_ERROR_ID = "categoria-hora-inicio-error";
const HORA_FIN_ERROR_ID = "categoria-hora-fin-error";
const FRANJA_ERROR_ID = "categoria-franja-error";
const DIAS_ERROR_ID = "categoria-dias-error";

/** Shared class for every per-field message on this form — same as `/login`'s. */
const FIELD_ERROR_CLASSES = "mt-1 text-xs font-semibold text-state-bad";

/**
 * One entry per field the categoría form can mark. Empty object = valid.
 *
 * `franja` has no input of its own on purpose: "la hora de inicio debe ser
 * anterior a la hora de fin" is a fact about the two together, and neither
 * one is the wrong one. `/login` reaches for the same shape when the server
 * rejects a credentials PAIR — one message, both controls pointing at it.
 */
interface CategoriaFieldErrors {
  nombre?: string;
  horaInicio?: string;
  horaFin?: string;
  franja?: string;
  dias?: string;
}

/** Whether an "HH:MM" value falls inside the club's window. Borders INCLUSIVE:
 *  a categoría starting 06:00 sharp or ending 22:00 sharp trains inside it. */
function dentroDeLaVentana(hora: string): boolean {
  return hora >= HORA_MINIMA_ENTRENAMIENTO && hora <= HORA_MAXIMA_ENTRENAMIENTO;
}

/**
 * The client mirror of the backend's categoría rules, field by field.
 *
 * Messages are the backend's own, verbatim, so the admin reads the same
 * sentence whether this function caught it or `AsistenciaServicio` did — a
 * value the client waves through (a franja the mirror somehow missed) must
 * not come back phrased differently just because it took the long way.
 *
 * The pair check runs only once BOTH hours are present and inside the window:
 * telling someone their 23:00–22:30 franja is "inverted" on top of being
 * outside the club's hours is two complaints for one typo, and the second one
 * disappears the moment they fix the first.
 */
function validarCategoria(
  form: HorarioFormData,
  cantidadDeDias: number,
): CategoriaFieldErrors {
  const errores: CategoriaFieldErrors = {};
  const fueraDeVentana = `Los entrenamientos deben programarse entre las ${HORA_MINIMA_ENTRENAMIENTO} y las ${HORA_MAXIMA_ENTRENAMIENTO}.`;

  if (!form.nombre.trim()) errores.nombre = "Ingresa un nombre para la categoría.";

  if (!form.horaInicio) errores.horaInicio = "Ingresa la hora de inicio.";
  else if (!dentroDeLaVentana(form.horaInicio)) errores.horaInicio = fueraDeVentana;

  if (!form.horaFin) errores.horaFin = "Ingresa la hora de fin.";
  else if (!dentroDeLaVentana(form.horaFin)) errores.horaFin = fueraDeVentana;

  if (!errores.horaInicio && !errores.horaFin && form.horaInicio >= form.horaFin) {
    errores.franja = "La hora de inicio debe ser anterior a la hora de fin.";
  }

  if (cantidadDeDias === 0) errores.dias = "Selecciona al menos un día.";
  else if (cantidadDeDias > MAXIMO_DIAS_POR_CATEGORIA) {
    errores.dias = `Una categoría no puede entrenar más de ${MAXIMO_DIAS_POR_CATEGORIA} días.`;
  }

  return errores;
}

export default function GroupsPage(): React.ReactElement {
  const [horarios, setHorarios] = useState<Horario[]>([]);
  const [allStudents, setAllStudents] = useState<StudentRef[]>([]);
  // The categoria catalog (hours/label/allowed días), fetched live from
  // `@/services/categorias` — see `loadData` below. Partial: a categoria the
  // catalog hasn't answered for yet (still loading, or an unrecognized code)
  // has no entry, which `diasPermitidos`/`horarioDe` and the lookups below
  // all degrade for instead of throwing.
  const [categorias, setCategorias] = useState<Partial<Record<Categoria, CategoriaInfo>>>({});
  const [loading, setLoading] = useState(true);
  const { showSuccess, showError, showWarning } = useToast();

  /** The categoría's label, falling back to its raw value for an unknown one
   *  (or while the catalog is still loading). */
  function categoriaLabel(categoria: string): string {
    return categorias[categoria as Categoria]?.label ?? categoria;
  }

  /** The categoría's ages label (#789) as the form holds it: `""` both for a
   *  categoría that publishes none and while the catalog is still loading. */
  function categoriaEdades(categoria: string): string {
    return categorias[categoria as Categoria]?.edades ?? "";
  }

  /** Card title, e.g. "Formativo · 15:00 — 16:00", used for accessible names. */
  function cardTitle(card: CategoriaCard): string {
    return `${categoriaLabel(card.categoria)} · ${formatTime(card.horaInicio)} — ${formatTime(card.horaFin)}`;
  }

  const [loadError, setLoadError] = useState<string | null>(null);

  // Single accordion state replaces the old showForm/editingId/horarioSeleccionado
  // fixed-position panels — PR3a.
  const [expandedGroup, setExpandedGroup] = useState<ExpandedGroupState | null>(null);
  const [editingGroup, setEditingGroup] = useState<HorarioGroup | null>(null);
  const [sinGrupoPage, setSinGrupoPage] = useState(1);
  const [formData, setFormData] = useState<HorarioFormData>(EMPTY_FORM);
  const [selectedDias, setSelectedDias] = useState<Set<string>>(new Set());
  const [diasTopeMensaje, setDiasTopeMensaje] = useState<string | null>(null);
  const [formSubmitting, setFormSubmitting] = useState(false);
  /**
   * The shared banner. SERVER errors only since #861 — a 400 the client had no
   * way to predict (a duplicate nombre, a día with real Asistencia history)
   * still needs somewhere to land, and it belongs to the whole form because
   * the server does not say which field it is about. Everything the client
   * can decide for itself goes to `fieldErrors` instead.
   */
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<CategoriaFieldErrors>({});
  /**
   * `categoria` code the server said already exists when a create was refused
   * on its label. When set, the form's banner offers a way into that categoría
   * (#1315) instead of leaving the admin at a dead end.
   */
  const [duplicateCategoriaCodigo, setDuplicateCategoriaCodigo] = useState<string | null>(null);
  const [pendingDeletions, setPendingDeletions] = useState<PendingDayDeletion[] | null>(null);
  // Distinguishes which flow populated `pendingDeletions`, so the shared
  // confirmation dialog's copy and cancel behavior can differ: "days" comes
  // from unticking días mid-edit (handleSubmit already wrote other rows —
  // cancel still resyncs/closes the form); "group" comes from the card's
  // trash icon deleting every día at once (cancel is a pure no-op, nothing
  // was mutated yet).
  const [pendingDeletionScope, setPendingDeletionScope] = useState<"days" | "group">("days");

  /** ADMB-14: non-blocking warnings (schedule overlap) the server attached to
   *  the last create/edit. Shown after the save, never in its way. */
  const [advertencias, setAdvertencias] = useState<string[]>([]);

  const [deletingId, setDeletingId] = useState<number | null>(null);
  /** `codigo` of the categoría a pending "group"-scope deletion targets —
   *  `pendingDeletions` itself only holds día rows, not the categoría
   *  identity `eliminarCategoria` needs (see `requestDeleteCategoria`). */
  const [deletingCategoriaCodigo, setDeletingCategoriaCodigo] = useState<string | null>(null);

  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Asignación directa alumno ↔ horario — content unchanged from PR2b, now
  // rendered inline via `expandedGroup.tab === "alumnos"`. Assignment is at
  // GRUPO level (every underlying `horario_id` día row), not per-día: a
  // student enrolled in a día-group belongs to ALL its días, never just one.
  // `roster.alumnos` holds the deduplicated (by `personaId`) union of the
  // roster across every row of the currently open group.
  /** 1-indexed page of the "Ver alumnos" roster. Reset whenever a panel opens. */

  /**
   * Enrolled person-ids per `Horario.id`, for the card's "N inscriptos" line.
   *
   * Ids rather than counts because the card counts a CATEGORÍA: a student
   * belongs to every weekday of their group, so summing the per-row counts
   * would report 220 students for the 44 who actually train. The union needs
   * the identities.
   *
   * `GET /groups/horarios` itself returns no enrollment count, but
   * `GET /groups/horarios/conteos?incluir_personas=true` (QA4 PERF-01)
   * answers the enrolled person ids of EVERY schedule in one call — ids
   * only, a few KB instead of the ~500 KB full roster (TRA-7) that used to
   * be downloaded just for this. The full detail of a categoría loads on
   * demand when its "Ver alumnos" panel opens. The ids are fetched AFTER the
   * schedules render so a slow/failed request
   * never delays or blanks the grid itself; on failure no card gets a count
   * line at all — an undercount would be a lie, and this figure is the one
   * the club plans around.
   */
  const [personasPorHorario, setPersonasPorHorario] = useState<PersonasPorHorario>({});

  const showNotification = useCallback((type: "success" | "error", message: string): void => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  }, []);

  /**
   * Keeps the card's "N inscritos" badge (`personasPorHorario`) truthful for
   * whatever rows the roster panel just (re)loaded — assign/unassign both
   * call `roster.load` on completion, so this is what stops the badge from
   * going stale the moment either one runs, without a second network request.
   */
  const handleRosterLoaded = useCallback(
    (rows: readonly HorarioGroupRow[], personaIdsByRow: readonly number[][]): void => {
      setPersonasPorHorario((prev) => {
        const next = { ...prev };
        rows.forEach((row, index) => {
          next[row.id] = personaIdsByRow[index];
        });
        return next;
      });
    },
    [],
  );

  const roster = useGroupRoster({ allStudents, showNotification, onRosterLoaded: handleRosterLoaded });

  /** The student a "Desasignar" click is waiting on the `ConfirmDialog` for. */
  const [pendingUnassign, setPendingUnassign] = useState<{
    card: CategoriaCard;
    alumno: AlumnoHorario;
  } | null>(null);

  function handleConfirmUnassign(): void {
    if (!pendingUnassign) return;
    const { card, alumno } = pendingUnassign;
    setPendingUnassign(null);
    void roster.unassign(card.rows, alumno.personaId);
  }

  function handleCancelUnassign(): void {
    setPendingUnassign(null);
  }

  const loadData = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      // The categoria catalog fetch is isolated with its own `.catch` so it
      // can never reject this `Promise.all`: unlike `horarios`/`members`,
      // whose failure legitimately blanks this screen (there is nothing
      // useful to show without them), a categoria-catalog outage should not
      // take down a Horarios list that loaded fine. On failure it resolves
      // to `{}` (the same "not loaded yet" shape callers already handle —
      // raw codes, blank locked horario, no día checkboxes) and surfaces a
      // non-blocking toast instead of the full-page `ErrorState`.
      const [horariosData, membersData, categoriasData] = await Promise.all([
        fetchHorarios(),
        fetchMembers(),
        cargarCategorias().catch(() => {
          showError("No se pudo cargar el catálogo de categorías.");
          return {} as Partial<Record<Categoria, CategoriaInfo>>;
        }),
      ]);
      setHorarios(horariosData);
      const students: StudentRef[] = membersData.accounts.flatMap((account) =>
        account.estudiantes.map((estudiante) => ({
          id: estudiante.id,
          nombres: estudiante.nombres,
          apellidos: estudiante.apellidos,
          activo: estudiante.activo,
        })),
      );
      setAllStudents(students);
      setCategorias(categoriasData);
    } catch {
      setLoadError("No se pudieron cargar los horarios. Intenta nuevamente.");
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  /**
   * Fill in the per-session rosters once the schedules are known. Kept out of
   * `loadData`'s `Promise.all` deliberately: this is a secondary line of
   * text, and it must never delay or fail the grid itself.
   */
  useEffect(() => {
    if (horarios.length === 0) return;
    let cancelled = false;

    void fetchConteosPorHorario({ incluirPersonas: true })
      .then((conteos) => {
        if (cancelled) return;
        // Every known horario gets an entry (possibly empty) so a genuinely
        // empty class still counts as "0 inscriptos", not "unanswered" —
        // see PersonasPorHorario's own doc comment.
        setPersonasPorHorario(personasPorHorarioFromConteos(horarios, conteos));
      })
      .catch(() => {
        // Leave personasPorHorario untouched: every row stays absent, so
        // every card omits its count rather than risking a false number.
      });

    return () => {
      cancelled = true;
    };
  }, [horarios]);

  const horarioGroups = useMemo(() => groupHorarios(horarios), [horarios]);

  /**
   * One card per training group. Five categorías, five cards — the whole
   * screen fits without pagination or filtering, which is the point: the
   * questions this screen answers ("who trains at 15:00?", "who runs
   * Competitivo?") are about the group, and the weekday was never the subject.
   */
  const categoriaCards = useMemo(() => buildCategoriaCards(horarioGroups), [horarioGroups]);

  /**
   * The summary strip above the list, from data the screen already holds.
   *
   * Enrollment figures are `null` until EVERY schedule's roster has answered
   * (see `personasPorHorario`): a partial union would undercount, and this is
   * the figure the club plans around.
   */
  const summary = useMemo(() => {
    const rostersLoaded =
      horarios.length > 0 && horarios.every((horario) => personasPorHorario[horario.id] !== undefined);
    if (!rostersLoaded) return { inscriptos: null, sinGrupo: null, sinGrupoAlumnos: [] as StudentRef[], activos: 0 };
    const assigned = new Set<number>();
    for (const horario of horarios) {
      for (const personaId of personasPorHorario[horario.id]) assigned.add(personaId);
    }
    const sinGrupoAlumnos = allStudents.filter((student) => student.activo && !assigned.has(Number(student.id)));
    return {
      inscriptos: assigned.size,
      sinGrupo: sinGrupoAlumnos.length,
      sinGrupoAlumnos,
      activos: allStudents.filter((student) => student.activo).length,
    };
  }, [horarios, personasPorHorario, allStudents]);

  /**
   * Catalog categorías with no schedules yet, shown as their own cards.
   *
   * They stay visible once some categorías are scheduled (mixed state), because
   * defining one categoría used to hide the rest of the seeded catalog again —
   * the original bug mid-flow. They render after the scheduled cards as a
   * pending-configuration queue.
   */
  const catalogoPendientes = useMemo(
    () => buildCatalogoSinHorarios(categorias, categoriaCards.map((card) => card.categoria)),
    [categorias, categoriaCards],
  );

  const categoriasOcultas = useMemo(
    () => categoriaCards.filter((card) => categorias[card.categoria as Categoria]?.visible === false).length,
    [categoriaCards, categorias],
  );

  /** No catalog answered: the only state where "no hay categorías" is true. */
  const catalogoVacio = Object.keys(categorias).length === 0;

  function openCreateForm(): void {
    setEditingGroup(null);
    setFormData(EMPTY_FORM);
    setSelectedDias(new Set());
    setFormError(null);
    setFieldErrors({});
    setDuplicateCategoriaCodigo(null);
    setExpandedGroup({ key: NEW_GROUP_KEY, tab: "editar" });
  }

  /** Loads a group into the edit form. `null` clears it back to the chooser,
   * which only appears when a categoría has more than one editable group. */
  function selectEditingGroup(group: HorarioGroup | null): void {
    setEditingGroup(group);
    setDiasTopeMensaje(null);
    setFormError(null);
    setFieldErrors({});
    if (group === null) {
      setFormData(EMPTY_FORM);
      setSelectedDias(new Set());
      return;
    }
    setFormData({
      nombre: categoriaLabel(group.categoria),
      horaInicio: aHoraCorta(group.horaInicio),
      horaFin: aHoraCorta(group.horaFin),
      edades: categoriaEdades(group.categoria),
    });
    setSelectedDias(new Set(group.rows.map((row) => row.diaSemana)));
  }

  /**
   * Opens the "Editar" accordion tab under a categoría card.
   *
   * A categoría normally has exactly one editable group, so the form opens
   * straight onto it. When its weekdays are split across several groups the
   * panel opens on a chooser instead of silently editing the first — that
   * split is real and the admin has to see it.
   */
  function openEditForm(card: CategoriaCard): void {
    setDuplicateCategoriaCodigo(null);
    selectEditingGroup(card.groups.length === 1 ? card.groups[0] : null);
    setExpandedGroup({ key: card.categoria, tab: "editar" });
  }

  /**
   * Opens the v6 edit form for a categoría that exists in the catalog but has
   * no schedules yet.
   *
   * There is no `HorarioGroup` row to edit, so the form is pre-filled from the
   * catalog: label, franja and its días permitidos. Submitting PUTs
   * `/asistencias/categorias/{codigo}` (`actualizarCategoria`), which creates
   * the missing `horario_entrenamiento` rows for the selected días atomically.
   */
  function openCatalogoEditForm(entry: CategoriaSinHorarios): void {
    setEditingGroup({
      key: entry.categoria,
      categoria: entry.categoria,
      horaInicio: entry.horaInicio,
      horaFin: entry.horaFin,
      rows: [],
    });
    setFormData({
      nombre: entry.label,
      horaInicio: aHoraCorta(entry.horaInicio),
      horaFin: aHoraCorta(entry.horaFin),
      edades: entry.edades ?? "",
    });
    setSelectedDias(new Set(entry.dias));
    setFormError(null);
    setFieldErrors({});
    setDuplicateCategoriaCodigo(null);
    setExpandedGroup({ key: entry.categoria, tab: "editar" });
  }

  /**
   * Opens the edit flow for an existing categoría by its código: its own card
   * when it already has schedules, the catalog-only form when it does not.
   * Used by the duplicate-label banner so the refused create has an exit.
   */
  function openCategoriaEdit(codigo: string): void {
    const card = categoriaCards.find((c) => c.categoria === codigo);
    if (card) {
      openEditForm(card);
      return;
    }
    const info = categorias[codigo];
    if (!info) return;
    openCatalogoEditForm({
      categoria: codigo,
      label: info.label,
      horaInicio: info.horaInicio,
      horaFin: info.horaFin,
      dias: info.dias,
      edades: info.edades,
    });
  }

  /** Opens the "Alumnos" accordion tab under a categoría card — loads the
   * roster for every weekday row at once (a student belongs to the whole
   * recurring grupo, not one día). */
  function openAlumnosTab(card: CategoriaCard, focusAdd = false): void {
    focusAddOnOpen.current = focusAdd;
    setExpandedGroup({ key: card.categoria, tab: "alumnos" });
    roster.setPage(1);
    void roster.load(card.rows);
  }

  /**
   * Set by "Agregar alumnos": the roster panel opens with the add-student
   * selector focused, since adding is what the admin came to do. "N inscritos"
   * opens the same panel without stealing focus.
   */
  const focusAddOnOpen = useRef(false);
  useEffect(() => {
    if (expandedGroup?.tab !== "alumnos" || !focusAddOnOpen.current) return;
    focusAddOnOpen.current = false;
    document.getElementById("alumno-select")?.focus();
  }, [expandedGroup]);

  /** The código whose publication toggle is mid-flight, so its button alone
   *  busies out while the PATCH runs. */
  const [togglingPublicacion, setTogglingPublicacion] = useState<string | null>(null);

  /**
   * Publishes or hides a categoría on the public landing — the admin's
   * publication toggle (`visible_en_landing`). One field on purpose: hiding
   * is an editorial decision, not a data change, so it PATCHes its own
   * endpoint instead of the atomic nombre/franja/días edit. The catalog
   * entry is flipped locally on success (the backend echoes the same
   * value); a failure leaves the state untouched and says so.
   */
  async function togglePublicacion(codigo: string): Promise<void> {
    const info = categorias[codigo as Categoria];
    const visibleAhora = info?.visible ?? true;
    setTogglingPublicacion(codigo);
    try {
      await cambiarPublicacionCategoria(codigo, !visibleAhora);
      if (info) {
        setCategorias((prev) => ({
          ...prev,
          [codigo]: { ...info, visible: !visibleAhora },
        }));
      }
      showNotification(
        "success",
        visibleAhora
          ? "La categoría no se publica en el sitio."
          : "La categoría vuelve a publicarse en el sitio.",
      );
    } catch (error: unknown) {
      showNotification("error", toUserMessage(error, "No se pudo cambiar la publicación de la categoría."));
    } finally {
      setTogglingPublicacion(null);
    }
  }

  /** The landing-publication toggle button shared by scheduled cards and
   *  catalog-only cards — same control, same accessible name contract. */
  function renderPublicacionToggle(codigo: string, label: string, disabled: boolean): React.ReactElement {
    const visible = categorias[codigo as Categoria]?.visible ?? true;
    const isToggling = togglingPublicacion === codigo;
    return (
      <Button
        variant="tertiary"
        size="sm"
        onClick={() => void togglePublicacion(codigo)}
        disabled={disabled || isToggling}
        title={
          visible
            ? "Oculta esta categoría del sitio público. Sigue activa para inscripciones y asistencia."
            : "Vuelve a publicar esta categoría en el sitio público."
        }
        aria-label={
          visible
            ? `Ocultar ${label} del sitio`
            : `Mostrar ${label} en el sitio`
        }
      >
        {isToggling ? (
          <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
        ) : visible ? (
          <Eye size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <EyeOff size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
        )}
        {visible ? "Ocultar del sitio" : "Mostrar en el sitio"}
      </Button>
    );
  }

  /** Collapses whichever accordion panel (editar or alumnos) is open. */
  function closeExpanded(): void {
    setExpandedGroup(null);
    setEditingGroup(null);
    setFormData(EMPTY_FORM);
    setSelectedDias(new Set());
    setDiasTopeMensaje(null);
    setFormError(null);
    setFieldErrors({});
    setDuplicateCategoriaCodigo(null);
    roster.reset();
  }

  function toggleDia(dia: string): void {
    setDiasTopeMensaje(null);
    if (!selectedDias.has(dia) && selectedDias.size >= MAXIMO_DIAS_POR_CATEGORIA) {
      setDiasTopeMensaje(
        `Máximo ${MAXIMO_DIAS_POR_CATEGORIA} días por categoría. Quite uno para agregar ${(DIA_LABELS[dia] ?? dia).toLowerCase()}.`,
      );
      return;
    }
    setSelectedDias((prev) => {
      const next = new Set(prev);
      if (next.has(dia)) next.delete(dia);
      else next.add(dia);
      return next;
    });
  }

  /**
   * Persist the categoría: one atomic backend call, create or edit
   * (`AsistenciaServicio.crear_categoria`/`actualizar_categoria`) that
   * writes `categoria_horario` + `categoria_horario_dia` + a
   * `horario_entrenamiento` per día in a SINGLE transaction. Unlike the old
   * per-día diff loop this replaces, a rejected request leaves NOTHING
   * written — so on failure the form stays open with the server's message
   * instead of closing and resyncing against a partially-applied save.
   */
  async function submitCategoria(moverAlumnosA?: string): Promise<void> {
    setFormSubmitting(true);
    setFormError(null);
    setAdvertencias([]);
    setDuplicateCategoriaCodigo(null);
    const nombre = formData.nombre.trim();
    const dias = Array.from(selectedDias);
    // `edades` goes as typed, blanks included: this is a full editor, so
    // ALWAYS sending it is what lets an emptied input clear a stored label
    // (an omitted field would leave it untouched — `exclude_unset`). The
    // trimming/blank-to-NULL normalisation lives in one place only, the
    // backend's `AsistenciaServicio._normalizar_edades`.
    const edades = formData.edades;
    try {
      // ADMB-14: the overlap warnings ride on the save's own response.
      const guardada = editingGroup
        ? await actualizarCategoria(editingGroup.categoria, {
            nombre, edades, hora_inicio: formData.horaInicio, hora_fin: formData.horaFin, dias,
            // ADMB-04: players of a removed día move in the same transaction.
            ...(moverAlumnosA ? { mover_alumnos_a: moverAlumnosA } : {}),
          })
        : await crearCategoria({
            nombre, edades, hora_inicio: formData.horaInicio, hora_fin: formData.horaFin, dias,
          });
      setAdvertencias(guardada?.advertencias ?? []);
      const message = editingGroup ? "Categoría actualizada correctamente." : "Categoría creada correctamente.";
      showNotification("success", message);
      showSuccess(message);
      closeExpanded();
      await loadData();
    } catch (err) {
      const message = extractErrorMessage(err, "Error al guardar la categoría.");
      // A duplicate-label refusal names the categoría that already exists
      // (issue #1315): the banner then offers a way into it instead of a
      // dead-end toast. Every other server error keeps the generic banner
      // plus the toast.
      const nombreDuplicado = findCategoriaDuplicada(message);
      const codigoDuplicado = nombreDuplicado ? findCodigoPorLabel(categorias, nombreDuplicado) : null;
      setDuplicateCategoriaCodigo(codigoDuplicado);
      setFormError(message);
      if (!codigoDuplicado) showError(message);
    } finally {
      setFormSubmitting(false);
    }
  }

  /**
   * Validates the form, then — only when editing AND at least one ticked-off
   * día currently has enrolled students — asks for explicit confirmation
   * before writing anything: `actualizar_categoria` unenrolls those students
   * from the removed día(s) as part of the same atomic transaction, so this
   * is the one place that has to warn about it up front. A día with real
   * `Asistencia` history is a different, harder case: the backend refuses
   * the whole edit for that (no history is ever deleted, see
   * docs/archive/fixes/24-abm-categorias.md), surfaced as `formError` — the
   * banner is for what only the server can know. What the client CAN decide
   * (#861: the training window, the día cap, an inverted franja, a missing
   * required field) is marked on the field it is about instead.
   */
  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    // A new submit attempt always retires whatever error state the LAST one
    // left behind (issue #1325): otherwise a stale duplicate-categoría banner
    // — with its "Editar «X»" action — keeps showing next to field errors
    // that describe a completely different problem, or after the client
    // rejects the form before ever reaching the server again.
    setFormError(null);
    setDuplicateCategoriaCodigo(null);
    // Recomputed from scratch on every submit, so a mark never outlives what
    // it described: fixing the field and pressing "Guardar" again clears it.
    const errores = validarCategoria(formData, selectedDias.size);
    setFieldErrors(errores);
    if (Object.keys(errores).length > 0) return;

    if (editingGroup) {
      const diasAQuitar = editingGroup.rows.filter((row) => !selectedDias.has(row.diaSemana));
      if (diasAQuitar.length > 0) {
        try {
          const listas = await Promise.all(diasAQuitar.map((row) => fetchAlumnosPorHorario(row.id)));
          if (listas.some((alumnos) => alumnos.length > 0)) {
            setPendingDeletionScope("days");
            setPendingDeletions(
              diasAQuitar.map((row, i) => ({ id: row.id, diaSemana: row.diaSemana, alumnos: listas[i] })),
            );
            return; // handleConfirmPendingDeletions calls submitCategoria() on confirm.
          }
        } catch {
          // A roster-check failure must not block saving — the backend still
          // validates (blocks on real Asistencia history) before writing
          // anything either way.
        }
      }
    }

    await submitCategoria();
  }

  /**
   * User confirmed. "days" (mid-edit unticking already warned about enrolled
   * students) proceeds to the one atomic save; "group" (trash icon) deletes
   * the categoría entirely. Neither path has written anything yet — this
   * dialog runs BEFORE the single backend call in both flows now, unlike the
   * old per-día loop it replaces.
   */
  async function handleConfirmPendingDeletions(): Promise<void> {
    if (!pendingDeletions) return;
    if (pendingDeletionScope === "group") {
      const codigo = deletingCategoriaCodigo;
      setPendingDeletions(null);
      setPendingDeletionScope("days");
      if (!codigo) return;
      try {
        await eliminarCategoria(codigo);
        const message = "Categoría eliminada correctamente.";
        showNotification("success", message);
        showSuccess(message);
        closeExpanded();
        await loadData();
      } catch (err) {
        const message = extractErrorMessage(err, "Error al eliminar la categoría.");
        showNotification("error", message);
        showError(message);
      } finally {
        setDeletingCategoriaCodigo(null);
      }
      return;
    }
    setPendingDeletions(null);
    await submitCategoria();
  }

  function handleCancelPendingDeletions(): void {
    setPendingDeletions(null);
    setPendingDeletionScope("days");
    setDeletingCategoriaCodigo(null);
  }

  /** The categoría the open "move players" dialog empties. */
  function categoriaAVaciar(): string | null {
    return pendingDeletionScope === "group" ? deletingCategoriaCodigo : editingGroup?.categoria ?? null;
  }

  /** ADMB-04 (a): everyone to ONE target. "group" is one atomic move+delete
   *  call; "days" saves the edit with `mover_alumnos_a`. A rejection reaches
   *  the dialog, which stays open — the server changed nothing. */
  async function handleMoveAll(destino: string): Promise<{ noEliminada?: string } | void> {
    if (pendingDeletionScope === "group") {
      const codigo = deletingCategoriaCodigo;
      if (!codigo) return;
      const resultado = await moverYEliminarCategoria(codigo, destino);
      if (!resultado.eliminada) {
        // The players moved but the history keeps the categoría: say so and
        // offer to hide it instead of a dead end. Reload behind the dialog.
        void loadData();
        return { noEliminada: resultado.motivo ?? "Los jugadores pasaron, pero la categoría no se pudo eliminar." };
      }
      const quienes = resultado.movidos === 1 ? "1 jugador" : `${resultado.movidos} jugadores`;
      const message = `Se pasó a ${quienes} a ${resultado.categoriaDestinoLabel} y se eliminó la categoría.`;
      handleCancelPendingDeletions();
      showNotification("success", message);
      showSuccess(message);
      closeExpanded();
      await loadData();
      return;
    }
    setPendingDeletions(null);
    await submitCategoria(destino);
  }

  /** The categoría cannot be deleted (history): hide it from the public page. */
  async function handleHideInstead(): Promise<void> {
    const codigo = deletingCategoriaCodigo;
    if (!codigo) return;
    await cambiarPublicacionCategoria(codigo, false);
    const message = "La categoría no se publica en el sitio.";
    handleCancelPendingDeletions();
    showNotification("success", message);
    showSuccess(message);
    closeExpanded();
    await loadData();
  }

  /** ADMB-04 (b): one player to the target the admin picked for them. */
  async function handleMoveOne(personaId: number, destino: string): Promise<void> {
    const codigo = categoriaAVaciar();
    if (!codigo) return;
    await moverAlumnosDeCategoria(codigo, destino, [personaId]);
  }

  /** Closing the "move players" dialog. Players already moved one by one are
   *  real changes, so the screen is reloaded and the stale form closed. */
  function handleCloseMover(huboCambios: boolean): void {
    handleCancelPendingDeletions();
    if (huboCambios) {
      closeExpanded();
      void loadData();
    }
  }

  /**
   * Trash-icon entry point: deletes the categoría entirely (every día row),
   * gated behind the same student-safety confirmation as unticking días
   * mid-edit (`fetchAlumnosPorHorario` per row, `pendingDeletions` +
   * `ConfirmDialog`) — but the actual delete is now ONE atomic backend call
   * (`eliminarCategoria`) in `handleConfirmPendingDeletions`, not a loop.
   */
  async function requestDeleteCategoria(codigo: string, rows: readonly HorarioGroupRow[]): Promise<void> {
    setDeletingId(rows[0]?.id ?? null);
    setDeletingCategoriaCodigo(codigo);
    try {
      const listas = await Promise.all(rows.map((row) => fetchAlumnosPorHorario(row.id)));
      setPendingDeletionScope("group");
      setPendingDeletions(rows.map((row, i) => ({ id: row.id, diaSemana: row.diaSemana, alumnos: listas[i] })));
    } catch (err) {
      const message = extractErrorMessage(err, "Error al eliminar la categoría.");
      showNotification("error", message);
      showError(message);
      setDeletingCategoriaCodigo(null);
    } finally {
      setDeletingId(null);
    }
  }

  /**
   * Categoría form — rendered inline (PR3a), either under the card being
   * edited or, for "Nueva categoría", in its own top-of-list card (no
   * existing card to nest a brand-new one under).
   *
   * v6 (docs/archive/fixes/24-abm-categorias.md): nombre/franja/días are typed
   * input now, not a `<select>` locked to an existing catalog entry — this
   * form is what CREATES the categoría, so there is no catalog entry to pick
   * from yet on that path. `código` is never asked for: the server derives
   * it from `nombre` and it does not change on a rename.
   */
  function renderHorarioForm(): React.ReactElement {
    return (
      <>
        <h3 className="mb-4 font-display text-lg uppercase leading-tight tracking-flat text-ink">
          {editingGroup !== null ? "Editar categoría" : "Nueva categoría"}
        </h3>
        {editingGroup === null && (
          <p className="mb-4 flex items-center gap-2 text-sm text-ink-3">
            <EyeOff size={ICON.sm} strokeWidth={2} aria-hidden="true" />
            {NUEVA_CATEGORIA_OCULTA_NOTA}
          </p>
        )}
        {formError && (
          <div className="mb-4">
            <div className="alert-error" role="alert"><LinkifiedText text={formError} /></div>
            {duplicateCategoriaCodigo && (
              <div className="mt-2">
                <Button size="sm" onClick={() => openCategoriaEdit(duplicateCategoriaCodigo)}>
                  Editar «{categoriaLabel(duplicateCategoriaCodigo)}»
                </Button>
              </div>
            )}
          </div>
        )}
        {/*
          `noValidate` (#861): without it the browser's own constraint
          validation refuses to submit while any `required` field below is
          empty, so `handleSubmit` never runs and NONE of this form's messages
          — the ones it has carried since v6 included — ever reach a real
          screen. They only ever appeared under jsdom, which does not enforce
          constraint validation, which is exactly why the suite never noticed.
          The `required`/`min`/`max` attributes stay: they are what the
          picker and assistive tech read. `/login` (issue #51) carries the
          same attribute for the same reason.
        */}
        <form onSubmit={(e) => void handleSubmit(e)} className="grid gap-5 sm:grid-cols-2 sm:gap-x-8 sm:gap-y-section" noValidate>
          <div className="flex flex-col gap-field">
            <label htmlFor="categoria-nombre" className={FIELD_LABEL}>
              Nombre
            </label>
            <input
              id="categoria-nombre"
              type="text"
              className={`${FIELD_CONTROL} ${fieldErrors.nombre ? "border-state-bad" : ""}`}
              value={formData.nombre}
              onChange={(e) => setFormData((prev) => ({ ...prev, nombre: e.target.value }))}
              placeholder="Ej: Preinfantil"
              required
              aria-invalid={fieldErrors.nombre ? true : undefined}
              aria-describedby={fieldErrors.nombre ? NOMBRE_ERROR_ID : undefined}
            />
            {fieldErrors.nombre && (
              <p id={NOMBRE_ERROR_ID} role="alert" className={FIELD_ERROR_CLASSES}>
                {fieldErrors.nombre}
              </p>
            )}
          </div>
          {/*
            Edades (#789) — orientation copy for the public board, never a
            rule: no age is validated against it, so the field is optional and
            a categoría without one saves exactly like any other. `maxLength`
            matches the column (50). Marked "opcional" rather than left
            unmarked: every other field here is required, so the absence of an
            asterisk is not by itself a statement.
          */}
          <div className="flex flex-col gap-field">
            <label htmlFor="categoria-edades" className={FIELD_LABEL}>
              Edades <span className="font-semibold normal-case text-ink-3">· opcional</span>
            </label>
            <input
              id="categoria-edades"
              type="text"
              className={FIELD_CONTROL}
              value={formData.edades}
              onChange={(e) => setFormData((prev) => ({ ...prev, edades: e.target.value }))}
              placeholder="Ej: 5 a 10 años"
              maxLength={50}
            />
          </div>
          {/*
            Horario: the two pickers state the franja in one format (24 h).
            `TimePicker24` carries the window bounds, but they are NOT the
            check: `validarCategoria` decides on submit, and the backend after
            it. The chip is a live hint only. The inverted-franja message sits
            under the row because it describes BOTH pickers.
          */}
          <div role="group" aria-labelledby="categoria-horario-label" className="flex flex-col gap-field">
            <div id="categoria-horario-label" className={FIELD_LABEL}>
              Horario <span className="font-semibold normal-case text-ink-3">· 24 h</span>
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2.5">
              <TimePicker24
                id="categoria-hora-inicio"
                label="Hora de inicio"
                value={formData.horaInicio}
                min={HORA_MINIMA_ENTRENAMIENTO}
                max={HORA_MAXIMA_ENTRENAMIENTO}
                onChange={(horaInicio) => setFormData((prev) => ({ ...prev, horaInicio }))}
                invalid={Boolean(fieldErrors.horaInicio || fieldErrors.franja)}
                describedBy={
                  fieldErrors.horaInicio
                    ? HORA_INICIO_ERROR_ID
                    : fieldErrors.franja
                      ? FRANJA_ERROR_ID
                      : undefined
                }
              />
              <span aria-hidden="true" className="text-ink-3">–</span>
              <TimePicker24
                id="categoria-hora-fin"
                label="Hora de fin"
                value={formData.horaFin}
                min={HORA_MINIMA_ENTRENAMIENTO}
                max={HORA_MAXIMA_ENTRENAMIENTO}
                onChange={(horaFin) => setFormData((prev) => ({ ...prev, horaFin }))}
                invalid={Boolean(fieldErrors.horaFin || fieldErrors.franja)}
                describedBy={
                  fieldErrors.horaFin
                    ? HORA_FIN_ERROR_ID
                    : fieldErrors.franja
                      ? FRANJA_ERROR_ID
                      : undefined
                }
              />
              <span aria-live="polite" className="contents">
                {formData.horaInicio && formData.horaFin && (
                  duracionLabel(formData.horaInicio, formData.horaFin) ? (
                    <span className="flex h-ctl items-center whitespace-nowrap rounded-ctl bg-sunken px-3 text-sm font-semibold tabular-nums text-ink-2">
                      {duracionLabel(formData.horaInicio, formData.horaFin)}
                    </span>
                  ) : (
                    <span className="flex h-ctl items-center whitespace-nowrap rounded-ctl bg-state-bad/10 px-3 text-sm font-semibold text-state-bad">
                      Fin antes del inicio
                    </span>
                  )
                )}
              </span>
            </div>
            {fieldErrors.horaInicio && (
              <p id={HORA_INICIO_ERROR_ID} role="alert" className={FIELD_ERROR_CLASSES}>
                {fieldErrors.horaInicio}
              </p>
            )}
            {fieldErrors.horaFin && (
              <p id={HORA_FIN_ERROR_ID} role="alert" className={FIELD_ERROR_CLASSES}>
                {fieldErrors.horaFin}
              </p>
            )}
            {fieldErrors.franja && (
              <p id={FRANJA_ERROR_ID} role="alert" className={FIELD_ERROR_CLASSES}>
                {fieldErrors.franja}
              </p>
            )}
          </div>
          {/*
            First fieldset-level error mark in this app (#861): the día cap is
            about the SET of toggles, not any single one, so there is no
            input to hang it on. It follows the same contract every per-field
            mark here does — `aria-invalid` + `aria-describedby` on the
            control, the message as a `role="alert"` paragraph — with the
            `<fieldset>` standing in for the input. The 7th día is never
            disabled: tapping it past the cap explains itself inline instead.
          */}
          <fieldset
            className="min-w-0"
            aria-invalid={fieldErrors.dias ? true : undefined}
            aria-describedby={fieldErrors.dias ? DIAS_ERROR_ID : undefined}
          >
            <legend className={`${FIELD_LABEL} mb-field`}>
              Días<span className="sr-only"> (obligatorio)</span>
            </legend>
            <div className="flex h-ctl overflow-hidden rounded-ctl border border-line-2">
              {DIA_ORDER.filter((dia) => dia !== "DOMINGO" || selectedDias.has(dia)).map((dia) => {
                const activo = selectedDias.has(dia);
                return (
                  <button
                    key={dia}
                    type="button"
                    aria-pressed={activo}
                    aria-label={DIA_LABELS[dia]}
                    onClick={() => toggleDia(dia)}
                    className={`flex-1 border-l border-line text-sm font-semibold first:border-l-0 ${
                      activo ? "border-l-ink bg-ink text-paper" : "bg-paper text-ink-3 hover:bg-sunken"
                    }`}
                  >
                    {(DIA_LABELS[dia] ?? dia).slice(0, 3)}
                  </button>
                );
              })}
            </div>
            {diasTopeMensaje && (
              <p role="alert" className={FIELD_ERROR_CLASSES}>
                {diasTopeMensaje}
              </p>
            )}
            {fieldErrors.dias && (
              <p id={DIAS_ERROR_ID} role="alert" className={FIELD_ERROR_CLASSES}>
                {fieldErrors.dias}
              </p>
            )}
          </fieldset>
          <div className="flex justify-end gap-2.5 sm:col-span-2 max-sm:[&>*]:flex-1">
            <Button variant="tertiary" className="!bg-transparent" onClick={closeExpanded}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={formSubmitting}>
              {formSubmitting && <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />}
              {editingGroup !== null ? "Guardar cambios" : "Crear categoría"}
            </Button>
          </div>
        </form>

        {/* Danger zone, exactly where `15-horario-editar.html` puts it: inside
            the edit form, not on the card. Deleting removes the categoría
            entera — every día row — so it must not hang off a card that
            names one single day. Blocked server-side (400) when any día has
            real Asistencia history; see docs/archive/fixes/24-abm-categorias.md.

            Hidden while the categoría has no día rows yet (a catalog-only
            categoría being scheduled for the first time, #1315): there is
            nothing to delete from this form until its first save creates the
            horarios, so the control would only promise an action that cannot
            run. */}
        {editingGroup !== null && puedeEliminarCategoria(editingGroup) && (
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <div className="min-w-[220px] flex-1">
              <p className="text-sm font-semibold text-state-bad">Eliminar esta categoría</p>
              <p className="text-xs text-ink-3">
                Se eliminan todos sus días. No se puede mientras tenga jugadores inscritos
                (reasígnalos primero) ni si alguno de sus días tiene asistencias registradas.
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => void requestDeleteCategoria(editingGroup.categoria, editingGroup.rows)}
              disabled={deletingId !== null}
            >
              {deletingId !== null ? (
                <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
              )}
              Eliminar…
            </Button>
          </div>
        )}
      </>
    );
  }

  /**
   * The "Editar" accordion panel of a categoría card.
   *
   * Goes straight to the form in the normal case (one editable group per
   * categoría). When the categoría's weekdays are split across several groups
   * it asks which one first, because there is no single answer to "edit this
   * categoría" then and picking silently would hide the split.
   */
  function renderEditPanel(card: CategoriaCard): React.ReactElement {
    if (editingGroup === null && card.groups.length > 1) {
      return (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="flex-1 font-display text-lg uppercase leading-tight tracking-flat text-ink">
              Editar {categoriaLabel(card.categoria)}
            </h3>
            <Button size="sm" onClick={closeExpanded}>
              Cerrar
            </Button>
          </div>
          <p className="mb-3 text-xs text-ink-3">
            Los días de esta categoría no comparten la misma configuración, así que se
            configuran por separado. Elige cuál editar.
          </p>
          <ul className="overflow-hidden rounded-ctl border border-line">
            {card.groups.map((group) => {
              const dias = formatDiaSet(group.rows.map((row) => row.diaSemana));
              return (
                <li
                  key={group.key}
                  className="flex min-h-drow flex-wrap items-center gap-3 border-b border-line px-3 py-2 last:border-b-0"
                >
                  <span className="min-w-0 flex-1 text-sm text-ink">
                    {dias}
                  </span>
                  <Button
                    size="sm"
                    className="flex-none"
                    onClick={() => selectEditingGroup(group)}
                    aria-label={`Editar los días ${dias} de ${categoriaLabel(card.categoria)}`}
                  >
                    Editar
                  </Button>
                </li>
              );
            })}
          </ul>
        </>
      );
    }
    return renderHorarioForm();
  }

  /** Roster/assign panel — real enrollment via `fetchAlumnosPorHorario`,
   * rendered inline (PR3a). Assignment/unassignment/roster act on the WHOLE
   * grupo (every underlying `horario_id` día row) at once — there is no
   * per-día selection anymore, since a student belongs to every día of the
   * grupo, never to a single loose day.
   *
   * TWO THINGS THE PRODUCT OWNER ASKED FOR, and both are about order and
   * length rather than about enrolment itself:
   *
   *   - *"el asignar nuevo estudiante que se vea al inicio no al final"*. The
   *     picker used to sit under the whole roster, so on `Formativo` — 44
   *     students — adding somebody meant scrolling past every name already in
   *     the group to reach the one control that adds another. It leads now.
   *   - *"paginar el desplegable de ver estudiante en horarios"*. The roster
   *     was printed whole. It pages ten at a time through the shared
   *     `Pagination` primitive — the one pager in the product; the audit found
   *     six and consolidated them, so this screen does not get a seventh.
   */
  function renderAlumnosPanel(card: CategoriaCard): React.ReactElement {
    const rows = card.rows;
    const totalPages = getTotalPages(roster.alumnos.length, ALUMNOS_PAGE_SIZE);
    // Clamped rather than trusted: desasignar can shorten the roster past the
    // page being read, and a page beyond the end would render an empty list
    // with no way back to the rows that are still there.
    const currentPage = Math.min(roster.page, totalPages);
    const alumnosVisibles = paginateRecords(roster.alumnos, currentPage, ALUMNOS_PAGE_SIZE);

    return (
      <>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserPlus size={ICON.sm} strokeWidth={1.5} className="text-state-bad" aria-hidden="true" />
            <h3 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">
              Jugadores de {categoriaLabel(card.categoria)}
            </h3>
          </div>
          <Button size="sm" onClick={closeExpanded}>
            Cerrar
          </Button>
        </div>

        {/* Asignar first — before the roster, not after it. It is the panel's
            main task, so it sits in its own framed box. */}
        <div className="mb-4 flex flex-col gap-3 rounded-card border border-line bg-sunken p-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="alumno-select" className="mb-1 block text-xs font-semibold text-ink-2">
              Agregar un jugador a esta categoría
            </label>
            <StudentSearch
              id="alumno-select"
              ariaLabel="Seleccionar jugador"
              placeholder="Buscar jugador por nombre…"
              role="ALUMNO"
              excludeIds={roster.alumnos.map((alumno) => alumno.personaId)}
                  showExcluded
              disabled={roster.assigning}
              onSelect={(alumno) => roster.setSelectedId(alumno.id)}
              onClear={() => roster.setSelectedId(null)}
            />
          </div>
          {/* `ui/Button`, not a raw `.btn-primary`. The global class carries
              a 12px radius and its own padding — a third shape and a fourth
              height — on a screen that imports the primitive twenty lines
              above. `dark` rather than `primary` because this panel opens
              inside a row and the screen's red belongs to the destructive
              dialog. */}
          <Button
            variant="primary"
            onClick={() => void roster.assign(rows)}
            disabled={!roster.selectedId || roster.assigning}
          >
            {roster.assigning ? (
              <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
            ) : (
              <UserPlus size={ICON.sm} strokeWidth={2} aria-hidden="true" />
            )}
            Asignar
          </Button>
        </div>

        {roster.loading ? (
          <LoadingState label="Cargando jugadores…" />
        ) : roster.alumnos.length === 0 ? (
          /*
           * The hole this panel shipped with. The branch below was
           * `roster.alumnos.length > 0 && (…)`, so a categoría with nobody
           * enrolled rendered LITERALLY NOTHING under the assign picker — no
           * statement, no explanation, just the card ending. D11's three parts
           * were zero of three, and the state is reachable the moment the club
           * opens a categoría before filling it.
           *
           * `inset`, because this is the body of a panel the row already
           * opened. The way out is the picker directly above, so the statement
           * points at it rather than growing a second copy of the control.
           */
          <div className="border-t border-line pt-4">
            <EmptyState
              surface="inset"
              icon={<UserPlus size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
              title="Esta categoría todavía no tiene jugadores"
              description="Elige un jugador en el selector de arriba y presiona «Asignar» para inscribirlo en todos los días de la categoría."
            />
          </div>
        ) : (
          roster.alumnos.length > 0 && (
            <div className="border-t border-line pt-4">
              <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-ink-3-strong">
                Jugadores asignados ({roster.alumnos.length})
              </p>
              <ul className="grid gap-2 lg:grid-cols-2 2xl:grid-cols-3">
                {alumnosVisibles.map((a) => (
                  <li
                    key={a.id}
                    className="flex min-w-0 items-center gap-3 rounded-ctl border border-line bg-surface px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-ink">{a.personaNombreCompleto}</p>
                      <p className="text-xs text-ink-3">{a.edad} años</p>
                    </div>
                    {/* `secondary` + `text-state-bad`: destructive without
                        competing with the panel's red "Asignar". `aria-label`
                        overrides the visible "Desasignar" so the accessible
                        name still names WHICH student. */}
                    <Button
                      variant="secondary"
                      size="sm"
                      className="shrink-0 text-state-bad"
                      onClick={() => setPendingUnassign({ card, alumno: a })}
                      aria-label={`Desasignar a ${a.personaNombreCompleto}`}
                    >
                      <UserMinus size={ICON.sm} strokeWidth={2} aria-hidden="true" />
                      Desasignar
                    </Button>
                  </li>
                ))}
              </ul>
              {roster.alumnos.length > ALUMNOS_PAGE_SIZE && (
                <Pagination
                  page={currentPage}
                  totalPages={totalPages}
                  onPageChange={roster.setPage}
                  totalItems={roster.alumnos.length}
                  pageSize={ALUMNOS_PAGE_SIZE}
                  itemNoun="jugador"
                  itemNounPlural="jugadores"
                  variant="footer"
                />
              )}
            </div>
          )
        )}
      </>
    );
  }

  /** How many unassigned students the rail lists per page. Five, not the
   * ten-row list standard: a deliberate, user-directed rail-widget exception
   * (admin v4 review R4), hence not named `*PAGE_SIZE`. */
  const SIN_GRUPO_RAIL_ROWS = 5;

  function renderRail(): React.ReactElement {
    const sinGrupoAlumnos = summary.sinGrupoAlumnos;
    // Clamped: the list can shrink (a student gets assigned) under the page being read.
    const sinGrupoTotalPages = getTotalPages(sinGrupoAlumnos.length, SIN_GRUPO_RAIL_ROWS);
    const sinGrupoCurrentPage = Math.min(sinGrupoPage, sinGrupoTotalPages);
    const sinGrupoFrom = (sinGrupoCurrentPage - 1) * SIN_GRUPO_RAIL_ROWS;
    return (
      <div className="grid content-start gap-page" data-testid="groups-rail">
        <InfoPanel title="Cómo funciona">
          <dl className="grid gap-2">
            <div>
              <dt className="font-semibold text-ink">Categorías y horarios</dt>
              <dd>Cada categoría tiene una franja horaria y los días en que entrena.</dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Inscripción</dt>
              <dd>
                «Agregar jugadores» inscribe al jugador en todos los días de la categoría a la vez, nunca solo en algunos.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Ocultar del sitio</dt>
              <dd>
                Quita la categoría del sitio público. Sigue activa para inscripciones y asistencia, y puede volver a
                mostrarla cuando quiera.
              </dd>
            </div>
          </dl>
        </InfoPanel>

        <InfoPanel title="Qué hacer después">
          <ul className="grid gap-2">
            <li>Asigna a los jugadores sin grupo desde «Agregar jugadores» en la categoría que les corresponda.</li>
            <li>Usa «Editar» para cambiar la franja horaria o los días de una categoría.</li>
          </ul>
        </InfoPanel>

        <InfoPanel
          title="Sin grupo"
          className={sinGrupoAlumnos.length > 0 ? "border-state-warn/30" : undefined}
        >
          <div id="sin-grupo" className="scroll-mt-24" />
          {summary.sinGrupo === null ? (
            <p>Calculando jugadores sin horario…</p>
          ) : sinGrupoAlumnos.length === 0 ? (
            <p>Todos los jugadores activos tienen un horario asignado.</p>
          ) : (
            <>
              <ul className="grid gap-1" data-testid="sin-grupo-list">
                {sinGrupoAlumnos.slice(sinGrupoFrom, sinGrupoFrom + SIN_GRUPO_RAIL_ROWS).map((alumno) => (
                  <li key={alumno.id} className="flex min-h-[32px] items-center gap-2 text-ink">
                    <Badge tone="warn">Sin horario</Badge>
                    <span className="min-w-0 truncate">
                      {alumno.nombres} {alumno.apellidos}
                    </span>
                  </li>
                ))}
              </ul>
              {sinGrupoAlumnos.length > SIN_GRUPO_RAIL_ROWS && (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs tabular-nums text-ink-3">
                    {sinGrupoFrom + 1}–{Math.min(sinGrupoFrom + SIN_GRUPO_RAIL_ROWS, sinGrupoAlumnos.length)} de{" "}
                    {sinGrupoAlumnos.length}
                  </p>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      onClick={() => setSinGrupoPage(sinGrupoCurrentPage - 1)}
                      disabled={sinGrupoCurrentPage <= 1}
                    >
                      Anterior
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => setSinGrupoPage(sinGrupoCurrentPage + 1)}
                      disabled={sinGrupoCurrentPage >= sinGrupoTotalPages}
                    >
                      Siguiente
                    </Button>
                  </div>
                </div>
              )}
              <p className="border-t border-line pt-3 text-xs text-ink-3">
                Para asignarlos, presione «Agregar alumnos» en la categoría y búsquelos por nombre.{" "}
                <Link href="/members" className="font-semibold text-ink underline underline-offset-2">
                  Ver miembros
                </Link>
              </p>
            </>
          )}
        </InfoPanel>
      </div>
    );
  }

  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <AppShell
        title="Grupos y horarios"
        subtitle="Organiza las categorías, sus horarios y los jugadores de cada una."
        actions={
          // Disabled while `categorias` (part of `loadData`'s Promise.all,
          // same as `horarios`/`allStudents`) hasn't loaded yet — the create
          // form's categoría <select>/locked horario/día checkboxes all read
          // from it, so opening the form before it answers would show a
          // blank/raw-code categoría instead of waiting for it like the rest
          // of the screen does.
          <Button variant="dark" onClick={openCreateForm} disabled={loading}>
            <Plus size={ICON.sm} strokeWidth={2} aria-hidden="true" />
            Nueva categoría
          </Button>
        }
      >
        {loadError && (
          <ErrorState message={loadError} onRetry={() => void loadData()} />
        )}

        {notification && (
          <div
            className={`flex items-center gap-2 rounded-card px-4 py-3 text-sm ${
              notification.type === "success"
                ? "border border-state-ok/30 bg-state-ok-bg text-state-ok"
                : "border border-state-bad/30 bg-state-bad-bg text-state-bad"
            }`}
            role="alert"
          >
            {notification.type === "success" ? (
              <CheckCircle2 size={ICON.sm} strokeWidth={2} aria-hidden="true" />
            ) : (
              <AlertTriangle size={ICON.sm} strokeWidth={2} aria-hidden="true" />
            )}
            <span><LinkifiedText text={notification.message} /></span>
          </div>
        )}

        {advertencias.length > 0 && (
          <div
            data-testid="categoria-advertencias"
            role="status"
            className="flex items-start gap-2 rounded-card border border-state-warn/30 bg-state-warn-bg px-4 py-3 text-sm text-state-warn"
          >
            <AlertTriangle size={ICON.sm} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0" />
            <ul className="min-w-0 flex-1">
              {advertencias.map((aviso) => (
                <li key={aviso}>{aviso}</li>
              ))}
            </ul>
            <Button size="sm" onClick={() => setAdvertencias([])}>Cerrar</Button>
          </div>
        )}

        {expandedGroup?.key === NEW_GROUP_KEY && (
          <div className="card p-5">
            {renderHorarioForm()}
          </div>
        )}

        {!loading && categoriaCards.length > 0 ? (
          <div data-testid="groups-summary" className={STAT_GRID}>
            <StatCard
              label="Categorías"
              value={categoriaCards.length}
              hint={
                categoriasOcultas > 0
                  ? `${categoriasOcultas} oculta${categoriasOcultas === 1 ? "" : "s"} en el sitio`
                  : "Todas visibles en el sitio"
              }
            />
            <StatCard label="Horarios" value={horarios.length} hint="Sesiones por semana, sumando todos los días" />
            <StatCard
              label="Jugadores en grupos"
              value={summary.inscriptos ?? "—"}
              hint={summary.inscriptos === null ? "Calculando…" : `De ${summary.activos} jugadores activos`}
            />
            {/* Attention card: the one figure that is a queue of work. */}
            <StatCard
              label="Sin grupo"
              value={summary.sinGrupo ?? "—"}
              variant={summary.sinGrupo ? "hot" : "default"}
              href={summary.sinGrupo ? "#sin-grupo" : undefined}
              hint={
                summary.sinGrupo
                  ? "Ver quiénes son y asignarlos"
                  : summary.sinGrupo === 0
                    ? "Todos los activos tienen horario"
                    : "Calculando…"
              }
            />
          </div>
        ) : null}

        <div className={PAGE_RAIL}>
        <div className="grid min-w-0 content-start gap-page">
        {loading ? (
          <div className="card">
            <LoadingState label="Cargando horarios…" />
          </div>
        ) : categoriaCards.length > 0 || catalogoPendientes.length > 0 ? (
          <div className="card overflow-hidden">
            {/* Column legend, once for the whole list instead of a repeated
                micro-label inside each of the five rows. Hidden below `xl`,
                where the rows stack and carry their own labels.

                `aria-hidden` is correct and stays: every cell below carries the
                same label as an `sr-only` span, so announcing this strip too
                would read each column name twice per row. What was wrong was
                that only two of the four cells actually carried one — see
                `COLUMNS`. */}
            <div
              className={`hidden h-thead border-b border-line bg-sunken px-5 ${CELL_LABEL} ${ROW_COLUMNS}`}
              aria-hidden="true"
            >
              {COLUMNS.map((column) => (
                // The action column's name is for assistive tech only: a
                // visible "Acciones" over two buttons that already say what
                // they do is a label nobody reads.
                <span key={column}>{column === "Acciones" ? "" : column}</span>
              ))}
            </div>

            <ul className="divide-y divide-line">
              {categoriaCards.map((card) => {
                // Deletion (inside the edit panel) removes a whole group — every
                // one of its día rows — so the categoría's row busies out.
                const isDeleting = card.rows.some((row) => row.id === deletingId);
                const isExpanded = expandedGroup?.key === card.categoria;
                const editOpen = isExpanded && expandedGroup.tab === "editar";
                const metadata = categorias[card.categoria as Categoria];
                // An unrecognized `categoria` has no metadata, so the track
                // falls back to the días the rows themselves carry.
                const diaTrack = buildDiaTrack(metadata?.dias ?? [], card.dias);
                const inscriptos = countInscriptos(card.rows, personasPorHorario);

                return (
                  /*
                   * A DISCLOSURE row, not a table row — which is why this list
                   * is not `ui/Table` and that is a decision, not an omission.
                   *
                   * Each row holds a footnote line and, when expanded, a whole
                   * edit form or student roster. A `<table>` carries those as
                   * `colSpan` rows, which breaks the primitive's last-row border
                   * rule and its `divide-y`; and `TableCell` fixes `h-row`,
                   * which the stacked layout below `xl` has to override with a
                   * competing `height` utility — the same specificity trap that
                   * cost this repo two measured bugs in Fase 1.
                   *
                   * What WAS wrong here — a column with no accessible name, and
                   * a row height invented with `py-*` — is fixed above and here.
                   * The height is `min-h-drow`, the dense-row token every other
                   * secondary list in the product already uses.
                   */
                  <li
                    key={card.categoria}
                    data-testid="horario-card"
                    className="min-h-drow px-5 py-4 2xl:py-12"
                  >
                    {/* Three shapes, one row: a stack on a phone, two columns
                        on the tablet/small-laptop band where the five tracks do
                        not fit but a single column wastes half the width, and
                        the full five-column row from `xl` up. */}
                    <div className={`flex flex-col gap-3.5 md:grid md:grid-cols-2 md:items-start md:gap-x-6 ${ROW_COLUMNS}`}>
                      <div className="min-w-0">
                        <CellLabel>{COLUMNS[0]}</CellLabel>
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <b className="text-base text-ink">
                            {categoriaLabel(card.categoria)}
                          </b>
                          {/* The publication fact, readable at a glance — the
                              toggle button names the ACTION, this names the
                              STATE, so the card never makes the admin infer
                              one from the other. */}
                          {!(categorias[card.categoria as Categoria]?.visible ?? true) && (
                            <Badge tone="neutral">Oculta en el sitio</Badge>
                          )}
                        </div>
                        <div className="mt-2">
                          {renderPublicacionToggle(card.categoria, categoriaLabel(card.categoria), isDeleting)}
                        </div>
                      </div>

                      {/* Days and time, both derived from the rows that exist. A
                          categoría that drifts off Monday–Friday says so here —
                          the live Saturday COMPETITIVO row reads "Lunes a viernes
                          + sábado" rather than being rounded to the norm — and the
                          track below it marks which días those are. */}
                      <div className="min-w-0">
                        <CellLabel>{COLUMNS[1]}</CellLabel>
                        <p className="text-sm text-ink-2">
                          {formatDiaSet(card.dias)} · {formatTime(card.horaInicio)} —{" "}
                          {formatTime(card.horaFin)}
                        </p>
                        <div className="mt-2">
                          <DiaTrack track={diaTrack} dias={card.dias} />
                        </div>
                      </div>

                      {/* Distinct students across the categoría's días. Absent
                          rather than zero while any roster is still unanswered —
                          the club plans around this figure. */}
                      <div className={`min-w-0 ${inscriptos === null ? "hidden 2xl:block" : ""}`}>
                        {inscriptos !== null && (
                          <>
                            <CellLabel>{COLUMNS[2]}</CellLabel>
                            {/* The count is also the way in to the roster. */}
                            <button
                              type="button"
                              className="rounded-ctl text-base font-semibold text-ink underline decoration-line-2 underline-offset-4 hover:decoration-ink max-md:inline-flex max-md:min-h-10 max-md:items-center"
                              onClick={() => openAlumnosTab(card)}
                              disabled={isDeleting}
                              aria-label={`Ver jugadores de ${cardTitle(card)}`}
                            >
                              {inscriptos} inscrito{inscriptos === 1 ? "" : "s"}
                            </button>
                          </>
                        )}
                      </div>

                      <div className="flex gap-2 md:col-span-2 md:justify-end 2xl:col-span-1 2xl:justify-end">
                        <span className="sr-only">{COLUMNS[3]}</span>
                        <Button
                          variant="dark"
                          size="sm"
                          className="flex-1 md:flex-none"
                          onClick={() => openAlumnosTab(card, true)}
                          disabled={isDeleting}
                          aria-label={`Agregar jugadores a ${cardTitle(card)}`}
                        >
                          <UserPlus size={ICON.sm} strokeWidth={2} aria-hidden="true" />
                          Agregar jugadores
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="flex-1 md:flex-none"
                          onClick={() => (editOpen ? closeExpanded() : openEditForm(card))}
                          disabled={isDeleting}
                          aria-expanded={editOpen}
                          aria-label={`${editOpen ? "Cerrar edición de" : "Editar"} ${cardTitle(card)}`}
                        >
                          {editOpen ? "Cerrar edición" : "Editar"}
                        </Button>
                      </div>
                    </div>

                    {isExpanded && expandedGroup.tab === "editar" && (
                      <div className="mt-4 border-t border-line pt-4">{renderEditPanel(card)}</div>
                    )}

                    {isExpanded && expandedGroup.tab === "alumnos" && (
                      <div className="mt-4 border-t border-line pt-4">
                        {renderAlumnosPanel(card)}
                      </div>
                    )}
                  </li>
                );
              })}

              {/* Catalog-only categorías (#1315): real categorías the backend
                  seeded but that have no `horario_entrenamiento` rows yet.
                  They render after the scheduled cards as a
                  pending-configuration queue. Same visual treatment as the
                  groups above — same row language — with a distinct testid so
                  "scheduled card" assertions stay precise. The difference is
                  the badge and the action: this one opens the v6 edit form so
                  the admin can define its días and franja. */}
              {catalogoPendientes.map((entry) => (
                <li
                  key={entry.categoria}
                  data-testid="catalogo-pendiente-card"
                  className="min-h-drow px-5 py-4 2xl:py-12"
                >
                  <div className={`flex flex-col gap-3.5 md:grid md:grid-cols-2 md:items-start md:gap-x-6 ${ROW_COLUMNS}`}>
                    <div className="min-w-0">
                      <CellLabel>{COLUMNS[0]}</CellLabel>
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <b className="text-base text-ink">{entry.label}</b>
                        <Badge tone="warn">Sin horarios de entrenamiento todavía</Badge>
                        {!(categorias[entry.categoria as Categoria]?.visible ?? true) && (
                          <Badge tone="neutral">Oculta en el sitio</Badge>
                        )}
                      </div>
                      <div className="mt-2">{renderPublicacionToggle(entry.categoria, entry.label, false)}</div>
                    </div>

                    {/* Días permitidos, in words and on the strip. The días are
                        dashed ("disponible"), never lit: nothing runs yet. */}
                    <div className="min-w-0">
                      <CellLabel>{COLUMNS[1]}</CellLabel>
                      <p className="text-sm text-ink-2">
                        Días permitidos: {formatDiaSet(entry.dias)} · {formatTime(entry.horaInicio)} —{" "}
                        {formatTime(entry.horaFin)}
                      </p>
                      <div className="mt-2">
                        <DiaTrack track={entry.dias} dias={[]} />
                      </div>
                    </div>

                    {/* No roster exists yet, so no count to show. The empty
                        cell keeps the action column aligned with the rows
                        above at `xl`. */}
                    <div className="hidden min-w-0 2xl:block" />

                    <div className="flex gap-2 md:col-span-2 md:justify-end 2xl:col-span-1 2xl:justify-end">
                      <span className="sr-only">{COLUMNS[3]}</span>
                      <Button
                        variant="dark"
                        size="sm"
                        className="flex-1 md:flex-none"
                        onClick={() => openCatalogoEditForm(entry)}
                        aria-label={`Definir horarios de ${entry.label}`}
                      >
                        Definir horarios
                      </Button>
                    </div>
                  </div>

                  {expandedGroup?.key === entry.categoria && expandedGroup.tab === "editar" && (
                    <div className="mt-4 border-t border-line pt-4">{renderHorarioForm()}</div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!loading && horarios.length === 0 && catalogoVacio && (
          <EmptyState
            icon={<Calendar size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
            title="No hay categorías configuradas"
            description="Crea una categoría con sus días de entrenamiento para empezar a asignarle jugadores."
            action={
              <Button variant="primary" onClick={openCreateForm}>
                <Plus size={ICON.sm} strokeWidth={2} aria-hidden="true" />
                Crear primera categoría
              </Button>
            }
          />
        )}

        </div>

        {renderRail()}
        </div>

        {pendingDeletions !== null && pendingDeletions.length > 0 && countUniqueAlumnos(pendingDeletions) > 0 && (
          <MoverAlumnosDialog
            title="Categoría con jugadores inscritos"
            message={pendingDeletionsMessage(pendingDeletions, pendingDeletionScope)}
            alumnos={uniqueAlumnos(pendingDeletions)}
            destinos={Object.entries(categorias)
              .filter(([codigo]) => codigo !== categoriaAVaciar())
              .map(([codigo, info]) => ({ codigo, label: info?.label ?? codigo }))}
            moveAllLabel={
              pendingDeletionScope === "group"
                ? "Pasar a todos y eliminar la categoría"
                : "Pasar a todos y quitar el día"
            }
            emptyConfirmLabel={pendingDeletionScope === "group" ? "Eliminar categoría" : "Guardar cambios"}
            onMoveAll={handleMoveAll}
            onHide={handleHideInstead}
            onMoveOne={handleMoveOne}
            onConfirmEmpty={() => void handleConfirmPendingDeletions()}
            onClose={handleCloseMover}
          />
        )}
        <ConfirmDialog
          open={
            pendingDeletions !== null &&
            pendingDeletions.length > 0 &&
            countUniqueAlumnos(pendingDeletions) === 0
          }
          variant="danger"
          title="Eliminar categoría completa"
          message={
            pendingDeletions ? pendingDeletionsMessage(pendingDeletions, pendingDeletionScope) : ""
          }
          confirmLabel="Eliminar categoría"
          onConfirm={() => void handleConfirmPendingDeletions()}
          onCancel={handleCancelPendingDeletions}
        />

        <ConfirmDialog
          open={pendingUnassign !== null}
          variant="danger"
          title="Desasignar jugador"
          message={
            pendingUnassign
              ? `¿Desasignar a ${pendingUnassign.alumno.personaNombreCompleto} de ${categoriaLabel(
                  pendingUnassign.card.categoria,
                )}? Se lo quitará de todos los días de la categoría.`
              : ""
          }
          confirmLabel="Desasignar"
          onConfirm={handleConfirmUnassign}
          onCancel={handleCancelUnassign}
        />
      </AppShell>
    </ProtectedRoute>
  );
}
