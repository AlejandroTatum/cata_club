import type { LandingSchedule } from "./landing-config";

export interface PublicScheduleBlockPayload {
  days: string[];
  startTime: string;
  endTime: string;
}

export interface PublicSchedulePayload {
  category: string;
  blocks: PublicScheduleBlockPayload[];
}

const DAY_LABELS: Record<string, string> = {
  LUNES: "Lunes",
  MARTES: "Martes",
  MIERCOLES: "Miércoles",
  JUEVES: "Jueves",
  VIERNES: "Viernes",
  SABADO: "Sábado",
  DOMINGO: "Domingo",
};

const WEEK_DAYS = new Set(["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES"]);
const VALID_TIME = /^\d{2}:\d{2}$/;

function joinLabels(labels: string[]): string {
  if (labels.length < 2) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} y ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")} y ${labels[labels.length - 1]}`;
}

function mapBlock(block: unknown): LandingSchedule["slots"][number] | null {
  if (typeof block !== "object" || block === null) return null;
  const candidate = block as Partial<PublicScheduleBlockPayload>;
  if (!Array.isArray(candidate.days) || candidate.days.length === 0) return null;
  if (!candidate.days.every((day): day is string => typeof day === "string" && DAY_LABELS[day] !== undefined)) return null;
  if (typeof candidate.startTime !== "string" || typeof candidate.endTime !== "string") return null;
  if (!VALID_TIME.test(candidate.startTime) || !VALID_TIME.test(candidate.endTime)) return null;
  const labels = candidate.days.map((day): string => DAY_LABELS[day]);
  return {
    hours: `${candidate.startTime} – ${candidate.endTime}`,
    days: joinLabels(labels),
    on: candidate.days.every((day): boolean => !WEEK_DAYS.has(day)) ? "sat" : "week",
  };
}

export function mapPublicSchedules(payload: unknown): LandingSchedule[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((entry): LandingSchedule[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const candidate = entry as Partial<PublicSchedulePayload>;
    if (typeof candidate.category !== "string" || !candidate.category.trim() || !Array.isArray(candidate.blocks)) return [];
    const slots = candidate.blocks.map(mapBlock).filter((slot): slot is LandingSchedule["slots"][number] => slot !== null);
    return slots.length > 0 ? [{ category: candidate.category.trim(), slots }] : [];
  });
}
