/**
 * Gestión de Horarios — Admin page for managing training schedules.
 *
 * Lists all HorarioEntrenamiento records with day, time, trainer, and
 * assigned training level. Shows which students belong to each schedule
 * based on their ranking level assignment. Allows creating, editing, and
 * deleting schedules.
 *
 * Rebuilt for issue #43 — replaces the old NivelRanking-as-Grupo placeholder
 * with real HorarioEntrenamiento management.
 *
 * v2 (Gestión de Horarios): once a `categoria` is picked, its day-set and
 * time range are LOCKED (not just pre-filled) — see
 * `backend/app/dominio/categoria_metadata.py` for the single source of
 * truth this mirrors via `@/services/categorias`. The backend derives and
 * validates `hora_inicio`/`hora_fin`/`dia_semana` server-side; the client
 * never submits them as freeform values anymore.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/contexts/ToastContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import {
  Calendar,
  Plus,
  Pencil,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Clock,
  Users,
  UserPlus,
  UserMinus,
} from "lucide-react";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  fetchHorarios,
  crearHorario,
  actualizarHorario,
  eliminarHorario,
  fetchMembers,
  fetchNivelesConOcupacion,
  fetchAlumnosPorHorario,
  asignarAlumnoAHorario,
  desasignarAlumnoDeHorario,
  fetchEntrenadores,
  ApiClientError,
} from "@/services/api";
import type { Horario, CrearHorarioDTO, ActualizarHorarioDTO, NivelConOcupacion, AlumnoHorario, Entrenador } from "@/services/api";
import { groupHorarios, diffGroupSave, type StudentRef, type HorarioGroup } from "@/lib/groups-utils";
import { CATEGORIA_METADATA, CATEGORIA_OPTIONS, diasPermitidos, horarioDe, type Categoria } from "@/services/categorias";
import { countUniqueAlumnos } from "./groups-page-utils";

const DIA_LABELS: Record<string, string> = {
  LUNES: "Lunes",
  MARTES: "Martes",
  MIERCOLES: "Miércoles",
  JUEVES: "Jueves",
  VIERNES: "Viernes",
  SABADO: "Sábado",
  DOMINGO: "Domingo",
};

const DIA_OPTIONS = ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO", "DOMINGO"];

function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(":");
  return `${h}:${m}`;
}

/** Short (3-letter) día badge label, e.g. "Lun", "Mié", "Vie". */
function shortDiaLabel(dia: string): string {
  return (DIA_LABELS[dia] ?? dia).slice(0, 3);
}

function extractErrorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiClientError ? err.message : fallback;
}

/** Shared (non-día) fields edited across the whole day-group at once — PR2b. */
interface HorarioFormData {
  categoria: Categoria;
  entrenador_id: number | null;
  nivel_ranking_id: number | null;
}

/** One día-group row pending deletion after student-safety check, awaiting user confirmation. */
interface PendingDayDeletion {
  id: number;
  diaSemana: string;
  alumnos: AlumnoHorario[];
}

/**
 * Single accordion state — at most one group's panel is expanded at a time.
 * `key` is either a `HorarioGroup.key` or `NEW_GROUP_KEY` for the create-new
 * flow (which has no existing card to nest under). `tab` picks which inline
 * panel renders under that group's card — PR3a. `alumnos` tab content itself
 * (real per-día roster) is reworked in PR3b; PR3a only wires the accordion
 * mechanics around the existing panel content.
 */
interface ExpandedGroupState {
  key: string;
  tab: "editar" | "alumnos";
}

/** Sentinel `expandedGroup.key` for "Nuevo Horario" — no existing card to nest under. */
const NEW_GROUP_KEY = "__new__";

const DEFAULT_CATEGORIA: Categoria = CATEGORIA_OPTIONS[0];

const EMPTY_FORM: HorarioFormData = {
  categoria: DEFAULT_CATEGORIA,
  entrenador_id: null,
  nivel_ranking_id: null,
};

