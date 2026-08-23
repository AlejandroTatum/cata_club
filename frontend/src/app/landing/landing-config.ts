export interface LandingStat {
  /** The figure exactly as it must appear. Rendered as text and never animated. */
  value: string;
  label: string;
}

export interface LandingScheduleSlot {
  hours: string;
  days: string;
  on: "week" | "sat";
}

export interface LandingSchedule {
  category: string;
  audience: string;
  slots: LandingScheduleSlot[];
}

export interface LandingContact {
  whatsapp: string[];
  facebook: string;
  instagram: string;
  hours: string;
}

export interface LandingConfig {
  schedules: LandingSchedule[];
  contact: LandingContact;
}

/** Ecuador's international dialing code, used to build wa.me deep links. */
const ECUADOR_COUNTRY_CODE = "593";

/**
 * The club's founding date, as published on the landing since its first
 * release ("Fundado el 10 de octubre" / "desde 2013"). Every "years of
 * experience" figure is derived from this so it can never drift out of date.
 */
export const FOUNDING_DATE = { year: 2013, month: 10, day: 10 } as const;

/**
 * Converts a locally formatted Ecuadorian mobile number into the digits-only
 * international form WhatsApp expects: the national trunk prefix `0` is
 * dropped and the country code is prepended (0994219619 → 593994219619).
 */
export function toWhatsAppNumber(localNumber: string): string {
  const digits = localNumber.replace(/\D/g, "");
  const national = digits.startsWith("0") ? digits.slice(1) : digits;
  return national.startsWith(ECUADOR_COUNTRY_CODE) ? national : `${ECUADOR_COUNTRY_CODE}${national}`;
}

/** Builds the wa.me chat link for a locally formatted contact number. */
export function toWhatsAppLink(localNumber: string): string {
  return `https://wa.me/${toWhatsAppNumber(localNumber)}`;
}

/**
 * Whole years elapsed since the founding date — the current year only counts
 * once the anniversary has passed.
 */
export function yearsSinceFounding(now: Date = new Date()): number {
  const years = now.getFullYear() - FOUNDING_DATE.year;
  const beforeAnniversary =
    now.getMonth() + 1 < FOUNDING_DATE.month ||
    (now.getMonth() + 1 === FOUNDING_DATE.month && now.getDate() < FOUNDING_DATE.day);
  return Math.max(beforeAnniversary ? years - 1 : years, 0);
}

/**
 * The trust band. Every figure here is either a constant of record (the
 * founding year, the venue) or derived from one — no unverified counts.
 */
export function buildLandingStats(now: Date = new Date()): LandingStat[] {
  const years = yearsSinceFounding(now);
  return [
    // Every figure is rendered statically. An odometer counting 0 → 2013 reads
    // as a bug, and a count-up on a two-digit number adds nothing while it can
    // still strand the band at 0 whenever its trigger does not fire.
    { value: String(FOUNDING_DATE.year), label: "Fundado el 10 de octubre" },
    { value: String(years), label: "Años formando deportistas" },
    { value: "Loja", label: "Junto al Coliseo Ciudad de Loja" },
  ];
}

/** Start/end of an `"HH:MM – HH:MM"` block, zero-padded so it sorts lexically. */
const TIME_RANGE = /(\d{2}:\d{2})\D+(\d{2}:\d{2})/;

/** Abbreviation of the latest weekday any slot, across every schedule, runs on. */
function lastDayOfWeek(slots: LandingScheduleSlot[]): string {
  const days = slots.map((slot): string => slot.days).join(" ");
  if (days.includes("Domingo")) return "Dom";
  if (days.includes("Sábado")) return "Sáb";
  return "Vie";
}

/**
 * Public attention hours, derived from the published training schedule so the
 * card can never advertise a narrower window than the club actually opens.
 *
 * Iterates every slot of every category — not just the first slot per
 * category — so a category with more than one time block (e.g. Adultos'
 * morning session, Competitivo's Saturday session) can move the derived
 * opening time or extend the day range on its own.
 */
export function deriveContactHours(schedules: LandingSchedule[]): string {
  const allSlots = schedules.flatMap((schedule): LandingScheduleSlot[] => schedule.slots);
  const ranges = allSlots
    .map((slot): RegExpExecArray | null => TIME_RANGE.exec(slot.hours))
    .filter((match): match is RegExpExecArray => match !== null);

  // Explicit comparator, not a bare `.sort()`. These are zero-padded "HH:MM"
  // strings, so the default sort happens to order them correctly today — but
  // the default compares UTF-16 code units after coercing to string, which is
  // a property of the values rather than of the code, and it silently stops
  // holding the moment the format changes.
  const byTime = (a: string, b: string): number => a.localeCompare(b);
  const starts = ranges.map((match): string => match[1]).sort(byTime);
  const ends = ranges.map((match): string => match[2]).sort(byTime);
  const opensAt = starts[0] ?? "";
  const closesAt = ends[ends.length - 1] ?? "";
  const lastDay = lastDayOfWeek(allSlots);

  return `Lun – ${lastDay} · ${opensAt} – ${closesAt}`;
}

const schedules: LandingSchedule[] = [
  {
    category: "Formativo",
    audience: "5 a 10 años",
    slots: [{ hours: "15:00 – 16:00", days: "Lunes a Viernes", on: "week" }],
  },
  {
    category: "Infantil",
    audience: "8 a 12 años",
    slots: [{ hours: "16:00 – 17:00", days: "Lunes a Viernes", on: "week" }],
  },
  {
    category: "Juvenil",
    audience: "Mayores de 12 años",
    slots: [{ hours: "17:00 – 18:00", days: "Lunes a Viernes", on: "week" }],
  },
  {
    category: "Competitivo",
    audience: "Selección",
    slots: [
      { hours: "18:00 – 20:00", days: "Lunes a Viernes", on: "week" },
      { hours: "18:00 – 20:00", days: "Sábado", on: "sat" },
    ],
  },
  {
    category: "Adultos",
    audience: "Mayores de 18 años",
    slots: [
      { hours: "08:00 – 09:15", days: "Lunes a Viernes", on: "week" },
      { hours: "20:00 – 21:15", days: "Lunes a Viernes", on: "week" },
    ],
  },
  {
    category: "Juego Libre",
    audience: "Abierto a todos",
    slots: [{ hours: "15:00 – 18:00", days: "Sábado", on: "sat" }],
  },
];

export const landingConfig: LandingConfig = {
  schedules,
  contact: {
    whatsapp: ["0994219619", "0990288152"],
    facebook: "https://www.facebook.com/share/1FN5DkgzXG/",
    instagram: "https://www.instagram.com/cataclub_tenis_de_mesa",
    hours: deriveContactHours(schedules),
  },
};
