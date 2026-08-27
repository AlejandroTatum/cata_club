/**
 * The roster of one open categoría: who is enrolled, and assigning/unassigning.
 *
 * A student enrolled in a día-group belongs to ALL of its días, never just one,
 * so everything here works on the categoría's rows as a set and deduplicates by
 * `personaId`. That rule is the reason this is one concern rather than a list
 * plus two buttons, and it is why it was worth lifting out of the page: the
 * grid, the category form and the day-deletion flow around it share none of
 * this state.
 *
 * What stays in the page: `personasPorHorario`, the per-card "N inscriptos"
 * line. It is loaded with the grid, not with a panel, and it survives the panel
 * closing — different lifetime, different owner.
 */

"use client";

import { useCallback, useState } from "react";
import {
  asignarAlumnoAHorario,
  desasignarAlumnoDeHorario,
  fetchAlumnosPorHorario,
} from "@/services/api";
import type { AlumnoHorario } from "@/services/api";
import { useToast } from "@/contexts/ToastContext";
import { toUserMessage } from "@/lib/error-message";
import { formatMembresiaVencidaWarning, formatSolapeHorarioWarning } from "./groups-page-utils";
import type { HorarioGroupRow, StudentRef } from "@/lib/groups-utils";

interface UseGroupRosterArgs {
  /** Used only to name the student in the overdue-fee warning. */
  allStudents: StudentRef[];
  /** The page's in-panel banner — distinct from the global toast, which is also raised. */
  showNotification: (type: "success" | "error", message: string) => void;
}

export interface GroupRoster {
  /** Deduplicated union of the roster across every row of the open group. */
  alumnos: AlumnoHorario[];
  loading: boolean;
  assigning: boolean;
  selectedId: number | null;
  setSelectedId: (id: number | null) => void;
  /** 1-indexed page of the "Ver alumnos" list. */
  page: number;
  setPage: (page: number) => void;
  /** Clear everything the open panel held — the panel is closing. */
  reset: () => void;
  load: (rows: readonly HorarioGroupRow[]) => Promise<void>;
  assign: (rows: readonly HorarioGroupRow[]) => Promise<void>;
  unassign: (rows: readonly HorarioGroupRow[], personaId: number) => Promise<void>;
}

export function useGroupRoster({ allStudents, showNotification }: UseGroupRosterArgs): GroupRoster {
  const { showSuccess, showError, showWarning } = useToast();
  const [alumnos, setAlumnos] = useState<AlumnoHorario[]>([]);
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [page, setPage] = useState(1);

  const reset = useCallback((): void => {
    setAlumnos([]);
    setSelectedId(null);
    setPage(1);
  }, []);

  /**
   * Loads the roster for a whole categoría: fetches every underlying row's
   * assignees and deduplicates by `personaId` (a student assigned — even
   * inconsistently, to only some días — must appear exactly once).
   */
  const load = useCallback(
    async (rows: readonly HorarioGroupRow[]): Promise<void> => {
      setLoading(true);
      try {
        const listasPorDia = await Promise.all(rows.map((row) => fetchAlumnosPorHorario(row.id)));
        const porPersona = new Map<number, AlumnoHorario>();
        for (const lista of listasPorDia) {
          for (const alumno of lista) {
            if (!porPersona.has(alumno.personaId)) porPersona.set(alumno.personaId, alumno);
          }
        }
        setAlumnos(Array.from(porPersona.values()));
      } catch {
        showNotification("error", "Error al cargar los alumnos del horario.");
      } finally {
        setLoading(false);
      }
    },
    [showNotification],
  );

  /**
   * Assigns the selected student to the categoría the card represents. The
   * backend enrolls the student into EVERY horario row of that categoría in one
   * atomic transaction — the club enrolls by full month, never by a loose
   * weekday — so this only needs to anchor the request on any one row.
   */
  const assign = useCallback(
    async (rows: readonly HorarioGroupRow[]): Promise<void> => {
      if (!selectedId || rows.length === 0) return;
      setAssigning(true);
      try {
        const respuesta = await asignarAlumnoAHorario({ persona_id: selectedId, horario_id: rows[0].id });
        const message = "Alumno asignado correctamente al horario.";
        showNotification("success", message);
        showSuccess(message);
        // Dos avisos NO BLOQUEANTES, sobre una asignación que ya ocurrió
        // arriba: la cuota vencida (INS-6, decisión de negocio #4) y el cruce
        // de horarios (#731, decisión del dueño 2026-08-27 — "avisar nada
        // más"). Ninguno reemplaza al toast de éxito; van al lado.
        const alumno = allStudents.find((s) => Number(s.id) === selectedId);
        const nombreCompleto = alumno ? `${alumno.nombres} ${alumno.apellidos}` : "El alumno";
        if (respuesta.membresiaVencida) {
          showWarning(formatMembresiaVencidaWarning(nombreCompleto, respuesta.diasVencida));
        }
        // `?? []` y no `!`: una respuesta vieja en caché (o un mock de test
        // que no lo declare) simplemente no avisa, en vez de romper el alta
        // que ya se completó del lado del servidor.
        const solape = formatSolapeHorarioWarning(nombreCompleto, respuesta.solapamientos ?? []);
        if (solape) showWarning(solape);
        setSelectedId(null);
      } catch (err) {
        const message = toUserMessage(err, "Error al asignar el alumno al horario.");
        showNotification("error", message);
        showError(message);
      }
      // Refreshed on both paths, mirroring `unassign`: an assign call can fail
      // on the client side (network) after already landing on the server, so
      // the roster must resync either way instead of only reflecting the last
      // KNOWN-good state.
      await load(rows);
      setAssigning(false);
    },
    [allStudents, load, selectedId, showError, showNotification, showSuccess, showWarning],
  );

  /**
   * Mirror of `assign`: the backend unassigns the student from every horario
   * row of the categoría in one atomic transaction, so one call anchored on any
   * row of the group is enough.
   */
  const unassign = useCallback(
    async (rows: readonly HorarioGroupRow[], personaId: number): Promise<void> => {
      if (rows.length === 0) return;
      try {
        await desasignarAlumnoDeHorario(personaId, rows[0].id);
        showNotification("success", "Alumno desasignado del horario.");
        showSuccess("Alumno desasignado del horario.");
      } catch (err) {
        const message = toUserMessage(err, "Error al desasignar el alumno del horario.");
        showNotification("error", message);
        showError(message);
      }
      await load(rows);
    },
    [load, showError, showNotification, showSuccess],
  );

  return {
    alumnos,
    loading,
    assigning,
    selectedId,
    setSelectedId,
    page,
    setPage,
    reset,
    load,
    assign,
    unassign,
  };
}
