/**
 * Nivel assignment panel — the trainer's `/trainer/nivel` screen.
 *
 * It used to be shared with the admin's `/ranking`. `/ranking` is now "la
 * escalera" (`app/ranking/page.tsx`), a ladder of niveles rather than a table
 * of students, so this panel has a single caller again. FASE 4 of the redesign
 * plan removes the Niveles section from the trainer entirely, at which point
 * this file goes with it.
 *
 * Assigns/moves each student's nivel (initial assignment via
 * `asignar-nivel-inicial`, re-assignment via `mover-de-nivel`).
 *
 * The nivel a student is assigned to IS the same `nivel_ranking` record used
 * by Grupo/`NivelTecnico` (see src/app/groups/page.tsx) — the backend only
 * has one such table. Mutating actions call the real backend endpoints
 * (assignStudentToNivel/moveStudentToNivel, same functions groups.tsx uses),
 * so after a successful assignment the roster is reloaded to reflect the
 * student's new nivel.
 *
 * Data source: `fetchAlumnosParaNivel()` + `fetchNivelesConOcupacion()`, both
 * readable by ADMINISTRADOR and ENTRENADOR. It used to be `fetchMembers()`,
 * whose route starts from the ADMINISTRADOR-only `GET /personas/` (it exposes
 * cédula/teléfono/fecha de nacimiento) — so the trainer's `/trainer/nivel`
 * got a real 403 and never rendered a student. The roster carries only what
 * this screen actually reads: name, active flag, representante link and
 * current nivel.
 *
 * Real backend gap for the admin actor (do not work around — documented at
 * the source instead of guessed here): initial group assignment (`POST
 * /ranking/asignar-nivel-inicial`) is backend-restricted to ENTRENADOR — an
 * ADMINISTRADOR gets a real 403. Moving an already-assigned student (`PATCH
 * /ranking/mover-de-nivel`) works fine for admins.
 */

"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import BackLink from "@/components/BackLink";
import { Users, CheckCircle2, GraduationCap } from "lucide-react";
import {
  Badge,
  EmptyState,
  ErrorState,
  LevelChip,
  LoadingState,
  Pagination,
  isLevel,
} from "@/components/ui";
import {
  fetchAlumnosParaNivel,
  fetchNivelesConOcupacion,
  assignStudentToNivel,
  moveStudentToNivel,
  ApiClientError,
  type AlumnoParaNivel,
  type NivelConOcupacion,
} from "@/services/api";
import { useToast } from "@/contexts/ToastContext";
import { buildNivelStudents } from "@/app/trainer/nivel/nivel-utils";
import { paginateRecords, getTotalPages } from "@/app/attendance/attendance-utils";
import type { UserRole } from "@/types/domain";

/** Tamaño de página para la lista de estudiantes (Nivel). */
const NIVEL_PAGE_SIZE = 10;

/**
 * The current-nivel cell.
 *
 * This used to paint a bespoke sky/violet/fuchsia ramp keyed on
 * `nivelCategoria`. That field is not an independent taxonomy: the backend
 * DERIVES it from the rank itself —
 * `backend/app/presentacion/schemas/ranking_schemas.py:26-36`,
 * `numero_nivel <= 3 → "avanzado"`, `<= 6 → "intermedio"`, else
 * `"principiante"`. So the three colours were a lossy re-encoding of a number
 * the payload already carries, in a hue scheme that contradicts the approved
 * l1–l10 grey ramp (`_sistema.css:44-45`) and implied a judgement the club
 * explicitly does not want to make.
 *
 * `numeroNivel` maps onto the ramp one-to-one, so the chip is now `LevelChip`.
 * Ranks outside 1–10 (the ramp is defined for ten rungs) and the unassigned
 * case fall back to the system's neutral `Badge` rather than to an invented
 * colour.
 */
