/**
 * AuthShell — the ONE template every public auth screen inherits.
 *
 * Transcribed from `docs/ux/prototipos/_sistema.css` (`.auth`, `.auth .left`,
 * `.auth .right`, `.authcard`, `.authnote`) and from the four prototypes that
 * use it: `01-login.html` (the plan's declared quality bar for the whole
 * redesign), `02-registro.html`, `03-recuperar-contrasenia.html` and
 * `04-restablecer-contrasenia.html`.
 *
 * ## The composition is BOUNDED, not full-height
 *
 * `.auth` is `min-height: 560px` (`_sistema.css:380`) inside the prototype's
 * `.app` frame (`:117` — 16px radius, hairline border, `0 18px 50px
 * rgba(0,0,0,.10)` elevation, `--canvas` behind it). It is a composition
 * centred in the page, NOT a full-viewport split.
 *
 * This used to be `min-h-screen`: at 1440x900 that stretched the coal panel to
 * 720x900 for a cluster only ~196px tall, i.e. ~326px of dead black above it
 * and ~342px below. Bounding it is the single biggest fix on this screen.
 *
 * Left panel — coal, composition CENTERED: the logo on a 104px white disc, the
 * club motto with "campeones" in ball yellow, the supporting line, the `.div`
 * hairline, ONE figure with its caption, and the copyright pinned to the
 * bottom. "← Volver al sitio" sits top-left.
 *
 * Right panel — the form in an elevated white card (18px radius, soft shadow).
 * The security/recovery note goes BELOW the card in small text (`.authnote`),
 * never inside it: it informs without competing with the form.
 *
 * ## The single figure is the club's age, not a student count
 *
 * `01-login.html:45` draws one figure ("67 · Estudiantes inscritos"). That
 * exact figure CANNOT be rendered: no endpoint an UNAUTHENTICATED visitor can
 * call returns a student count — the club-wide counts (`GET /dashboard/stats`,
 * `GET /membresias/estadisticas`) both sit behind
 * `GestorPermisos(["ADMINISTRADOR"])`, so a public caller gets a 401 before any
 * handler runs. This component once filled that gap from `src/mocks/*.ts`, i.e.
 * it showed an invented number to every visitor of /login.
 *
 * Dropping it altogether was the previous fix, and it left the composition
 * without its bottom third. The figure rendered here instead is
 * `yearsSinceFounding()` — derived from `FOUNDING_DATE`, the constant of record
 * the landing has published since its first release ("Fundado el 10 de
 * octubre"). It is public, verifiable, needs no backend, and cannot drift out
 * of date. Same slot, same type scale, an honest number.
 *
 * No client-only APIs are used here, so this stays server-safe.
 */

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { yearsSinceFounding } from "@/app/landing/landing-config";

/**
 * `.input` (`_sistema.css:185`) — 40px, 10px radius, `--line-2` border on
 * paper. Shared by all four auth screens so the field height is a token, not
 * a per-screen guess (the legacy `.input-field` in globals.css derives its
 * height from padding and lands off-system).
 */
export const AUTH_INPUT_CLASSES =
  "h-ctl w-full rounded-ctl border border-line-2 bg-paper px-[13px] text-[13.5px] text-ink " +
  "transition-colors placeholder:text-ink-3 focus:border-cata-red focus:outline-none " +
  "focus:ring-[3px] focus:ring-cata-red/10 disabled:cursor-not-allowed disabled:opacity-50";

/** `.field .k` — the 10.5px uppercase field label. */
export const AUTH_LABEL_CLASSES =
  "mb-1.5 block text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3";

export interface AuthShellProps {
  /** `.authcard h3` — the form's own heading, e.g. "Bienvenido de nuevo". */
  title: string;
  /** Optional supporting line directly under the title. */
  subtitle?: string;
  /**
   * `.authnote` — small print rendered BELOW the card: the security note on
   * /login, the "el enlace vencido" escape hatch on /reset-password.
   */
  note?: React.ReactNode;
  /**
   * Card width. `.authcard` is 356px and that is the default for all four
   * screens. `"wide"` exists for exactly one caller: `/register` still carries
   * the long multi-column field set. `02-registro.html` reduces it to three
   * fields (cédula, correo, contraseña), but that reduction is FASE 4 item 4
   * (the inscripción wizard), not this one — so the wide card is a temporary
   * accommodation, not a second layout to design against.
   */
  cardWidth?: "form" | "wide";
  /** The screen's form, rendered inside the elevated card. */
  children: React.ReactNode;
}

const CARD_WIDTH: Record<NonNullable<AuthShellProps["cardWidth"]>, string> = {
  form: "max-w-[356px]",
  wide: "max-w-[520px]",
};

