/**
 * AuthShell — the ONE template every public auth screen inherits.
 *
 * ## Which prototype is the authority
 *
 * `docs/archive/prototypes/prototipo-rediseno.html` — the approved 14-view prototype, login
 * section at `<section class="stage" id="stage-login">`. `docs/archive/prototypes/prototipos/`
 * supersedes it for the ADMIN shell, but NOT for these four screens: the small
 * `prototipos/01-login.html` composition is a different, reduced design, and
 * building against it is what produced the broken screen this file replaces.
 * Every number below is transcribed from the 14-view file (CSS at its lines
 * 226-243, login instance overrides at 789-814, phone rules at 416-417).
 *
 * ## The composition FILLS THE VIEWPORT — this overrides the prototype
 *
 * The prototype bounds `.auth` at `min-height:660px` and centres it as an
 * artboard on a deeper page field. That is what shipped first, and the product
 * owner rejected it on sight: *"por qué el login no ocupa toda la pantalla"*.
 * A user decision beats a prototype measurement, so the composition is now
 * edge-to-edge — no max-width, no outer padding, no frame (border, radius,
 * elevation) around it, because a full-bleed split has no artboard to frame.
 *
 * Everything the prototype established that was NOT objected to survives: the
 * big headline (smaller on phones), the coal panel wider than the form panel,
 * the red eyebrow, the ringed logo, the inline figure row, the red links.
 *
 * The three sizes the prototype writes here — 42px and 30px for the headline,
 * 24px for the card title — have no step of their own in the type scale
 * (`docs/ux/escala-tipografica.md`), so each takes the nearest one: `display`
 * (46px) / `2xl` (32px) for the headline, `xl` (26px) for the title. The
 * headline keeps an explicit `leading-crisp`, because a step tight enough for
 * a one-line hero is too tight for a motto that wraps to three.
 *
 * The two panels are NOT equal halves: `.auth .dark { flex:1.1 }` against
 * `.auth .light { flex:1 }`. The coal panel is the wider one, because it
 * carries the headline that is the whole point of the screen. Rendering that
 * headline at half its size (21px) is what made the screen read as broken;
 * the prototype writes `font-size:42px; font-weight:800; letter-spacing:-1.5px;
 * line-height:1.12; max-width:15ch; text-wrap:balance`, dropping to 30px on
 * phones (line 417).
 *
 * ## Both halves are centred on ONE axis — the viewport's own middle
 *
 * The first full-viewport revision hung each half off its own leftover space,
 * and the product owner read the result as two unrelated compositions: *"el
 * login y la parte izquierda no están bien centradas, se ven desalineadas"*.
 * Measured at 1440x900 it was exactly that — the brand cluster centred at
 * y=414, the form card at y=398, neither on the page's 450 — with a 194px
 * hole between the subtitle and the closing hairline.
 *
 * Both panels now use the SAME three-row grid: `1fr / auto / 1fr`. The middle
 * row holds the one object that matters (brand cluster left, form card right)
 * and the two `1fr` rails are forced equal, so that object's centre lands on
 * the panel's exact vertical middle — 450 on both sides, whatever the edge
 * chrome weighs. `1fr` resolves to `minmax(auto, 1fr)`, so a rail that cannot
 * fit its own content stops flexing instead of clipping it: on a short
 * viewport the composition degrades to top-weighted rather than overflowing.
 *
 * Two moves pay for that on the coal side:
 *
 *   1. The figure row rejoins the centre cluster. It stays the same INLINE
 *      baseline row over a `--coal-3` hairline (`display:flex;
 *      align-items:baseline; gap:10px`) — a number and its caption on one
 *      line, never a stacked divider/number/caption — but as the cluster's
 *      closing tier it gives the centre real mass and deletes the hole.
 *   2. Only the copyright is left pinned to the floor, which makes the two
 *      rails near-identical in weight: a 20px link above, an 18px line below.
 *
 * A single soft radial behind the brand mark gives the dark field depth, so
 * the air around the logo reads as a lit stage rather than as unpainted space.
 * It is one authored moment, suppressed on phones where there is no air.
 *
 * ## Phones stack, they do not hide
 *
 * `@media (max-width:980px){ .auth{flex-direction:column} }` — the coal panel
 * moves ABOVE the form, it is not removed. (The other prototype hid it; this
 * one is the authority here.) So there is no separate compact brand block.
 *
 * That 980px is the `split` breakpoint of `tailwind.config.ts`, and this file
 * is the only one that reads it so far: `split:` is where the composition
 * stops being a stack and becomes two panes.
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
import { BackLink } from "@/components/ui";
import HelpChatLauncher from "@/components/chatbot/HelpChatLauncher";
import { yearsSinceFounding } from "@/app/landing/landing-config";

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
  /** The screen's form, rendered inside the elevated card. */
  children: React.ReactNode;
}

