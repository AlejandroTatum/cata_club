/**
 * MemberCard — the membership carnet, for the profile screen.
 *
 * The product already has a coal carnet for the student home (`/student`,
 * `StudentCarnet`) — the club label small and spaced at the top, the yellow
 * ball as the accent, the name, and a fact rail at the foot. `MemberCard`
 * retakes that language rather than inventing a second one, with the two
 * changes design review asked for: no logo/avatar (the ball dot alone
 * carries the accent), and the name set in the display mono so identity
 * reads as an object on the page — a carnet, not a second `<h1>` — instead
 * of body type that could be mistaken for a heading.
 *
 * The footer (role, member-since) sits below its own hairline, the same
 * "identity above / facts below a rule" split the student carnet already
 * uses for its schedule facts.
 *
 * ## Name size — `text-lg`, not `text-display`
 *
 * This shipped with `font-mono text-display` (46px, the auth-headline step)
 * and was never tried against a real long name in a compact card — it was
 * built without a screen to apply it to. `/profile` puts this card beside a
 * 72px avatar, and a 46px mono name like "Jefferson Delgado Rivadeneira"
 * (29 characters, from the seeded fixtures) only leaves a handful of
 * characters visible before `truncate` clips the rest — the identity a
 * carnet exists to state becomes the LEAST legible thing on it.
 *
 * `text-lg` (20px) is the scale's own step for exactly this job — its own
 * comment in `tailwind.config.ts` names it "a name that leads a row" — so
 * this recalibrates onto a size the system already committed to rather than
 * picking a new one by eye. `truncate` stays as the guard for whatever a
 * narrow viewport still can't fit.
 */

import type { ReactElement } from "react";
import { cn } from "./cn";

export interface MemberCardProps {
  name: string;
  email: string;
  /** e.g. "Administradora", "Alumno". */
  role: string;
  /** A ready-to-print fact, e.g. "Socio desde ene 2023". */
  memberSince: string;
  className?: string;
}

export default function MemberCard({
  name,
  email,
  role,
  memberSince,
  className,
}: MemberCardProps): ReactElement {
  return (
    <section
      aria-label={`Carnet de socio de ${name}`}
      className={cn(
        "relative overflow-hidden rounded-card bg-coal px-6 py-[22px] text-white",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-[46px] -top-[46px] h-[150px] w-[150px] rounded-full bg-ball/[0.08]"
      />

      <div className="relative z-10 flex items-center gap-1.5">
        <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-ball" />
        <span className="text-2xs font-bold uppercase tracking-flat text-white/60">
          Cata Club
        </span>
      </div>

      <p className="relative z-10 mt-4 truncate font-mono text-lg font-semibold leading-none text-white">
        {name}
      </p>
      <p className="relative z-10 mt-2.5 text-sm text-white/60">{email}</p>

      <div className="relative z-10 mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-4 text-xs text-white/60">
        <span>{role}</span>
        <span>{memberSince}</span>
      </div>
    </section>
  );
}
