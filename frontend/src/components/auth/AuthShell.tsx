/**
 * AuthShell — the ONE template every public auth screen inherits
 * (/login, /forgot-password, /reset-password, /verificar-correo and
 * /login/activacion), in every state each of them renders.
 *
 * ## Composition (admin v4)
 *
 * Two panes, edge to edge, capped at `split:max-w-[120rem]` so ultra-wide
 * screens park the leftover width in gutters instead of inside a pane:
 *
 *   · Brand panel — coal, 5/12 of the width from `split` (980px) up. A club
 *     photo fills it edge to edge under a coal gradient, so the field has the
 *     club in it instead of empty coal, and the copy stays legible. Content is
 *     anchored top and bottom: the way back (top-left) and the original lockup
 *     (small crest + wordmark, top-right) on top, the motto, the club facts
 *     and the copyright at the foot.
 *   · Form panel — paper, the rest of the width. The form owns a 448px column
 *     (`max-w-md`) centred in the pane, with a real heading hierarchy
 *     (eyebrow, title, subtitle) and the secondary small print grouped under a
 *     hairline. There is no card floating on a grey canvas: the panel IS the
 *     surface.
 *
 * Phones stack, they do not hide: the coal panel collapses to a compact header
 * (way back, the lockup and the motto) above the form; the photo is split-only; the supporting line, the
 * facts and the copyright only exist from `split` up.
 *
 * ## The facts are public and verifiable
 *
 * No endpoint an unauthenticated visitor can call returns a student count, so
 * none is shown. The figures are the landing's own constants of record
 * (`FOUNDING_DATE`, `yearsSinceFounding()`) and the venue, the same ones
 * `buildLandingStats` publishes.
 *
 * The motto is the one use of Playfair on the screen (`DESIGN.md`: the club
 * speaking in first person) and carries no weight class: the 600 cut is the
 * only one loaded, and a CSS weight would synthesise a bold on top of it.
 *
 * No client-only APIs are used here, so this stays server-safe.
 */

import Image from "next/image";
import { BackLink } from "@/components/ui";
import {
  FOUNDING_DATE,
  landingConfig,
  toWhatsAppLink,
  yearsSinceFounding,
} from "@/app/landing/landing-config";

/**
 * `.input` (prototype line 82) — 40px, 10px radius, hairline border on paper,
 * 13px text. Shared by all four auth screens so the field height is a token,
 * not a per-screen guess.
 *
 * No focus ring is declared here. `globals.css` paints the system indicator
 * from a 0,3,0 selector, which outranks Tailwind's 0,2,0 `focus:*` utilities —
 * so the `focus:ring-[3px] focus:ring-cata-red/10` these fields used to carry
 * never rendered, and at 1.16:1 composited on paper it would have been
 * decoration rather than an indicator if it had. `focus:border-cata-red`
 * stays: that is the field reacting, a real 5.00:1 state change.
 */
export const AUTH_INPUT_CLASSES =
  "h-ctl w-full rounded-ctl border border-line-2 bg-paper px-[13px] text-sm text-ink " +
  "transition-colors placeholder:text-ink-3 focus:border-cata-red focus:outline-none " +
  "disabled:cursor-not-allowed disabled:opacity-50";

/** `.field label` (line 239) — 12.5px/600, 6px below the control. */
export const AUTH_LABEL_CLASSES = "mb-1.5 block text-xs font-semibold text-ink";

/**
 * The delay + spam-folder sentence shared by every auth screen that sends a
 * transactional email (#1295). `/login/activacion`'s email screen and
 * `/forgot-password`'s confirmation used to spell this out separately, each
 * with its own guess at how long the send actually takes — both sit behind
 * the same outbox, dispatched by the same Celery beat job and delivered
 * through the same Resend account, so it is one fact, not two copys.
 * "Unos 2 minutos" is measured off that queue, not a placeholder.
 */