/** `.fcard` is `max-width:360px` — the single card width for all three screens. */
const CARD_WIDTH = "max-w-[360px]";

export default function AuthShell({
  title,
  subtitle,
  note,
  children,
}: AuthShellProps): React.ReactElement {
  const years = yearsSinceFounding();

  return (
    /*
     * The composition IS the page — full viewport, no artboard, no frame. The
     * `auth-shell` class stays: `globals.css` keys the chrome-less layout off
     * `.app-main:has(.auth-shell)`.
     */
    <div
      data-testid="auth-composition"
      className="auth-shell flex min-h-screen w-full flex-col bg-canvas split:flex-row"
    >
      {/*
       * `.auth .dark` — `flex:1.1`, i.e. WIDER than the form panel. Laid out
       * as `1fr / auto / 1fr`: the exit link hugs the top of an elastic rail,
       * the copyright hugs the bottom of an identical one, and the brand
       * cluster sits in the auto row between them — on the panel's exact
       * vertical middle, which is the same axis the form card uses.
       */}
      <div
        data-testid="auth-panel-dark"
        className="relative grid grid-rows-[1fr_auto_1fr] gap-8 overflow-hidden bg-coal px-6 py-8 text-center text-white split:flex-[1.1_1_0%] split:gap-10 split:px-14 split:py-12"
      >
        {/*
         * The lit stage. One soft radial centred on the brand mark so the dark
         * field has depth instead of being unpainted space. Phones have no air
         * to light, so it only exists from `split` up.
         *
         * Contrast, measured rather than assumed: the gradient fades out at 68%
         * of its 340px radius, i.e. ~231px from centre, and every muted line on
         * this panel sits outside that — the figure caption ~310px, the
         * copyright ~384px — so they keep `ON_COAL_MUTED`'s full 5.49:1 on bare
         * coal. `ON_COAL_SUPPORT`, which IS inside the lit area, measures
         * 7.85:1 there. Even the impossible case (muted text at the exact
         * centre, where the logo is) holds 4.53:1, so the effect cannot push
         * anything below AA.
         *
         * The exit link used to be on that list, ~475px away in `ON_COAL_MUTED`.
         * It is `BackLink`'s coal tone now — white on its own translucent fill,
         * 14.13:1 at rest — so it no longer depends on where the radial ends;
         * `lib/__tests__/color-contrast.test.ts` owns those numbers.
         */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 hidden h-[680px] w-[680px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.075),rgba(255,255,255,0)_68%)] split:block"
        />

        {/*
         * The way out, and it is the SYSTEM's back control now (D12b).
         *
         * It used to be a bare link — muted grey on coal, 24px tall, no box —
         * which made this the product's SECOND back control, in contradiction
         * of the very decision (#202) that gave the other one a visible border.
         * The reason was never a design intent: the light skin was unreadable
         * on coal, so this screen wrote its own. `BackLink`'s `coal` tone is
         * what removes the excuse, and with it the control comes up to the
         * system's 32px and stops naming its destination by hand — "Volver al
         * sitio" was a fifth name for a place the rail already calls "Inicio".
         *
         * `min-h-[24px]` retired with it: the control is 32px now, which clears
         * WCAG 2.2 SC 2.5.8's 24×24 target the old link only just reached
         * (measured 101.8 × 19.5 before the hit area was padded out).
         */}
        <BackLink href="/" tone="coal" className="relative z-[1] justify-self-start" />

        {/*
         * The centred cluster — `gap:22px`, and a measure that TRACKS THE
         * PANEL instead of freezing.
         *
         * RE-DERIVED for Playfair. The bounds below were calibrated against
         * Barlow ExtraBold at the 46px `display` step; the motto is Playfair
         * at the voice step now, and a face's measure does not survive being
         * handed to another face. Every number here was measured in Chromium
         * at 1440x900 against the shipped woff2, not estimated:
         *
         *   · 507px — the motto unbroken at the clamp's 31px ceiling. A
         *     measure at or above that collapses it to ONE line, which is the
         *     same cliff the old ceiling was written to avoid.
         *   · 326px — its natural first line, "“Formando campeones". Under
         *     that the motto breaks into three.
         *   · 350px — the supporting line below it, unbroken. It must not wrap.
         *
         * `clamp(22.5rem, 72%, 31rem)` is 360px…496px: 10px clear of the
         * supporting line at the floor, 11px clear of the one-line cliff at
         * the ceiling. The percentage still tracks the panel, so the measure
         * still grows with it. What changes is that the motto now sets on two
         * lines at EVERY viewport from `split` up — at 980px the panel gives
         * 360px against a 384px motto, at 1440 it gives 459px against 507px,
         * and from 1920 up the ceiling holds it at 496px — where the old
         * calibration drifted 3 lines → 2 → 1 across the same range.
         *
         * The prototype writes `max-width:44ch` (line 792) on this wrapper.
         * `ch` resolves against the element's OWN font-size, and this wrapper
         * declares none, so it inherited the 16px root and the cap computed to
         * a flat 440px at every viewport. The panel is `flex:1.1` of the
         * composition and does grow — measured 749px at 1440, 1000px at 1920,
         * 1336px at 2560 — so the brand block fell from 58.7% of it to 44.0%
         * to 32.9%. That is the empty dark field: not a missing element, a cap
         * that answers the same number whatever it is asked.
         *
         * `clamp(25rem, 72%, 44rem)` replaces it. The percentage is of the
         * panel's content box, so the measure grows with the panel; the two
         * bounds are the limits either side of which the composition breaks,
         * both measured in a browser at the `display` step:
         *
         *   25rem (400px) floor — the supporting line below the headline is
         *   389px of unbroken text. Under 400px it wraps to two lines, which
         *   is a regression at the `split` boundary, where 72% of the panel is
         *   only 289px.
         *
         *   44rem (704px) ceiling — the motto sets on 3 lines up to 480px, on
         *   2 from 490px, and collapses to 1 at 750px. A one-line motto is not
         *   the centred brand block this panel is built around, so the ceiling
         *   sits 46px clear of that cliff.
         *
         * Measured after the change: 61.3% of the panel at 1440, 63.9% at
         * 1920, 52.7% at 2560 — an 11-point spread where it used to be 26.
         *
         * Contrast is unchanged where it can be, and covered by the file's own
         * worst case where it moves. A 2-line motto makes the cluster SHORTER,
         * so from 1920 up the figure caption sits 168px off the panel centre
         * instead of 194px — both INSIDE the gradient's ~231px fade, so the
         * caption was already lit before this change and the radial only gets
         * marginally brighter under it. The bound that covers it is the one
         * measured above: muted ink at the exact centre, the brightest point
         * the gradient has, still holds 4.53:1. Every other muted line on this
         * panel is untouched — the exit link and the copyright are pinned to
         * the rails, 393px off centre, and neither moves.
         */}
        <div
          data-testid="auth-brand-cluster"
          className="relative z-[1] flex flex-col items-center justify-center gap-[22px] self-center justify-self-center max-w-[clamp(22.5rem,72%,31rem)]"
        >
          {/*
           * 104px, `border:4px solid rgba(255,255,255,.12)`. The 50%-black
           * drop shadow that shipped with it is gone: NEITHER prototype draws
           * one — `_sistema.css`'s `.auth .left .disc` (line 385) declares
           * only a size, and the 14-view file's `.authlogo` (line 247) only a
           * size and a border. What separates the disc from the coal field is
           * that white hairline, plus the radial behind it, and both are
           * specified. A shadow half the depth of pure black was not.
           */}
          <span className="relative block h-[104px] w-[104px] shrink-0 overflow-hidden rounded-full border-4 border-white/[0.12]">
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
           * THE VOICE, and this is the one line in the product that is it.
           *
           * "Formando campeones para la vida" is the club talking to the
           * person in first person, which is the single job `DESIGN.md` gives
           * Playfair: *"Playfair aparece una vez por pantalla, cuando el club
           * habla en primera persona."* It shipped in Barlow ExtraBold at the
           * 46px Graduate hero step — the interface face, shouting — and
           * `font-serif` had zero call sites anywhere under `src/`: a family
           * loaded on every route and spent on nothing. This is where it goes,
           * and per the rule of the voice, nowhere else on this screen.
           *
           * NO WEIGHT CLASS. `playfair-display-600.woff2` is a single 600 cut
           * declared with no `font-weight` descriptor (`lib/fonts.ts`), so a
           * CSS 600 or 800 here asks the browser to synthesise a bold on top
           * of a face that already is one, and it thickens the strokes into
           * mud at hero size. `StatCard` carries the same note for Graduate.
           *
           * ONE fluid step instead of two fixed ones: `text-voice` is
           * `clamp(20px, 2.4vw, 31px)`, so the phone size and the desktop size
           * are the same declaration and there is no breakpoint left for a
           * media query to outrank. That also retires the `leading-crisp`
           * repetition the old two-step version needed — the step carries its
           * own 1.3, which is the leading a line meant to be READ takes.
           *
           * `max-w-[16rem]` (256px) replaces the prototype's `15ch`, and only
           * on phones. Measured: at the clamp's 20px floor the motto is 328px
           * unbroken and its first line "“Formando campeones" is 210px, so
           * 256px sets it on two lines inside a 342px phone panel. `15ch`
           * against Playfair computes to ~150px, which would break it into
           * four. From `split` up the cap is cancelled and the measure is the
           * cluster's, exactly as before.
           *
           * The quotation marks are the typographic pair the 14-view
           * prototype uses (line 794). Guillemets shipped here by mistake,
           * copied from the reduced `prototipos/01-login.html`, and the
           * product owner rejected them outright: *"esos signos de mayor y
           * menor se ven muy mal"*. Kept as a <p>: the page's single <h1> is
           * the form title, and the motto is brand copy, not the heading of a
           * section a user navigates to.
           */}
          <p
            data-testid="auth-headline"
            className="my-5 max-w-[16rem] font-serif text-voice [text-wrap:balance] split:my-0 split:max-w-none"
          >
            “Formando <em className="not-italic text-ball">campeones</em> para la vida”
          </p>

          {/* The supporting line — 14.5px, `margin:-6px 0 0`. */}
          <p className={`-mt-1.5 text-base ${ON_COAL_SUPPORT}`}>
            Cada entrenamiento es una oportunidad para superarte.
          </p>

          {/*
           * The ONE figure — an inline baseline row over a `--coal-3`
           * hairline, not a stacked divider/number/caption. It closes the
           * cluster instead of floating at the panel's foot: the extra 12px
           * above the hairline marks it as the next tier down, and its mass
           * is what keeps the centred group from looking like it is falling
           * out of the top of the panel.
           */}
          <p className="mt-3 flex min-w-[240px] items-baseline justify-center gap-2.5 border-t border-coal-3 pt-[18px]">
            <b data-testid="auth-figure" className="text-xl font-extrabold tabular-nums">
              {years}
            </b>
            <small className={`text-xs ${ON_COAL_MUTED}`}>años formando deportistas</small>
          </p>
        </div>

        {/* `.copy` — the prototype says 12px; `xs` renders it at 12.5px, the
            nearest step. Alone at the foot so it weighs the same as the exit
            link above and the middle row stays on the page's axis. */}
        <p className={`relative z-[1] self-end text-xs ${ON_COAL_MUTED}`}>
          © 2026 Cata Club — Tenis de Mesa
        </p>
      </div>

      {/*
       * `.auth .light` — `flex:1`, and the SAME `1fr / auto / 1fr` grid as the
       * coal panel. Centring the whole column (card + small print) is what put
       * the card 52px above the page's middle while the brand cluster sat
       * elsewhere; centring the CARD and letting the small print hang into the
       * lower rail puts both halves on one axis. No row gap here: the card's
       * distance from its footnotes is the 16px margin below, not a grid gap.
       *
       * Only from `split` up, where this panel is a full-height column with an
       * axis to share. Below that the two panels are stacked and the page
       * scrolls anyway, so the same rails would just push the form further
       * under the fold — measured at 390x844, 144px of dead air above a card
       * that already starts below it. The phone keeps the plain centred
       * column. `row-start-*` is inert under `display:flex`, so the children
       * need no breakpoint of their own.
       */}
      {/*
       * The landmark is THIS panel, not the composition. The dark side is the
       * brand rail — a logo, a caption, a copyright and the way out — and the
       * errand someone came here for is the form on this one. Making the whole
       * two-panel composition "principal" would announce the decoration as
       * content. This route reaches the user through no other shell, so if this
       * element is not the landmark, the page has none.
       */}
      <main
        data-testid="auth-panel-light"
        className="flex flex-1 flex-col justify-center bg-canvas px-6 py-10 text-ink split:grid split:flex-1 split:grid-rows-[1fr_auto_1fr] split:px-14 split:py-12"
      >
        {/* `.fcard` — 360px, 18px radius, `padding:30px 28px`, `shadow-hero`:
            the elevation of a card that stands alone on the canvas with no
            page chrome around it. */}
        <div
          data-testid="auth-card"
          className={`row-start-2 mx-auto flex w-full flex-col gap-3.5 rounded-[18px] border border-line bg-paper px-7 py-[30px] shadow-hero ${CARD_WIDTH}`}
        >
          {/*
           * The eyebrow — 10px/700, `letter-spacing:2px`, uppercase, and no
           * longer red.
           *
           * This screen had six red elements and one of them was the action.
           * The rule of the single red is not a quota: red MEANS "this is the
           * thing to press", and when the eyebrow, both links, both error
           * lines and the submit button all wear it, nothing on the card says
           * which one that is. A 10.5px micro-label that orients and cannot be
           * pressed is the first one to give it up.
           *
           * `ink-3` measures 4.62:1 on paper — AA for this size — where the
           * red it replaces measures 4.10:1 and never did.
           */}
          <p className="text-2xs font-bold uppercase tracking-caps-wide text-ink-3">
            Panel de gestión
          </p>
          {/*
           * Graduate, and the same correction `PageHeader` already made one
           * screen over: `font-extrabold` is Barlow, Barlow is the interface
           * face, and this is the title of the card on the first screen anyone
           * sees. `text-lg` (20px) rather than the 26px it used to take —
           * measured, because uppercase Graduate runs ~35% wider than Barlow:
           * the card's content box is 236px and "BIENVENIDO DE NUEVO" sets
           * 241px at 20px (two balanced lines) against 297px at 26px (two
           * ragged ones). `[text-wrap:balance]` splits the longer titles the
           * other three auth screens pass — "Elija una contraseña nueva" is
           * 323px — evenly instead of leaving one word alone on line two.
           *
           * No weight class: one 400 cut, see the motto's note above.
           */}
          <h1 className="font-display text-lg uppercase leading-tight tracking-flat text-ink [text-wrap:balance]">
            {title}
          </h1>
          {subtitle && <p className="-mt-2 text-sm text-ink-3">{subtitle}</p>}
          {children}
        </div>

        {/*
         * The small print rides in the lower rail, hugging its top edge so it
         * still reads as belonging to the card 16px above it.
         */}
        <div className="row-start-3 self-start">
          {/* The note — outside the card, on purpose. `margin:16px auto 0`. */}
          {note && (
            /* `ink-3-strong`: the note sits OUTSIDE the card, directly on the
               `canvas` field, where `ink-3` measures 3.78:1. The companion
               token exists for exactly this case (see `tailwind.config.ts`)
               and reads 4.86:1 without promoting the small print to body ink. */
            <p
              className={`mx-auto mt-4 text-center text-2xs tracking-flat text-ink-3-strong ${CARD_WIDTH}`}
            >
              {note}
            </p>
          )}

          {/*
           * The assistant, reachable BEFORE signing in — it answers "¿cómo
           * inicio sesión?" and "¿cuáles son los horarios?" without an
           * account, and `POST /chatbot` is public. It lives in the small
           * print rather than as the floating button it used to be, which
           * covered this very form. One placement here covers /login,
           * /forgot-password and /reset-password, since all three inherit
           * this shell.
           */}
          {/*
           * A DIV, not a P. The launcher renders the panel as a sibling of
           * its own trigger, and a `<header>` inside a `<p>` is invalid HTML:
           * opening the assistant from any auth screen logged a React
           * hydration error and let the browser close the paragraph early.
           */}
          <div className={`mx-auto mt-3 text-center ${CARD_WIDTH}`}>
            <HelpChatLauncher variant="quiet" label="¿Necesita ayuda para entrar?" />
          </div>
        </div>
      </main>
    </div>
  );
}
