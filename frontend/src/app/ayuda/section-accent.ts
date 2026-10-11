import { Dumbbell, Rocket, ShieldCheck, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The audience color system #203 asks for — one hue per "who this section is
 * for", so the grid reads as a set of audiences rather than a wall of
 * identical cards. Every value here is a named token from
 * `tailwind.config.ts`, never a literal hex: `color-contrast.test.ts` only
 * proves tokens are AA-safe, and `no screen paints with Tailwind's default
 * palette` only allows names it already knows.
 *
 * The icon/text pairs mirror the ones `/admin/crear-cuenta` already ships for
 * the same "estudiante" (`cuenta-representante`) and "entrenador"
 * (`cuenta-entrenador`) accounts. The yellow and red chips are themed PAIRS
 * (`chip-*`): fill and ink change together, so the icon holds 3:1 (WCAG 1.4.11,
 * not the 4.5:1 body-text floor) in light and in dark. A brand-constant fill
 * under a themed ink is what put a light icon on a pale chip in dark.
 *
 * Keyed by section title rather than folded into `faq-content.ts`: that file
 * is the copy that is tested against the club's knowledge snapshot, and
 * this is presentation the content module has no reason to know about.
 */
export const SECTION_ACCENT: Record<string, { icon: LucideIcon; iconBg: string; iconFg: string }> = {
  "Para empezar": {
    icon: Rocket,
    iconBg: "bg-chip-ball",
    iconFg: "text-ball-ink",
  },
  "Si eres jugador o representante": {
    icon: Users,
    iconBg: "bg-cuenta-representante-bg",
    iconFg: "text-cuenta-representante",
  },
  "Si eres entrenador": {
    icon: Dumbbell,
    iconBg: "bg-cuenta-entrenador-bg",
    iconFg: "text-cuenta-entrenador",
  },
  "Si eres administrador": {
    icon: ShieldCheck,
    iconBg: "bg-chip-red",
    iconFg: "text-chip-red-ink",
  },
};