export const EMAIL_DELAY_SPAM_NOTICE =
  "Puede tardar unos 2 minutos en llegar; si no lo ves, revisa la carpeta de correo no deseado.";

/**
 * The ONE link skin the four auth screens share.
 *
 * It lived in `login/page.tsx` as a file-local constant, which is why
 * `/reset-password` could write a second one — `font-semibold text-cata-red`,
 * no underline — and nothing noticed. Two screens inheriting one shell had two
 * answers for "what does a link look like here".
 *
 * `cata-red-dark`, not `cata-red`: the fill measures 4.10:1 on the canvas the
 * note below the card stands on, and 5.00:1 on the paper inside it, so it is
 * under AA exactly where the small print is. The dark cut reads 6.34:1 and
 * 7.74:1. The underline is what separates the colour's two jobs — the button
 * is pressed, these are followed.
 *
 * The hit area is deliberately NOT in here: WCAG 2.2 SC 2.5.8 exempts a link
 * inline in a sentence, and every use of this string so far is one. A link
 * that stands alone adds `min-h-[24px]` itself, the way `/login`'s recovery
 * link does.
 */
export const AUTH_LINK_CLASSES =
  "inline-flex items-center gap-1 text-xs font-semibold text-cata-red-dark " +
  "underline decoration-cata-red-dark/40 underline-offset-[3px] transition-colors " +
  "hover:decoration-cata-red-dark";

/**
 * The muted ink used on coal (`#A3A3AB`, lifted from #8B8B93 now that a photo sits behind it) and the brighter supporting line
 * (`#B9B9C1`). Both are prototype literals with no product token: the `ink-*`
 * ramp is defined for light surfaces only.
 */
const ON_COAL_MUTED = "text-[#A3A3AB]";
const ON_COAL_SUPPORT = "text-[#B9B9C1]";

/** The founding year, from the landing's constant of record. */
const FOUNDING_YEAR = String(FOUNDING_DATE.year);

export interface AuthShellProps {
  /** The form's own heading, e.g. "Bienvenido de nuevo". */
  title: string;
  /** Optional supporting line directly under the title. */
  subtitle?: string;
  /**
   * The small print grouped under the form: the security note on /login, the
   * "el enlace vencido" escape hatch on /reset-password.
   */
  note?: React.ReactNode;
  /**
   * Where the brand panel's exit goes — the step this screen was reached FROM,
   * not a fixed way out of the product (#295). Defaults to the public site,
   * which is where /login came from; /forgot-password and /reset-password pass
   * "/login". The label is derived from this href by `BackLink`
   * (`lib/destinations.ts`) and must not become a second prop.
   */
  backHref?: string;
  /**
   * Drops the corner exit entirely (#1045) — for /login/activacion, where the
   * person is already authenticated and the form carries its own "Cerrar
   * sesión". Defaults to `false`.
   */
  hideBack?: boolean;
  /**
   * The micro-label above the title (#1195). Defaults to "Panel de gestión",
   * which is wrong for visitor-facing screens such as /login/activacion;
   * those pass their own, e.g. "Acceso al club".
   */
  eyebrow?: string;
  /** The screen's form or state, rendered in the form column. */
  children: React.ReactNode;
}

/**
 * One figure of the facts row: a number over its caption. The term (caption)
 * comes first in the DOM, as `<dl>` wants; `flex-col-reverse` puts the number
 * on top.
 */
function Fact({
  value,
  caption,
  testId,
}: {
  value: string;
  caption: string;
  testId?: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col-reverse justify-end gap-1 border-l border-coal-3 pl-4 first:border-l-0 first:pl-0">
      <dt className={`text-xs ${ON_COAL_MUTED}`}>{caption}</dt>
      <dd data-testid={testId} className="text-2xl font-extrabold tabular-nums">
        {value}
      </dd>
    </div>
  );
}

