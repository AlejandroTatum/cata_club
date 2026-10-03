/**
 * The right rail of the attendance history: the period at a glance (listed vs
 * scheduled vs missing), how it splits by state, which scheduled sessions have
 * no list yet, and a standing guide to what each state means.
 *
 * Shared by the trainer's `/trainer/attendance/history` and the admin's
 * `/attendance` — one composition, one set of card styles. Role-specific
 * guidance (the admin's correction rules) comes in through `guideExtra`.
 */

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { buttonClasses, InfoPanel, StatCard } from "@/components/ui";
import SessionDonut from "@/app/trainer/attendance/SessionDonut";
import { SessionCompositionCounts } from "@/app/trainer/SessionComposition";
import { buildWizardQuery } from "@/app/trainer/attendance/attendance-utils";
import {
  AVISO_ESTIMACION,
  findMissingSessions,
  summarizePeriodCoverage,
} from "@/app/trainer/attendance/history/history-utils";
import {
  formatMissingSessionDate,
  type SessionSummary,
} from "@/app/trainer/trainer-day-utils";
import type { TrainingSchedule } from "@/app/attendance/attendance-utils";
import { clubIsoDate, clubTimeHHMM } from "@/lib/club-date";
import type { EstadoAsistencia } from "@/types/domain";

/** Sessions without a list shown in the rail before the rest are left to the period's stats. */
const MAX_MISSING_SHOWN = 5;

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

const STATE_GUIDE: ReadonlyArray<{ label: string; meaning: string }> = [
  { label: "Presente", meaning: "asistió a la sesión completa." },
  {
    label: "Tardanza",
    meaning: "llegó después de la hora de inicio; cuenta como asistencia.",
  },
  {
    label: "Justificado",
    meaning: "avisó con motivo y la ausencia fue aceptada.",
  },
  { label: "Enfermo", meaning: "ausencia autorizada por salud." },
  {
    label: "Competencia",
    meaning: "ausencia autorizada por representar al club.",
  },
  { label: "Ausente", meaning: "no asistió y no hubo aviso." },
];

const RAIL_HEADING =
  "font-display text-lg uppercase leading-tight tracking-flat text-ink";

export interface AttendancePeriodRailProps {
  sessions: readonly SessionSummary[];
  schedules: readonly TrainingSchedule[];
  fechaInicio: string;
  fechaFin: string;
  horarioId: number | null;
  /** A student filter is active: the schedule comparison no longer applies. */
  studentFiltered: boolean;
  /** Enrolled students per horario id. With it, a list holding fewer records than that is listed as incomplete. */
  inscritosPorHorario?: Record<number, number>;
  /** Extra paragraphs for the indications card (role-specific rules). */
  guideExtra?: ReactNode;
}

