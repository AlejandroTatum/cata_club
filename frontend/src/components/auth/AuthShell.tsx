/**
 * AuthShell — the ONE template every public auth screen inherits.
 *
 * ## Which prototype is the authority
 *
 * `docs/ux/prototipo-rediseno.html` — the approved 14-view prototype, login
 * section at `<section class="stage" id="stage-login">`. `docs/ux/prototipos/`
 * supersedes it for the ADMIN shell, but NOT for these four screens: the small
 * `prototipos/01-login.html` composition is a different, reduced design, and
 * building against it is what produced the broken screen this file replaces.
 * Every number below is transcribed from the 14-view file (CSS at its lines
 * 226-243, login instance overrides at 789-814, phone rules at 416-417).
 *
 * ## The composition
 *
 * `.auth { display:flex; min-height:640px }`, and the login instance raises it
 * to `min-height:660px` — a bounded block centred in the page, never a
 * full-viewport split.
 *
 * The two panels are NOT equal halves: `.auth .dark { flex:1.1 }` against
 * `.auth .light { flex:1 }`. The coal panel is the wider one, because it
 * carries the 42px headline that is the whole point of the screen. Rendering
 * that headline at half its size (21px) is what made the screen read as
 * broken; it is `font-size:42px; font-weight:800; letter-spacing:-1.5px;
 * line-height:1.12; max-width:15ch; text-wrap:balance`, dropping to 30px on
 * phones (line 417).
 *
 * The dark panel is `justify-content:space-between`: exit link pinned top,
 * brand cluster centred, copyright pinned bottom. The figure under the
 * subtitle is an INLINE row (`display:flex; align-items:baseline; gap:10px`)
 * over a `--coal-3` hairline — a number and its caption on one line, not a
 * stacked divider/number/caption.
 *
 * ## Phones stack, they do not hide
 *
 * `@media (max-width:980px){ .auth{flex-direction:column} }` — the coal panel
 * moves ABOVE the form, it is not removed. (The other prototype hid it; this
 * one is the authority here.) So there is no separate compact brand block.
 *
 * ## The single figure is the club's age, not a student count
 *
 * The prototype draws "67 estudiantes inscritos". That exact figure CANNOT be
 * rendered honestly: no endpoint an UNAUTHENTICATED visitor can call returns a
 * student count — `GET /dashboard/stats` and `GET /membresias/estadisticas`
 * both sit behind `GestorPermisos(["ADMINISTRADOR"])`, so a public caller gets
 * a 401 before any handler runs. An earlier revision filled the slot from
 * `src/mocks/*.ts`, i.e. it showed an invented number to every visitor.
 *
 * What is rendered instead is `yearsSinceFounding()`, derived from
 * `FOUNDING_DATE` — the constant of record the landing has published since its
 * first release ("Fundado el 10 de octubre"). Public, verifiable, no backend,
 * cannot drift. Same slot, same inline `<b>` + `<small>` shape, honest number.
 *
 * No client-only APIs are used here, so this stays server-safe.
 */

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { yearsSinceFounding } from "@/app/landing/landing-config";

/**
 * `.input` (prototype line 82) — 40px, 10px radius, hairline border on paper,
 * 13px text. Shared by all four auth screens so the field height is a token,
 * not a per-screen guess.
 */
export const AUTH_INPUT_CLASSES =
  "h-ctl w-full rounded-ctl border border-line-2 bg-paper px-[13px] text-[13.5px] text-ink " +
  "transition-colors placeholder:text-ink-3 focus:border-cata-red focus:outline-none " +
  "focus:ring-[3px] focus:ring-cata-red/10 disabled:cursor-not-allowed disabled:opacity-50";

/** `.field label` (line 239) — 12.5px/600, 6px below the control. */
export const AUTH_LABEL_CLASSES = "mb-1.5 block text-[12.5px] font-semibold text-ink";

/**
 * The muted ink used on coal (`#8B8B93`) and the brighter supporting line
 * (`#B9B9C1`). Both are prototype literals with no product token: the `ink-*`
 * ramp is defined for light surfaces only.
 */
const ON_COAL_MUTED = "text-[#8B8B93]";
const ON_COAL_SUPPORT = "text-[#B9B9C1]";

export interface AuthShellProps {
  /** `.fcard h2` — the form's own heading, e.g. "Bienvenido de nuevo". */
  title: string;
  /** `.fcard .sub` — optional supporting line directly under the title. */
  subtitle?: string;
  /**
   * The small print rendered BELOW the card (line 814): the security note on
   * /login, the "el enlace vencido" escape hatch on /reset-password.
   */
  note?: React.ReactNode;
  /**
   * Card width. `.fcard` is `max-width:360px` and that is the default for all
   * four screens. `"wide"` exists for exactly one caller: `/register` still
   * carries the long multi-column field set. The prototype reduces that form
   * to three fields, but that reduction is the inscripción wizard's work, not
   * this one — so the wide card is a temporary accommodation, not a second
   * layout to design against.
   */
  cardWidth?: "form" | "wide";
  /** The screen's form, rendered inside the elevated card. */
  children: React.ReactNode;
}

