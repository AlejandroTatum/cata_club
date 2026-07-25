/**
 * Niveles — "la escalera".
 *
 * The audit's sharpest finding was about this screen: levels 1–10 with 1 at
 * the top is the club's proudest structure, and the interface rendered it as
 * a string picked from a `<select>` in a per-student table. Nothing in that
 * layout encoded that the scale is ordinal, that the first rung sits above the
 * last, or that moving up is an achievement. So the screen is the ladder
 * itself (`docs/ux/prototipos/13-niveles.html`): a vertical list with a
 * connecting rail, one rung per level, and assignment opening under the rung
 * it belongs to rather than hiding in a dropdown.
 *
 * v2 made the ladder a working tool. The metaphor was right and is untouched;
 * four things made it unusable against real data, and each has an answer here:
 *
 *   1. TWO NUMBERS PER RUNG. The club's ELEVEN levels are named "1A", "1B",
 *      "2" … "10" against ranks 1…11, so a chip reading "3" sat beside a name
 *      reading "2". The name now leads and is the only number rendered; the
 *      rank lives in the ordering, the rail and the node's "Puesto N" title.
 *      See `NivelLadder`'s header for the full rule.
 *   2. NO NAMES. 59 assigned students were shown as grey two-letter initials.
 *      Rungs carry real names now.
 *   3. NO WAY TO FIND ANYONE. The two real tasks are "where is Juan?" and
 *      "move Juan up a level". A page-level search answers the first by
 *      picking Juan out on his own rung, and the second by offering the move
 *      right there in the result row.
 *   4. THE UNASSIGNED WERE INVISIBLE. "59 de 67" named eight students it gave
 *      no way to see or act on. They now have their own block above the
 *      ladder, each with the one control that places them.
 *
 * Non-negotiable product rules baked in here:
 *   - NO occupancy. `NivelConOcupacion` carries `personasActuales`,
 *     `cuposDisponibles` and `necesitaRevision`; none of the three reaches the
 *     UI. The backend still computes them to validate capacity server-side.
 *   - NO "Promover". A student with no level yet is "Asignar"
 *     (`POST /ranking/asignar-nivel-inicial`); one already on a rung is
 *     "Mover" (`PATCH /ranking/mover-de-nivel`). Two endpoints, and the word
 *     says which of the two the row will call — never a judgement about the
 *     direction of the change.
 *   - Two stats, no judgement: Estudiantes asignados and Niveles.
 *
 * NAME vs RANK still wants a product decision, though the screen no longer
 * depends on one: the club's names and `numero_nivel` diverge from the third
 * rung down, and the prototype's "1 es la cima" copy does not literally
 * describe a ladder whose bottom rung is NAMED "10" but ranked 11th. The stat
 * hint is derived from the top rung's real name instead of hardcoding "1".
 *
 * ROLE NOTE: initial assignment is open to ADMINISTRADOR and ENTRENADOR alike
 * (`ROL_ADMIN_O_ENTRENADOR` on `POST /ranking/asignar-nivel-inicial`), so an
 * admin can place the unassigned students this screen surfaces. An older note
 * here claimed the endpoint was trainer-only; the router says otherwise.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trophy, UserPlus, Users } from "lucide-react";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import BackLink from "@/components/BackLink";
import NivelLadder, { type LadderRung } from "@/components/nivel/NivelLadder";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  SearchInput,
  StatCard,
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
import {
  searchStudents,
  sortStudentsByName,
  studentFullName,
  unassignedStudents,
} from "./ranking-page-utils";

/** How long a row shows its success label before reverting to the verb. */
const SUCCESS_RESET_DELAY_MS = 2000;

