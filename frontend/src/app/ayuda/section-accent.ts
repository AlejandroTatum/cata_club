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
 * (`cuenta-entrenador`) accounts, and reuse `cata-red` at the same `/15` tint
 * that screen uses for its own red card — both are icon-only usages (3:1,
 * not the 4.5:1 body-text floor), matching how those tokens already ship.
 *
 * Keyed by section title rather than folded into `faq-content.ts`: that file
 * is the copy that is tested against the club's knowledge snapshot, and
 * this is presentation the content module has no reason to know about.
 */
export const SECTION_ACCENT: Record<string, { icon: LucideIcon; iconBg: string; iconFg: string }> = {
  "Para empezar": {
    icon: Rocket,
    iconBg: "bg-cata-yellow-soft",
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
    iconBg: "bg-cata-red/15",
    iconFg: "text-cata-red",
  },
};
