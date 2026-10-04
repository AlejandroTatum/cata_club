/**
 * Fechas y sesiones de asistencia relativas al «hoy» del club.
 *
 * El backend solo registra o corrige asistencia dentro de los últimos
 * `VENTANA_REGISTRO_ASISTENCIA_DIAS` días (30) del día del club
 * (`hoy_club()`, America/Guayaquil) y solo en la fecha cuyo día de semana es
 * el del horario. Una fecha fija en el spec envejece fuera de esa ventana,
 * así que los specs en vivo la derivan de acá en cada corrida.
 *
 * El bulk-seed cierra las últimas 4 ocurrencias de cada horario (contando
 * desde ayer), por lo que una sesión libre dentro de la ventana depende del
 * día en que corre la suite: `findOpenAttendanceSession` la descubre en vez de
 * asumirla.
 */
import type { APIRequestContext } from "@playwright/test";

/** Mismo valor que `VENTANA_REGISTRO_ASISTENCIA_DIAS` en el backend. */
export const ATTENDANCE_WINDOW_DAYS = 30;

const CLUB_TIME_ZONE = "America/Guayaquil";

/** `diaSemana` tal como lo devuelve `GET /api/attendance/schedules`, indexado por `getUTCDay()`. */
const DAY_CODES = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"] as const;

/** Día de calendario del club (`YYYY-MM-DD`), `daysAgo` días antes de hoy. */
export function clubIsoDate(daysAgo = 0, now: Date = new Date()): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: CLUB_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const shifted = new Date(`${today}T12:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() - daysAgo);
  return shifted.toISOString().slice(0, 10);
}

function dayCodeOf(isoDate: string): string {
  return DAY_CODES[new Date(`${isoDate}T12:00:00Z`).getUTCDay()];
}

export interface AttendanceSession {
  horarioId: number;
  fecha: string;
  studentPersonaId: number;
  /** `true` si ya había asistencia de `studentName` registrada (sesión cerrada). */
  alreadyFiled: boolean;
}

interface Schedule {
  id: number;
  diaSemana: string;
}

interface AttendanceRecordRow {
  estado: string;
  personaId?: number | string;
}

/**
 * La sesión más reciente dentro de la ventana en la que `studentName` está
 * inscrito y que sigue SIN ninguna asistencia registrada. Si no queda ninguna
 * libre, la sesión más reciente donde `studentName` ya figura como `estado`
 * (la que dejó una corrida anterior). `request` debe tener sesión de
 * entrenador o administrador.
 */
export async function findOpenAttendanceSession(
  request: APIRequestContext,
  studentName: string,
  fallbackEstado: string,
): Promise<AttendanceSession> {
  const schedules = (await request.get("/api/attendance/schedules").then((r) => r.json())) as Schedule[];
  const rosterCache = new Map<number, number | null>();
  const personaIdIn = async (horarioId: number): Promise<number | null> => {
    if (!rosterCache.has(horarioId)) {
      const roster = (await request
        .get(`/api/groups/horarios/${horarioId}/alumnos?limit=200`)
        .then((r) => r.json())) as { items: Array<{ personaId: number; personaNombreCompleto: string }> };
      const found = roster.items.find((i) => i.personaNombreCompleto === studentName);
      rosterCache.set(horarioId, found ? found.personaId : null);
    }
    return rosterCache.get(horarioId) ?? null;
  };

  let filed: AttendanceSession | null = null;
  for (let daysAgo = 0; daysAgo <= ATTENDANCE_WINDOW_DAYS; daysAgo += 1) {
    const fecha = clubIsoDate(daysAgo);
    for (const horario of schedules.filter((h) => h.diaSemana === dayCodeOf(fecha))) {
      const studentPersonaId = await personaIdIn(horario.id);
      if (studentPersonaId === null) continue;
      const records = (await request
        .get(`/api/attendance/records?fechaInicio=${fecha}&fechaFin=${fecha}&horarioId=${horario.id}`)
        .then((r) => r.json())) as AttendanceRecordRow[];
      if (records.length === 0) {
        return { horarioId: horario.id, fecha, studentPersonaId, alreadyFiled: false };
      }
      const own = records.find((r) => String(r.personaId) === String(studentPersonaId));
      if (!filed && own?.estado === fallbackEstado) {
        filed = { horarioId: horario.id, fecha, studentPersonaId, alreadyFiled: true };
      }
    }
  }
  if (filed) return filed;
  throw new Error(
    `No hay ninguna sesión libre de ${studentName} en los últimos ${ATTENDANCE_WINDOW_DAYS} días del club ` +
      "(ni una que una corrida anterior haya dejado marcada): el seed cerró todas las ocurrencias de sus horarios.",
  );
}
