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
 * ## Solo lectura, por ahora
 *
 * Esta pantalla llevaba dos caminos hacia el asistente para tomar la lista:
 * "Pasar lista" en el encabezado y en el estado vacío, y un "Corregir" por
 * fila que abría la sesión con sus marcas ya cargadas (#95, con la ventana de
 * 30 días de #262 y su motivo dicho entero de #373). Los tres se fueron con el
 * asistente, que dejó de ofrecerse desde la interfaz mientras se rehace dentro
 * del área de miembros.
 *
 * La columna entera se fue, no solo su enlace: era la única acción que tenía y
 * solo la veía un administrador. Una celda vacía bajo un encabezado "ACCIONES"
 * es exactamente lo que esa columna ya se había prohibido en su momento. El
 * historial en sí no cambió — sigue leyendo los mismos registros, agrupando
 * por sesión y filtrando igual.
 *
 * `AttendanceRecord` sigue trayendo `horarioId` (el adaptador lo dejaba caer
 * hasta #95) y eso no se toca: la corrección va a volver a necesitarlo, y una
 * fila que solo dice "Lunes 15:00 — 16:30" no es reversible a un horario.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { ClipboardList } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { fetchAttendanceRecords, fetchTrainingSchedules } from "@/services/api";
import AttendanceFilters, { useAttendanceFilters } from "@/components/attendance/AttendanceFilters";
import {
  DataBox,
  EmptyState,
  ErrorState,
  LoadingState,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableNameCell,
  TableRow,
  BackLink,
} from "@/components/ui";
import {
  getTotalPages,
  paginateRecords,
  type AttendanceRecord,
  type TrainingSchedule,
} from "@/app/attendance/attendance-utils";
import { formatDate } from "@/lib/format-utils";
import { clubIsoDate } from "@/lib/club-date";
import { groupRecordsBySession, type SessionSummary } from "../../trainer-day-utils";
import {
  SessionCompositionBar,
  SessionCompositionCounts,
} from "../../SessionComposition";
import { summarizePeriodCoverage } from "./history-utils";

/** Sessions per page. */
const PAGE_SIZE = 10;

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

interface PeriodFigureProps {
  label: string;
  value: number;
  /** Aclaración bajo la cifra, cuando la cifra necesita una. */
  note?: string;
}

/**
 * Una de las tres cifras del período.
 *
 * La figura va en el `DataBox` numérico que el producto ya usa para todo valor
 * suelto, y el color —cuando lo haya— vive en el rótulo, nunca en el número:
 * es la regla que `StatCard` y `StatGrid` ya declaran. Acá los tres rótulos son
 * neutros a propósito; ninguna de las tres cifras carga un juicio.
 */
function PeriodFigure({ label, value, note }: PeriodFigureProps): React.ReactElement {
  return (
    <div className="flex max-w-[320px] flex-col items-start gap-1.5">
      <DataBox variant="numeric">{value}</DataBox>
      <span className="text-2xs font-bold uppercase tracking-flat text-ink-2">{label}</span>
      {note ? <p className="text-xs text-ink-3">{note}</p> : null}
    </div>
  );
}

export default function TrainerAttendanceHistoryPage(): React.ReactElement {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [schedules, setSchedules] = useState<TrainingSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

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

  return (
    <ProtectedRoute allowedRoles={["trainer", "admin"]}>
      {/*
       * Sin acción en el encabezado. Llevaba el mismo "Pasar lista" que
       * `/attendance` —su gemela de administración, leyendo los mismos
       * registros— desde #74, y apuntaba al asistente que ya no se ofrece.
       * `primary-action.test.ts` la nombra en su lista de excepciones con esta
       * misma razón: no es un slot que alguien olvidó, es una pantalla de
       * consulta que hoy no tiene verbo que promover.
       */}
      <AppShell title="Historial de asistencias">
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
          <div className="card flex flex-wrap items-start gap-x-10 gap-y-section px-4 py-3">
            {filters.student ? (
              <p className="max-w-[560px] text-xs text-ink-3">{AVISO_FILTRO_ALUMNO}</p>
            ) : (
              <>
                <PeriodFigure label="Listas tomadas" value={coverage.listasTomadas} />
                <PeriodFigure
                  label="Sesiones programadas"
                  value={coverage.sesionesProgramadas}
                />
                <PeriodFigure
                  label="Sin lista (estimado)"
                  value={coverage.sinLista}
                  note={AVISO_ESTIMACION}
                />
              </>
            )}
          </div>
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
                    : "Cambie el rango o los filtros para ver otras listas."
                }
              />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHead>
                      <tr>
                        {/*
                          Densidad: cada columna pide el ancho de lo que
                          realmente lleva. "Sesión" es una fecha y una etiqueta
                          de horario — mide siempre lo mismo, así que `w-px`
                          (el idioma de "encogé hasta el contenido" en una tabla
                          al 100%) le da eso y ni un píxel más. Lo que sobra se
                          lo lleva "Resultado", que es la única columna donde el
                          ancho es legibilidad y no aire: ahí vive la barra de
                          composición.
                        */}
                        <TableHeaderCell className="w-px">Sesión</TableHeaderCell>
                        <TableHeaderCell>Registró</TableHeaderCell>
                        <TableHeaderCell className="w-full">Resultado</TableHeaderCell>
                        {/*
                         * No hay columna de acciones. "Corregir" fue la única
                         * que esta tabla ofreció, y se fue con el asistente al
                         * que apuntaba. La regla que la gobernaba ya era la
                         * misma: una columna cuya acción no existe se omite
                         * entera —encabezado incluido— en vez de prometer algo
                         * bajo un "ACCIONES" que queda vacío en cada fila.
                         */}
                      </tr>
                    </TableHead>
                    <TableBody>
                      {visible.map((sessionRow: SessionSummary) => (
                        <TableRow key={`${sessionRow.fecha}|${sessionRow.horario}`}>
                          <TableNameCell
                            className="w-px whitespace-nowrap"
                            name={formatDate(sessionRow.fecha)}
                            sub={sessionRow.horario}
                          />
                          <TableCell>
                            {/*
                              Un nombre completo ecuatoriano son cuatro palabras
                              y se comía el ancho de la columna de al lado. Se
                              topa y se trunca — pero truncar no puede PERDER el
                              dato: el `title` conserva el nombre entero, que es
                              lo que el navegador muestra al pasar el mouse y lo
                              que un lector de pantalla anuncia junto al texto
                              recortado.

                              El `title` solo cuelga del nombre real. "No
                              registrado" es un marcador de posición: repetirlo
                              en un tooltip no agrega nada que la celda no diga.
                            */}
                            {sessionRow.registradoPorNombre ? (
                              <span
                                className="block max-w-[240px] truncate"
                                title={sessionRow.registradoPorNombre}
                              >
                                {sessionRow.registradoPorNombre}
                              </span>
                            ) : (
                              "No registrado"
                            )}
                          </TableCell>
                          <TableCell>
                            {/*
                              The composition, drawn the way the panel already
                              draws it on "Mi día" — see `SessionComposition`
                              for why there is only one drawing of it now. The
                              state name still rides along as real, visible
                              text: a bare "9" next to a colored dot would
                              force every reader to memorize what each color
                              meant.
                            */}
                            {/*
                              Sin techo: la barra mide una proporción, y una
                              proporción de cuatro estados dibujada en 220px
                              deja tramos de dos píxeles que no se distinguen
                              entre sí. El mínimo sube y el máximo se va, para
                              que la columna se quede con todo el ancho que las
                              otras dos no reclamaron.
                            */}
                            <div className="flex w-full min-w-[320px] flex-col gap-2">
                              <SessionCompositionBar
                                counts={sessionRow.counts}
                                total={sessionRow.total}
                              />
                              <SessionCompositionCounts
                                counts={sessionRow.counts}
                                total={sessionRow.total}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {totalPages > 1 && (
                  <Pagination
                    variant="footer"
                    page={page}
                    totalPages={totalPages}
                    onPageChange={setPage}
                    totalItems={sessions.length}
                    pageSize={PAGE_SIZE}
                    itemNoun="sesión"
                    itemNounPlural="sesiones"
                  />
                )}
              </>
            )}
          </div>
        )}

      </AppShell>
    </ProtectedRoute>
  );
}
