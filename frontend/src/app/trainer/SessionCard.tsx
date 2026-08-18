/**
 * The immediate-session card — the coal half of the trainer dashboard's top
 * row (issue #211, `docs/archive/prototypes/prototipos/31-entrenador-dashboard-alternativas.html`).
 *
 * The big number is the session's own identifier — its start hour — in every
 * state that has a session at all, and the elapsed or remaining time is said
 * in words on the support line.
 *
 * It used to swap: the countdown owned the figure until the session started,
 * and the hour took over afterwards. Two things were wrong with that. A
 * minute count is only a readable quantity for about an hour, and this panel
 * is opened at any hour — at 03:20 on a Friday whose first session is at
 * 15:00 the 46px figure read "700 minutos", which is a number nobody
 * converts. And the same slot meaning two different things is what
 * DESIGN.md's "un solo formato por columna" exists to stop: the eye has to
 * read the kicker before it can know what the figure is. The hour decides
 * which session; the wait only qualifies it, so the wait is a line of text
 * (`formatTimeUntilStart`, which changes unit at the hour).
 *
 * The primary action moved here from the page header (`page.tsx`) — once,
 * never twice — and names the session by its hour ("Pasar lista de las
 * 15:00"), never "esta sesión": the label has to survive being read without
 * the card around it.
 *
 * `state === null` renders nothing. Combined with `page.tsx` never mounting
 * this component during loading/error, and `buildSessionCardState` never
 * producing a schedule for "done", none of the three no-session states can
 * leave a `horario=` link in the tree — see `SessionCard.test.tsx`.
 *
 * ## El resto del día: un riel, no una pila de filas
 *
 * La banda cerraba con un `<ol>` de una fila de ~40px por sesión pendiente. El
 * reclamo del dueño sobre eso fue de tamaño — "me ponen un rectángulo negro
 * gigante", con la banda en ~337px — y una lista de filas es justo la forma
 * que contesta una queja de alto CRECIENDO: tres sesiones costaban ~100px de
 * banda y seis costaban el doble.
 *
 * Así que el día se dibuja a lo ANCHO, que es donde la banda tiene lugar de
 * sobra. Un riel horizontal con TODAS las sesiones de hoy —no solo las que
 * faltan— cada una ubicada y dimensionada por sus horas reales
 * (`buildDayRail`), un marcador en el minuto actual, el bloque en curso
 * sólido, los terminados apagados y los que vienen a media luz. La banda queda
 * en ~210px y, sobre todo, deja de crecer con la agenda: seis sesiones miden
 * lo mismo que dos.
 *
 * Esto NO deshace la decisión de `page.tsx`: la banda sigue siendo una sola
 * tarjeta `rounded-card bg-coal` a todo el ancho, con su cifra
 * `font-display text-display` y su CTA propio, que es el vocabulario que
 * comparte con `/dashboard`. Cambia lo que la banda dibuja adentro, no lo que
 * la banda es.
 *
 * ## El equivalente accesible
 *
 * El riel es un dibujo: los bloques no llevan texto, así que por sí solos no
 * le dicen nada a un lector de pantalla. El `<ol role="list">` que había era
 * deliberado (Safari/VoiceOver pierde el rol implícito apenas `list-none` saca
 * las viñetas) y resignarlo sería un retroceso, así que el riel ES esa lista:
 * la pista es el `<ol>`, cada bloque es un `<li>` de verdad, y el día se
 * recorre ítem por ítem sin región de scroll propia ni roving tabindex.
 *
 * Lo que dice cada bloque va en su `aria-label`, que es la misma jugada que ya
 * hace `buildSessionBarAriaLabel` con la barra proporcional de esta pantalla:
 * a un gráfico sin texto propio se lo nombra. La alternativa —una segunda
 * lista oculta— dejaría cada cifra dos veces en el árbol y haría que la línea
 * de soporte de la banda se leyera de nuevo.
 *
 * ## Lo que un bloque puede decir
 *
 * Un `TrainingSchedule` son cuatro campos: `id`, `diaSemana`, `horaInicio`,
 * `horaFin`. No hay nombre de sesión, ni categoría, ni nivel, ni estado por
 * sesión en ningún lado, así que un bloque lleva una hora y nada más. Toda
 * etiqueta que se le agregue sería inventada.
 */

