/**
 * Niveles — "la escalera".
 *
 * The audit's sharpest finding was about this screen: levels 1–10 with 1 at
 * the top is the club's proudest structure, and the interface rendered it as
 * a string picked from a `<select>` in a per-student table. Nothing in that
 * layout encoded that the scale is ordinal, that 1 sits above 10, or that
 * moving up is an achievement.
 *
 * So the screen is now the ladder itself (`docs/ux/prototipos/13-niveles.html`,
 * plan FASE 3 item 4): a vertical 1→10 list with a connecting rail, the rank
 * chip on the l1–l10 ramp, the level name, the roster as an avatar stack, and
 * ONE action per rung — "Asignar". Assignment is a panel that opens under the
 * rung it belongs to, so the target level is the heading of what you are doing
 * rather than a value you pick out of a dropdown.
 *
 * Non-negotiable product rules baked in here:
 *   - NO occupancy. `NivelConOcupacion` carries `personasActuales`,
 *     `cuposDisponibles` and `necesitaRevision`; none of the three reaches the
 *     UI. The backend still computes them to validate capacity server-side.
 *   - NO "Promover". The single verb is "Asignar", whether the student is
 *     unassigned (`POST /ranking/asignar-nivel-inicial`) or already on a rung
 *     (`PATCH /ranking/mover-de-nivel`).
 *   - Two stats, no judgement: Estudiantes asignados and Niveles.
 *
 * DATA NOTE — needs a product decision, not a workaround. The dev database
 * holds ELEVEN levels whose names are "1A", "1B", "2", "3" … "10", against
 * `numero_nivel` 1…11. So the club's own label for a rung and its rank are
 * different numbers from the third rung down, and the ladder cannot show a
 * single number that is both. It shows the rank on the chip (that is what the
 * l1–l10 ramp encodes and what "1 es la cima" refers to) and the club's name
 * beside it, and the chip's accessible label says "Puesto N" rather than
 * "Nivel N" so it never claims to be the name. Two consequences the client has
 * to settle: the eleventh rung falls off the ten-step ramp and gets a neutral
 * chip, and the prototype's "1 es la cima, 10 es la base" copy does not
 * literally describe a ladder whose bottom rung is named "10" but ranked 11th.
 *
 * Real backend gap for this actor (documented, not worked around): initial
 * assignment is backend-restricted to ENTRENADOR, so an ADMINISTRADOR gets a
 * real 403 assigning a student who has no level yet. Moving an
 * already-assigned student works fine for admins.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trophy, Users } from "lucide-react";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import BackLink from "@/components/BackLink";
import NivelLadder, { type LadderRung } from "@/components/nivel/NivelLadder";
import {
  Button,
  EmptyState,
  ErrorState,
  LevelChip,
  LoadingState,
  SearchInput,
  StatCard,
  isLevel,
} from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import {
  ApiClientError,
  assignStudentToNivel,
  fetchAlumnosParaNivel,
  fetchNivelesConOcupacion,
  moveStudentToNivel,
  type AlumnoParaNivel,
  type NivelConOcupacion,
} from "@/services/api";
import { buildNivelStudents, type NivelStudentRef } from "@/app/trainer/nivel/nivel-utils";

/** How long a row shows "Asignado" before reverting to "Asignar". */
const SUCCESS_RESET_DELAY_MS = 2000;

/** Rows the assignment panel renders before it asks you to search instead. */
const PANEL_VISIBLE_LIMIT = 12;

/** Display name for a level, falling back to its rank when unnamed. */
function nivelNombre(nivel: NivelConOcupacion): string {
  return nivel.nombre ?? `Nivel ${nivel.numeroNivel}`;
}

export default function RankingPage(): React.ReactElement {
  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <RankingContent />
    </ProtectedRoute>
  );
}