/** Rows the rung's assignment panel renders before it asks you to search instead. */
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
  /** The rung panel's own filter — scoped to "who do I add to THIS rung". */
  const [panelSearch, setPanelSearch] = useState("");
  /** The page-level person finder — "where is Juan, and move him". */
  const [studentSearch, setStudentSearch] = useState("");
  /** Target level picked per student in a direct assign/move row. */
  const [targetNivelIds, setTargetNivelIds] = useState<Record<string, number>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [successIds, setSuccessIds] = useState<Set<string>>(new Set());
  const [assignError, setAssignError] = useState<string | null>(null);

  // One reset timer per student, not a single shared ref: two assignments can
  // complete inside each other's 2s window and each row's success label has to
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

  /** Rank order — the ladder's order, and the order every level picker uses. */
  const nivelesPorPuesto = useMemo(
    () => [...niveles].sort((a, b) => a.numeroNivel - b.numeroNivel),
    [niveles],
  );

  const sinNivel = useMemo(() => unassignedStudents(students), [students]);
  const resultados = useMemo(
    () => searchStudents(students, studentSearch),
    [students, studentSearch],
  );
  const buscando = studentSearch.trim() !== "";
  const resaltados = useMemo(
    () => new Set(resultados.map((student) => student.id)),
    [resultados],
  );

  const rungs: LadderRung[] = useMemo(
    () =>
      niveles.map((nivel) => ({
        id: nivel.id,
        numeroNivel: nivel.numeroNivel,
        nombre: nivelNombre(nivel),
        students: sortStudentsByName(
          students.filter((student) => student.nivelRankingId === nivel.id),
        ).map((student) => ({ id: student.id, nombre: studentFullName(student) })),
      })),
    [niveles, students],
  );

  const openNivel = niveles.find((nivel) => nivel.id === openNivelId) ?? null;

  function handleToggleRung(nivelId: number): void {
    setAssignError(null);
    setPanelSearch("");
    setOpenNivelId((prev) => (prev === nivelId ? null : nivelId));
  }

  /**
   * Assign or move — one gesture for the user, two endpoints underneath. A
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

      // Optimistic: the rung's roster updates without a refetch.
      setRoster((prev) =>
        prev.map((alumno) =>
          String(alumno.personaId) === student.id
            ? { ...alumno, nivelRankingId: nivelId }
            : alumno,
        ),
      );
      setSuccessIds((prev) => new Set(prev).add(student.id));
      setTargetNivelIds((prev) => {
        if (!(student.id in prev)) return prev;
        const next = { ...prev };
        delete next[student.id];
        return next;
      });
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

  /**
   * A student row that carries its own destination: the name, where they are
   * now, a level picker and the one button that places them.
   *
   * This is the control the screen was missing. Both blocks that need it — the
   * unassigned students and the search results — are lists of "this person,
   * that level", so they share one row rather than two dialects of it.
   */
  function renderStudentRow(student: NivelStudentRef, scope: string): React.ReactElement {
    const nombre = studentFullName(student);
    const actual = niveles.find((nivel) => nivel.id === student.nivelRankingId) ?? null;
    const destino = targetNivelIds[student.id];
    const verbo = student.nivelRankingId === null ? "Asignar" : "Mover";
    const selectId = `nivel-destino-${scope}-${student.id}`;

    return (
      <li
        key={student.id}
        className="flex min-h-drow flex-wrap items-center gap-3 border-b border-line px-3 py-2 last:border-b-0"
      >
        {/* On a phone the name takes the whole first line and the controls the
            second: truncating a student's name to "Arian…" to keep a picker on
            the same row loses the only thing the row is about. */}
        <span className="min-w-0 flex-1 basis-full truncate text-[13.5px] text-ink sm:basis-auto">
          {nombre}
          {!student.activo ? (
            <span className="ml-2 text-[11.5px] text-ink-3">Inactivo</span>
          ) : null}
        </span>

        {/* Where they are now. Suppressed inside the unassigned block, whose
            heading already says it — eight rows repeating "Sin nivel" is noise,
            not information. */}
        {scope === "sin-nivel" ? null : (
          <span className="flex-none text-[12.5px] text-ink-3">
            {actual ? `Nivel ${nivelNombre(actual)}` : "Sin nivel"}
          </span>
        )}

        <label htmlFor={selectId} className="sr-only">
          Nivel de destino para {nombre}
        </label>
        <select
          id={selectId}
          // `.input-field` carries `w-full`, which on a wide row would give the
          // picker everything and push the action onto a line of its own. A row
          // is "who · where they are · where they go · go", left to right.
          className="input-field h-ctl flex-1 sm:w-[168px] sm:flex-none"
          value={destino ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            setTargetNivelIds((prev) => {
              const next = { ...prev };
              if (value === "") delete next[student.id];
              else next[student.id] = Number(value);
              return next;
            });
          }}
        >
          <option value="">Elegir nivel…</option>
          {nivelesPorPuesto
            .filter((nivel) => nivel.id !== student.nivelRankingId)
            .map((nivel) => (
              <option key={nivel.id} value={nivel.id}>
                {nivelNombre(nivel)}
              </option>
            ))}
        </select>

        <Button
          size="sm"
          className="flex-none"
          disabled={destino === undefined || savingId === student.id}
          onClick={() => {
            if (destino !== undefined) void handleAssign(student, destino);
          }}
          aria-label={`${verbo} a ${nombre}`}
        >
          {savingId === student.id
            ? "Guardando…"
            : successIds.has(student.id)
              ? "Listo"
              : verbo}
        </Button>
      </li>
    );
  }

  /** The rung's own panel: who do I add to THIS level. */
  function renderPanel(): React.ReactElement | null {
    if (!openNivel) return null;
    const nombre = nivelNombre(openNivel);
    const term = panelSearch.trim().toLowerCase();
    const panelStudents = sortStudentsByName(
      students.filter(
        (student) => term === "" || studentFullName(student).toLowerCase().includes(term),
      ),
    );
    const visibleStudents = panelStudents.slice(0, PANEL_VISIBLE_LIMIT);
    const hiddenCount = panelStudents.length - visibleStudents.length;

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
          value={panelSearch}
          onChange={setPanelSearch}
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
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">
                    {studentFullName(student)}
                    {!student.activo ? (
                      <span className="ml-2 text-[11.5px] text-ink-3">Inactivo</span>
                    ) : null}
                  </span>
                  <span className="flex-none text-[12.5px] text-ink-3">
                    {currentNivel ? `Nivel ${nivelNombre(currentNivel)}` : "Sin nivel"}
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
                      aria-label={`Asignar ${studentFullName(student)} al nivel ${nombre}`}
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

  const cima = nivelesPorPuesto[0];

  return (
    <AppShell eyebrow="Escalera de entrenamiento" title="Niveles">
      <BackLink href="/dashboard" label="Volver al Panel" />

      {loadError ? (
        <ErrorState className="mb-6" message={loadError} onRetry={() => void loadData()} />
      ) : null}

      {/* Two stats, and only two. The prototype caps this row at 520px so it
          reads as a pair rather than as a dashboard. */}
      <div className="mb-5 grid max-w-[520px] grid-cols-2 gap-3.5">
        <StatCard
          label="Estudiantes asignados"
          value={assignedCount}
          hint={`de ${students.length} estudiantes`}
        />
        <StatCard
          label="Niveles"
          value={niveles.length}
          hint={cima ? `${nivelNombre(cima)} es la cima` : "El primero es la cima"}
        />
      </div>

      {/* The person finder. The screen's real questions are about a student,
          not about a level, and neither could be asked before. */}
      <SearchInput
        className="mb-5 max-w-sm"
        label="Buscar un estudiante en toda la escalera"
        placeholder="Buscar estudiante por nombre…"
        value={studentSearch}
        onChange={setStudentSearch}
      />

      {buscando ? (
        <section className="mb-5 overflow-hidden rounded-card border border-line bg-paper">
          <h2 className="border-b border-line px-5 py-3 text-[13px] font-bold text-ink">
            Resultados de la búsqueda ({resultados.length})
          </h2>
          {resultados.length === 0 ? (
            <EmptyState
              icon={<Users size={21} strokeWidth={1.5} aria-hidden="true" />}
              title="Ningún estudiante coincide"
              description="Revise el nombre o borre la búsqueda para ver toda la escalera."
            />
          ) : (
            <ul className="px-2 py-2">
              {resultados.map((student) => renderStudentRow(student, "busqueda"))}
            </ul>
          )}
        </section>
      ) : sinNivel.length > 0 ? (
        // The eight students the "59 de 67" stat used to name and hide. They
        // are the actionable population of this screen, so they sit above the
        // ladder with the control that places them.
        <section className="mb-5 overflow-hidden rounded-card border border-line bg-paper">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
            <UserPlus
              size={16}
              strokeWidth={1.5}
              className="flex-none text-ink-2"
              aria-hidden="true"
            />
            <h2 className="flex-1 text-[13px] font-bold text-ink">
              Sin nivel asignado ({sinNivel.length})
            </h2>
          </div>
          <p className="px-5 pt-3 text-[12.5px] text-ink-3">
            Elija el nivel donde entra cada estudiante y confirme la asignación.
          </p>
          <ul className="px-2 py-2">
            {sinNivel.map((student) => renderStudentRow(student, "sin-nivel"))}
          </ul>
        </section>
      ) : null}

      {assignError && openNivel === null ? (
        <p className="mb-4 text-[12.5px] text-state-bad" role="alert">
          {assignError}
        </p>
      ) : null}

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
            highlightIds={resaltados}
          />
        )}
      </div>
    </AppShell>
  );
}
