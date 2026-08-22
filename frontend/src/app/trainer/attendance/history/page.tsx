/**
 * Trainer — "Historial de asistencias"
 * (`docs/archive/prototypes/prototipos/21-entrenador-historial.html`).
 *
 * This route used to be a `redirect("/trainer")`: the history had been merged
 * into the trainer dashboard, which is what left that screen with two
 * quick-action cards, three stat cards, a four-control filter panel and a
 * paginated table competing for one scroll. The history is a separate errand
 * — it comes back to its own view, and "Mi día" keeps a single focus.
 *
 * ## Grouped by SESSION, not by student
 *
 * The prototype's reasoning, verbatim: *"el entrenador no busca «qué hizo Ana
 * el 14»; busca «la lista del lunes pasado»"*. So each row is one session,
 * with the four state counts in the row itself. A "Registró" column shows
 * who TOOK the list (issue #263, persisted `registrado_por_id`/nombre). Who
 * TAUGHT the session still isn't recorded (issue #13) — a separate fact.
 *
 * ## Filters
 *
 * Range, horario and alumno, rendered from the shared
 * `<AttendanceFilters>` panel (src/components/attendance/AttendanceFilters.tsx).
 * The three date presets this screen shipped with were not enough: the same
 * controls existed only on the admin's `/attendance`, which redirects a trainer
 * away, so "how did the Friday 17:00 group do?" and "what has Ana been doing
 * this term?" had no answer anywhere in the trainer's product. Grouping stays
 * by session; the filters just narrow what gets grouped.
 *
 * ## "Corregir" deep-links into the session (#95)
 *
 * Each row addresses its own roll call:
 * `/trainer/attendance?horario=<id>&fecha=<YYYY-MM-DD>&paso=lista`. Both
 * halves are load-bearing — the horario says which group, the fecha says
 * which day, and the same horario on two days is two different sessions. The
 * wizard opens on that roster with its filed marks already showing, and files
 * the correction back on that same date.
 *
 * This used to be documented here as a gap needing a backend field. It did
 * not: `AsistenciaResponseDTO` had always sent `horarioId` and the adapter
 * was dropping it. `AttendanceRecord` carries it now, so the row has an id
 * and not only the "Lunes 15:00 — 16:30" label, which is not reversible into
 * a horario.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { ArrowRight, ClipboardList } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { fetchAttendanceRecords, fetchTrainingSchedules } from "@/services/api";
import AttendanceFilters, { useAttendanceFilters } from "@/components/attendance/AttendanceFilters";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Pagination,
  ResponsiveListTable,
  STAT_GRID,
  StatCard,
  TableCell,
  TableHeaderCell,
  TableNameCell,
  TableRow,
  BackLink,
  buttonClasses,
} from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import {
  getTotalPages,
  paginateRecords,
  type AttendanceRecord,
  type TrainingSchedule,
} from "@/app/attendance/attendance-utils";
import { formatDate } from "@/lib/format-utils";
import { calendarIsoDate, clubIsoDate, clubToday } from "@/lib/club-date";
import { groupRecordsBySession, type SessionSummary } from "../../trainer-day-utils";
import {
  SessionCompositionBar,
  SessionCompositionCounts,
} from "../../SessionComposition";
import { buildWizardQuery } from "../attendance-utils";
import { summarizePeriodCoverage } from "./history-utils";

/** Sessions per page. */
const PAGE_SIZE = 10;

/** Corregir solo admite sesiones con hasta 30 días de antigüedad — mismo
 *  tope que el backend impone en `PATCH /asistencias/{id}/corregir`
 *  (`LIMITE_CORRECCION_ASISTENCIA_DIAS`, issue #389). */
const LIMITE_CORRECCION_DIAS = 30;

/**
 * Where "Corregir" goes: that session's roll call, already open.
 *
 * Built through `buildWizardQuery` rather than by hand so the wizard stays
 * the single owner of its own address — the parameter names and the step
 * vocabulary ("lista") live in one module, and this screen cannot drift out
 * of sync with the page it links into.
 *
 * The roster it lands on is read-only for everyone now (issue #389, slice 3)
 * — what actually corrects a row is that slice's per-student "Corregir"
 * button on that same roster (slice 4b), not this link by itself. This link
 * is only the entry point: it still has to land on the right session before
 * an admin can reach that button.
 */