export default function AuthShell({
  title,
  subtitle,
  note,
  cardWidth = "form",
  children,
}: AuthShellProps): React.ReactElement {
  const years = yearsSinceFounding();

  return (
    // The page behind the composition. `.auth .right` is `--canvas` (:392), so
    // the page cannot also be `--canvas` or the composition's right half
    // dissolves into it and only the coal panel reads as an object. The
    // prototype solves this the same way — `.app` sits on `--chrome-bg`
    // (#ECECEF), one step deeper than the canvas inside it — and `line`
    // (#E9E9EC) is the product token that already carries that value.
    //
    // Below 860px the frame (border/elevation/rounding) is dropped and the
    // page takes the canvas: with the coal panel hidden there, a box around a
    // single card is chrome around chrome.
    <div className="auth-shell flex min-h-screen items-center justify-center bg-canvas min-[860px]:bg-line min-[860px]:px-5 min-[860px]:py-10">
      {/* `.auth` (`_sistema.css:380`) inside `.app` (`:117`). */}
      <div
        data-testid="auth-composition"
        className="grid w-full grid-cols-1 self-stretch min-[860px]:min-h-[560px] min-[860px]:max-w-[1240px] min-[860px]:grid-cols-2 min-[860px]:self-center min-[860px]:overflow-hidden min-[860px]:rounded-2xl min-[860px]:border min-[860px]:border-line min-[860px]:shadow-[0_18px_50px_rgba(0,0,0,0.10)]"
      >
        {/*
         * `.auth .left` — hidden below 860px exactly as the prototype specifies.
         * The compact brand block further down replaces it there, so a phone
         * still shows which club it is signing in to.
         */}
        <div className="relative hidden flex-col items-center justify-center gap-[13px] bg-coal p-10 text-center text-white min-[860px]:flex">
          <Link
            href="/"
            className="absolute left-[22px] top-5 inline-flex items-center gap-1.5 text-[12.5px] text-white/60 transition-colors hover:text-white"
          >
            <ArrowLeft size={13} strokeWidth={2} aria-hidden="true" />
            Volver al sitio
          </Link>

          {/* `.auth .left .disc` — 104px white disc. */}
          <span className="relative block h-[104px] w-[104px] shrink-0 overflow-hidden rounded-full bg-white">
            <Image
              src="/brand/cata-club-logo.jpeg"
              alt="Cata Club"
              fill
              sizes="104px"
              className="object-cover"
              priority
            />
          </span>

          {/* `.auth .left .quote` — the landing's motto, "campeones" in ball. */}
          <p className="m-0 max-w-[15ch] text-[21px] font-extrabold leading-[1.25] tracking-[-0.025em]">
            «Formando <em className="not-italic text-ball">campeones</em> para la vida»
          </p>
          <p className="m-0 max-w-[30ch] text-[13px] text-white/60">
            Cada entrenamiento es una oportunidad para superarte.
          </p>

          {/* `.auth .left .div` — 54x1px hairline above the figure. */}
          <span aria-hidden="true" className="block h-px w-[54px] bg-white/[0.16]" />

          {/* `.auth .left .n` + `.k` — ONE figure and its caption. */}
          <span
            data-testid="auth-figure"
            className="text-[26px] font-extrabold leading-none tracking-[-0.04em]"
          >
            {years}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-[0.13em] text-white/[0.42]">
            Años formando deportistas
          </span>

          {/* `.auth .left .copy` */}
          <p className="absolute bottom-5 m-0 text-[11px] text-white/35">
            © 2026 Cata Club — Tenis de Mesa
          </p>
        </div>

        {/* `.auth .right` — `padding: 40px 34px`, `gap: 12px`. */}
        <div className="flex flex-col items-center justify-center gap-3 bg-canvas px-6 py-10 sm:px-[34px]">
          {/* Compact brand for the viewports where the coal panel is hidden. */}
          <div className="mb-2 flex flex-col items-center gap-2.5 min-[860px]:hidden">
            <span className="relative block h-16 w-16 shrink-0 overflow-hidden rounded-full bg-coal">
              <Image
                src="/brand/cata-club-logo.jpeg"
                alt="Cata Club"
                fill
                sizes="64px"
                className="object-cover"
                priority
              />
            </span>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-3 transition-colors hover:text-ink"
            >
              <ArrowLeft size={13} strokeWidth={2} aria-hidden="true" />
              Volver al sitio
            </Link>
          </div>

          {/* `.authcard` — 18px radius, soft elevation, 356px wide. */}
          <div
            className={`flex w-full flex-col gap-3.5 rounded-[18px] border border-line bg-paper p-6 shadow-[0_8px_34px_rgba(0,0,0,0.07)] ${CARD_WIDTH[cardWidth]}`}
          >
            <div>
              <h1 className="m-0 text-[20px] font-extrabold tracking-[-0.025em] text-ink">
                {title}
              </h1>
              {subtitle && <p className="mt-1 text-[13px] text-ink-3">{subtitle}</p>}
            </div>
            {children}
          </div>

          {/* `.authnote` — outside the card, on purpose. */}
          {note && (
            <p
              className={`text-center text-[11.5px] leading-relaxed text-ink-3 ${CARD_WIDTH[cardWidth]}`}
            >
              {note}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
