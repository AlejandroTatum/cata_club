/**
 * De asignaciones a personas — la lógica detrás de «Alumnos del club».
 *
 * `GET /groups/horarios/alumnos` no devuelve alumnos: devuelve una fila por
 * `alumno_horario`. Un chico inscripto en tres horarios llega tres veces, con
 * el mismo `persona_id`, el mismo nombre y la misma edad. Es el mismo endpoint
 * que «Mi día» ya usa para contar inscriptos por horario, donde repetir una
 * persona es lo correcto; acá es exactamente lo que hay que deshacer.
 *
 * ## Lo que el padrón NO trae
 *
 * `AlumnoHorarioDetalleDTO` tiene nueve campos y ninguno dice si el alumno
 * tiene ficha médica cargada (issue #362), a qué categoría pertenece, ni si su
 * membresía está al día. Este módulo no inventa ninguno de los tres: la nómina
 * muestra lo que el dato afirma y el hueco de la ficha se explica donde se
 * descubre, dentro del diálogo.
 *
 * Módulo puro — sin React ni APIs del navegador — por la misma razón que
 * `attendance-utils.ts`: la regla de "una persona, un renglón" se prueba sin
 * montar nada.
 */

import type { AlumnoHorario } from "@/services/api";
import { normalizeText } from "@/app/members/members-utils";
import { buildWeeklyTrainingSchedule } from "@/app/student/student-utils";

/** Una persona del padrón, ya juntada, tal como la pinta un renglón. */
export interface AlumnoDelClub {
  personaId: number;
  nombreCompleto: string;
  edad: number;
  /**
   * `"Lun 18:00 · Mié 18:00"`, o `null` cuando ninguna de sus filas trajo un
   * horario legible.
   *
   * `null` y `""` no son lo mismo para la pantalla: el nulo dice "el club le
   * asignó horarios que no se pueden leer", y merece silencio en vez de una
   * línea que diga "undefined".
   */
  horarios: string | null;
}

/**
 * `"Miércoles"` → `"Mié"`, derivado en vez de tabulado.
 *
 * Los siete días en español sobreviven al corte de tres letras sin ambigüedad
 * (Lun, Mar, Mié, Jue, Vie, Sáb, Dom), así que una segunda tabla de etiquetas
 * cortas sería una copia que puede desincronizarse de la primera. El acento se
 * conserva a propósito: "Mie" y "Sab" no son palabras.
 */
function abreviarDia(diaLabel: string): string {
  return diaLabel.slice(0, 3);
}

/**
 * La semana de un alumno en una línea.
 *
 * Pasa por `buildWeeklyTrainingSchedule` —el mismo que arma el portal de la
 * familia— y no por las filas crudas, porque el club modela una tarde de tres
 * horas como tres `Horario` de una hora e inscribe al chico en los tres.
 * Listarlas sueltas le diría al entrenador que la nena entrena tres veces el
 * lunes; fusionadas dice la verdad: una ventana, que empieza a las 15:00.
 *
 * Solo la hora de INICIO. Este renglón contesta "¿cuándo lo veo?", no "¿cuánto
 * dura?" — la duración está en «Horarios» y repetirla acá gastaría el ancho
 * que el nombre y la edad necesitan en un teléfono.
 */
function resumirHorarios(filas: AlumnoHorario[]): string | null {
  const ventanas = buildWeeklyTrainingSchedule(filas);
  if (ventanas.length === 0) return null;
  return ventanas
    .map((ventana) => `${abreviarDia(ventana.diaLabel)} ${ventana.horaInicio}`)
    .join(" · ");
}

/**
 * El padrón agregado del club, convertido en la nómina que se muestra.
 *
 * Junta por `persona_id` —no por nombre: dos homónimos son dos chicos— y
 * ordena alfabéticamente con `localeCompare`, que es lo único que pone a
 * "Ávila" antes que a "Boris" en castellano.
 *
 * El endpoint NO pagina y devuelve el club entero (66 alumnos con horario al
 * medirlo para el issue #362, ~200 filas). Juntar acá es lo que hace que ese
 * volumen entre en una lista legible; la paginación que la pantalla aplica
 * después es sobre ESTA lista, ya deduplicada, nunca sobre las filas crudas.
 */
export function agruparAlumnosDelPadron(filas: AlumnoHorario[]): AlumnoDelClub[] {
  const porPersona = new Map<number, AlumnoHorario[]>();
  for (const filaActual of filas) {
    const acumuladas = porPersona.get(filaActual.personaId);
    if (acumuladas) acumuladas.push(filaActual);
    else porPersona.set(filaActual.personaId, [filaActual]);
  }

  return [...porPersona.values()]
    .map((filasDeLaPersona) => ({
      personaId: filasDeLaPersona[0].personaId,
      nombreCompleto: filasDeLaPersona[0].personaNombreCompleto,
      edad: filasDeLaPersona[0].edad,
      horarios: resumirHorarios(filasDeLaPersona),
    }))
    .sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto, "es"));
}

/**
 * La nómina que sobrevive al buscador.
 *
 * En cliente y sobre la lista ya cargada: el padrón vino entero en una sola
 * llamada, así que ir al servidor por cada tecla sería pedir de nuevo lo que
 * ya está en memoria. Reusa `normalizeText` de `/members` —el mismo
 * comparador sin acentos que el buscador de miembros— porque nadie escribe
 * "Sofía" con tilde en un buscador, y menos con el teléfono en la mano al
 * borde de la cancha.
 *
 * Un término vacío devuelve todo; uno sin coincidencias devuelve la lista
 * vacía, que la pantalla nombra. Devolver la nómina entera "por las dudas"
 * haría que el buscador parezca roto.
 */
export function filtrarPorNombre(alumnos: AlumnoDelClub[], termino: string): AlumnoDelClub[] {
  const buscado = normalizeText(termino);
  if (buscado === "") return alumnos;
  return alumnos.filter((alumno) => normalizeText(alumno.nombreCompleto).includes(buscado));
}
