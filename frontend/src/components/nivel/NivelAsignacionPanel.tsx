/**
 * Nivel assignment panel — shared between the trainer's `/trainer/nivel` and
 * the admin's `/ranking` screens (extracted to eliminate duplication; same
 * pattern as `SeleccionOficialPanel`).
 *
 * Assigns/moves each student's nivel (initial assignment via
 * `asignar-nivel-inicial`, re-assignment via `mover-de-nivel`).
 *
 * The nivel a student is assigned to IS the same `nivel_ranking` record used
 * by Grupo/`NivelTecnico` (see src/app/groups/page.tsx) — the backend only
 * has one such table, fetched here via the same
 * fetchNivelesConOcupacion()/fetchMembers() calls groups.tsx uses. Mutating
 * actions call the real backend endpoints (assignStudentToNivel/
 * moveStudentToNivel, same functions groups.tsx uses), so after a successful
 * assignment the member list is reloaded to reflect the student's new nivel.
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
import { Users, CheckCircle2, AlertTriangle, ChevronLeft, ChevronRight, GraduationCap } from "lucide-react";
import {
  fetchMembers,
  assignStudentToNivel,
  moveStudentToNivel,
  ApiClientError,
  type NivelConOcupacion,
} from "@/services/api";
import { useToast } from "@/contexts/ToastContext";
import { buildNivelStudents } from "@/app/trainer/nivel/nivel-utils";
import { paginateRecords, getTotalPages } from "@/app/attendance/attendance-utils";
import type { UserRole } from "@/types/domain";

/** Tamaño de página para la lista de estudiantes (Nivel). */
const NIVEL_PAGE_SIZE = 10;

const NIVEL_COLOR_MAP: Record<string, string> = {
  principiante: "border border-sky-200 bg-sky-100 text-sky-700",
  intermedio: "border border-violet-200 bg-violet-100 text-violet-700",
  avanzado: "border border-fuchsia-200 bg-fuchsia-100 text-fuchsia-700",
};
const DEFAULT_BADGE_CLASS = "border border-gray-200 bg-gray-100 text-gray-400";

function nivelBadge(
  niveles: NivelConOcupacion[],
  nivelId: number | null,
): { label: string; className: string } {
  if (nivelId === null) {
    return { label: "Sin asignar", className: DEFAULT_BADGE_CLASS };
  }
  const nivel = niveles.find((n) => n.id === nivelId);
  if (!nivel) {
    return { label: `Nivel ${nivelId}`, className: DEFAULT_BADGE_CLASS };
  }
  const label = nivel.nombre ?? String(nivel.numeroNivel);
  const className = NIVEL_COLOR_MAP[nivel.nivelCategoria] ?? DEFAULT_BADGE_CLASS;
  return { label, className };
}

export interface NivelAsignacionPanelProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly allowedRoles: UserRole[];
}

export default function NivelAsignacionPanel({
  eyebrow,
  title,
  allowedRoles,
}: NivelAsignacionPanelProps): React.ReactElement {
  const [members, setMembers] = useState<Awaited<ReturnType<typeof fetchMembers>>["accounts"]>([]);
  const [niveles, setNiveles] = useState<NivelConOcupacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const membersRef = useRef(members);
  membersRef.current = members;

  const loadData = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const { accounts: membersData, niveles: nivelesData } = await fetchMembers();
      setMembers(membersData);
      setNiveles(nivelesData);
    } catch {
      setLoadError("No se pudieron cargar los estudiantes. Intente nuevamente.");
    } finally {
      setLoading(false);
    }
  }, []);

  const silentRefresh = useCallback(async (): Promise<void> => {
    try {
      const { accounts: membersData, niveles: nivelesData } = await fetchMembers();
      setMembers(membersData);
      setNiveles(nivelesData);
    } catch {
      /* swallow — data is stale but functional */
    }
  }, []);

  const handleOptimisticAssign = useCallback(
    (studentId: string, newNivelId: number) => {
      const currentMembers = membersRef.current;
      let oldNivelId: number | null = null;
      for (const account of currentMembers) {
        for (const est of account.estudiantes) {
          if (est.id === studentId && est.grupoId !== null) {
            oldNivelId = Number(est.grupoId);
            break;
          }
        }
        if (oldNivelId !== null) break;
      }

      setMembers((prev) =>
        prev.map((account) => ({
          ...account,
          estudiantes: account.estudiantes.map((est) =>
            est.id === studentId ? { ...est, grupoId: String(newNivelId) } : est,
          ),
        })),
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

  const students = buildNivelStudents(members);

  return (
    <ProtectedRoute allowedRoles={allowedRoles}>
      <AppShell eyebrow={eyebrow} title={title}>
        {loadError && (
          <div
            className="mb-6 flex items-center gap-2 rounded-xl border border-cata-red/30 bg-cata-red/10 px-4 py-3 text-sm text-cata-red"
            role="alert"
          >
            <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />
            {loadError}
            <button type="button" onClick={() => void loadData()} className="btn-ghost ml-auto text-xs">
              Reintentar
            </button>
          </div>
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
  const { showSuccess } = useToast();
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
      setError(
        err instanceof ApiClientError ? err.message : "Error al asignar el nivel.",
      );
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
        <div className="flex flex-col items-center py-12 text-center">
          <p className="text-sm text-cata-text/50">Cargando estudiantes…</p>
        </div>
      ) : students.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-center">
          <Users size={32} strokeWidth={1.5} className="mb-3 text-cata-text/20" aria-hidden="true" />
          <p className="text-sm text-cata-text/50">No hay estudiantes registrados.</p>
        </div>
      ) : filteredStudents.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-center">
          <Users size={32} strokeWidth={1.5} className="mb-3 text-cata-text/20" aria-hidden="true" />
          <p className="text-sm text-cata-text/50">No se encontraron estudiantes con ese criterio.</p>
        </div>
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
                    {(() => {
                      const badge = nivelBadge(niveles, student.nivelRankingId);
                      return (
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}>
                          {badge.label}
                        </span>
                      );
                    })()}
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
                        "Guardando..."
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
        <div className="flex items-center justify-between border-t border-cata-border bg-cata-bg px-4 py-3">
          <p className="text-xs text-cata-text/65">
            Página {page} de {totalPages} · {filteredStudents.length} estudiante{filteredStudents.length !== 1 ? "s" : ""}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Página anterior"
            >
              <ChevronLeft size={14} strokeWidth={1.5} aria-hidden="true" />
              Anterior
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Página siguiente"
            >
              Siguiente
              <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