export default function AuthShell({
  title,
  subtitle,
  note,
  backHref = "/",
  hideBack = false,
  eyebrow = "Panel de gestión",
  children,
}: AuthShellProps): React.ReactElement {
  const years = yearsSinceFounding();

  return (
    /*
     * The `auth-shell` class stays: `globals.css` keys the chrome-less layout
     * off `.app-main:has(.auth-shell)`.
     */
    <div
      data-testid="auth-composition"
      className="auth-shell mx-auto flex min-h-screen w-full flex-col bg-paper split:max-w-[120rem] split:flex-row"
    >
      {/*
       * Brand panel. `justify-between` anchors the banner to the top and the
       * copyright to the bottom; the banner itself spreads its three blocks the
       * same way, so nothing floats in the middle of dead coal.
       */}
      <div
        data-testid="auth-panel-dark"
        className="relative flex flex-col justify-between gap-4 overflow-hidden bg-coal px-6 py-5 text-left text-white split:w-5/12 split:shrink-0 split:gap-10 split:px-14 split:py-12"
      >
        {/*
         * The photo: a real club shot, full bleed behind everything, with a coal
         * gradient over it (light at the top where only the buttons sit, near
         * solid under the quote and facts) so the white and #B9B9C1 copy keeps
         * AA contrast. Decorative (`alt=""`), split-only and NOT `priority`:
         * on a phone it is `display:none`, and a lazy image there is never
         * fetched.
         */}
        <div
          data-testid="auth-photo"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 hidden split:block"
        >
          <Image
            src="/landing/gallery-12-team.jpg"
            alt=""
            fill
            sizes="(min-width: 980px) 42vw, 0px"
            quality={85}
            className="object-cover object-[50%_40%]"
          />
          <span className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(17,17,20,0.55)_0%,rgba(17,17,20,0.35)_22%,rgba(17,17,20,0.88)_58%,rgba(17,17,20,0.96)_100%)]" />
        </div>

        {/*
         * The banner landmark (#820): way back, lockup, motto and facts.
         * The way back is `BackLink`'s coal tone, the system's single back
         * control; it opens the top row on the left (QA registro) and sits in
         * the row's flow rather than pinned absolutely, so it can never overlap
         * the lockup on a narrow phone.
         */}
        <header
          aria-label="Marca de Cata Club"
          className="relative z-[1] flex flex-1 flex-col justify-between gap-4 split:gap-10"
        >
          <div className="flex items-center justify-between gap-4">
            {!hideBack ? (
              <BackLink
                href={backHref}
                tone="coal"
                className="ring-1 ring-inset ring-white/20"
              />
            ) : (
              <span aria-hidden="true" />
            )}
            {/* The original lockup, unchanged: small crest + wordmark. */}
            <div data-testid="auth-lockup" className="flex items-center gap-3">
              <span className="relative block h-10 w-10 shrink-0 overflow-hidden rounded-full border-2 border-white/[0.12] split:h-14 split:w-14 split:border-4">
                <Image
                  src="/brand/cata-club-logo.jpeg"
                  alt="Cata Club"
                  fill
                  sizes="56px"
                  className="object-cover"
                  priority
                />
              </span>
              <span className="whitespace-nowrap font-display text-lg uppercase tracking-flat">
                Cata Club
              </span>
            </div>
          </div>

          {/* The motto and its supporting line, anchored above the facts. */}
          <div
            data-testid="auth-brand-cluster"
            className="flex max-w-sm flex-col gap-4 split:mt-auto split:max-w-md split:gap-5"
          >
            {/* The ball, as the rule that opens the quote. */}
            <span
              aria-hidden="true"
              className="hidden h-1 w-12 rounded-full bg-ball split:block"
            />
            {/*
             * THE VOICE: the club talking in first person, the one Playfair use
             * on the screen. Kept as a <p>: the page's single <h1> is the form
             * title. The typographic double quotes are the 14-view prototype's
             * (guillemets were rejected by the product owner).
             */}
            <p
              data-testid="auth-headline"
              className="font-serif text-voice [text-wrap:balance]"
            >
              “Formando <em className="not-italic text-ball">campeones</em> para
              la vida”
            </p>
            <p className={`hidden text-base split:block ${ON_COAL_SUPPORT}`}>
              Cada entrenamiento es una oportunidad para superarse.
            </p>
          </div>

          {/* The facts row: three figures over a hairline, anchored at the foot. */}
          <dl className="hidden grid-cols-3 gap-4 border-t border-coal-3 pt-6 split:grid">
            <Fact
              value={String(years)}
              caption="años formando deportistas"
              testId="auth-figure"
            />
            <Fact value={FOUNDING_YEAR} caption="Desde el 10 de octubre" />
            <Fact value="Loja" caption="Junto al Coliseo Ciudad de Loja" />
          </dl>
        </header>

        <footer
          aria-label="Derechos de autor"
          className="relative z-[1] hidden split:grid"
        >
          <p className={`text-xs ${ON_COAL_MUTED}`}>
            © 2026 Cata Club — Tenis de Mesa
          </p>
        </footer>
      </div>

      {/*
       * The landmark is THIS panel, not the composition: the dark side is the
       * brand rail, and the errand someone came here for is the form. The form
       * column is centred in the pane and owns its own vertical rhythm.
       */}
      <main
        data-testid="auth-panel-light"
        className="flex flex-1 flex-col bg-paper px-6 py-6 text-ink split:px-16 split:py-12"
      >
        {/*
         * One column, one axis: the form and the help footer share the same 448px column (same max-width, same left edge).
         */}
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        {/* Centred in the column. From `split` it is nudged up by
            the bottom padding so the form sits in the upper-middle; on a phone
            the help footer anchors the foot, so the form centres in the room
            between the brand header and that footer instead of leaving the
            bottom third blank. */}
        <div className="flex flex-1 flex-col justify-center py-4 split:pb-24 split:py-0">
          <div
            data-testid="auth-card"
            className="mx-auto flex w-full max-w-md flex-col gap-6"
          >
            <div className="flex flex-col gap-2">
              {/*
               * The eyebrow is a quiet micro-label, not red: red MEANS "this is
               * the thing to press". `ink-3` measures 4.62:1 on paper.
               */}
              <p className="text-2xs font-bold uppercase tracking-caps-wide text-ink-3">
                {eyebrow}
              </p>
              {/*
               * Graduate (the club's display face), one 400 cut, so no weight
               * class. `xl` on phones, `2xl` from `split`; `balance` splits the
               * longer titles evenly.
               */}
              <h1 className="font-display text-xl uppercase leading-tight tracking-flat text-ink [text-wrap:balance] split:text-2xl">
                {title}
              </h1>
              {subtitle && <p className="text-base text-ink-3">{subtitle}</p>}
            </div>

            <div className="flex flex-col gap-4">{children}</div>

            {/* The small print, grouped under a hairline. `ink-3-strong` reads
              4.86:1 even on the darker canvas, so it clears AA on paper. */}
            {note && (
              <p
                data-testid="auth-note"
                className="border-t border-line pt-5 text-xs text-ink-3-strong"
              >
                {note}
              </p>
            )}
          </div>
        </div>

        {/* Bottom anchor: a human to ask when the access fails. */}
        <p
          data-testid="auth-help"
          className="mt-4 flex flex-wrap items-center gap-x-2 text-xs text-ink-3-strong"
        >
          ¿Problemas para ingresar?
          <a
            href={toWhatsAppLink(landingConfig.contact.whatsapp[0])}
            target="_blank"
            rel="noopener noreferrer"
            className={`${AUTH_LINK_CLASSES} touch-target-row`}
          >
            Escríbenos por WhatsApp
          </a>
        </p>
        </div>
      </main>
    </div>
  );
}
