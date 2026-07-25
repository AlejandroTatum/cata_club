/**
 * AuthShell — the ONE template every public auth screen inherits.
 *
 * Transcribed from `docs/ux/prototipos/_sistema.css` (`.auth`, `.auth .left`,
 * `.auth .right`, `.authcard`, `.authnote`) and from the four prototypes that
 * use it: `01-login.html` (the plan's declared quality bar for the whole
 * redesign), `02-registro.html`, `03-recuperar-contrasenia.html` and
 * `04-restablecer-contrasenia.html`.
 *
 * Left panel — coal, composition CENTERED: the logo on a 104px white disc, the
 * club motto with "campeones" in ball yellow, the supporting line, and the
 * copyright pinned to the bottom. "← Volver al sitio" sits top-left.
 *
 * Right panel — the form in an elevated white card (18px radius, soft shadow).
 * The security/recovery note goes BELOW the card in small text (`.authnote`),
 * never inside it: it informs without competing with the form.
 *
 * ## The single figure is deliberately absent
 *
 * `01-login.html:45` shows one figure ("67 · Estudiantes inscritos"). It is NOT
 * rendered here, and that is a decision, not an omission by accident: the
 * backend exposes no endpoint an UNAUTHENTICATED visitor can call for a student
 * count. The only club-wide counts (`GET /dashboard/stats`,
 * `GET /membresias/estadisticas`) are both behind
 * `GestorPermisos(["ADMINISTRADOR"])`, so a public caller gets a 401 before any
 * handler runs. This component used to fill the gap from `src/mocks/*.ts` —
 * i.e. it showed invented numbers to every visitor of /login. A fabricated
 * figure is worse than no figure. The `.div` hairline that separated the copy
 * from that figure goes with it; a divider above nothing is noise.
 *
 * Re-add both the moment a public count endpoint exists — see the report note
 * accompanying this change.
 *
 * No client-only APIs are used here, so this stays server-safe.
 */

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

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
  return (
    <div className="auth-shell grid min-h-screen grid-cols-1 min-[860px]:grid-cols-2">
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

        {/* `.auth .left .copy` */}
        <p className="absolute bottom-5 m-0 text-[11px] text-white/35">
          © 2026 Cata Club — Tenis de Mesa
        </p>
      </div>

      {/* `.auth .right` */}
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
  );
}
