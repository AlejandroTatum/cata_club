/**
 * El padrón que llega no es una lista de alumnos: es una lista de
 * ASIGNACIONES.
 *
 * `GET /groups/horarios/alumnos` devuelve una fila por `alumno_horario`, así
 * que un chico inscripto en tres horarios llega tres veces, con el mismo
 * `persona_id` y el mismo nombre. Pintarlo tal cual daría una nómina con 66
 * alumnos y 200 renglones, y el entrenador contaría gente que no existe.
 *
 * Estas pruebas fijan las dos operaciones que convierten esas filas en la
 * nómina que la pantalla muestra: juntar por persona y decir en una línea
 * cuándo entrena.
 */

import { describe, it, expect } from "vitest";
import type { AlumnoHorario } from "@/services/api";
import { agruparAlumnosDelPadron, filtrarPorNombre } from "../students-utils";

let siguienteId = 1;

/**
 * Una fila del padrón. `horarioDia` va en MAYÚSCULAS porque así lo manda el
 * backend (`DiaSemana.LUNES` en `dominio/enums.py`) — el `DiaSemana` del
 * frontend, que se escribe `"lun"`, es otro tipo y pertenece a otra ruta.
 */
function fila(
  personaId: number,
  nombre: string,
  edad: number,
  dia: string,
  horaInicio: string,
  horaFin: string,
): AlumnoHorario {
  return {
    id: siguienteId++,
    personaId,
    personaNombreCompleto: nombre,
    edad,
    horarioId: siguienteId,
    horarioDia: dia,
    horarioHoraInicio: horaInicio,
    horarioHoraFin: horaFin,
    fechaAsignacion: "2026-01-15T00:00:00",
  };
}

describe("agruparAlumnosDelPadron", () => {
  it("junta las tres asignaciones de un alumno en un solo renglón", () => {
    const alumnos = agruparAlumnosDelPadron([
      fila(7, "Melany Quimis", 12, "LUNES", "18:00:00", "19:00:00"),
      fila(7, "Melany Quimis", 12, "MIERCOLES", "18:00:00", "19:00:00"),
      fila(7, "Melany Quimis", 12, "VIERNES", "18:00:00", "19:00:00"),
    ]);

    expect(alumnos).toHaveLength(1);
    expect(alumnos[0]).toEqual({
      personaId: 7,
      nombreCompleto: "Melany Quimis",
      edad: 12,
      horarios: "Lun 18:00 · Mié 18:00 · Vie 18:00",
    });
  });

  it("ordena los horarios por día de la semana, no por el orden en que llegaron", () => {
    const alumnos = agruparAlumnosDelPadron([
      fila(3, "Diego Mendoza", 15, "SABADO", "09:00:00", "10:00:00"),
      fila(3, "Diego Mendoza", 15, "MARTES", "17:00:00", "18:00:00"),
    ]);

    expect(alumnos[0].horarios).toBe("Mar 17:00 · Sáb 09:00");
  });

  it("funde dos horas consecutivas del mismo día en una sola ventana", () => {
    // El club modela una tarde de dos horas como dos `Horario` de una hora
    // (FORMATIVO 15-16, INFANTIL 16-17) y asigna al chico a los dos. Son un
    // entrenamiento, no dos: listarlos aparte diría que va dos veces el lunes.
    const alumnos = agruparAlumnosDelPadron([
      fila(9, "Ana García", 10, "LUNES", "15:00:00", "16:00:00"),
      fila(9, "Ana García", 10, "LUNES", "16:00:00", "17:00:00"),
    ]);

    expect(alumnos[0].horarios).toBe("Lun 15:00");
  });

  it("ordena la nómina por nombre, sin que el acento mande a Ávila al final", () => {
    const alumnos = agruparAlumnosDelPadron([
      fila(2, "Sofía Vera", 14, "LUNES", "18:00:00", "19:00:00"),
      fila(1, "Ávila Pérez", 11, "LUNES", "18:00:00", "19:00:00"),
      fila(3, "boris Cedeño", 13, "LUNES", "18:00:00", "19:00:00"),
    ]);

    expect(alumnos.map((alumno) => alumno.nombreCompleto)).toEqual([
      "Ávila Pérez",
      "boris Cedeño",
      "Sofía Vera",
    ]);
  });

  it("deja el resumen en null cuando ninguna fila trae un horario legible", () => {
    // Un día que el build no reconoce se descarta en vez de imprimirse como
    // "undefined 18:00". Sin ventanas válidas no hay frase que decir, y la
    // pantalla tiene que poder distinguir eso de "todavía no cargó".
    const alumnos = agruparAlumnosDelPadron([
      fila(4, "Luis López", 16, "LUNGAR", "18:00:00", "19:00:00"),
    ]);

    expect(alumnos).toHaveLength(1);
    expect(alumnos[0].horarios).toBeNull();
  });

  it("devuelve una nómina vacía para un padrón vacío", () => {
    expect(agruparAlumnosDelPadron([])).toEqual([]);
  });
});

describe("filtrarPorNombre", () => {
  const NOMINA = agruparAlumnosDelPadron([
    fila(1, "Melany Quimis", 12, "LUNES", "18:00:00", "19:00:00"),
    fila(2, "Sofía Vera", 14, "MARTES", "18:00:00", "19:00:00"),
    fila(3, "Diego Mendoza", 15, "MARTES", "18:00:00", "19:00:00"),
  ]);

  it("encuentra por apellido, no solo por el comienzo del nombre", () => {
    expect(filtrarPorNombre(NOMINA, "vera").map((a) => a.nombreCompleto)).toEqual(["Sofía Vera"]);
  });

  it("encuentra a Sofía escribiendo Sofia", () => {
    // Nadie pone el acento en un buscador, y menos con el teléfono en la mano
    // al borde de la cancha.
    expect(filtrarPorNombre(NOMINA, "Sofia").map((a) => a.nombreCompleto)).toEqual(["Sofía Vera"]);
  });

  it("devuelve la nómina entera cuando el buscador está vacío o solo tiene espacios", () => {
    expect(filtrarPorNombre(NOMINA, "")).toHaveLength(3);
    expect(filtrarPorNombre(NOMINA, "   ")).toHaveLength(3);
  });

  it("devuelve una lista vacía cuando nadie coincide, en vez de la nómina entera", () => {
    expect(filtrarPorNombre(NOMINA, "zzz")).toEqual([]);
  });
});