export default function GroupsPage(): React.ReactElement {
  const [horarios, setHorarios] = useState<Horario[]>([]);
  const [niveles, setNiveles] = useState<NivelConOcupacion[]>([]);
  const [allStudents, setAllStudents] = useState<StudentRef[]>([]);
  const [loading, setLoading] = useState(true);
  const { showError } = useToast();

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

  // Real entrenadores (rol ENTRENADOR) — feeds the "Entrenador" dropdown in
  // the create/edit form. `entrenador_id` is a real, explicitly chosen
  // person (notified downstream on level changes, attributed on Asistencia
  // records) so it must never be auto-filled or left as a raw ID input.
  // Fetched independently from `loadData()` (see `cargarEntrenadores` below):
  // entrenadores only feed the create/edit form's dropdown, not the horarios
  // list itself, so a failure here must never block viewing/editing existing
  // horarios.
  const [entrenadores, setEntrenadores] = useState<Entrenador[]>([]);
  const [entrenadoresLoading, setEntrenadoresLoading] = useState(true);

  const showNotification = useCallback((type: "success" | "error", message: string): void => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  }, []);

  /** Loads the roster for a whole día-group: fetches every underlying row's
   * assignees and deduplicates by `personaId` (a student assigned — even
   * inconsistently, to only some días — must appear exactly once). */
  const cargarAlumnosDelGrupo = useCallback(async (group: HorarioGroup): Promise<void> => {
    setCargandoAlumnos(true);
    try {
      const listasPorDia = await Promise.all(group.rows.map((row) => fetchAlumnosPorHorario(row.id)));
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

  /** Assigns the selected student to EVERY día row of the group — a student
   * belongs to the whole grupo, not to one día. Per-row failures (e.g. an
   * inconsistent prior assignment already covering that specific row) don't
   * abort the loop; the outcome is reported as a normal success if at least
   * one row newly assigned, or as "already assigned" if none did — but only
   * when every failure was the benign "ya estaba asignado" case (HTTP 400).
   * Any other failure (network, 404, etc.) is a real error and must never be
   * swallowed into a success message. */
  const handleAsignarAlumno = useCallback(async (group: HorarioGroup): Promise<void> => {
    if (!alumnoSeleccionado) return;
    setAsignandoAlumno(true);
    try {
      let asignados = 0;
      let primerErrorReal: unknown = null;
      for (const row of group.rows) {
        try {
          await asignarAlumnoAHorario({ persona_id: alumnoSeleccionado, horario_id: row.id });
          asignados++;
        } catch (err) {
          const esBenigno = err instanceof ApiClientError && err.status === 400;
          if (!esBenigno && primerErrorReal === null) {
            primerErrorReal = err;
          }
          // Benigno (400): ya estaba asignado a esta fila puntual — se
          // continúa con el resto de los días del grupo. No benigno: se
          // trackea el primero para reportarlo abajo, pero igual se sigue
          // intentando el resto de las filas.
        }
      }
      if (primerErrorReal !== null) {
        showNotification("error", extractErrorMessage(primerErrorReal, "Error al asignar el alumno al horario."));
      } else {
        showNotification(
          "success",
          asignados > 0
            ? "Alumno asignado correctamente al horario."
            : "El alumno ya estaba asignado a este horario.",
        );
        setAlumnoSeleccionado(null);
      }
      await cargarAlumnosDelGrupo(group);
    } finally {
      setAsignandoAlumno(false);
    }
  }, [alumnoSeleccionado, cargarAlumnosDelGrupo, showNotification]);

  /** Unassigns the student from EVERY día row of the group, same all-días
   * criterion as assignment. A per-row 404 ("no había asignación en esa
   * fila") is the only benign outcome this endpoint can produce, so it's
   * swallowed; any other failure is real and must surface as an error
   * instead of the "desasignado" success message. */
  const handleDesasignarAlumno = useCallback(async (group: HorarioGroup, personaId: number): Promise<void> => {
    let primerErrorReal: unknown = null;
    for (const row of group.rows) {
      try {
        await desasignarAlumnoDeHorario(personaId, row.id);
      } catch (err) {
        const esBenigno = err instanceof ApiClientError && err.status === 404;
        if (!esBenigno && primerErrorReal === null) {
          primerErrorReal = err;
        }
        // Benigno (404): no estaba asignado a esta fila puntual — se
        // continúa con el resto. No benigno: se trackea el primero para
        // reportarlo abajo.
      }
    }
    if (primerErrorReal !== null) {
      showNotification("error", extractErrorMessage(primerErrorReal, "Error al desasignar el alumno del horario."));
    } else {
      showNotification("success", "Alumno desasignado del horario.");
    }
    await cargarAlumnosDelGrupo(group);
  }, [cargarAlumnosDelGrupo, showNotification]);

  const loadData = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const [horariosData, nivelesData, membersData] = await Promise.all([
        fetchHorarios(),
        fetchNivelesConOcupacion(),
        fetchMembers(),
      ]);
      setHorarios(horariosData);
      setNiveles(nivelesData);
      const students: StudentRef[] = membersData.accounts.flatMap((account) =>
        account.estudiantes.map((estudiante) => ({
          id: estudiante.id,
          nombres: estudiante.nombres,
          apellidos: estudiante.apellidos,
          grupoId: estudiante.grupoId,
          activo: estudiante.activo,
        })),
      );
      setAllStudents(students);
    } catch {
      setLoadError("No se pudieron cargar los horarios. Intente nuevamente.");
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Entrenadores are used ONLY by the create/edit form's dropdown, not by the
   * horarios list itself — so this is fetched independently from `loadData()`
   * (not folded into its `Promise.all`). A failure here must never surface
   * the page-wide `loadError` and must never block viewing/editing horarios
   * that already loaded successfully; it only degrades the dropdown to an
   * empty/error state via `entrenadores.length === 0`.
   */
  const cargarEntrenadores = useCallback(async (): Promise<void> => {
    setEntrenadoresLoading(true);
    try {
      const entrenadoresData = await fetchEntrenadores();
      setEntrenadores(entrenadoresData);
    } catch {
      setEntrenadores([]);
      showNotification("error", "No se pudieron cargar los entrenadores. Intente nuevamente.");
    } finally {
      setEntrenadoresLoading(false);
    }
  }, [showNotification]);

  useEffect(() => {
    void loadData();
    void cargarEntrenadores();
  }, [loadData, cargarEntrenadores]);

  function openCreateForm(): void {
    setEditingGroup(null);
    setFormData(EMPTY_FORM);
    setSelectedDias(new Set());
    setFormError(null);
    setExpandedGroup({ key: NEW_GROUP_KEY, tab: "editar" });
  }

  function openEditForm(group: HorarioGroup): void {
    setEditingGroup(group);
    setFormData({
      categoria: (group.categoria as Categoria) ?? DEFAULT_CATEGORIA,
      entrenador_id: group.entrenadorId,
      nivel_ranking_id: group.nivelRankingId,
    });
    setSelectedDias(new Set(group.rows.map((row) => row.diaSemana)));
    setFormError(null);
    setExpandedGroup({ key: group.key, tab: "editar" });
  }

  /** Opens the "Alumnos" accordion tab for a group — loads the roster for
   * the WHOLE group (every día row), not a single día (a student belongs to
   * the whole recurring grupo, not one día). */
  function openAlumnosTab(group: HorarioGroup): void {
    setExpandedGroup({ key: group.key, tab: "alumnos" });
    void cargarAlumnosDelGrupo(group);
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
      setFormError("Seleccioná al menos un día.");
      return;
    }
    const entrenadorId = formData.entrenador_id;
    if (entrenadorId === null) {
      setFormError("Seleccioná un entrenador.");
      return;
    }
    setFormSubmitting(true);
    setFormError(null);
    const shared = {
      categoria: formData.categoria,
      entrenador_id: entrenadorId,
      nivel_ranking_id: formData.nivel_ranking_id,
    };
    try {
      const group: HorarioGroup = editingGroup ?? {
        key: "",
        categoria: shared.categoria,
        horaInicio: horarioDe(shared.categoria).horaInicio,
        horaFin: horarioDe(shared.categoria).horaFin,
        entrenadorId: shared.entrenador_id,
        nivelRankingId: shared.nivel_ranking_id,
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

      showNotification("success", editingGroup ? "Horario actualizado correctamente." : "Horario creado correctamente.");
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
      showNotification("error", extractErrorMessage(err, "Error al guardar el horario."));
      closeExpanded();
      await loadData();
    } finally {
      setFormSubmitting(false);
    }
  }

  /** User confirmed: desasignar every affected alumno THEN delete each pending row (FK has no ON DELETE CASCADE). */
  async function handleConfirmPendingDeletions(): Promise<void> {
    if (!pendingDeletions) return;
    try {
      for (const pending of pendingDeletions) {
        for (const alumno of pending.alumnos) {
          await desasignarAlumnoDeHorario(alumno.personaId, pending.id);
        }
        await eliminarHorario(pending.id);
      }
      showNotification(
        "success",
        pendingDeletionScope === "group" ? "Horario eliminado correctamente." : "Horario actualizado correctamente.",
      );
    } catch (err) {
      showNotification("error", extractErrorMessage(err, "Error al eliminar el horario."));
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
   * desasigna-then-elimina) instead of duplicating that logic.
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
      showNotification("error", extractErrorMessage(err, "Error al eliminar el horario."));
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
        <h3 className="mb-4 text-sm font-bold text-cata-text">
          {editingGroup !== null ? "Editar Horario" : "Nuevo Horario"}
        </h3>
        {formError && (
          <div className="alert-error mb-4" role="alert">{formError}</div>
        )}
        <form onSubmit={(e) => void handleSubmit(e)} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="horario-categoria" className="mb-1 block text-xs font-medium text-cata-text/65">
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
                  const permitidos = new Set(diasPermitidos(categoria));
                  return new Set([...prev].filter((dia) => permitidos.has(dia)));
                });
              }}
              required
            >
              {CATEGORIA_OPTIONS.map((cat) => (
                <option key={cat} value={cat}>{CATEGORIA_METADATA[cat].label}</option>
              ))}
            </select>
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-cata-text/65">
              Horario (fijo según categoría)
            </span>
            <p
              className="input-field flex w-full items-center text-cata-text/70"
              aria-readonly="true"
            >
              {horarioDe(formData.categoria).horaInicio} – {horarioDe(formData.categoria).horaFin}
            </p>
          </div>
          <div>
            <label htmlFor="horario-entrenador" className="mb-1 block text-xs font-medium text-cata-text/65">
              Entrenador
            </label>
            <select
              id="horario-entrenador"
              className="input-field w-full"
              value={formData.entrenador_id ?? ""}
              onChange={(e) => setFormData((prev) => ({
                ...prev,
                entrenador_id: e.target.value ? Number(e.target.value) : null,
              }))}
              disabled={entrenadoresLoading || entrenadores.length === 0}
            >
              <option value="">
                {entrenadoresLoading
                  ? "Cargando..."
                  : entrenadores.length === 0
                    ? "No hay entrenadores registrados"
                    : "Seleccionar entrenador..."}
              </option>
              {entrenadores.map((entrenador) => (
                <option key={entrenador.id} value={entrenador.id}>
                  {entrenador.nombreCompleto}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="horario-nivel" className="mb-1 block text-xs font-medium text-cata-text/65">
              Nivel de ranking <span className="text-cata-text/40">(opcional)</span>
            </label>
            <select
              id="horario-nivel"
              className="input-field w-full"
              value={formData.nivel_ranking_id ?? ""}
              onChange={(e) => setFormData((prev) => ({
                ...prev,
                nivel_ranking_id: e.target.value ? Number(e.target.value) : null,
              }))}
            >
              <option value="">Sin nivel asignado</option>
              {niveles.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.nombre ?? `Nivel ${n.numeroNivel}`}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <span className="mb-1 block text-xs font-medium text-cata-text/65">
              Días de la semana
            </span>
            <div className="flex flex-wrap gap-3">
              {diasPermitidos(formData.categoria).map((dia) => (
                <label key={dia} className="inline-flex items-center gap-1.5 text-xs text-cata-text">
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
            <button type="submit" disabled={formSubmitting} className="btn-primary inline-flex items-center gap-1.5 text-xs">
              {formSubmitting && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
              {editingGroup !== null ? "Guardar cambios" : "Crear horario"}
            </button>
            <button type="button" onClick={closeExpanded} className="btn-secondary text-xs">
              Cancelar
            </button>
          </div>
        </form>
      </>
    );
  }

  /** Roster/assign panel — real enrollment via `fetchAlumnosPorHorario`,
   * rendered inline (PR3a). Assignment/unassignment/roster act on the WHOLE
   * grupo (every underlying `horario_id` día row) at once — there is no
   * per-día selection anymore, since a student belongs to every día of the
   * grupo, never to a single loose day. */
  function renderAlumnosPanel(group: HorarioGroup): React.ReactElement {
    return (
      <>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserPlus size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
            <h3 className="text-sm font-bold text-cata-text">
              Asignar alumnos al horario
            </h3>
          </div>
          <button type="button" onClick={closeExpanded} className="btn-secondary text-xs">
            Cerrar
          </button>
        </div>

        {cargandoAlumnos ? (
          <div className="flex items-center gap-2 py-4 text-sm text-cata-text/50">
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            Cargando alumnos...
          </div>
        ) : (
          <>
            {alumnosPorHorario.length > 0 && (
              <div className="mb-4">
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-cata-text/40">
                  Alumnos asignados ({alumnosPorHorario.length})
                </p>
                <div className="space-y-2">
                  {alumnosPorHorario.map((a) => (
                    <div key={a.id} className="flex items-center justify-between rounded-lg bg-cata-bg px-3 py-2">
                      <span className="text-sm text-cata-text">{a.personaNombreCompleto} · {a.edad} años</span>
                      <button
                        type="button"
                        onClick={() => void handleDesasignarAlumno(group, a.personaId)}
                        className="rounded-lg border border-cata-border p-1 text-cata-text/50 transition-colors hover:bg-red-50 hover:text-cata-red"
                        title="Desasignar alumno"
                      >
                        <UserMinus size={12} strokeWidth={1.5} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label htmlFor="alumno-select" className="mb-1 block text-xs font-medium text-cata-text/65">
                  Seleccionar alumno
                </label>
                <select
                  id="alumno-select"
                  className="input-field w-full"
                  value={alumnoSeleccionado ?? ""}
                  onChange={(e) => setAlumnoSeleccionado(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Seleccionar alumno...</option>
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
                onClick={() => void handleAsignarAlumno(group)}
                disabled={!alumnoSeleccionado || asignandoAlumno}
                className="btn-primary inline-flex items-center gap-1.5 text-xs"
              >
                {asignandoAlumno ? (
                  <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                ) : (
                  <UserPlus size={12} strokeWidth={2} aria-hidden="true" />
                )}
                Asignar
              </button>
            </div>
          </>
        )}
      </>
    );
  }

  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <AppShell
        eyebrow="Gestión Operativa"
        title="Gestión de Horarios"
      >
        {loadError && (
          <div
            className="mb-4 flex items-center gap-2 rounded-xl border border-cata-red/30 bg-cata-red/10 px-4 py-3 text-sm text-cata-red"
            role="alert"
          >
            <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />
            {loadError}
            <button type="button" onClick={() => void loadData()} className="btn-ghost ml-auto text-xs">
              Reintentar
            </button>
          </div>
        )}

        {notification && (
          <div
            className={`mb-4 flex items-center gap-2 rounded-xl px-4 py-3 text-sm ${
              notification.type === "success"
                ? "border border-cata-state-ok/30 bg-cata-state-ok/10 text-cata-state-ok"
                : "border border-cata-red/30 bg-cata-red/10 text-cata-red"
            }`}
            role="alert"
          >
            {notification.type === "success" ? (
              <CheckCircle2 size={14} strokeWidth={2} aria-hidden="true" />
            ) : (
              <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />
            )}
            {notification.message}
          </div>
        )}

        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
            <h2 className="text-lg font-bold text-cata-text">
              Horarios de Entrenamiento ({horarios.length})
            </h2>
          </div>
          <button
            type="button"
            onClick={openCreateForm}
            className="btn-primary inline-flex items-center gap-1.5 text-xs"
          >
            <Plus size={14} strokeWidth={2} aria-hidden="true" />
            Nuevo Horario
          </button>
        </div>

        {expandedGroup?.key === NEW_GROUP_KEY && (
          <div className="card mb-6 p-5">
            {renderHorarioForm()}
          </div>
        )}

        {loading ? (
          <div className="card flex flex-col items-center py-12 text-center">
            <Loader2 size={24} className="mb-3 animate-spin text-cata-text/30" aria-hidden="true" />
            <p className="text-sm text-cata-text/50">Cargando horarios…</p>
          </div>
        ) : horarios.length > 0 ? (
          <div className="space-y-3">
            {groupHorarios(horarios).map((group) => {
              // Asignar-alumnos opens the tab on the first día in the group
              // (per-día switching happens inside the tab via the día-pill
              // selector — PR3b). The trash icon, unlike that, deletes the
              // WHOLE group (every día row) via `requestDeleteGroup`.
              const isDeleting = group.rows.some((row) => row.id === deletingId);

              return (
                <div key={group.key} className="card p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-cata-red/10">
                        <Calendar size={20} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
                      </div>
                      <div>
                        <div className="text-xs font-extrabold uppercase tracking-wide text-cata-red">
                          {(CATEGORIA_METADATA[group.categoria as Categoria] ?? CATEGORIA_METADATA[DEFAULT_CATEGORIA]).label}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {group.rows.map((row) => (
                            <span
                              key={row.id}
                              className="inline-flex items-center rounded-full bg-cata-bg px-2 py-0.5 text-xs font-bold text-cata-text"
                            >
                              {shortDiaLabel(row.diaSemana)}
                            </span>
                          ))}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-cata-text/60">
                          <Clock size={11} strokeWidth={1.5} aria-hidden="true" />
                          {formatTime(group.horaInicio)} – {formatTime(group.horaFin)}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openAlumnosTab(group)}
                        disabled={isDeleting}
                        aria-label="Ver alumnos del horario"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-cata-red/10 px-2.5 py-1.5 text-xs font-bold text-cata-red transition-colors hover:bg-cata-red/20 disabled:opacity-50"
                      >
                        <Users size={13} strokeWidth={1.5} aria-hidden="true" />
                        Ver alumnos
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditForm(group)}
                        disabled={isDeleting}
                        className="rounded-lg border border-cata-border p-1.5 text-cata-text/50 transition-colors hover:bg-cata-red/10 hover:text-cata-red disabled:opacity-50"
                        title="Editar horario"
                      >
                        <Pencil size={13} strokeWidth={1.5} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void requestDeleteGroup(group)}
                        disabled={isDeleting}
                        className="rounded-lg border border-cata-border p-1.5 text-cata-text/50 transition-colors hover:bg-red-50 hover:text-cata-red disabled:opacity-50"
                        title="Eliminar horario"
                      >
                        {isDeleting ? (
                          <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                        ) : (
                          <Trash2 size={13} strokeWidth={1.5} aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </div>

                  {expandedGroup?.key === group.key && expandedGroup.tab === "editar" && (
                    <div className="mt-4 border-t border-cata-border pt-4">
                      {renderHorarioForm()}
                    </div>
                  )}

                  {expandedGroup?.key === group.key && expandedGroup.tab === "alumnos" && (
                    <div className="mt-4 border-t border-cata-border pt-4">
                      {renderAlumnosPanel(group)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="card flex flex-col items-center py-16 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-cata-red/10">
              <Calendar size={28} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
            </div>
            <h3 className="mb-1 text-base font-bold text-cata-text">
              No hay horarios configurados
            </h3>
            <p className="mb-4 max-w-sm text-sm text-cata-text/50">
              Creá un horario de entrenamiento para empezar a gestionar los grupos.
            </p>
            <button
              type="button"
              onClick={openCreateForm}
              className="btn-primary inline-flex items-center gap-1.5 text-xs"
            >
              <Plus size={14} strokeWidth={2} aria-hidden="true" />
              Crear primer horario
            </button>
          </div>
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
