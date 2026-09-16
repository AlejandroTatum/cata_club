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
import { summarizePeriodCoverage, findMissingSessions } from "../history-utils";

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

  describe("hoy con horaActual: una sesión de hoy que todavía no arrancó", () => {
    // Issue #1239: a las 11:14 del martes, el horario de 15:00 no es una lista
    // que falte — es una lista que todavía no toca, igual que un día futuro.
    const SCHEDULES_DE_HOY: TrainingSchedule[] = [
      { id: 15, diaSemana: "mar", horaInicio: "15:00", horaFin: "16:00" },
      { id: 16, diaSemana: "mar", horaInicio: "16:00", horaFin: "17:00" },
      { id: 17, diaSemana: "mar", horaInicio: "17:00", horaFin: "18:00" },
      { id: 18, diaSemana: "mar", horaInicio: "18:00", horaFin: "19:00" },
      { id: 20, diaSemana: "mar", horaInicio: "20:00", horaFin: "21:00" },
    ];
    // 2026-09-15 es un martes.
    const HOY = "2026-09-15";

    it("a las 11:14 ninguna sesión de hoy arrancó: cero programadas, cero huecos", () => {
      const coverage = summarizePeriodCoverage({
        sessions: [
          { fecha: HOY, horarioId: 18 },
          { fecha: HOY, horarioId: 20 },
        ],
        schedules: SCHEDULES_DE_HOY,
        desde: HOY,
        hasta: HOY,
        hoy: HOY,
        horaActual: "11:14",
      });

      expect(coverage.sesionesProgramadas).toBe(0);
      expect(coverage.sinLista).toBe(0);
      // Las listas de 18:00 y 20:00 se tomaron por adelantado — igual cuentan.
      expect(coverage.listasTomadas).toBe(2);
    });

    it("a las 16:30 ya arrancaron 15:00 y 16:00: una con lista, una sin", () => {
      const coverage = summarizePeriodCoverage({
        sessions: [
          { fecha: HOY, horarioId: 16 },
          { fecha: HOY, horarioId: 18 },
          { fecha: HOY, horarioId: 20 },
        ],
        schedules: SCHEDULES_DE_HOY,
        desde: HOY,
        hasta: HOY,
        hoy: HOY,
        horaActual: "16:30",
      });

      // Arrancaron 15:00 y 16:00; 17:00, 18:00 y 20:00 todavía no.
      expect(coverage.sesionesProgramadas).toBe(2);
      // 15:00 no tiene lista; 16:00 sí.
      expect(coverage.sinLista).toBe(1);
      expect(coverage.listasTomadas).toBe(3);
    });

    it("un día pasado no se filtra por horaActual: todo su horario cuenta", () => {
      const coverage = summarizePeriodCoverage({
        sessions: [],
        schedules: SCHEDULES_DE_HOY,
        desde: "2026-09-08",
        hasta: "2026-09-08",
        hoy: HOY,
        horaActual: "00:00",
      });

      // 2026-09-08 también es martes: las cinco sesiones del día ya pasaron,
      // aunque `horaActual` sea la más temprana posible.
      expect(coverage.sesionesProgramadas).toBe(5);
      expect(coverage.sinLista).toBe(5);
    });
  });
});

describe("findMissingSessions", () => {
  it("excluye una sesión con lista tomada, y la incluye cuando no la tiene", () => {
    const missing = findMissingSessions({
      sessions: [
        { fecha: "2026-07-20", horarioId: 7 },
        { fecha: "2026-07-17", horarioId: 9 },
      ],
      schedules: SCHEDULES,
      desde: "2026-07-13",
      hasta: "2026-07-20",
      hoy: "2026-08-15",
    });

    // Lunes 13 y 20 (horario 7) + viernes 17 (horario 9); el lunes 20 y el
    // viernes 17 tienen lista, así que el único hueco es el lunes 13.
    expect(missing).toEqual([{ fecha: "2026-07-13", schedule: SCHEDULES[0] }]);
  });

  it("no incluye una sesión de hoy que todavía no arrancó", () => {
    const SCHEDULES_DE_HOY: TrainingSchedule[] = [
      { id: 15, diaSemana: "mar", horaInicio: "15:00", horaFin: "16:00" },
      { id: 16, diaSemana: "mar", horaInicio: "16:00", horaFin: "17:00" },
    ];
    const HOY = "2026-09-15";

    const missing = findMissingSessions({
      sessions: [],
      schedules: SCHEDULES_DE_HOY,
      desde: HOY,
      hasta: HOY,
      hoy: HOY,
      horaActual: "15:30",
    });

    // Arrancó la de las 15:00 y le falta lista; la de las 16:00 todavía no toca.
    expect(missing).toEqual([{ fecha: HOY, schedule: SCHEDULES_DE_HOY[0] }]);
  });

  it("ordena de más reciente a más antiguo, y por hora dentro del mismo día", () => {
    const missing = findMissingSessions({
      sessions: [],
      schedules: SCHEDULES,
      desde: "2026-07-13",
      hasta: "2026-07-20",
      hoy: "2026-08-15",
    });

    // Lunes 13, lunes 20 (horario 7, 15:00) y viernes 17 (horario 9, 17:00) —
    // ninguno tiene lista. Más reciente primero: 20, luego 17, luego 13.
    expect(missing.map((m) => m.fecha)).toEqual(["2026-07-20", "2026-07-17", "2026-07-13"]);
  });
});
