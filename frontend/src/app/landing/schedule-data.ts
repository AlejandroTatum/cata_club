/**
 * The landing's schedule vocabulary lives here, with the mapper that produces
 * it — issue #789. It used to live in `landing-config.ts`, beside a
 * hand-written list of the club's categories; the club manages its schedules
 * inside the app now, so `GET /api/schedules` is the only source and this
 * module is the only place that says what one looks like.
 */

/** One published time block of a category, ready to render. */
export interface LandingScheduleSlot {
  hours: string;
  days: string;
  on: "week" | "sat";
}

export interface LandingSchedule {
  category: string;
  /**
   * The club's orientation label for the category ("5 a 10 años",
   * "Selección") — copy, never a rule: no age is validated against it. Absent
   * when the category publishes none, which is a legitimate state.
   */
  audience?: string;
  slots: LandingScheduleSlot[];
}

export interface PublicScheduleBlockPayload {
  days: string[];
  startTime: string;
  endTime: string;
}

export interface PublicSchedulePayload {
  category: string;
  /** Optional in the backend's `PublicScheduleCategoryDTO` (#913). */
  ages?: string | null;
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

/**
 * The category's age label, or nothing. A blank string and a value that is not
 * text both mean "no label": the landing renders the Edad fact conditionally,
 * and an empty or malformed one must disappear rather than show as a gap.
 */
function mapAudience(ages: unknown): string | undefined {
  if (typeof ages !== "string") return undefined;
  const label = ages.trim();
  return label.length > 0 ? label : undefined;
}

function mapBlock(block: unknown): LandingScheduleSlot | null {
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
    const slots = candidate.blocks.map(mapBlock).filter((slot): slot is LandingScheduleSlot => slot !== null);
    if (slots.length === 0) return [];
    const audience = mapAudience(candidate.ages);
    // Spread rather than `audience: undefined`: an absent label leaves the key
    // absent, so nothing downstream has to tell "no label" from "not mapped".
    return [{ category: candidate.category.trim(), ...(audience === undefined ? {} : { audience }), slots }];
  });
}