function NivelActual({
  niveles,
  nivelId,
}: {
  niveles: NivelConOcupacion[];
  nivelId: number | null;
}): React.ReactElement {
  if (nivelId === null) {
    return <Badge tone="neutral">Sin asignar</Badge>;
  }
  const nivel = niveles.find((n) => n.id === nivelId);
  if (!nivel) {
    return <Badge tone="neutral">{`Nivel ${nivelId}`}</Badge>;
  }
  if (!isLevel(nivel.numeroNivel)) {
    return <Badge tone="neutral">{nivel.nombre ?? `Nivel ${nivel.numeroNivel}`}</Badge>;
  }
  return (
    <span className="inline-flex items-center gap-2">
      <LevelChip level={nivel.numeroNivel} label={nivel.nombre ?? `Nivel ${nivel.numeroNivel}`} />
      <span className="text-[12.5px] font-semibold text-ink-2">
        {nivel.nombre ?? `Nivel ${nivel.numeroNivel}`}
      </span>
    </span>
  );
}

export interface NivelAsignacionPanelProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly allowedRoles: UserRole[];
  readonly backHref: string;
  readonly backLabel: string;
}

export default function NivelAsignacionPanel({
  eyebrow,
  title,
  allowedRoles,
  backHref,
  backLabel,
}: NivelAsignacionPanelProps): React.ReactElement {
  const [roster, setRoster] = useState<AlumnoParaNivel[]>([]);
  const [niveles, setNiveles] = useState<NivelConOcupacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const rosterRef = useRef(roster);
  rosterRef.current = roster;

  const fetchPanelData = useCallback(async (): Promise<void> => {
    const [rosterData, nivelesData] = await Promise.all([
      fetchAlumnosParaNivel(),
      fetchNivelesConOcupacion(),
    ]);
    setRoster(rosterData);
    setNiveles(nivelesData);
  }, []);

  const loadData = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      await fetchPanelData();
    } catch {
      setLoadError("No se pudieron cargar los estudiantes. Intente nuevamente.");
    } finally {
      setLoading(false);
    }
  }, [fetchPanelData]);

  const silentRefresh = useCallback(async (): Promise<void> => {
    try {
      await fetchPanelData();
    } catch {
      /* swallow — data is stale but functional */
    }
  }, [fetchPanelData]);

  const handleOptimisticAssign = useCallback(
    (studentId: string, newNivelId: number) => {
      const previous = rosterRef.current.find((alumno) => String(alumno.personaId) === studentId);
      const oldNivelId = previous?.nivelRankingId ?? null;

      setRoster((prev) =>
        prev.map((alumno) =>
          String(alumno.personaId) === studentId
            ? { ...alumno, nivelRankingId: newNivelId }
            : alumno,
        ),
      );

      setNiveles((prev) =>
        prev.map((n) => {
          if (oldNivelId !== null && n.id === oldNivelId) {
            return {
              ...n,
              personasActuales: Math.max(0, n.personasActuales - 1),
              cuposDisponibles: n.cuposDisponibles + 1,
            };
          }
          if (n.id === newNivelId) {
            return {
              ...n,
              personasActuales: n.personasActuales + 1,
              cuposDisponibles: Math.max(0, n.cuposDisponibles - 1),
            };
          }
          return n;
        }),
      );
    },
    [],
  );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const students = buildNivelStudents(roster);

  return (
    <ProtectedRoute allowedRoles={allowedRoles}>
      <AppShell eyebrow={eyebrow} title={title}>
        <BackLink href={backHref} label={backLabel} />

        {loadError && (
          <ErrorState className="mb-6" message={loadError} onRetry={() => void loadData()} />
        )}

        <AsignarNivelTab
          students={students}
          niveles={niveles}
          loading={loading}
          onOptimisticAssign={handleOptimisticAssign}
          onBackgroundRefresh={silentRefresh}
        />
      </AppShell>
    </ProtectedRoute>
  );
}