import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { buttonClasses } from "@/components/ui";
import { formatDay } from "@/app/attendance/attendance-utils";
import {
  formatElapsedMinutes,
  formatEnrolledCount,
  formatTimeUntilStart,
  type DayRail,
  type DayRailBlock,
  type DayRailPhase,
  type SessionCardState,
} from "./trainer-day-utils";

interface SessionCardProps {
  state: SessionCardState;
  /**
   * El día entero, ya posicionado (`buildDayRail`). `null` cuando no hay nada
   * dibujable: la banda se queda sin riel, no sin banda.
   */
  rail: DayRail | null;
  /** Enrolled-count-by-horario-id — covers the hero session AND every block of the rail. */
  enrolledCounts: Record<number, number>;
}

/**
 * Alto de una fila del riel y separación entre filas, en px.
 *
 * Van acá y no en una clase de Tailwind porque el alto de la pista es
 * `filas × alto + huecos`, o sea aritmética sobre datos: se calcula en JS y se
 * escribe como estilo en línea, igual que el `left`/`width` de cada bloque. Un
 * valor arbitrario entre corchetes sería la otra forma de escribir lo mismo, y
 * esa es exactamente la que `arbitrary-style-values.test.ts` cierra.
 */
const RAIL_ROW_HEIGHT = 22;
const RAIL_ROW_GAP = 4;

/**
 * Cómo se ve y cómo se dice cada fase — juntas a propósito: son la misma
 * decisión contada dos veces, y separarlas es cómo el color termina diciendo
 * una cosa y la palabra otra. El bloque en curso va sólido en el rojo que ya
 * usa el punto de "En curso"; lo terminado se apaga; lo que viene queda a
 * media luz.
 */
const RAIL_PHASE: Record<DayRailPhase, { className: string; palabra: string }> = {
  past: { className: "bg-white/15", palabra: "terminada" },
  live: { className: "bg-cata-red", palabra: "en curso" },
  upcoming: { className: "bg-white/40", palabra: "por venir" },
};

/**
 * El nombre accesible de un bloque: hora, fase y cuántos hay inscritos.
 *
 * Dice "a" donde la línea visible dice "—": un guión largo se lee como una
 * pausa o directamente no se lee, y un rango hablado necesita una palabra. La
 * cifra se omite entera mientras el roster no se conozca — `formatEnrolledCount`
 * ya distingue el 0 real del dato que falta.
 */
function railBlockLabel(block: DayRailBlock, enrolled: number | null): string {
  const { horaInicio, horaFin } = block.schedule;
  const partes = [`${horaInicio} a ${horaFin}`, RAIL_PHASE[block.phase].palabra];
  const inscritos = formatEnrolledCount(enrolled);
  if (inscritos) partes.push(inscritos);
  return partes.join(", ");
}