const CARD_WIDTH: Record<NonNullable<AuthShellProps["cardWidth"]>, string> = {
  form: "max-w-[360px]",
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
    /*
     * The page behind the composition. `.auth .light` is `--bg` (the canvas),
     * so the page cannot also be the canvas or the composition's right half
     * dissolves into it and only the coal panel reads as an object. The
     * prototype solves this the same way — the artboard sits on `--chrome-bg`,
     * one step deeper than the `--bg` inside it — and `line` is the product
     * token that already carries that value.
     *
     * Below 980px the composition IS the page: the panels stack full-bleed, so
     * the frame (border, elevation, rounding, backdrop) is dropped.
     */
    <div className="auth-shell bg-canvas min-[980px]:flex min-[980px]:min-h-screen min-[980px]:items-center min-[980px]:justify-center min-[980px]:bg-line min-[980px]:px-5 min-[980px]:py-10">
      {/* `.auth` — `min-height:660px` on the login instance (line 789). */}
      <div
        data-testid="auth-composition"
        className="flex min-h-screen w-full flex-col min-[980px]:min-h-[660px] min-[980px]:max-w-[1240px] min-[980px]:flex-row min-[980px]:overflow-hidden min-[980px]:rounded-[18px] min-[980px]:border min-[980px]:border-line min-[980px]:shadow-[0_18px_50px_rgba(0,0,0,0.10)]"
      >
        {/*
         * `.auth .dark` — `flex:1.1`, i.e. WIDER than the form panel, and
         * `justify-content:space-between` so the exit link and the copyright
         * pin to the edges while the cluster holds the centre.
         */}
        <div
          data-testid="auth-panel-dark"
          className="flex flex-col items-center justify-between gap-6 bg-coal px-6 py-8 text-center text-white min-[980px]:flex-[1.1_1_0%] min-[980px]:px-12 min-[980px]:py-9"
        >
          <Link
            href="/"
            className={`inline-flex items-center gap-1.5 self-start text-[13px] transition-colors hover:text-white ${ON_COAL_MUTED}`}
          >
            <ArrowLeft size={14} strokeWidth={2} aria-hidden="true" />
            Volver al sitio
          </Link>

          {/* The centred cluster — `gap:22px`, `max-width:44ch` (line 792). */}
          <div className="flex max-w-[44ch] flex-col items-center gap-[22px]">
            {/* 104px, `border:4px solid rgba(255,255,255,.12)` + drop shadow. */}
            <span className="relative block h-[104px] w-[104px] shrink-0 overflow-hidden rounded-full border-4 border-white/[0.12] shadow-[0_12px_40px_rgba(0,0,0,0.5)]">
              <Image
                src="/brand/cata-club-logo.jpeg"
                alt="Cata Club"
                fill
                sizes="104px"
                className="object-cover"
                priority
              />
            </span>

            {/*
             * `.headline` — 42px/800/-1.5px, 30px on phones. Kept as a <p>:
             * the page's single <h1> is the form title, and the motto is
             * brand copy, not the heading of a section a user navigates to.
             */}
            <p
              data-testid="auth-headline"
              className="my-5 max-w-[15ch] text-[30px] font-extrabold leading-[1.12] tracking-[-1.5px] [text-wrap:balance] min-[980px]:my-0 min-[980px]:text-[42px]"
            >
              «Formando <em className="not-italic text-ball">campeones</em> para la vida»
            </p>

            {/* The supporting line — 14.5px, `margin:-6px 0 0`. */}
            <p className={`-mt-1.5 text-[14.5px] ${ON_COAL_SUPPORT}`}>
              Cada entrenamiento es una oportunidad para superarte.
            </p>

            {/*
             * The ONE figure — an inline baseline row over a `--coal-3`
             * hairline, not a stacked divider/number/caption.
             */}
            <p className="mt-1 flex items-baseline gap-2.5 border-t border-coal-3 pt-[18px]">
              <b
                data-testid="auth-figure"
                className="text-[26px] font-extrabold tabular-nums"
              >
                {years}
              </b>
              <small className={`text-[12.5px] ${ON_COAL_MUTED}`}>
                años formando deportistas
              </small>
            </p>
          </div>

          {/* `.copy` — 12px, pinned to the bottom of the panel. */}
          <p className={`text-[12px] ${ON_COAL_MUTED}`}>© 2026 Cata Club — Tenis de Mesa</p>
        </div>

        {/* `.auth .light` — `flex:1`, `padding:36px 48px`, contents centred. */}
        <div className="flex flex-1 flex-col justify-center bg-canvas px-6 py-8 text-ink min-[980px]:flex-1 min-[980px]:px-12 min-[980px]:py-9">
          {/* `.fcard` — 360px, 18px radius, `padding:30px 28px`, elevated. */}
          <div
            className={`mx-auto flex w-full flex-col gap-3.5 rounded-[18px] border border-line bg-paper px-7 py-[30px] shadow-[0_12px_44px_rgba(0,0,0,0.07)] ${CARD_WIDTH[cardWidth]}`}
          >
            {/* The red eyebrow — 10px/700, `letter-spacing:2px`, uppercase. */}
            <p className="text-[10px] font-bold uppercase tracking-[2px] text-cata-red">
              Panel de gestión
            </p>
            <h1 className="text-[24px] font-extrabold tracking-[-0.5px] text-ink">{title}</h1>
            {subtitle && <p className="-mt-2 text-[13.5px] text-ink-3">{subtitle}</p>}
            {children}
          </div>

          {/* The note — outside the card, on purpose. `margin:16px auto 0`. */}
          {note && (
            <p
              className={`mx-auto mt-4 text-center text-[11.5px] leading-[1.5] text-ink-3 ${CARD_WIDTH[cardWidth]}`}
            >
              {note}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