export default function AttendancePeriodRail({
  sessions,
  schedules,
  fechaInicio,
  fechaFin,
  horarioId,
  studentFiltered,
  inscritosPorHorario,
  guideExtra,
}: AttendancePeriodRailProps): React.ReactElement {
  const coverageInput = useMemo(
    () => ({
      sessions: sessions.map((s) => ({
        fecha: s.fecha,
        horarioId: s.horarioId,
        registrados: s.total,
      })),
      inscritosPorHorario,
      schedules: [...schedules],
      desde: fechaInicio,
      hasta: fechaFin,
      // El techo real: un rango personalizado puede terminar en el futuro, y
      // una sesión que todavía no ocurrió no es una lista que falte.
      hoy: clubIsoDate(),
      // Dentro de hoy, el mismo razonamiento corre por hora.
      horaActual: clubTimeHHMM(),
      horarioId,
    }),
    [sessions, schedules, fechaInicio, fechaFin, horarioId, inscritosPorHorario],
  );
  const coverage = useMemo(
    () => summarizePeriodCoverage(coverageInput),
    [coverageInput],
  );
  const missing = useMemo(
    () => findMissingSessions(coverageInput),
    [coverageInput],
  );

  const { counts, total } = useMemo(() => {
    const acc: Record<EstadoAsistencia, number> = {
      present: 0,
      absent: 0,
      late: 0,
      justified: 0,
      sick: 0,
      competition: 0,
    };
    let sum = 0;
    for (const session of sessions) {
      for (const state of Object.keys(acc) as EstadoAsistencia[])
        acc[state] += session.counts[state];
      sum += session.total;
    }
    return { counts: acc, total: sum };
  }, [sessions]);

  return (
    <aside
      className="flex flex-col gap-page lg:sticky lg:top-4"
      aria-label="Resumen del período"
    >
      {studentFiltered ? (
        <p className="card px-4 py-3 text-sm text-ink-2">
          {AVISO_FILTRO_ALUMNO}
        </p>
      ) : (
        <>
          <section
            aria-labelledby="period-summary-title"
            className="grid grid-cols-2 gap-field"
          >
            <h2 id="period-summary-title" className="sr-only">
              Resumen del período
            </h2>
            <StatCard
              label="Listas tomadas"
              value={coverage.listasTomadas}
              hint="registradas en el período"
            />
            <StatCard
              label="Sesiones programadas"
              value={coverage.sesionesProgramadas}
              hint="según el horario semanal"
            />
            <div className="col-span-2">
              <StatCard
                label="Sin lista (estimado)"
                value={coverage.sinLista}
                hint="diferencia estimada"
              />
            </div>
            <p className="col-span-2 px-1 text-xs text-ink-3-strong" role="note">
              {AVISO_ESTIMACION}
            </p>
          </section>

          {total > 0 && (
            <section
              className="card flex flex-col gap-3 p-4"
              aria-labelledby="distribution-title"
            >
              <h2 id="distribution-title" className={RAIL_HEADING}>
                Distribución del período
              </h2>
              <div className="flex items-center gap-4">
                <SessionDonut
                  counts={counts}
                  total={total}
                  className="flex-none"
                />
                <div className="min-w-0">
                  <SessionCompositionCounts
                    counts={counts}
                    total={total}
                    hideZero
                  />
                </div>
              </div>
            </section>
          )}

          <section
            className="card flex flex-col gap-2 p-4"
            aria-labelledby="missing-title"
          >
            <h2 id="missing-title" className={RAIL_HEADING}>
              Sin lista en el período
            </h2>
            {missing.length === 0 ? (
              <p className="text-sm text-ink-2">
                Todas las sesiones del período tienen lista.
              </p>
            ) : (
              <ul className="flex flex-col">
                {missing.slice(0, MAX_MISSING_SHOWN).map((m) => (
                  <li
                    key={`${m.fecha}|${m.schedule.id}`}
                    className="flex items-center justify-between gap-3 border-t border-line py-2 first:border-t-0"
                  >
                    <span className="min-w-0 text-sm text-ink">
                      <b className="font-bold tabular-nums">
                        {formatMissingSessionDate(m.fecha)}
                      </b>{" "}
                      <span className="text-xs tabular-nums text-ink-2">
                        {m.schedule.horaInicio} — {m.schedule.horaFin}
                      </span>
                      {m.registrados !== undefined && m.inscritos !== undefined && (
                        <span className="ml-2 text-xs font-semibold text-state-warn">
                          {m.registrados} de {m.inscritos} registrados
                        </span>
                      )}
                    </span>
                    <Link
                      href={`/trainer/attendance${buildWizardQuery(m.schedule.id, m.fecha, "mark-attendance")}`}
                      className={buttonClasses("secondary", "sm")}
                      aria-label={`${m.registrados !== undefined ? "Completar lista" : "Pasar lista"} del ${formatMissingSessionDate(m.fecha)} ${m.schedule.horaInicio}`}
                    >
                      {m.registrados !== undefined ? "Completar lista" : "Pasar lista"}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {missing.length > MAX_MISSING_SHOWN && (
              <p className="text-xs text-ink-3">
                y {missing.length - MAX_MISSING_SHOWN} más — acote el rango para
                verlas.
              </p>
            )}
          </section>
        </>
      )}

      <InfoPanel title="Cómo leer el historial" as="div">
        <p>
          Cada fila es una sesión con lista: la fecha, quién la pasó y cómo
          quedó el grupo. Las sesiones del horario sin lista se pasan desde «Sin
          lista en el período».
        </p>
        <ul className="flex flex-col gap-1.5">
          {STATE_GUIDE.map((state) => (
            <li key={state.label}>
              <span className="font-semibold text-ink">{`${state.label}: `}</span>
              {state.meaning}
            </li>
          ))}
        </ul>
        {guideExtra}
      </InfoPanel>
    </aside>
  );
}
