/**
 * El cruce entre el horario semanal y las listas que se tomaron.
 *
 * Todo lo demás del historial es un dato: el backend lo devuelve y la pantalla
 * lo dibuja. Esto no. Acá se DERIVA una cifra que nadie guardó — cuántas
 * sesiones del período quedaron sin lista — expandiendo cada `TrainingSchedule`
 * sobre el rango del filtro y restándole las claves `(fecha, horarioId)` que la
 * pantalla ya tiene agrupadas.
 *
 * ## Por qué es una ESTIMACIÓN, y no una cuenta
 *
 * El modelo no tiene con qué hacerla exacta. `HorarioEntrenamiento`
 * (`backend/app/dominio/modelos.py:595`) guarda categoría, día de la semana y
 * las dos horas, y nada más: no hay `vigente_desde`/`vigente_hasta`, ni baja
 * suave, ni feriados, ni cancelaciones en ninguna tabla. De ahí salen tres
 * formas de mentir, todas hacia arriba:
 *
 *   - un horario dado de alta este mes se expande hacia atrás sobre semanas en
 *     las que ese grupo todavía no existía;
 *   - un feriado o una clase suspendida se cuentan como sesión programada;
 *   - un horario que dejó de darse sigue expandiéndose hasta que alguien lo
 *     borre, y borrarlo se llevaría también su historia.
 *
 * Encima, issue #313 / hallazgo #56 ya dejó anotado que el horario semanal
 * programado y las listas efectivamente tomadas no son el mismo universo.
 *
 * Por eso la pantalla declara la cifra como estimación con todas las letras y
 * no la pinta como un problema confirmado. Si algún día el horario gana
 * vigencia, esta función deja de estimar y el rótulo se cae solo.
 */

import type { TrainingSchedule } from "@/app/attendance/attendance-utils";
import { calendarIsoDate, diaSemanaOfCalendarDate } from "@/lib/club-date";

/** Una sesión ya tomada, reducida a lo único con lo que se la cruza. */
export interface TakenSession {
  /** `"YYYY-MM-DD"`. */
  fecha: string;
  horarioId: number;
}

/** Las tres cifras del período, en el orden en que se leen. */
export interface PeriodCoverage {
  /** Sesiones con lista pasada — una por `(fecha, horarioId)`. */
  listasTomadas: number;
  /** Sesiones que el horario semanal pone en el rango. */
  sesionesProgramadas: number;
  /** Programadas sin lista. La estimación; ver el encabezado del módulo. */
  sinLista: number;
}

export interface PeriodCoverageInput {
  sessions: TakenSession[];
  schedules: TrainingSchedule[];
  /** Inicio del rango del filtro, `"YYYY-MM-DD"`. */
  desde: string;
  /** Fin del rango del filtro, `"YYYY-MM-DD"`. */
  hasta: string;
  /** Hoy en la zona del club — el rango se recorta acá. Ver abajo. */
  hoy: string;
  /** El filtro de horario, cuando hay uno: expande solo ese. */
  horarioId?: number | null;
}

/**
 * El techo del recorrido, en días.
 *
 * Los presets nunca pasan de un mes, pero el rango personalizado son dos
 * `<input type="date">` sueltos: un dedo de más escribe el año 20260 y el bucle
 * se lleva puesto el render. Tres años cubre cualquier consulta real de un club
 * que abrió hace dos.
 */
const MAX_DIAS_EXPANDIDOS = 1_100;

/** La clave con la que una sesión programada y una tomada son la misma. */
function sessionKey(fecha: string, horarioId: number): string {
  return `${fecha}|${horarioId}`;
}

/**
 * Cruzar el horario semanal contra las listas tomadas en el período.
 *
 * El rango se recorta contra `hoy` porque un rango personalizado puede terminar
 * en el futuro, y una sesión que todavía no ocurrió no es una lista que falte:
 * es una lista que no toca. Los presets ya terminan hoy (`buildDateRange`), así
 * que el recorte solo muerde en el rango personalizado.
 */
export function summarizePeriodCoverage(input: PeriodCoverageInput): PeriodCoverage {
  const { sessions, schedules, desde, hasta, hoy, horarioId } = input;

  const listasTomadas = sessions.length;
  const tomadas = new Set(sessions.map((s) => sessionKey(s.fecha, s.horarioId)));

  // El filtro de horario tiene que aplicarse a AMBOS lados del cruce: la
  // pantalla ya recibe solo las listas de ese horario, así que expandir los
  // demás dejaría huecos que el trainer no está mirando.
  const expandibles =
    horarioId === null || horarioId === undefined
      ? schedules
      : schedules.filter((schedule) => schedule.id === horarioId);

  const fin = hasta < hoy ? hasta : hoy;

  let sesionesProgramadas = 0;
  let sinLista = 0;

  if (expandibles.length > 0 && desde && fin && desde <= fin) {
    const cursor = new Date(`${desde}T12:00:00`);
    for (let dia = 0; dia < MAX_DIAS_EXPANDIDOS; dia += 1) {
      const fecha = calendarIsoDate(cursor);
      if (fecha > fin) break;

      const diaSemana = diaSemanaOfCalendarDate(fecha);
      if (diaSemana !== null) {
        for (const schedule of expandibles) {
          if (schedule.diaSemana !== diaSemana) continue;
          sesionesProgramadas += 1;
          if (!tomadas.has(sessionKey(fecha, schedule.id))) sinLista += 1;
        }
      }

      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return { listasTomadas, sesionesProgramadas, sinLista };
}