export default function SessionCard({
  state,
  rail,
  enrolledCounts,
}: SessionCardProps): React.ReactElement | null {
  if (state === null) return null;

  if (state.kind === "done") {
    return (
      <section
        className="flex flex-col gap-3 rounded-card bg-coal px-7 py-6 text-white"
        aria-label="Su día de hoy"
      >
        <p className="m-0 flex items-center gap-2 text-sm text-white/60">
          <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-ball" />
          Hoy
        </p>
        <p className="m-0 text-lg font-bold leading-snug">Ya no quedan sesiones hoy.</p>
        <div className="mt-auto flex flex-wrap gap-2.5 pt-3">
          <Link href="/trainer/attendance" className={buttonClasses("onCoal")}>
            Elegir otro horario
          </Link>
        </div>
      </section>
    );
  }

  const isLive = state.kind === "live";
  const enrolledLabel = formatEnrolledCount(enrolledCounts[state.schedule.id] ?? null);
  const railHeight = rail
    ? rail.lanes * RAIL_ROW_HEIGHT + (rail.lanes - 1) * RAIL_ROW_GAP
    : 0;

  return (
    <section
      className="flex flex-col gap-3 rounded-card bg-coal px-7 py-6 text-white"
      aria-label="Su día de hoy"
    >
      {/* El kicker y la escala del riel comparten fila: la escala no merece un
          renglón propio en una banda que se está achicando, y al ras del borde
          derecho queda encima de la punta que nombra. Con una sola sesión el
          riel no tiene escala que dar — el rango ya está en la línea de
          soporte, y repetirlo sería decir dos veces lo mismo. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3.5 gap-y-1">
        <p className="m-0 flex items-center gap-2 text-sm text-white/60">
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 flex-none rounded-full ${isLive ? "bg-cata-red" : "bg-ball"}`}
          />
          {isLive ? "En curso" : "Próxima sesión"}
        </p>
        {rail && rail.blocks.length > 1 && (
          <p className="m-0 text-xs text-white/50 tabular-nums">
            Su día: {rail.startHora} — {rail.endHora}
          </p>
        )}
      </div>

      {/* La cifra ancla la izquierda y el riel se lleva el ancho que queda, que
          es el punto entero del rediseño. En una sola fila, además, la banda se
          ahorra el renglón que antes separaba a las dos. */}
      <div className="flex items-center gap-x-5">
        {/* Graduate, like every other figure the system prints at a display step
            (`StatCard`), and with the declared tracking that keeps a wide,
            flat face from inheriting the step's own tightening. No weight: the
            face ships a single 400 cut and anything else is a synthesised fake. */}
        <span className="flex-none font-display text-display leading-none tracking-flat tabular-nums">
          {state.schedule.horaInicio}
        </span>

        {rail && (
          <div
            className="relative min-w-0 flex-1 rounded-card bg-white/5"
            style={{ height: railHeight }}
          >
            <ol
              // Explícito porque Safari/VoiceOver pierde el rol implícito apenas
              // `list-none` saca las viñetas — la misma razón por la que lo
              // llevaba la lista que este riel reemplaza.
              role="list"
              aria-label="Sus sesiones de hoy"
              className="absolute inset-0 m-0 list-none p-0"
            >
              {rail.blocks.map((block) => (
                <li
                  key={block.schedule.id}
                  data-phase={block.phase}
                  aria-label={railBlockLabel(block, enrolledCounts[block.schedule.id] ?? null)}
                  className={`absolute rounded-full ${RAIL_PHASE[block.phase].className}`}
                  style={{
                    left: `${block.leftPercent}%`,
                    width: `${block.widthPercent}%`,
                    top: block.lane * (RAIL_ROW_HEIGHT + RAIL_ROW_GAP),
                    height: RAIL_ROW_HEIGHT,
                  }}
                />
              ))}
            </ol>

            {/* El minuto actual, cruzando todas las filas. Es decoración pura:
                el "dónde estoy" que marca ya está dicho en la fase de cada
                bloque y en la línea de soporte. */}
            {rail.nowPercent !== null && (
              <span
                data-rail="now"
                aria-hidden="true"
                className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-white"
                style={{ left: `${rail.nowPercent}%` }}
              />
            )}
          </div>
        )}
      </div>

      <p className="m-0 flex flex-wrap gap-x-3.5 gap-y-1 text-sm text-white/70">
        <span>
          {formatDay(state.schedule.diaSemana)} {state.schedule.horaInicio} — {state.schedule.horaFin}
        </span>
        <span>
          {isLive
            ? formatElapsedMinutes(state.minutesElapsed)
            : formatTimeUntilStart(state.minutesAway)}
        </span>
        {enrolledLabel && <span>{enrolledLabel}</span>}
      </p>

      <div className="mt-auto flex flex-wrap gap-2.5">
        <Link href={state.href} className={buttonClasses("primary")}>
          <ClipboardList size={ICON.sm} strokeWidth={2} aria-hidden="true" />
          Pasar lista de las {state.schedule.horaInicio}
        </Link>
        <Link href="/trainer/attendance" className={buttonClasses("onCoal")}>
          Elegir otro horario
        </Link>
      </div>
    </section>
  );
}
