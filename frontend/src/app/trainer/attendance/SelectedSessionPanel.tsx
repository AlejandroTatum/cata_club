import { CalendarClock, Users } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { formatDay } from "@/app/attendance/attendance-utils";
import type { TrainingSchedule } from "@/app/attendance/attendance-utils";
import type { DiaSemana } from "@/types/domain";
import type { SchedulePreview } from "./useSchedulePreview";

const PREVIEW_NAMES = 8;

interface SelectedSessionPanelProps {
  schedule: TrainingSchedule | null;
  today: DiaSemana;
  recordedCount: number;
  /** Every roster student has a record (ENT-03); otherwise a partial list reads as incomplete. */
  listClosed: boolean;
  preview: SchedulePreview;
  /** The stacked commit bar ("Continuar"), hosted under the details. */
  commitBar: React.ReactNode;
}

/**
 * Step 1's aside: what the trainer is about to open. With nothing chosen it
 * draws the same card as ghost rows — the shape of the answer, not a void —
 * so picking a tile fills a box that was already there.
 */
export default function SelectedSessionPanel({
  schedule,
  today,
  recordedCount,
  listClosed,
  preview,
  commitBar,
}: SelectedSessionPanelProps): React.ReactElement {
  const shown = preview.names.slice(0, PREVIEW_NAMES);
  const rest = preview.names.length - shown.length;

  return (
    <aside className="flex flex-col gap-page" aria-label="Horario elegido">
      <div className="card flex flex-col gap-4 p-5" data-testid="selected-session-panel">
        <h2 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">Horario elegido</h2>

        {schedule ? (
          <>
            <div className="flex flex-col gap-0.5">
              <p className="text-lg font-bold leading-tight text-ink">
                {formatDay(schedule.diaSemana)} {schedule.horaInicio} — {schedule.horaFin}
              </p>
              {schedule.categoriaLabel && <p className="text-sm text-ink-2">{schedule.categoriaLabel}</p>}
              <p className="text-xs text-ink-3">
                {recordedCount > 0
                  ? `${listClosed ? `Lista tomada${schedule.diaSemana === today ? " hoy" : ""}` : "Lista incompleta"} · ${recordedCount} ${recordedCount === 1 ? "registro" : "registros"}`
                  : schedule.diaSemana === today
                    ? "Sin lista tomada hoy"
                    : "Sin lista tomada esta semana"}
              </p>
            </div>

            <div className="flex flex-col gap-2 border-t border-line pt-4">
              <p className="flex items-center gap-2 text-xs font-bold uppercase text-ink-3">
                <Users size={ICON.sm} strokeWidth={2} aria-hidden="true" />
                {preview.loading
                  ? "Jugadores…"
                  : `${preview.names.length} ${preview.names.length === 1 ? "jugador" : "jugadores"} en la lista`}
              </p>
              {preview.loading ? (
                <GhostLines count={4} animate />
              ) : preview.names.length === 0 ? (
                <p className="text-xs text-ink-3">Este horario todavía no tiene jugadores asignados.</p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {shown.map((name) => (
                    <li
                      key={name}
                      className="rounded-full border border-line bg-canvas px-2.5 py-1 text-xs font-semibold text-ink-2"
                    >
                      {name}
                    </li>
                  ))}
                  {rest > 0 && (
                    <li className="rounded-full px-1.5 py-1 text-xs font-semibold text-ink-3">+{rest} más</li>
                  )}
                </ul>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-4" data-testid="selected-session-ghost">
            <div className="flex items-start gap-3 text-ink-3">
              <CalendarClock size={ICON.lg} strokeWidth={1.5} aria-hidden="true" className="flex-none" />
              <p className="text-sm">Elige un horario para ver a sus jugadores y cómo quedó su última lista.</p>
            </div>
            <dl
              aria-hidden="true"
              className="flex flex-col divide-y divide-dashed divide-line border-t border-dashed border-line text-xs"
            >
              {["Categoría", "Jugadores en la lista", "Última lista"].map((label) => (
                <div key={label} className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="font-bold uppercase text-ink-3">{label}</dt>
                  <dd className="text-ink-3">—</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        <div className="border-t border-line pt-4 max-lg:border-0 max-lg:pt-0">{commitBar}</div>
      </div>
    </aside>
  );
}

/** Ghost chips: the shape of a roster before there is one. */
function GhostLines({ count, animate = false }: { count: number; animate?: boolean }): React.ReactElement {
  return (
    <div aria-hidden="true" className="flex flex-wrap gap-1.5">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={`h-6 rounded-full bg-line ${animate ? "animate-pulse" : "opacity-60"}`}
          style={{ width: `${64 + ((i * 23) % 40)}px` }}
        />
      ))}
    </div>
  );
}
