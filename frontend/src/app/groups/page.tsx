/**
 * Horarios — Admin page for managing training schedules.
 *
 * NAMING (three names, one thing — read this before renaming anything):
 *   - USER-FACING name: **Horarios**. That is what the nav says
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

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/contexts/ToastContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import StudentSearch from "@/components/StudentSearch";
import AppShell from "@/components/shell/AppShell";
import {
  Calendar,
  Plus,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  UserPlus,
  UserMinus,
} from "lucide-react";
import { ICON } from "@/lib/icon-size";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button, DataBox, DataRow, DataRowList, EmptyState, ErrorState, LoadingState, Pagination, WeekStrip } from "@/components/ui";
import { getTotalPages, paginateRecords } from "@/app/attendance/attendance-utils";
import { useGroupRoster } from "./useGroupRoster";
import {
  fetchHorarios,
  crearCategoria,
  actualizarCategoria,
  eliminarCategoria,
  fetchMembers,
  fetchAlumnosPorHorario,
  fetchRosterDeTodosLosHorarios,
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
  countUniqueAlumnos,
  buildCategoriaCards,
  formatDiaSet,
  countInscriptos,
  buildDiaTrack,
  DIA_ORDER,
  DIA_LABELS,
  formatTime,
  toStripDias,
  type CategoriaCard,
  type PersonasPorHorario,
} from "./groups-page-utils";
import { toUserMessage } from "@/lib/error-message";
import { joinWithY } from "@/lib/format-utils";

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
  "xl:grid xl:grid-cols-[minmax(140px,0.95fr)_minmax(200px,1.25fr)_minmax(92px,0.5fr)_192px] " +
  "xl:items-center xl:gap-x-5";

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
// user-facing screen name stays "Horarios" (see the NAMING note at the top
// of this file): that rename is deliberately out of scope, this one is not.
const COLUMNS = ["Categoría", "Horario", "Alumnos", "Acciones"] as const;

/**
 * A cell's own label. Visible below `xl`, where the stacked row has no header
 * strip above it; from `xl` up it goes `sr-only` rather than `hidden`, because
 * the visible header strip is `aria-hidden` and a bare value with no label
 * announced before it is not a row a screen reader can read.
 */