function buildCorrectionHref(session: SessionSummary): string {
  return `/trainer/attendance${buildWizardQuery(session.horarioId, session.fecha, "mark-attendance")}`;
}

/**
 * El motivo del bloqueo, dicho entero (issue #373).
 *
 * Antes, pasados los 30 días, la celda quedaba vacía: el vencimiento se veía
 * exactamente igual que un error de carga, y el administrador no podía
 * distinguir "esta sesión ya no se corrige" de "algo se rompió". La regla no
 * cambió — sigue siendo la ventana de `LIMITE_CORRECCION_DIAS`, la misma que
 * el backend re-verifica en `PATCH /asistencias/{id}/corregir` (issue #389)
 * — lo que cambió es que ahora se nombra en vez de borrarse, el mismo
 * criterio que #312: un control bloqueado dice por qué.
 */
const MOTIVO_CORRECCION_VENCIDA =
  "La ventana de corrección de 30 días ya cerró para esta sesión.";

/**
 * El ancla entre el control muerto y su motivo, una por fila.
 *
 * `aria-describedby` apunta a un id, así que dos filas vencidas en la misma
 * página no pueden compartirlo o el lector de pantalla leería el motivo de
 * otra sesión. La fecha y el horario son justamente lo que hace única a una
 * sesión — la misma pareja con la que se arma la `key` de la fila.
 */
function buildReasonId(session: SessionSummary): string {
  return `correccion-vencida-${session.fecha}-${session.horarioId}`;
}

/**
 * La advertencia que convierte una cifra en una estimación.
 *
 * "Sin lista" no sale del backend: se deriva expandiendo el horario semanal
 * sobre el rango del filtro (ver `history-utils.ts` para las tres formas en que
 * eso miente hacia arriba, y para por qué el modelo no puede hacerlo exacto).
 *
 * Va escrita, entera y al lado de la cifra, en vez de un asterisco: un
 * asterisco solo avisa a quien ya sospecha. Y por el mismo motivo la cifra no
 * se pinta de rojo — el rojo afirma un problema confirmado, y acá lo confirmado
 * es únicamente que el horario semanal dice una cosa y las listas dicen otra.
 */
const AVISO_ESTIMACION =
  "Estimación: se compara contra el horario semanal, que no contempla feriados, " +
  "cancelaciones ni desde cuándo rige cada horario.";

/**
 * Por qué el cruce desaparece al elegir un alumno.
 *
 * Con un alumno filtrado, "listas tomadas" pasa a significar "listas donde
 * figura esa persona", mientras que el horario semanal sigue siendo el del club
 * entero. Restar uno del otro daría un hueco enorme y falso, así que la resta no
 * se hace — y se dice, porque un bloque que se esfuma sin explicación se lee
 * como un error de carga (el mismo criterio de #373 una pantalla más allá).
 */
const AVISO_FILTRO_ALUMNO =
  "El período no se compara contra el horario semanal al filtrar por alumno: las listas " +
  "donde figura una persona y las sesiones programadas del club no son la misma medida.";

