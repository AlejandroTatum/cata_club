/**
 * Horarios — Admin page for managing training schedules.
 *
 * NAMING (three names, one thing — read this before renaming anything):
 *   - USER-FACING name: **Horarios**. That is what the nav says
 *     (`lib/auth-utils.ts`), what the page title says, and what the approved
 *     prototype says (`docs/ux/prototipos/14-horarios.html`). It is the only
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
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/contexts/ToastContext";
import ProtectedRoute from "@/components/ProtectedRoute";
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
import { Button, DataBox, DataRow, DataRowList, EmptyState, ErrorState, LoadingState, Pagination } from "@/components/ui";
import { getTotalPages, paginateRecords } from "@/app/attendance/attendance-utils";
import {
  fetchHorarios,
  crearHorario,
  actualizarHorario,
  eliminarHorario,
  fetchMembers,
  fetchAlumnosPorHorario,
  asignarAlumnoAHorario,
  desasignarAlumnoDeHorario,
} from "@/services/api";
import type { Horario, CrearHorarioDTO, ActualizarHorarioDTO, AlumnoHorario } from "@/services/api";
import {
  groupHorarios,
  diffGroupSave,
  type StudentRef,
  type HorarioGroup,
  type HorarioGroupRow,
} from "@/lib/groups-utils";
import { cargarCategorias, CATEGORIA_OPTIONS, diasPermitidos, horarioDe, type Categoria, type CategoriaInfo } from "@/services/categorias";
import {
  countUniqueAlumnos,
  buildCategoriaCards,
  formatDiaSet,
  countInscriptos,
  buildDiaTrack,
  formatMembresiaVencidaWarning,
  DIA_LABELS,
  type CategoriaCard,
  type PersonasPorHorario,
} from "./groups-page-utils";
import { toUserMessage } from "@/lib/error-message";

function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(":");
  return `${h}:${m}`;
}

/** Short (3-letter) día label, e.g. "Lun", "Mié", "Vie". Used in confirmations. */
function shortDiaLabel(dia: string): string {
  return (DIA_LABELS[dia] ?? dia).slice(0, 3);
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
const COLUMNS = ["Grupo", "Horario", "Alumnos", "Acciones"] as const;

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
 * The categoría's week, as one marker per día.
 *
 * Coal fill means the group meets that día; the outlined ones are días it is
 * allowed to meet on but does not. That is what the extra width buys: the
 * Saturday `COMPETITIVO` row and a categoría that skips a weekday both become
 * visible at a glance instead of only in the sentence above.
 *
 * `aria-hidden` on purpose — the schedule line right above states the same day
 * set in words ("Lunes a viernes + sábado"), so a screen reader gets the fact
 * once as prose instead of six unlabeled chips. These are read-only markers,
 * never selectable filters, so they carry no ball dot.
 */
function DiaTrack({ track, dias }: { track: string[]; dias: string[] }): React.ReactElement {
  const activos = new Set(dias);
  return (
    <ul className="flex flex-wrap gap-1" aria-hidden="true">
      {track.map((dia) => {
        const activo = activos.has(dia);
        return (
          <li
            key={dia}
            data-testid="dia-marker"
            data-dia={dia}
            data-active={activo ? "true" : "false"}
            className={`h-badge inline-flex min-w-[38px] items-center justify-center rounded-full px-2 text-2xs tracking-flat font-bold ${
              activo ? "bg-coal text-white" : "border border-dashed border-line-2 text-ink-3"
            }`}
          >
            {shortDiaLabel(dia)}
          </li>
        );
      })}
    </ul>
  );
}

/** Shared (non-día) fields edited across the whole day-group at once — PR2b.
 *
 * A horario has no nivel de ranking: the column was dropped by migration
 * `c4d5e6f7a8b9` and `HorarioCreateDTO` never accepted one, so the form used
 * to collect a value the BFF silently discarded. It has no entrenador either:
 * the trainer–schedule relation was removed (issue #13, migration
 * `e7c3a1b9d5f2`). */
interface HorarioFormData {
  categoria: Categoria;
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

const DEFAULT_CATEGORIA: Categoria = CATEGORIA_OPTIONS[0];

const EMPTY_FORM: HorarioFormData = {
  categoria: DEFAULT_CATEGORIA,
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

  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Asignación directa alumno ↔ horario — content unchanged from PR2b, now
  // rendered inline via `expandedGroup.tab === "alumnos"`. Assignment is at
  // GRUPO level (every underlying `horario_id` día row), not per-día: a
  // student enrolled in a día-group belongs to ALL its días, never just one.
  // `alumnosPorHorario` holds the deduplicated (by `personaId`) union of the
  // roster across every row of the currently open group.
  const [alumnosPorHorario, setAlumnosPorHorario] = useState<AlumnoHorario[]>([]);
  const [cargandoAlumnos, setCargandoAlumnos] = useState(false);
  const [asignandoAlumno, setAsignandoAlumno] = useState(false);
  const [alumnoSeleccionado, setAlumnoSeleccionado] = useState<number | null>(null);
  /** 1-indexed page of the "Ver alumnos" roster. Reset whenever a panel opens. */
  const [alumnosPage, setAlumnosPage] = useState(1);

  /**
   * Enrolled person-ids per `Horario.id`, for the card's "N inscriptos" line.
   *
   * Ids rather than counts because the card counts a CATEGORÍA: a student
   * belongs to every weekday of their group, so summing the per-row counts
   * would report 220 students for the 44 who actually train. The union needs
   * the identities.
   *
   * BACKEND GAP: `GET /groups/horarios` returns no enrollment count, and there
   * is no bulk roster endpoint — the only way to know who a session has is one
   * `GET /groups/horarios/{id}/alumnos` per row. So the rosters are fetched in
   * parallel AFTER the schedules render, and a categoría with any unanswered
   * row simply has no count line. Rendering an undercount for a request that
   * never answered would be a lie, and this figure is the one the club plans
   * around.
   */
  const [personasPorHorario, setPersonasPorHorario] = useState<PersonasPorHorario>({});

  const showNotification = useCallback((type: "success" | "error", message: string): void => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  }, []);

  /** Loads the roster for a whole categoría: fetches every underlying row's
   * assignees and deduplicates by `personaId` (a student assigned — even
   * inconsistently, to only some días — must appear exactly once). */
  const cargarAlumnosDelGrupo = useCallback(async (rows: readonly HorarioGroupRow[]): Promise<void> => {
    setCargandoAlumnos(true);
    try {
      const listasPorDia = await Promise.all(rows.map((row) => fetchAlumnosPorHorario(row.id)));
      const porPersona = new Map<number, AlumnoHorario>();
      for (const lista of listasPorDia) {
        for (const alumno of lista) {
          if (!porPersona.has(alumno.personaId)) porPersona.set(alumno.personaId, alumno);
        }
      }
      setAlumnosPorHorario(Array.from(porPersona.values()));
    } catch {
      showNotification("error", "Error al cargar los alumnos del horario.");
    } finally {
      setCargandoAlumnos(false);
    }
  }, [showNotification]);

  /**
   * Assigns the selected student to the categoría the card represents. The
   * backend now enrolls the student into EVERY horario row of that categoría
   * in one atomic transaction — the club enrolls by full month, never by a
   * loose weekday — so this only needs to anchor the request on any one row
   * of the group (`rows[0]`); there is no longer a per-row loop to run or a
   * benign-per-row-failure case to tolerate on this side.
   */
  const handleAsignarAlumno = useCallback(async (rows: readonly HorarioGroupRow[]): Promise<void> => {
    if (!alumnoSeleccionado || rows.length === 0) return;
    setAsignandoAlumno(true);
    try {
      const respuesta = await asignarAlumnoAHorario({ persona_id: alumnoSeleccionado, horario_id: rows[0].id });
      const message = "Alumno asignado correctamente al horario.";
      showNotification("success", message);
      showSuccess(message);
      // INS-6 (decisión de negocio #4): la cuota vencida NO bloquea la
      // asignación -- ya se hizo, arriba. Esto es solo el aviso no
      // bloqueante, aparte del toast de éxito.
      if (respuesta.membresiaVencida) {
        const alumno = allStudents.find((s) => Number(s.id) === alumnoSeleccionado);
        const nombreCompleto = alumno ? `${alumno.nombres} ${alumno.apellidos}` : "El alumno";
        showWarning(formatMembresiaVencidaWarning(nombreCompleto, respuesta.diasVencida));
      }
      setAlumnoSeleccionado(null);
    } catch (err) {
      const message = extractErrorMessage(err, "Error al asignar el alumno al horario.");
      showNotification("error", message);
      showError(message);
    }
    // Refreshed on both paths, mirroring handleDesasignarAlumno: an assign
    // call can fail on the client side (network) after already landing on
    // the server, so the roster must resync either way instead of only
    // reflecting the last KNOWN-good state.
    await cargarAlumnosDelGrupo(rows);
    setAsignandoAlumno(false);
  }, [alumnoSeleccionado, allStudents, cargarAlumnosDelGrupo, showNotification, showSuccess, showError, showWarning]);

  /** Mirror of `handleAsignarAlumno`: the backend unassigns the student from
   * every horario row of the categoría in one atomic transaction, so one
   * call anchored on any row of the group is enough. */
  const handleDesasignarAlumno = useCallback(async (rows: readonly HorarioGroupRow[], personaId: number): Promise<void> => {
    if (rows.length === 0) return;
    try {
      await desasignarAlumnoDeHorario(personaId, rows[0].id);
      showNotification("success", "Alumno desasignado del horario.");
      showSuccess("Alumno desasignado del horario.");
    } catch (err) {
      const message = extractErrorMessage(err, "Error al desasignar el alumno del horario.");
      showNotification("error", message);
      showError(message);
    }
    await cargarAlumnosDelGrupo(rows);
  }, [cargarAlumnosDelGrupo, showNotification, showSuccess, showError]);

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
   * `loadData`'s `Promise.all` deliberately: this is N extra requests for a
   * secondary line of text, and it must never delay or fail the grid itself.
   */
  useEffect(() => {
    if (horarios.length === 0) return;
    let cancelled = false;

    void Promise.all(
      horarios.map(async (horario) => {
        try {
          const alumnos = await fetchAlumnosPorHorario(horario.id);
          return [horario.id, alumnos.map((alumno) => alumno.personaId)] as const;
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const rosters: Record<number, number[]> = {};
      for (const result of results) {
        if (result) rosters[result[0]] = [...result[1]];
      }
      setPersonasPorHorario(rosters);
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
      categoria: (group.categoria as Categoria) ?? DEFAULT_CATEGORIA,
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
    setAlumnosPage(1);
    void cargarAlumnosDelGrupo(card.rows);
  }

  /** Collapses whichever accordion panel (editar or alumnos) is open. */
  function closeExpanded(): void {
    setExpandedGroup(null);
    setEditingGroup(null);
    setFormData(EMPTY_FORM);
    setSelectedDias(new Set());
    setFormError(null);
    setAlumnosPorHorario([]);
    setAlumnoSeleccionado(null);
    setAlumnosPage(1);
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
   * Apply a `diffGroupSave` diff: create/update rows immediately, delete rows
   * with zero enrolled students immediately, and collect rows with enrolled
   * students into `pendingDeletions` (awaiting explicit user confirmation
   * instead of deleting silently and orphaning `AlumnoHorario` rows).
   */
  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (selectedDias.size === 0) {
      setFormError("Seleccione al menos un día.");
      return;
    }
    setFormSubmitting(true);
    setFormError(null);
    const shared = {
      categoria: formData.categoria,
    };
    try {
      const group: HorarioGroup = editingGroup ?? {
        key: "",
        categoria: shared.categoria,
        horaInicio: horarioDe(categorias, shared.categoria).horaInicio,
        horaFin: horarioDe(categorias, shared.categoria).horaFin,
        rows: [],
      };
      const diff = diffGroupSave(group, selectedDias);

      for (const dia of diff.toCreate) {
        const dto: CrearHorarioDTO = { dia_semana: dia, ...shared };
        await crearHorario(dto);
      }
      for (const id of diff.toUpdateIds) {
        const dto: ActualizarHorarioDTO = { ...shared };
        await actualizarHorario(id, dto);
      }

      const nextPending: PendingDayDeletion[] = [];
      for (const id of diff.toDeleteIds) {
        const alumnos = await fetchAlumnosPorHorario(id);
        if (alumnos.length > 0) {
          const row = group.rows.find((r) => r.id === id);
          nextPending.push({ id, diaSemana: row?.diaSemana ?? "", alumnos });
        } else {
          await eliminarHorario(id);
        }
      }

      if (nextPending.length > 0) {
        setPendingDeletions(nextPending);
        return;
      }

      const message = editingGroup ? "Horario actualizado correctamente." : "Horario creado correctamente.";
      showNotification("success", message);
      showSuccess(message);
      closeExpanded();
      await loadData();
    } catch (err) {
      // A partial failure mid-sequence (e.g. the 2nd of 3 crearHorario calls
      // rejects) leaves the backend ahead of local state: some rows were
      // already created/updated/deleted before the failing call. Closing the
      // form drops the now-stale `editingGroup`/`selectedDias` snapshot
      // instead of leaving them around to silently re-diff against pre-save
      // data on a retry (which would re-create the row that already
      // succeeded). `loadData()` resyncs `horarios` with what's actually
      // persisted so any retry starts from a reopened, accurate group.
      const message = extractErrorMessage(err, "Error al guardar el horario.");
      showNotification("error", message);
      showError(message);
      closeExpanded();
      await loadData();
    } finally {
      setFormSubmitting(false);
    }
  }

  /**
   * User confirmed: delete each pending row. `eliminarHorario` now unassigns
   * that row's own students server-side before removing it (scoped to that
   * ONE horario_id) — deliberately NOT the categoría-wide
   * `desasignarAlumnoDeHorario`, which would incorrectly unenroll these
   * students from every OTHER día of the categoría too. Dropping Miércoles
   * from a 5-día group must leave enrolled students on the remaining 4, not
   * unenroll them entirely.
   */
  async function handleConfirmPendingDeletions(): Promise<void> {
    if (!pendingDeletions) return;
    try {
      for (const pending of pendingDeletions) {
        await eliminarHorario(pending.id);
      }
      const message =
        pendingDeletionScope === "group" ? "Horario eliminado correctamente." : "Horario actualizado correctamente.";
      showNotification("success", message);
      showSuccess(message);
    } catch (err) {
      const message = extractErrorMessage(err, "Error al eliminar el horario.");
      showNotification("error", message);
      showError(message);
    } finally {
      setPendingDeletions(null);
      setPendingDeletionScope("days");
      closeExpanded();
      await loadData();
    }
  }

  function handleCancelPendingDeletions(): void {
    // Only the "days" flow (mid-edit unticking) has already written other
    // rows via handleSubmit before this dialog appears, so only it needs to
    // close the form and resync on cancel. The "group" flow (trash icon)
    // hasn't mutated anything yet — canceling is a pure no-op.
    if (pendingDeletionScope === "days") {
      closeExpanded();
      void loadData();
    }
    setPendingDeletions(null);
    setPendingDeletionScope("days");
  }

  /**
   * Trash-icon entry point: deletes the ENTIRE group (every día row), not
   * just `group.rows[0]` — reuses the same student-safety pending-deletion
   * flow as unticking días mid-edit (`fetchAlumnosPorHorario` per row,
   * `pendingDeletions` + confirmation dialog, `handleConfirmPendingDeletions`
   * calling `eliminarHorario` per row) instead of duplicating that logic.
   */
  async function requestDeleteGroup(group: HorarioGroup): Promise<void> {
    setDeletingId(group.rows[0].id);
    try {
      const nextPending: PendingDayDeletion[] = [];
      for (const row of group.rows) {
        const alumnos = await fetchAlumnosPorHorario(row.id);
        nextPending.push({ id: row.id, diaSemana: row.diaSemana, alumnos });
      }
      setPendingDeletionScope("group");
      setPendingDeletions(nextPending);
    } catch (err) {
      const message = extractErrorMessage(err, "Error al eliminar el horario.");
      showNotification("error", message);
      showError(message);
    } finally {
      setDeletingId(null);
    }
  }

  /** Shared/día-checklist edit form — rendered inline (PR3a), either under the
   * group card being edited or, for "Nuevo Horario", in its own top-of-list
   * card (no existing group card to nest a brand-new one under). */
  function renderHorarioForm(): React.ReactElement {
    return (
      <>
        <h3 className="mb-4 text-sm font-bold text-ink">
          {editingGroup !== null ? "Editar Horario" : "Nuevo Horario"}
        </h3>
        {formError && (
          <div className="alert-error mb-4" role="alert">{formError}</div>
        )}
        <form onSubmit={(e) => void handleSubmit(e)} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="horario-categoria" className="mb-1 block text-xs font-semibold text-ink-2">
              Categoría
            </label>
            <select
              id="horario-categoria"
              className="input-field w-full"
              value={formData.categoria}
              onChange={(e) => {
                const categoria = e.target.value as Categoria;
                setFormData((prev) => ({ ...prev, categoria }));
                setSelectedDias((prev) => {
                  const permitidos = new Set(diasPermitidos(categorias, categoria));
                  return new Set([...prev].filter((dia) => permitidos.has(dia)));
                });
              }}
              required
            >
              {CATEGORIA_OPTIONS.map((cat) => (
                <option key={cat} value={cat}>{categorias[cat]?.label ?? cat}</option>
              ))}
            </select>
          </div>
          <div>
            <span className="mb-1 block text-xs font-semibold text-ink-2">
              Horario (fijo según categoría)
            </span>
            <p
              className="input-field flex w-full items-center text-ink-2"
              aria-readonly="true"
            >
              {horarioDe(categorias, formData.categoria).horaInicio} – {horarioDe(categorias, formData.categoria).horaFin}
            </p>
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <span className="mb-1 block text-xs font-semibold text-ink-2">
              Días de la semana
            </span>
            <div className="flex flex-wrap gap-3">
              {diasPermitidos(categorias, formData.categoria).map((dia) => (
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
          </div>
          <div className="sm:col-span-2 lg:col-span-4 flex gap-2">
            <Button type="submit" variant="primary" size="sm" disabled={formSubmitting}>
              {formSubmitting && <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />}
              {editingGroup !== null ? "Guardar cambios" : "Crear horario"}
            </Button>
            <Button size="sm" onClick={closeExpanded}>
              Cancelar
            </Button>
          </div>
        </form>

        {/* Danger zone, exactly where `15-horario-editar.html` puts it: inside
            the edit form, not on the card. Deleting removes the whole
            recurring schedule — every weekday of the group — so it must not
            hang off a card that names one single day. */}
        {editingGroup !== null && (
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <div className="min-w-[220px] flex-1">
              <p className="text-sm font-semibold text-state-bad">Eliminar este horario</p>
              <p className="text-xs text-ink-3">
                Se eliminan todos sus días y los alumnos quedan sin horario asignado.
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => void requestDeleteGroup(editingGroup)}
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
            <h3 className="flex-1 text-sm font-bold text-ink">
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
    const totalPages = getTotalPages(alumnosPorHorario.length, ALUMNOS_PAGE_SIZE);
    // Clamped rather than trusted: desasignar can shorten the roster past the
    // page being read, and a page beyond the end would render an empty list
    // with no way back to the rows that are still there.
    const currentPage = Math.min(alumnosPage, totalPages);
    const alumnosVisibles = paginateRecords(alumnosPorHorario, currentPage, ALUMNOS_PAGE_SIZE);

    return (
      <>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserPlus size={ICON.sm} strokeWidth={1.5} className="text-state-bad" aria-hidden="true" />
            <h3 className="text-sm font-bold text-ink">
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
            <select
              id="alumno-select"
              className="input-field w-full"
              value={alumnoSeleccionado ?? ""}
              onChange={(e) => setAlumnoSeleccionado(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Seleccionar alumno…</option>
              {allStudents
                .filter((s) => s.activo && !alumnosPorHorario.some((a) => a.personaId === Number(s.id)))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombres} {s.apellidos}
                  </option>
                ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => void handleAsignarAlumno(rows)}
            disabled={!alumnoSeleccionado || asignandoAlumno}
            className="btn-primary inline-flex items-center gap-1.5 text-xs"
          >
            {asignandoAlumno ? (
              <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
            ) : (
              <UserPlus size={ICON.sm} strokeWidth={2} aria-hidden="true" />
            )}
            Asignar
          </button>
        </div>

        {cargandoAlumnos ? (
          <LoadingState label="Cargando alumnos…" />
        ) : (
          alumnosPorHorario.length > 0 && (
            <div className="border-t border-line pt-4">
              <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-ink-3-strong">
                Alumnos asignados ({alumnosPorHorario.length})
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
                        onClick={() => void handleDesasignarAlumno(rows, a.personaId)}
                        className="rounded-lg border border-line-2 p-1 text-ink-3 transition-colors hover:bg-red-50 hover:text-state-bad"
                        title="Desasignar alumno"
                      >
                        <UserMinus size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
                      </button>
                    }
                  />
                ))}
              </DataRowList>
              {alumnosPorHorario.length > ALUMNOS_PAGE_SIZE && (
                <Pagination
                  page={currentPage}
                  totalPages={totalPages}
                  onPageChange={setAlumnosPage}
                  totalItems={alumnosPorHorario.length}
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
            Nuevo horario
          </Button>
        }
      >
        {loadError && (
          <ErrorState message={loadError} onRetry={() => void loadData()} />
        )}

        {notification && (
          <div
            className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm ${
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
            title="No hay horarios configurados"
            description="Cree un horario de entrenamiento para empezar a asignarle alumnos."
            action={
              <Button variant="primary" onClick={openCreateForm}>
                <Plus size={ICON.sm} strokeWidth={2} aria-hidden="true" />
                Crear primer horario
              </Button>
            }
          />
        )}

        <ConfirmDialog
          open={pendingDeletions !== null && pendingDeletions.length > 0}
          variant="danger"
          title={pendingDeletionScope === "group" ? "Eliminar horario completo" : "Desasignar alumnos y eliminar días"}
          message={
            pendingDeletions
              ? pendingDeletionScope === "group"
                ? `Se eliminará el horario completo (todos sus días: ${pendingDeletions
                    .map((p) => shortDiaLabel(p.diaSemana))
                    .join(", ")}) y ${countUniqueAlumnos(pendingDeletions)} alumno(s) quedarán desasignados. Esta acción no se puede deshacer.`
                : `${countUniqueAlumnos(pendingDeletions)} alumno(s) quedarán desasignados de: ${pendingDeletions
                    .map((p) => shortDiaLabel(p.diaSemana))
                    .join(", ")}. ¿Confirma la eliminación de esos días?`
              : ""
          }
          onConfirm={() => void handleConfirmPendingDeletions()}
          onCancel={handleCancelPendingDeletions}
        />
      </AppShell>
    </ProtectedRoute>
  );
}