function CellLabel({ children }: { children: React.ReactNode }): React.ReactElement {
  return <span className={`mb-1 block ${CELL_LABEL} xl:sr-only`}>{children}</span>;
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
function DiaTrack({ track, dias }: { track: string[]; dias: string[] }): React.ReactElement {
  return (
    <WeekStrip dias={toStripDias(dias)} permitidos={toStripDias(track)} />
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
  const [formData, setFormData] = useState<HorarioFormData>(EMPTY_FORM);
  const [selectedDias, setSelectedDias] = useState<Set<string>>(new Set());
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingDeletions, setPendingDeletions] = useState<PendingDayDeletion[] | null>(null);
  // Distinguishes which flow populated `pendingDeletions`, so the shared
  // confirmation dialog's copy and cancel behavior can differ: "days" comes
  // from unticking días mid-edit (handleSubmit already wrote other rows —
  // cancel still resyncs/closes the form); "group" comes from the card's
  // trash icon deleting every día at once (cancel is a pure no-op, nothing
  // was mutated yet).
  const [pendingDeletionScope, setPendingDeletionScope] = useState<"days" | "group">("days");

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
   * `GET /groups/horarios/alumnos` (TRA-7) answers the roster of EVERY
   * schedule in one call — replacing the 26-call fan-out (one
   * `GET /groups/horarios/{id}/alumnos` per row) this used to need. The
   * roster is fetched AFTER the schedules render so a slow/failed request
   * never delays or blanks the grid itself; on failure no card gets a count
   * line at all — an undercount would be a lie, and this figure is the one
   * the club plans around.
   */
  const [personasPorHorario, setPersonasPorHorario] = useState<PersonasPorHorario>({});

  const showNotification = useCallback((type: "success" | "error", message: string): void => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  }, []);

  const roster = useGroupRoster({ allStudents, showNotification });

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
      setLoadError("No se pudieron cargar los horarios. Intente nuevamente.");
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

    void fetchRosterDeTodosLosHorarios()
      .then((roster) => {
        if (cancelled) return;
        // Every known horario gets an entry (possibly empty) so a genuinely
        // empty class still counts as "0 inscriptos", not "unanswered" —
        // see PersonasPorHorario's own doc comment.
        const rosters: Record<number, number[]> = {};
        for (const horario of horarios) rosters[horario.id] = [];
        for (const alumno of roster) {
          (rosters[alumno.horarioId] ??= []).push(alumno.personaId);
        }
        setPersonasPorHorario(rosters);
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

  function openCreateForm(): void {
    setEditingGroup(null);
    setFormData(EMPTY_FORM);
    setSelectedDias(new Set());
    setFormError(null);
    setExpandedGroup({ key: NEW_GROUP_KEY, tab: "editar" });
  }

  /** Loads a group into the edit form. `null` clears it back to the chooser,
   * which only appears when a categoría has more than one editable group. */
  function selectEditingGroup(group: HorarioGroup | null): void {
    setEditingGroup(group);
    setFormError(null);
    if (group === null) {
      setFormData(EMPTY_FORM);
      setSelectedDias(new Set());
      return;
    }
    setFormData({
      nombre: categoriaLabel(group.categoria),
      horaInicio: group.horaInicio,
      horaFin: group.horaFin,
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
    selectEditingGroup(card.groups.length === 1 ? card.groups[0] : null);
    setExpandedGroup({ key: card.categoria, tab: "editar" });
  }

  /** Opens the "Alumnos" accordion tab under a categoría card — loads the
   * roster for every weekday row at once (a student belongs to the whole
   * recurring grupo, not one día). */
  function openAlumnosTab(card: CategoriaCard): void {
    setExpandedGroup({ key: card.categoria, tab: "alumnos" });
    roster.setPage(1);
    void roster.load(card.rows);
  }

  /** Collapses whichever accordion panel (editar or alumnos) is open. */
  function closeExpanded(): void {
    setExpandedGroup(null);
    setEditingGroup(null);
    setFormData(EMPTY_FORM);
    setSelectedDias(new Set());
    setFormError(null);
    roster.reset();
  }

  function toggleDia(dia: string): void {
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
  async function submitCategoria(): Promise<void> {
    setFormSubmitting(true);
    setFormError(null);
    const nombre = formData.nombre.trim();
    const dias = Array.from(selectedDias);
    // `edades` goes as typed, blanks included: this is a full editor, so
    // ALWAYS sending it is what lets an emptied input clear a stored label
    // (an omitted field would leave it untouched — `exclude_unset`). The
    // trimming/blank-to-NULL normalisation lives in one place only, the
    // backend's `AsistenciaServicio._normalizar_edades`.
    const edades = formData.edades;
    try {
      if (editingGroup) {
        await actualizarCategoria(editingGroup.categoria, {
          nombre, edades, hora_inicio: formData.horaInicio, hora_fin: formData.horaFin, dias,
        });
      } else {
        await crearCategoria({
          nombre, edades, hora_inicio: formData.horaInicio, hora_fin: formData.horaFin, dias,
        });
      }
      const message = editingGroup ? "Categoría actualizada correctamente." : "Categoría creada correctamente.";
      showNotification("success", message);
      showSuccess(message);
      closeExpanded();
      await loadData();
    } catch (err) {
      const message = extractErrorMessage(err, "Error al guardar la categoría.");
      setFormError(message);
      showError(message);
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
   * docs/archive/fixes/24-abm-categorias.md), surfaced as `formError` like any other
   * validation failure.
   */
  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!formData.nombre.trim()) {
      setFormError("Ingrese un nombre para la categoría.");
      return;
    }
    if (!formData.horaInicio || !formData.horaFin) {
      setFormError("Ingrese la hora de inicio y de fin.");
      return;
    }
    if (selectedDias.size === 0) {
      setFormError("Seleccione al menos un día.");
      return;
    }
    setFormError(null);

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
        {formError && (
          <div className="alert-error mb-4" role="alert">{formError}</div>
        )}
        <form onSubmit={(e) => void handleSubmit(e)} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label htmlFor="categoria-nombre" className="mb-1 block text-xs font-semibold text-ink-2">
              Nombre <span aria-hidden="true" className="text-state-bad">*</span>
            </label>
            <input
              id="categoria-nombre"
              type="text"
              className="input-field w-full"
              value={formData.nombre}
              onChange={(e) => setFormData((prev) => ({ ...prev, nombre: e.target.value }))}
              placeholder="Ej: Preinfantil"
              required
            />
          </div>
          {/*
            Edades (#789) — orientation copy for the public board, never a
            rule: no age is validated against it, so the field is optional and
            a categoría without one saves exactly like any other. `maxLength`
            matches the column (50). Marked with "(opcional)" rather than left
            unmarked, the same minority-marking this product uses elsewhere:
            on this form every other field is required, so the absence of an
            asterisk is not by itself a statement.
          */}
          <div className="sm:col-span-2">
            <label htmlFor="categoria-edades" className="mb-1 block text-xs font-semibold text-ink-2">
              Edades <span className="font-normal text-ink-3">(opcional)</span>
            </label>
            <input
              id="categoria-edades"
              type="text"
              className="input-field w-full"
              value={formData.edades}
              onChange={(e) => setFormData((prev) => ({ ...prev, edades: e.target.value }))}
              placeholder="Ej: 5 a 10 años"
              maxLength={50}
            />
          </div>
          <div>
            <label htmlFor="categoria-hora-inicio" className="mb-1 block text-xs font-semibold text-ink-2">
              Hora de inicio <span aria-hidden="true" className="text-state-bad">*</span>
            </label>
            <input
              id="categoria-hora-inicio"
              type="time"
              className="input-field w-full"
              value={formData.horaInicio}
              onChange={(e) => setFormData((prev) => ({ ...prev, horaInicio: e.target.value }))}
              required
            />
          </div>
          <div>
            <label htmlFor="categoria-hora-fin" className="mb-1 block text-xs font-semibold text-ink-2">
              Hora de fin <span aria-hidden="true" className="text-state-bad">*</span>
            </label>
            <input
              id="categoria-hora-fin"
              type="time"
              className="input-field w-full"
              value={formData.horaFin}
              onChange={(e) => setFormData((prev) => ({ ...prev, horaFin: e.target.value }))}
              required
            />
          </div>
          <fieldset className="sm:col-span-2 lg:col-span-4" aria-required="true">
            <legend className="mb-1 block text-xs font-semibold text-ink-2">
              Días de la semana <span aria-hidden="true" className="text-state-bad">*</span>
            </legend>
            <div className="flex flex-wrap gap-3">
              {DIA_ORDER.map((dia) => (
                <label key={dia} className="inline-flex items-center gap-1.5 text-xs text-ink">
                  <input
                    type="checkbox"
                    checked={selectedDias.has(dia)}
                    onChange={() => toggleDia(dia)}
                  />
                  {DIA_LABELS[dia]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="sm:col-span-2 lg:col-span-4 flex gap-2">
            <Button type="submit" variant="primary" size="sm" disabled={formSubmitting}>
              {formSubmitting && <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />}
              {editingGroup !== null ? "Guardar cambios" : "Crear categoría"}
            </Button>
            <Button size="sm" onClick={closeExpanded}>
              Cancelar
            </Button>
          </div>
        </form>

        {/* Danger zone, exactly where `15-horario-editar.html` puts it: inside
            the edit form, not on the card. Deleting removes the categoría
            entera — every día row — so it must not hang off a card that
            names one single day. Blocked server-side (400) when any día has
            real Asistencia history; see docs/archive/fixes/24-abm-categorias.md. */}
        {editingGroup !== null && (
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <div className="min-w-[220px] flex-1">
              <p className="text-sm font-semibold text-state-bad">Eliminar esta categoría</p>
              <p className="text-xs text-ink-3">
                Se eliminan todos sus días y los alumnos quedan sin horario asignado. No se puede
                si alguno de sus días tiene asistencias registradas.
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
            configuran por separado. Elija cuál editar.
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
              Alumnos de {categoriaLabel(card.categoria)}
            </h3>
          </div>
          <Button size="sm" onClick={closeExpanded}>
            Cerrar
          </Button>
        </div>

        {/* Asignar first — before the roster, not after it. */}
        <div className="mb-4 flex items-end gap-3">
          <div className="flex-1">
            <label htmlFor="alumno-select" className="mb-1 block text-xs font-semibold text-ink-2">
              Seleccionar alumno
            </label>
            <StudentSearch
              id="alumno-select"
              ariaLabel="Seleccionar alumno"
              placeholder="Buscar alumno por nombre…"
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
            variant="dark"
            size="sm"
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
          <LoadingState label="Cargando alumnos…" />
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
              title="Esta categoría todavía no tiene alumnos"
              description="Elija un alumno en el selector de arriba y presione «Asignar» para inscribirlo en todos los días de la categoría."
            />
          </div>
        ) : (
          roster.alumnos.length > 0 && (
            <div className="border-t border-line pt-4">
              <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-ink-3-strong">
                Alumnos asignados ({roster.alumnos.length})
              </p>
              <DataRowList>
                {alumnosVisibles.map((a) => (
                  <DataRow
                    key={a.id}
                    name={a.personaNombreCompleto}
                    meta={<DataBox>{a.edad} años</DataBox>}
                    actions={
                      <button
                        type="button"
                        onClick={() => void roster.unassign(rows, a.personaId)}
                        className="rounded-ctl border border-line-2 p-1 text-ink-3 transition-colors hover:bg-state-bad-bg hover:text-state-bad"
                        title="Desasignar alumno"
                      >
                        <UserMinus size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
                      </button>
                    }
                  />
                ))}
              </DataRowList>
              {roster.alumnos.length > ALUMNOS_PAGE_SIZE && (
                <Pagination
                  page={currentPage}
                  totalPages={totalPages}
                  onPageChange={roster.setPage}
                  totalItems={roster.alumnos.length}
                  pageSize={ALUMNOS_PAGE_SIZE}
                  itemNoun="alumno"
                  variant="footer"
                />
              )}
            </div>
          )
        )}
      </>
    );
  }

  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <AppShell
        title="Horarios"
        /*
         * One card per categoría, and there are as many categorías as the club
         * defines — five today. Like `/discounts` this list has no pager, so
         * its canvas (508/640/820px) is a record count rather than a page size.
         * The roster inside a card DOES paginate, and it was measured at this
         * measure too: it fills the page at every viewport either way. See
         * `CONTENT_MEASURE`.
         */
        measure="short"
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
            {notification.message}
          </div>
        )}

        {expandedGroup?.key === NEW_GROUP_KEY && (
          <div className="card p-5">
            {renderHorarioForm()}
          </div>
        )}

        {loading ? (
          <div className="card">
            <LoadingState label="Cargando horarios…" />
          </div>
        ) : categoriaCards.length > 0 ? (
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
                    className="min-h-drow px-5 py-4"
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
                      <div className={`min-w-0 ${inscriptos === null ? "hidden xl:block" : ""}`}>
                        {inscriptos !== null && (
                          <>
                            <CellLabel>{COLUMNS[2]}</CellLabel>
                            <p className="text-base font-semibold text-ink">
                              {inscriptos} inscripto{inscriptos === 1 ? "" : "s"}
                            </p>
                          </>
                        )}
                      </div>

                      <div className="flex gap-2 md:col-span-2 md:justify-end xl:col-span-1 xl:justify-end">
                        <span className="sr-only">{COLUMNS[3]}</span>
                        <Button
                          size="sm"
                          className="flex-1 md:flex-none"
                          onClick={() => openAlumnosTab(card)}
                          disabled={isDeleting}
                          aria-label={`Ver alumnos de ${cardTitle(card)}`}
                        >
                          Ver alumnos
                        </Button>
                        <Button
                          size="sm"
                          className="flex-1 md:flex-none"
                          onClick={() => openEditForm(card)}
                          disabled={isDeleting}
                          aria-label={`Editar ${cardTitle(card)}`}
                        >
                          Editar
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
            </ul>
          </div>
        ) : null}

        {!loading && horarios.length === 0 && (
          <EmptyState
            icon={<Calendar size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
            title="No hay categorías configuradas"
            description="Cree una categoría con sus días de entrenamiento para empezar a asignarle alumnos."
            action={
              <Button variant="primary" onClick={openCreateForm}>
                <Plus size={ICON.sm} strokeWidth={2} aria-hidden="true" />
                Crear primera categoría
              </Button>
            }
          />
        )}

        <ConfirmDialog
          open={pendingDeletions !== null && pendingDeletions.length > 0}
          variant="danger"
          title={pendingDeletionScope === "group" ? "Eliminar categoría completa" : "Desasignar alumnos y quitar días"}
          message={
            pendingDeletions
              ? pendingDeletionScope === "group"
                ? `Se eliminará la categoría completa (todos sus días: ${diaListLabel(
                    pendingDeletions.map((p) => p.diaSemana),
                  )}) y ${countUniqueAlumnos(pendingDeletions)} alumno(s) quedarán desasignados. Esta acción no se puede deshacer.`
                : `${countUniqueAlumnos(pendingDeletions)} alumno(s) quedarán desasignados de: ${diaListLabel(
                    pendingDeletions.map((p) => p.diaSemana),
                  )}. ¿Confirma guardar la categoría con esos días quitados?`
              : ""
          }
          onConfirm={() => void handleConfirmPendingDeletions()}
          onCancel={handleCancelPendingDeletions}
        />
      </AppShell>
    </ProtectedRoute>
  );
}
