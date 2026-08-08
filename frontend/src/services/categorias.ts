/**
 * Frontend mirror of the backend's single source of truth for the 5 fixed
 * `categoria` schedules — see `backend/app/dominio/categoria_metadata.py`.
 *
 * These are confirmed business constants (audience, time range, allowed
 * days), never edited at runtime, so a static map here avoids a metadata
 * GET endpoint for 5 values that rarely change. `hora_inicio`/`hora_fin`
 * are always derived server-side once a `categoria` is chosen — the client
 * never sends them (see `CrearHorarioDTO`/`ActualizarHorarioDTO` in
 * `@/services/api`), it only reads them here to render a locked, read-only
 * display.
 */

export type Categoria = "FORMATIVO" | "INFANTIL" | "JUVENIL" | "COMPETITIVO" | "ADULTOS";

export interface CategoriaInfo {
  label: string;
  horaInicio: string;
  horaFin: string;
  dias: string[];
}

const LUN_VIE = ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES"];
const LUN_SAB = [...LUN_VIE, "SABADO"];

export const CATEGORIA_METADATA: Record<Categoria, CategoriaInfo> = {
  FORMATIVO: {
    label: "Formativo",
    horaInicio: "15:00",
    horaFin: "16:00",
    dias: LUN_VIE,
  },
  INFANTIL: {
    label: "Infantil",
    horaInicio: "16:00",
    horaFin: "17:00",
    dias: LUN_VIE,
  },
  JUVENIL: {
    label: "Juvenil",
    horaInicio: "17:00",
    horaFin: "18:00",
    dias: LUN_VIE,
  },
  COMPETITIVO: {
    label: "Competitivo",
    horaInicio: "18:00",
    horaFin: "20:00",
    dias: LUN_SAB,
  },
  ADULTOS: {
    label: "Adultos",
    horaInicio: "20:00",
    horaFin: "21:15",
    dias: LUN_VIE,
  },
};

/** Stable iteration order for `<select>` options — same order as the backend enum. */
export const CATEGORIA_OPTIONS: Categoria[] = ["FORMATIVO", "INFANTIL", "JUVENIL", "COMPETITIVO", "ADULTOS"];

/** Days a given categoria is allowed to be scheduled on. */
export function diasPermitidos(categoria: Categoria): string[] {
  return CATEGORIA_METADATA[categoria].dias;
}

/** The locked, server-derived time range for a given categoria. */
export function horarioDe(categoria: Categoria): { horaInicio: string; horaFin: string } {
  const { horaInicio, horaFin } = CATEGORIA_METADATA[categoria];
  return { horaInicio, horaFin };
}