function RankingContent(): React.ReactElement {
  const { showSuccess, showError } = useToast();

  const [roster, setRoster] = useState<AlumnoParaNivel[]>([]);
  const [niveles, setNiveles] = useState<NivelConOcupacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [openNivelId, setOpenNivelId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [successIds, setSuccessIds] = useState<Set<string>>(new Set());
  const [assignError, setAssignError] = useState<string | null>(null);

  // One reset timer per student, not a single shared ref: two assignments can
  // complete inside each other's 2s window and each row's "Asignado" has to
  // expire on its own clock.
  const resetTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => {
    const timers = resetTimersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);

  const fetchLadderData = useCallback(async (): Promise<void> => {
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
      await fetchLadderData();
    } catch {
      setLoadError("No se pudieron cargar los niveles. Intente nuevamente.");
    } finally {
      setLoading(false);
    }
  }, [fetchLadderData]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const students = useMemo(() => buildNivelStudents(roster), [roster]);

  const assignedCount = students.filter((student) => student.nivelRankingId !== null).length;

  const rungs: LadderRung[] = useMemo(
    () =>
      niveles.map((nivel) => ({
        id: nivel.id,
        numeroNivel: nivel.numeroNivel,
        nombre: nivelNombre(nivel),
        students: students
          .filter((student) => student.nivelRankingId === nivel.id)
          .map((student) => ({
            id: student.id,
            nombre: `${student.nombres} ${student.apellidos}`,
          })),
      })),
    [niveles, students],
  );

  const openNivel = niveles.find((nivel) => nivel.id === openNivelId) ?? null;

  function handleToggleRung(nivelId: number): void {
    setAssignError(null);
    setSearch("");
    setOpenNivelId((prev) => (prev === nivelId ? null : nivelId));
  }

  /**
   * Assign or move — one verb for the user, two endpoints underneath. A
   * student with no level yet takes `asignar-nivel-inicial`; anyone already
   * on a rung takes `mover-de-nivel`.
   */
  async function handleAssign(student: NivelStudentRef, nivelId: number): Promise<void> {
    setSavingId(student.id);
    setAssignError(null);

    const pending = resetTimersRef.current.get(student.id);
    if (pending) {
      clearTimeout(pending);
      resetTimersRef.current.delete(student.id);
    }

    try {
      if (student.nivelRankingId === null) {
        await assignStudentToNivel(Number(student.id), nivelId);
      } else {
        await moveStudentToNivel(Number(student.id), nivelId);
      }

      // Optimistic: the rung's avatar stack updates without a refetch.
      setRoster((prev) =>
        prev.map((alumno) =>
          String(alumno.personaId) === student.id
            ? { ...alumno, nivelRankingId: nivelId }
            : alumno,
        ),
      );
      setSuccessIds((prev) => new Set(prev).add(student.id));
      showSuccess("Nivel asignado correctamente.");

      const timer = setTimeout(() => {
        setSuccessIds((prev) => {
          if (!prev.has(student.id)) return prev;
          const next = new Set(prev);
          next.delete(student.id);
          return next;
        });
        resetTimersRef.current.delete(student.id);
      }, SUCCESS_RESET_DELAY_MS);
      resetTimersRef.current.set(student.id, timer);
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : "Error al asignar el nivel.";
      setAssignError(message);
      showError(message);
    } finally {
      setSavingId(null);
    }
  }

  const term = search.trim().toLowerCase();
  const panelStudents = students.filter(
    (student) =>
      term === "" || `${student.nombres} ${student.apellidos}`.toLowerCase().includes(term),
  );
  const visibleStudents = panelStudents.slice(0, PANEL_VISIBLE_LIMIT);
  const hiddenCount = panelStudents.length - visibleStudents.length;

  function renderPanel(): React.ReactElement | null {
    if (!openNivel) return null;
    const nombre = nivelNombre(openNivel);

    return (
      <div className="border-t border-line bg-canvas px-5 py-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="flex-1 text-[13px] font-bold text-ink">
            Asignar estudiantes al nivel {nombre}
          </h3>
          <Button size="sm" onClick={() => setOpenNivelId(null)}>
            Cerrar
          </Button>
        </div>

        <SearchInput
          className="mb-3 max-w-xs"
          label={`Buscar estudiante para el nivel ${nombre}`}
          placeholder="Buscar por nombre…"
          value={search}
          onChange={setSearch}
        />

        {assignError ? (
          <p className="mb-3 text-[12.5px] text-state-bad" role="alert">
            {assignError}
          </p>
        ) : null}

        {panelStudents.length === 0 ? (
          <EmptyState
            icon={<Users size={21} strokeWidth={1.5} aria-hidden="true" />}
            title="No se encontraron estudiantes"
            description="Ningún estudiante coincide con la búsqueda."
          />
        ) : (
          <ul className="overflow-hidden rounded-ctl border border-line bg-paper">
            {visibleStudents.map((student) => {
              const alreadyHere = student.nivelRankingId === openNivel.id;
              const currentNivel = niveles.find((n) => n.id === student.nivelRankingId);

              return (
                <li
                  key={student.id}
                  className="flex min-h-drow flex-wrap items-center gap-3 border-b border-line px-3 py-2 last:border-b-0"
                >
                  {currentNivel && isLevel(currentNivel.numeroNivel) ? (
                    <LevelChip
                      level={currentNivel.numeroNivel}
                      label={`Nivel actual: ${currentNivel.numeroNivel}`}
                    />
                  ) : (
                    <span
                      title="Sin nivel"
                      className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-state-neutral-bg text-[10px] font-bold text-state-neutral"
                    >
                      <span className="sr-only">Sin nivel</span>
                      <span aria-hidden="true">—</span>
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">
                    {student.nombres} {student.apellidos}
                    {!student.activo ? (
                      <span className="ml-2 text-[11.5px] text-ink-3">Inactivo</span>
                    ) : null}
                  </span>
                  {alreadyHere ? (
                    <span className="flex-none text-[11.5px] font-semibold text-ink-3">
                      Ya está aquí
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      className="flex-none"
                      disabled={savingId === student.id}
                      onClick={() => void handleAssign(student, openNivel.id)}
                      aria-label={`Asignar ${student.nombres} ${student.apellidos} al nivel ${nombre}`}
                    >
                      {savingId === student.id
                        ? "Guardando…"
                        : successIds.has(student.id)
                          ? "Asignado"
                          : "Asignar"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {hiddenCount > 0 ? (
          <p className="mt-2 text-[12px] text-ink-3">
            {hiddenCount} estudiante{hiddenCount === 1 ? "" : "s"} más. Use la búsqueda para
            encontrarlos.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <AppShell eyebrow="Escalera de entrenamiento" title="Niveles">
      <BackLink href="/dashboard" label="Volver al Panel" />

      {loadError ? (
        <ErrorState className="mb-6" message={loadError} onRetry={() => void loadData()} />
      ) : null}

      {/* Two stats, and only two. The prototype caps this row at 520px so it
          reads as a pair rather than as a dashboard. */}
      <div className="mb-6 grid max-w-[520px] grid-cols-2 gap-3.5">
        <StatCard
          label="Estudiantes asignados"
          value={assignedCount}
          hint={`de ${students.length} estudiantes`}
        />
        <StatCard label="Niveles" value={niveles.length} hint="1 es la cima" />
      </div>

      <div className="overflow-hidden rounded-card border border-line bg-paper">
        {loading ? (
          <LoadingState label="Cargando niveles…" />
        ) : niveles.length === 0 ? (
          <EmptyState
            icon={<Trophy size={21} strokeWidth={1.5} aria-hidden="true" />}
            title="Todavía no hay niveles"
            description="Cuando el club cree su primer nivel, la escalera aparecerá aquí."
          />
        ) : (
          <NivelLadder
            rungs={rungs}
            openNivelId={openNivelId}
            onAssign={handleToggleRung}
            renderPanel={renderPanel}
          />
        )}
      </div>
    </AppShell>
  );
}