// ---------------------------------------------------------------------------
// Tab 1 — Asignar Nivel
// ---------------------------------------------------------------------------

interface AsignarNivelTabProps {
  students: ReturnType<typeof buildNivelStudents>;
  niveles: NivelConOcupacion[];
  loading: boolean;
  onOptimisticAssign: (studentId: string, newNivelId: number) => void;
  onBackgroundRefresh: () => Promise<void>;
}

const NIVEL_FILTER_UNASSIGNED = "sin-asignar";

/** How long the "Asignado" label stays on the row before reverting to "Asignar". */
const SUCCESS_RESET_DELAY_MS = 2000;

function AsignarNivelTab({ students, niveles, loading, onOptimisticAssign, onBackgroundRefresh }: AsignarNivelTabProps): React.ReactElement {
  const { showSuccess, showError } = useToast();
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which rows currently show "Asignado". A Set (not a single id) because two
  // students can complete an assignment within each other's reset window —
  // each row's "Asignado" state must revert independently.
  const [successIds, setSuccessIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [nivelFilter, setNivelFilter] = useState("");
  const [page, setPage] = useState(1);
  // One reset timer per student (keyed by estudianteId), not a single shared
  // ref — otherwise a second student's assignment completing overwrites the
  // ref before the first student's timer is cleared, leaving it orphaned:
  // it still fires and clears `successId` unconditionally, hiding the
  // second student's "Asignado" before that student's own 2s window elapses.
  const resetTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Clear every pending "Asignado" reset timer on unmount so no state update
  // fires after the component is gone.
  useEffect(() => {
    const timers = resetTimersRef.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  const filteredStudents = students.filter((student) => {
    const term = searchTerm.trim().toLowerCase();
    const matchesSearch =
      term === "" ||
      `${student.nombres} ${student.apellidos}`.toLowerCase().includes(term);

    const matchesNivel =
      nivelFilter === "" ||
      (nivelFilter === NIVEL_FILTER_UNASSIGNED
        ? student.nivelRankingId === null
        : student.nivelRankingId === Number(nivelFilter));

    return matchesSearch && matchesNivel;
  });

  /** Resetea a página 1 cada vez que cambian los filtros o los datos. */
  useEffect(() => {
    setPage(1);
  }, [filteredStudents.length, searchTerm, nivelFilter]);

  const totalPages = useMemo(
    () => getTotalPages(filteredStudents.length, NIVEL_PAGE_SIZE),
    [filteredStudents.length],
  );
  const paginatedStudents = useMemo(
    () => paginateRecords(filteredStudents, page, NIVEL_PAGE_SIZE),
    [filteredStudents, page],
  );

  async function handleAssign(estudianteId: string): Promise<void> {
    const nivelId = drafts[estudianteId];
    if (!nivelId) return;

    const student = students.find((s) => s.id === estudianteId);
    setSavingId(estudianteId);
    setError(null);
    setSuccessIds((prev) => {
      if (!prev.has(estudianteId)) return prev;
      const next = new Set(prev);
      next.delete(estudianteId);
      return next;
    });
    const pendingTimer = resetTimersRef.current.get(estudianteId);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      resetTimersRef.current.delete(estudianteId);
    }
    try {
      if (student?.nivelRankingId === null || student?.nivelRankingId === undefined) {
        await assignStudentToNivel(Number(estudianteId), nivelId);
      } else {
        await moveStudentToNivel(Number(estudianteId), nivelId);
      }
      onOptimisticAssign(estudianteId, nivelId);
      setSuccessIds((prev) => new Set(prev).add(estudianteId));
      showSuccess("Nivel asignado correctamente.");
      void onBackgroundRefresh();
      const timer = setTimeout(() => {
        setSuccessIds((prev) => {
          if (!prev.has(estudianteId)) return prev;
          const next = new Set(prev);
          next.delete(estudianteId);
          return next;
        });
        resetTimersRef.current.delete(estudianteId);
      }, SUCCESS_RESET_DELAY_MS);
      resetTimersRef.current.set(estudianteId, timer);
    } catch (err) {
      console.error("[nivel] assign/move nivel failed", err);
      const message = err instanceof ApiClientError ? err.message : "Error al asignar el nivel.";
      setError(message);
      showError(message);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-cata-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Users size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
          <h2 className="text-sm font-bold text-cata-text">Estudiantes ({filteredStudents.length})</h2>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="text"
            aria-label="Buscar estudiante por nombre"
            placeholder="Buscar por nombre…"
            className="input-field w-full sm:w-48"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <select
            aria-label="Filtrar por nivel actual"
            className="input-field w-full sm:w-40"
            value={nivelFilter}
            onChange={(e) => setNivelFilter(e.target.value)}
          >
            <option value="">Todos</option>
            <option value={NIVEL_FILTER_UNASSIGNED}>Sin asignar</option>
            {niveles.map((n) => (
              <option key={n.id} value={n.id}>
                {n.nombre ?? n.numeroNivel}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="alert-error mx-5 mt-4" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <LoadingState label="Cargando estudiantes…" />
      ) : students.length === 0 ? (
        <EmptyState
          icon={<Users size={21} strokeWidth={1.5} aria-hidden="true" />}
          title="No hay estudiantes registrados"
          description="Cuando se inscriba el primer alumno, aparecerá aquí para asignarle un nivel."
        />
      ) : filteredStudents.length === 0 ? (
        <EmptyState
          icon={<Users size={21} strokeWidth={1.5} aria-hidden="true" />}
          title="No se encontraron estudiantes"
          description="Ningún estudiante coincide con la búsqueda y los filtros activos."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-cata-border bg-cata-bg text-xs font-medium uppercase tracking-wider text-cata-text/65">
                <th className="px-4 py-3 font-medium">Estudiante</th>
                <th className="px-4 py-3 text-center font-medium">Nivel actual</th>
                <th className="px-4 py-3 font-medium">Nuevo nivel</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-cata-border">
              {paginatedStudents.map((student) => (
                <tr key={student.id} className="transition-colors hover:bg-cata-bg">
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cata-red/15">
                        <GraduationCap size={14} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
                      </div>
                      <div>
                        <span className="font-medium text-cata-text">
                          {student.nombres} {student.apellidos}
                        </span>
                        {!student.activo && (
                          <span className="ml-2 rounded bg-cata-bg px-1.5 py-0.5 text-[10px] font-medium text-cata-text/45">
                            Inactivo
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <NivelActual niveles={niveles} nivelId={student.nivelRankingId} />
                  </td>
                  <td className="px-4 py-3.5">
                    <select
                      aria-label={`Nuevo nivel para ${student.nombres} ${student.apellidos}`}
                      className="input-field w-24 py-1.5 text-sm"
                      value={drafts[student.id] ?? ""}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [student.id]: Number(e.target.value) }))
                      }
                    >
                      <option value="">—</option>
                      {niveles.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.nombre ?? n.numeroNivel}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3.5">
                    <button
                      type="button"
                      disabled={!drafts[student.id] || savingId === student.id}
                      onClick={() => handleAssign(student.id)}
                      className="btn-secondary py-1.5 text-xs"
                    >
                      {savingId === student.id ? (
                        "Guardando…"
                      ) : successIds.has(student.id) ? (
                        <>
                          <CheckCircle2 size={12} strokeWidth={2} aria-hidden="true" />
                          Asignado
                        </>
                      ) : (
                        "Asignar"
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Paginación */}
      {!loading && filteredStudents.length > NIVEL_PAGE_SIZE && (
        <Pagination
          className="mt-0 border-t border-cata-border bg-cata-bg px-4 py-3"
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          totalItems={filteredStudents.length}
          pageSize={NIVEL_PAGE_SIZE}
          itemNoun="estudiante"
        />
      )}
    </div>
  );
}
