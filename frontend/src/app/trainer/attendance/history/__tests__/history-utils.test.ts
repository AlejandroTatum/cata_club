/**
 * El cruce entre "lo que se programó" y "lo que se tomó", medido acá.
 *
 * La cifra que sale de esta función es la única del historial que NO viene del
 * backend: se deriva expandiendo el horario semanal sobre el rango del filtro y
 * restándole las listas que la pantalla ya tiene. Por eso vive en un módulo
 * puro con sus propios candados — lo que puede salir mal es aritmética de
 * calendario, no React.
 *
 * Julio de 2026 es el mes que ya usan los fixtures del test de la pantalla:
 * el 20 es lunes y el 17 es viernes. De ahí salen los lunes 6/13/20/27 y los
 * viernes 3/10/17/24/31.
 */

import { describe, it, expect } from "vitest";
import type { TrainingSchedule } from "@/app/attendance/attendance-utils";
import { summarizePeriodCoverage } from "../history-utils";

const SCHEDULES: TrainingSchedule[] = [
  { id: 7, diaSemana: "lun", horaInicio: "15:00", horaFin: "16:00" },
  { id: 9, diaSemana: "vie", horaInicio: "17:00", horaFin: "18:00" },
];

describe("summarizePeriodCoverage", () => {
  it("expande el horario semanal sobre el rango y le resta las listas tomadas", () => {
    const coverage = summarizePeriodCoverage({
      sessions: [
        { fecha: "2026-07-20", horarioId: 7 },
        { fecha: "2026-07-17", horarioId: 9 },
      ],
      schedules: SCHEDULES,
      desde: "2026-07-13",
      hasta: "2026-07-20",
      hoy: "2026-08-15",
    });

    // Lunes 13 y 20 (horario 7) + viernes 17 (horario 9).
    expect(coverage.sesionesProgramadas).toBe(3);
    expect(coverage.listasTomadas).toBe(2);
    // El único hueco: el lunes 13.
    expect(coverage.sinLista).toBe(1);
  });

  it("no cuenta como hueco un día que todavía no llegó", () => {
    // Un rango personalizado puede terminar en el futuro. Una sesión que aún no
    // ocurrió no es una lista que falte: es una lista que todavía no toca.
    const coverage = summarizePeriodCoverage({
      sessions: [{ fecha: "2026-07-13", horarioId: 7 }],
      schedules: SCHEDULES,
      desde: "2026-07-13",
      hasta: "2026-07-31",
      hoy: "2026-07-20",
    });

    // Hasta el 20 inclusive: lunes 13 y 20, viernes 17. Nada del 21 en adelante.
    expect(coverage.sesionesProgramadas).toBe(3);
    expect(coverage.sinLista).toBe(2);
  });

  it("respeta el filtro de horario: expande solo el horario elegido", () => {
    const coverage = summarizePeriodCoverage({
      sessions: [{ fecha: "2026-07-17", horarioId: 9 }],
      schedules: SCHEDULES,
      desde: "2026-07-13",
      hasta: "2026-07-20",
      hoy: "2026-08-15",
      horarioId: 9,
    });

    expect(coverage.sesionesProgramadas).toBe(1);
    expect(coverage.listasTomadas).toBe(1);
    expect(coverage.sinLista).toBe(0);
  });

  it("nunca devuelve un hueco negativo cuando se tomó una lista fuera del horario semanal", () => {
    // Una recuperación un martes no está programada en ningún lado. Cuenta como
    // lista tomada, y no puede descontar un hueco que no tapó.
    const coverage = summarizePeriodCoverage({
      sessions: [
        { fecha: "2026-07-14", horarioId: 99 },
        { fecha: "2026-07-13", horarioId: 7 },
        { fecha: "2026-07-20", horarioId: 7 },
        { fecha: "2026-07-17", horarioId: 9 },
      ],
      schedules: SCHEDULES,
      desde: "2026-07-13",
      hasta: "2026-07-20",
      hoy: "2026-08-15",
    });

    expect(coverage.listasTomadas).toBe(4);
    expect(coverage.sesionesProgramadas).toBe(3);
    expect(coverage.sinLista).toBe(0);
  });

  it("sin horarios cargados no inventa sesiones programadas", () => {
    // El select de horarios puede fallar sin tumbar la pantalla (la pantalla ya
    // lo trata así). Sin esa lista, el universo programado es desconocido, y
    // desconocido se dice con cero huecos, no con huecos falsos.
    const coverage = summarizePeriodCoverage({
      sessions: [{ fecha: "2026-07-20", horarioId: 7 }],
      schedules: [],
      desde: "2026-07-13",
      hasta: "2026-07-20",
      hoy: "2026-08-15",
    });

    expect(coverage.sesionesProgramadas).toBe(0);
    expect(coverage.sinLista).toBe(0);
    expect(coverage.listasTomadas).toBe(1);
  });

  it("un rango vacío o invertido no expande nada", () => {
    const coverage = summarizePeriodCoverage({
      sessions: [],
      schedules: SCHEDULES,
      desde: "2026-07-20",
      hasta: "2026-07-13",
      hoy: "2026-08-15",
    });

    expect(coverage.sesionesProgramadas).toBe(0);
    expect(coverage.sinLista).toBe(0);
  });
});
