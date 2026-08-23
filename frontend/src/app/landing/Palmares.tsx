"use client";

import { useState } from "react";
import Image from "next/image";
import { AlertTriangle, Medal as MedalIcon } from "lucide-react";
import {
  DEMO_PALMARES,
  isPalmaresRowComplete,
  MEDAL_LABELS,
  PALMARES,
  palmaresPhotoSrc,
  type PalmaresMedal,
  type PalmaresRow,
} from "./landing-palmares";

/**
 * Real, meaningful copy — not a quiet chip. This is a real text node in the
 * accessible tree (`role="alert"`), asserted on directly by the test suite,
 * because a screenshot with the demo toggle left on would show a real club
 * claiming medals, years, and competitions it never actually won.
 */
const DEMO_WARNING_TEXT =
  "Datos de ejemplo — resultados ficticios: el club NO ganó esto. Los años, medallas y torneos de abajo no ocurrieron; se muestran solo para revisar el diseño de la sección.";

interface PalmaresMedalBadgeProps {
  medal: PalmaresMedal;
}

/**
 * `part` (participación) deliberately gets no color and no medal icon — it
 * is not a medal, so giving it the same gold/silver/bronze treatment would
 * misrepresent it as one.
 */
function PalmaresMedalBadge({ medal }: PalmaresMedalBadgeProps): React.ReactElement {
  if (medal === "") {
    return <span className="landing-medal landing-medal-pending">medalla</span>;
  }
  if (medal === "part") {
    return <span className="landing-medal landing-medal-part">{MEDAL_LABELS.part}</span>;
  }
  return (
    <span className={`landing-medal landing-medal-${medal}`}>
      <MedalIcon aria-hidden="true" />
      {MEDAL_LABELS[medal]}
    </span>
  );
}

interface PalmaresRowItemProps {
  row: PalmaresRow;
}

/**
 * One documented (or pending) result. Any single empty field puts the whole
 * row in the `pending` state — reusing the app's existing dashed-border,
 * muted-ink idiom for "not filled in yet" (see `AttendanceRosterRow.tsx` /
 * `MarkAttendanceStep.tsx` / the enrollment wizard's empty state), restated
 * here in `landing.css`'s own token vocabulary since the landing page never
 * consumes the shared Tailwind design tokens for anything but `sr-only`.
 */
function PalmaresRowItem({ row }: PalmaresRowItemProps): React.ReactElement {
  const complete = isPalmaresRowComplete(row);
  return (
    <article className={`landing-palmares-row${complete ? "" : " pending"}`}>
      <span className="landing-palmares-photo">
        <Image src={palmaresPhotoSrc(row.photo)} alt="" width={240} height={160} loading="lazy" />
      </span>
      <span className="landing-palmares-body">
        <span className="landing-palmares-year">{row.year || "año"}</span>
        <b>{row.event || "competencia"}</b>
        <span className="landing-palmares-venue">{row.venue || "sede y categoría"}</span>
      </span>
      <PalmaresMedalBadge medal={row.medal} />
    </article>
  );
}

/**
 * Logros / Palmarés. A client component (state for the demo toggle) split
 * out of the server-rendered `LandingPage.tsx`, the same way `Gallery.tsx`
 * owns the carousel's lightbox state.
 *
 * The toggle defaults to OFF — an explicit product override of the approved
 * prototype, which defaulted it on behind a quiet chip. The prototype's demo
 * rows are entirely fabricated (medals, years, and competitions the club
 * never actually won), so shipping them by default would show a real club
 * claiming results it never won. Real, mostly-empty `PALMARES` data renders
 * first; switching the toggle on both swaps to `DEMO_PALMARES` AND raises
 * the warning banner above — the two are never independent.
 */
export default function Palmares(): React.ReactElement {
  const [demoOn, setDemoOn] = useState(false);
  const rows = demoOn ? DEMO_PALMARES : PALMARES;

  return (
    <section className="landing-section landing-wins" id="logros" data-motion-section data-testid="motion-section">
      <header className="landing-section-header" data-reveal>
        <span className="landing-eyebrow">El palmarés</span>
        <h2>Logros</h2>
        <p>El registro del club: año, puesto, competencia y sede. La foto es la prueba, no el titular.</p>
      </header>

      {/* Scoped to this section, next to its own header — NOT a page-wide
       * bar; only the toggle concept carries over from the prototype. */}
      <div className="landing-palmares-toggle">
        <label>
          <input
            type="checkbox"
            checked={demoOn}
            onChange={(event): void => setDemoOn(event.target.checked)}
          />
          Ver datos de ejemplo
        </label>
      </div>

      {demoOn ? (
        <p role="alert" className="landing-demo-warning">
          <AlertTriangle aria-hidden="true" />
          <b>{DEMO_WARNING_TEXT}</b>
        </p>
      ) : (
        <p className="landing-palmares-ask">
          <b>Para completar · pedido al club</b>
          <span>
            Sólo el Sudamericano está documentado en el repositorio, y sin año ni puesto. Cada fila necesita año,
            puesto, competencia y sede. Con eso, la sección se completa sola.
          </span>
        </p>
      )}

      <div className="landing-palmares">
        {rows.map((row, index): React.ReactElement => <PalmaresRowItem key={`${row.photo}-${index}`} row={row} />)}
      </div>
    </section>
  );
}