export default function TrainerAttendanceHistoryPage(): React.ReactElement {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [schedules, setSchedules] = useState<TrainingSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const { session } = useAuth();
  const esAdmin = session?.user.role === "admin";
  // "Hoy - 30 días" resuelto en la zona del club, en YYYY-MM-DD para compararlo
  // lexicográficamente contra `sessionRow.fecha` (también YYYY-MM-DD).
  const corteCorreccion = useMemo(() => {
    const hoy = clubToday();
    const corte = new Date(hoy);
    corte.setDate(corte.getDate() - LIMITE_CORRECCION_DIAS);
    return calendarIsoDate(corte);
  }, []);

  const filters = useAttendanceFilters("this_month");
  const { query } = filters;

  const loadHistory = useCallback(async (): Promise<void> => {
    // A half-filled custom range shows no sessions rather than silently
    // falling back to "everything" — see `buildAttendanceQuery`.
    if (query === null) {
      setRecords([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      setRecords(await fetchAttendanceRecords(query));
    } catch (err) {
      console.error("[trainer/attendance/history] loadHistory failed", err);
      setError("No se pudieron cargar los registros de asistencia.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // The horario select needs the schedule list; a failure there only costs the
  // trainer that one filter, so it never blocks or errors the history itself.
  useEffect(() => {
    fetchTrainingSchedules()
      .then(setSchedules)
      .catch((err: unknown) => {
        console.error("[trainer/attendance/history] fetchTrainingSchedules failed", err);
      });
  }, []);

  const sessions = useMemo(() => groupRecordsBySession(records), [records]);

  // Back to page 1 whenever the result set changes — page 3 of a shorter list
  // is an empty screen with no explanation.
  useEffect(() => {
    setPage(1);
  }, [sessions.length]);

  const totalPages = getTotalPages(sessions.length, PAGE_SIZE);
  const visible = useMemo(() => paginateRecords(sessions, page, PAGE_SIZE), [sessions, page]);

  // El cruce del período. Se recalcula con el rango porque el rango ES la
  // pregunta: "de lo que tocaba en estas fechas, ¿cuánto quedó registrado?".
  const coverage = useMemo(
    () =>
      summarizePeriodCoverage({
        sessions,
        schedules,
        desde: query?.fechaInicio ?? "",
        hasta: query?.fechaFin ?? "",
        // El techo real: un rango personalizado puede terminar en el futuro, y
        // una sesión que todavía no ocurrió no es una lista que falte.
        hoy: clubIsoDate(),
        horarioId: query?.horarioId ?? null,
      }),
    [sessions, schedules, query],
  );

  const renderCorrectionAction = (sessionRow: SessionSummary): React.ReactNode => {
    if (!esAdmin) return null;
    if (sessionRow.fecha >= corteCorreccion) return <Link href={buildCorrectionHref(sessionRow)} className={buttonClasses("secondary", "sm")}>Corregir</Link>;
    return <div className="flex flex-col items-end gap-1.5"><Button variant="secondary" size="sm" disabled aria-describedby={buildReasonId(sessionRow)}>Corregir</Button><p id={buildReasonId(sessionRow)} className="max-w-[240px] text-balance text-xs text-ink-3">{MOTIVO_CORRECCION_VENCIDA}</p></div>;
  };
  const renderComposition = (sessionRow: SessionSummary): React.ReactElement => (
    <div className="flex w-full min-w-0 flex-col gap-2 sm:min-w-[320px]"><SessionCompositionBar counts={sessionRow.counts} total={sessionRow.total} /><SessionCompositionCounts counts={sessionRow.counts} total={sessionRow.total} /></div>
  );

  return (
    <ProtectedRoute allowedRoles={["trainer", "admin"]}>
      <AppShell
        title="Historial de asistencias"
        /*
         * The same link, with the same label and the same arrow, that `/attendance`
         * — this screen's admin twin, reading the same records — has carried in its
         * header since #74. Until now this one offered no way to pass a list at all
         * unless the table came back empty, so the action existed only in the state
         * where there was nothing to correct.
         */
        actions={
          <Link href="/trainer/attendance" className={buttonClasses("primary")}>
            Pasar lista
            <ArrowRight size={ICON.sm} strokeWidth={2} aria-hidden="true" />
          </Link>
        }
      >
        <BackLink href="/trainer" className="mb-6" />

        <AttendanceFilters filters={filters} schedules={schedules} layout="row" />

        {/*
          Las tres cifras del período, arriba de la tabla.
          Con 54 sesiones repartidas en páginas, "cuántas listas se tomaron" era
          una pregunta que solo se contestaba sumando a mano; y la que de verdad
          importa —cuántas sesiones quedaron SIN lista— no se contestaba de
          ninguna manera, porque una lista que nadie pasó no deja fila.

          Se dibujan también cuando el período no tiene ni una lista: ese es
          justamente el momento en que el hueco es toda la información que hay.
        */}
        {!loading && !error && query !== null && (
          filters.student ? (
            <p className="card px-4 py-3 text-sm text-ink-2">{AVISO_FILTRO_ALUMNO}</p>
          ) : (
            <section aria-labelledby="period-summary-title" className="space-y-field">
              <h2 id="period-summary-title" className="sr-only">Resumen del período</h2>
              <div className={STAT_GRID}>
                <StatCard label="Listas tomadas" value={coverage.listasTomadas} hint="registradas en el período" />
                <StatCard label="Sesiones programadas" value={coverage.sesionesProgramadas} hint="según el horario semanal" />
                <StatCard label="Sin lista (estimado)" value={coverage.sinLista} hint="diferencia estimada" />
              </div>
              <p className="card px-4 py-3 text-sm text-ink-2" role="note">{AVISO_ESTIMACION}</p>
            </section>
          )
        )}
        {loading && <LoadingState label="Cargando historial…" />}

        {error && !loading && <ErrorState message={error} onRetry={() => loadHistory()} />}

        {!loading && !error && (
          <div className="card overflow-hidden">
            {sessions.length === 0 ? (
              <EmptyState surface="inset"
                icon={<ClipboardList size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
                title="No hay listas en este período"
                description={
                  query === null
                    // Covers both unusable states — one end missing, or the
                    // two ends inverted — because "complete las dos fechas"
                    // is wrong advice when both are already filled in.
                    ? "Ajuste el rango de fechas para ver las listas."
                    : "Cambie el rango o los filtros, o pase lista para que aparezca aquí."
                }
                action={
                  <Link href="/trainer/attendance" className={buttonClasses("primary")}>
                    Pasar lista
                  </Link>
                }
              />
            ) : (
                <ResponsiveListTable
                  items={visible}
                  getKey={(sessionRow) => `${sessionRow.fecha}|${sessionRow.horario}`}
                  mobileListTestId="history-mobile-list"
                  desktopTableTestId="history-desktop-table"
                  tableHead={<tr><TableHeaderCell className="w-px">Sesión</TableHeaderCell><TableHeaderCell>Registró</TableHeaderCell><TableHeaderCell className="w-full">Resultado</TableHeaderCell>{esAdmin && <TableHeaderCell align="right"><span className="sr-only">Acciones</span></TableHeaderCell>}</tr>}
                  renderCard={(sessionRow) => (
                    <li className="space-y-section px-4 py-4" data-testid={`history-mobile-card-${sessionRow.fecha}-${sessionRow.horarioId}`}>
                      <div><p className="font-semibold text-ink">{formatDate(sessionRow.fecha)}</p><p className="text-xs text-ink-3">{sessionRow.horario}</p></div>
                      <p className="text-sm text-ink-2"><span className="font-semibold text-ink">Registró: </span>{sessionRow.registradoPorNombre ?? "No registrado"}</p>
                      {renderComposition(sessionRow)}
                      {esAdmin && <div className="flex justify-end">{renderCorrectionAction(sessionRow)}</div>}
                    </li>
                  )}
                  renderRow={(sessionRow) => (
                    <TableRow>
                      <TableNameCell className="w-px whitespace-nowrap" name={formatDate(sessionRow.fecha)} sub={sessionRow.horario} />
                      <TableCell>{sessionRow.registradoPorNombre ? <span className="block max-w-[240px] truncate" title={sessionRow.registradoPorNombre}>{sessionRow.registradoPorNombre}</span> : "No registrado"}</TableCell>
                      <TableCell>{renderComposition(sessionRow)}</TableCell>
                      {esAdmin && <TableCell align="right">{renderCorrectionAction(sessionRow)}</TableCell>}
                    </TableRow>
                  )}
                  footer={totalPages > 1 ? <Pagination variant="footer" page={page} totalPages={totalPages} onPageChange={setPage} totalItems={sessions.length} pageSize={PAGE_SIZE} itemNoun="sesión" itemNounPlural="sesiones" /> : undefined}
                />
            )}
          </div>
        )}

      </AppShell>
    </ProtectedRoute>
  );
}
