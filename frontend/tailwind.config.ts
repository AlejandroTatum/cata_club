import type { Config } from "tailwindcss";

/**
 * The resting shadow of the assistant launcher, named once because it is
 * written twice: `box-shadow` is a single property, so a control that keeps a
 * drop shadow while focused has to restate it inside the focus value or it
 * disappears the moment the ring appears.
 */
const FLOAT_SHADOW = "0 10px 28px rgba(19, 19, 22, 0.30)";

/**
 * The two-tone focus ring: a 2px white band hugging the control, then a 3px
 * coal band around it. Whatever the control and the page happen to be, one of
 * the two bands is high-contrast against its neighbour — the "adjacent
 * colours" test WCAG 1.4.11 / 2.4.11 apply. Measured in
 * `components/chatbot/chat-focus-ring.ts`.
 */
const FOCUS_DUO = "0 0 0 2px #FFFFFF, 0 0 0 5px #131316";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    // -----------------------------------------------------------------------
    // Tailwind's five stock breakpoints plus one, restated here rather than
    // extended, because `extend` appends and the ORDER of this object is the
    // order the media queries are emitted in. A `split:` rule declared after
    // `2xl:` would win over it at 1536px and up, which is the same class of
    // bug `min-[980px]:text-display` shipped in #50 — a rule landing later in
    // the file than the one it was meant to lose to. Listed in numeric order,
    // `split` sits where its width says it does.
    //
    // `split` (980px) is the width at which a composition stops being a stack
    // and becomes two panes side by side. It is not a device size: it is the
    // one breakpoint `prototipo-rediseno.html` declares (`@media (max-width:
    // 980px)`, line 408), and that block does exactly this — `.auth` drops to
    // `flex-direction:column`, `.cols`, `.duo` and `.quick` drop to a single
    // column, the sidebar collapses to its icon rail. `_sistema.css` spends
    // the same 980px on `.paysplit` (line 369). Today only `AuthShell` reads
    // it, and it reads it fifteen times.
    // -----------------------------------------------------------------------
    screens: {
      sm: "640px",
      md: "768px",
      /** Two panes side by side. Below this the composition is a stack. */
      split: "980px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1536px",
    },
    extend: {
      colors: {
        // -------------------------------------------------------------------
        // "La Paleta" design system — the brand values (coal, red, ball) and
        // the type/metric scale are transcribed from
        // `docs/archive/prototypes/prototipos/_sistema.css` (the approved, executable spec).
        // Do not tune those by eye; change the spec first.
        //
        // The SURFACE relationship (canvas / sunken / paper / line) is the one
        // part the spec got wrong in practice and that this file now owns —
        // see the block above `paper` for the measurements.
        // -------------------------------------------------------------------

        /** Black rubber. `--coal` / `--coal-2` / `--coal-3`. */
        coal: {
          DEFAULT: "#131316",
          "2": "#1C1C21",
          "3": "#26262C",
        },
        /**
         * The ball — attention accent. `ball-ink` is its text-weight companion,
         * the same job `cata.fuchsia-ink` does for the pink.
         *
         * `ink` shipped at #8A6D00, transcribed from `_sistema.css:26`, and it
         * failed WCAG AA (1.4.3) on BOTH surfaces it can reach: 3.48:1 printed
         * ON the yellow — the pair a companion ink exists for — and 4.03:1 on
         * the deepened `canvas`. It only ever measured well on `paper`
         * (4.92:1), which is how two failures sat unnoticed on the one token
         * whose entire job is being legible.
         *
         * #6E5700 is not a fresh pick. It is the `--ball-ink-strong` that
         * `_sistema.css` had already grown for exactly this reason — the
         * prototype sheet needed a darker yellow ink for its `.note .mine`
         * pill and invented one locally rather than moving the shared value.
         * That left the prototypes with better contrast than the product,
         * which is the drift `prototipos-sistema-tokens.test.ts` exists to
         * catch. Promoting it here retires the local token: same hue, ~20%
         * darker, 4.91:1 on `ball`, 5.69:1 on `canvas`, 6.94:1 on `paper`.
         *
         * The ball itself is NOT darkened to rescue the ink: `DEFAULT` is a
         * FILL whose luminance the focus ring depends on (it is the band that
         * carries the 3:1 against the coal rail), so moving it to fix a text
         * pair would break the indicator `color-contrast.test.ts` locks.
         */
        ball: {
          DEFAULT: "#FFD600",
          ink: "#6E5700",
        },
        /** Text ink ramp. `--ink` is the only color a stat number may ever be. */
        ink: {
          DEFAULT: "#17181C",
          "2": "#4A4A55",
          "3": "#74747F",
          /**
           * AA-safe companion to `ink-3` for muted text that sits on the
           * `canvas` grey or the `#FAFAFB` table-head fill — the page kicker,
           * the page subtitle, the table header. NOT a replacement for `ink-3`.
           *
           * `ink-3` measures 4.62:1 on `paper`, which passes; it only slips to
           * 3.78:1 once the surface underneath is the `canvas` grey (and 4.21:1
           * on `sunken`). Darkening the shared token to cover those two tints
           * would drag every muted 12–13px line in the product several stops
           * darker for no accessibility gain, so the shared token stays and
           * this one carries the small-bold usage.
           *
           * Deepening the canvas cost this token one step (#6B6B76 → #63636E):
           * on the new field #6B6B76 falls to 4.31:1. At #63636E it measures
           * 4.86:1 on `canvas`, 5.93:1 on `paper` and 5.40:1 on `sunken` —
           * the same margin it had before the surface rework.
           *
           * It lands on the same hex as `state-neutral` by construction: both
           * are "the lightest neutral grey that still clears AA on the page
           * field". They stay separate tokens because they answer to different
           * things — this one to the canvas, that one to its own tint.
           *
           * `ink-2` was the other candidate, but at 7.16:1 on `canvas` it reads
           * as body ink and collapses the eyebrow→title→subtitle hierarchy the
           * kicker exists to create.
           */
          "3-strong": "#63636E",
        },
        /**
         * Hairlines. `--line` draws the card edge AND the dividers inside it;
         * `--line-2` is the heavier border every interactive control wears.
         *
         * Both are one step darker than `_sistema.css` shipped them
         * (#E9E9EC / #D8D8DE). The old `line` measured 1.01:1 against the new
         * `canvas` — a card outline literally the same luminance as the page
         * it sat on. At #DEDEE6 the same hairline is 1.10:1 on `canvas` and
         * 1.34:1 on `paper`, so one value draws a real edge on both surfaces.
         * `line-2` goes from 1.42:1 to 1.55:1 on `paper`, which is what makes
         * an input read as a field rather than as a ghost.
         */
        line: {
          DEFAULT: "#DEDEE6",
          "2": "#CFCFDA",
        },
        // ---------------------------------------------------------------------
        // The three-surface ladder. Everything else in the product sits on one
        // of these, and the whole point is that they are TELLABLE APART.
        //
        //   canvas  #E8E8EE   L* 92.2   the page field
        //   sunken  #F4F4F7   L* 96.3   an inset area INSIDE paper
        //   paper   #FFFFFF   L* 100    the card
        //
        // `_sistema.css` put the canvas at #F5F5F7 (L* 96.6). A white card on
        // it measured 1.089:1 — a 3.4-point L* step, which is below the
        // threshold where a large field of flat colour reads as a separate
        // plane at all, so a screen of stacked cards looked like one washed
        // sheet with faint hairlines drawn on it. The canvas now sits 7.8 L*
        // points below the card (1.220:1, +50% relative separation) and the
        // shadow tokens carry a real offset, so a card is an object.
        //
        // #E8E8EE is not an arbitrary "a bit darker": it is the darkest canvas
        // that keeps every foreground token above WCAG AA on the page field.
        // The binding pair is `state-warn` at 4.59:1 (`state-ok` 4.62:1,
        // `ink-3-strong` 4.86:1); one more step to #E4E4EC drops warn/ok to
        // 4.43/4.46:1 and fails. Going darker therefore requires re-deriving
        // the state ramp first — do not nudge this value alone.
        // ---------------------------------------------------------------------
        /** Card/control surface. */
        paper: "#FFFFFF",
        /**
         * Inset fill INSIDE a card: table heads, pager strips, modal footers,
         * the resting hover of a white control. `_sistema.css` spelled this
         * #FAFAFB as a literal in three places; at 1.043:1 on `paper` it was
         * invisible, so it is now a named token at 1.10:1 — the same step the
         * card takes above the canvas, one rung up.
         */
        sunken: "#F4F4F7",
        /** App background behind the cards. */
        canvas: "#E8E8EE",

        // Status pairs (foreground + `-bg` fill). Namespaced under `state-` so
        // `neutral` does not shadow Tailwind's built-in neutral scale.
        //
        // ok/warn/bad are one notch darker than `_sistema.css` shipped them
        // (#157F3D / #B45309 / #D92128). Each foreground is defined to be read
        // ON its own `-bg` tint — that is the pair's entire purpose — and the
        // original three measured 4.49:1, 4.46:1 and 4.27:1 there, all under
        // AA's 4.5:1 for the 11.5px/700 badge label. Unlike `ink-3`, these had
        // no surface where the lighter value was the correct choice, so there
        // was nothing to preserve: the corrected values are strictly better
        // everywhere they appear (on `paper` 5.0 → 5.6-5.9, on `canvas`
        // 4.6 → 5.1-5.5). `_sistema.css` carries the same correction.
        state: {
          ok: "#137739",
          "ok-bg": "#E7F4EC",
          warn: "#A94D08",
          "warn-bg": "#FBF0E2",
          neutral: "#63636E",
          "neutral-bg": "#EFEFF2",
          bad: "#C51B22",
          "bad-bg": "#FBE9EA",
        },

        /**
         * Account-type accents — `/admin/crear-cuenta` only.
         *
         * The screen offers four kinds of account and gives each one a hue, so
         * the four cards read as a set of choices rather than a list. That is
         * the one place in the product where colour carries CATEGORY and not
         * status, which is why these cannot borrow `state`: `state-ok` green on
         * "Entrenador" would say the account is healthy, not that it coaches.
         *
         * Same shape as `state` — a foreground and the tint it sits on — and
         * the same rule: the pair is the token's purpose, so the pair clears AA
         * (`color-contrast.test.ts`), not the foreground on its own.
         *
         * The values are the ones the screen already shipped, kept so nothing
         * changes visually, except where they were under AA. `menor` used four
         * steps of one hue for four jobs; two of them measured 3.69:1 and
         * 2.64:1 (#139). The tint-borne text now takes this single value at
         * 6.51:1, and the "ID: n" suffix leaves the hue for `ink-3`, because it
         * is metadata and never carried category meaning.
         *
         * "Jugador" is absent on purpose: it already wears `cata-red`, the
         * system accent, at `/15`. Baking that composite into a hex here would
         * be a second copy of a colour the palette already owns.
         */
        cuenta: {
          representante: "#1D4ED8",
          "representante-bg": "#EFF6FF",
          menor: "#7E22CE",
          "menor-bg": "#FAF5FF",
          entrenador: "#047857",
          "entrenador-bg": "#ECFDF5",
        },

        // Level ramp — sequential greys, l1 is the TOP of the ladder and l10
        // the base. Carries no occupancy meaning; it is pure rank ordering.
        l1: "#131316",
        l2: "#26262C",
        l3: "#3A3A42",
        l4: "#4E4E58",
        l5: "#62626E",
        l6: "#7C7C88",
        l7: "#9A9AA4",
        l8: "#B8B8C0",
        l9: "#D3D3D9",
        // The base rung was #E9E9EC, which is 1.01:1 against the new `canvas`
        // — a level-10 chip dropped on the page field would have disappeared
        // outright. #DCDCE4 keeps the ramp monotonic (L* 88.0, between l9's
        // 84.7 and the canvas) and reads on both surfaces.
        l10: "#DCDCE4",

        cata: {
          /**
           * The CTA red is a FILL: white on #D92128 is 5.0:1 and it is the
           * colour of the primary button and of destructive intent.
           *
           * It is not a text colour on a light surface. As 12–14px type it
           * measures 5.00:1 on `paper` but only 4.10:1 on the deepened
           * `canvas` (it was 4.59:1 on the old near-white page, i.e. it was
           * always marginal). Red TEXT that sits on the page field belongs to
           * `state-bad` (#C51B22, 4.84:1 on canvas) — the palette already
           * carries a text-weight red, the same way `ball-ink` and
           * `fuchsia-ink` exist for the yellow and the pink.
           */
          red: "#D92128",
          "red-light": "#E55157",
          "red-dark": "#A11D22",
          yellow: "#FFD600",
          "yellow-soft": "#FFEF9E",
          amber: "#F4B41A",
          fuchsia: "#E5397D",
          // Text-weight companion to `fuchsia`. The brand pink is a 3.4:1
          // foreground on the `fuchsia/10` card tint it sits on, so it fails
          // WCAG AA (1.4.3) as body text — but it is a correct, passing choice
          // on the near-black header (`hover:text-cata-fuchsia` in Header.tsx),
          // so the shared token must NOT be darkened. Use this one whenever
          // fuchsia is the color of TEXT on a light surface.
          //
          // Deepening the canvas darkened the tint these cards composite to,
          // which took the /trainer subtitle (this ink at 90% on the
          // `fuchsia/15` hover tint) from 4.95:1 to 4.40:1 — under AA. #9E114F
          // restores it to 4.75:1 and lifts the resting title to 5.77:1.
          "fuchsia-ink": "#9E114F",
          black: "#111111",
          navy: "#0F0F1A",
          "navy-light": "#2A2A3E",
          cream: "#FAF8F6",
          warm: "#F5F3F0",
          stone: "#E5E1DC",
          charcoal: "#1E1E1E",
          gray: "rgba(255,255,255,0.45)",
          "gray-light": "#A09890",
          platinum: "#F0EFED",
          dark: "#0A0A12",
          "dark-elevated": "#141420",
          "dark-surface": "#1E1E2E",
          "text-primary": "#FFFFFF",
          "text-secondary": "rgba(255,255,255,0.65)",
          // The legacy aliases are re-pointed at the reworked surface ladder
          // rather than left on their Tailwind-grey values (#E5E7EB / #F9FAFB).
          // Components that still speak the old vocabulary (NotificationBell,
          // StudentSearch, NivelAsignacionPanel, ContextualHelp) then inherit
          // the new system without being touched.
          border: "#DEDEE6",
          "border-hover": "rgba(255,255,255,0.15)",
          bg: "#F4F4F7",
          surface: "#FFFFFF",
          text: "#1F2937",
          "state-ok": "#15803D",
        },
      },
      // ---------------------------------------------------------------------
      // Three families, three jobs. Declared in `lib/fonts.ts` and mounted as
      // CSS variables on `<html>` by the root layout, which is why each stack
      // starts with a `var()` and not with a family name: `next/font/local`
      // generates the real family name at build time, so the variable is the
      // only name that survives a rebuild.
      //
      // `sans` used to start with "Inter", loaded from `@fontsource/inter`.
      // That dependency is gone: it dressed every authenticated screen in a
      // face the brand does not own, while the three files the club actually
      // uses sat in `public/fonts/` being loaded by the landing alone.
      //
      // THE THREE RULES, and they are not stylistic preferences:
      //
      //   · `display` (Graduate) is DISPLAY, uppercase, and never smaller than
      //     15px. It is a collegiate face with no lowercase design intent and
      //     almost no vertical range, so it reads as texture rather than as
      //     words the moment it drops into a sentence. It never enters a
      //     paragraph — a Graduate <p> is a bug, not a bold choice.
      //   · `sans` (Barlow) carries ALL interface text: every label, cell,
      //     button, field, helper line and paragraph. If a screen has to ask
      //     which family a string takes, the answer is this one.
      //   · `serif` (Playfair) is the voice, and it is rationed: at most ONE
      //     phrase per screen — a pull quote, a motto, the single line meant to
      //     be read rather than scanned. A second one on the same screen means
      //     neither is emphasis any more.
      //
      // The tail of each stack is what the user actually sees while the woff2
      // is in flight (`display: "swap"`), so each one degrades to a face with
      // comparable proportions rather than to whatever the browser defaults to.
      // `sans` keeps exactly the fallback chain Inter shipped with.
      // ---------------------------------------------------------------------
      fontFamily: {
        sans: [
          "var(--font-barlow)",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        display: ["var(--font-graduate)", "serif"],
        serif: ["var(--font-playfair)", "Georgia", "serif"],
      },
      // ---------------------------------------------------------------------
      // The type scale. Eight steps, in Tailwind's tuple form
      // `[size, { lineHeight, letterSpacing }]`, so picking a step resolves
      // size + leading + tracking in one decision instead of three.
      //
      // The steps are the ones "La Paleta" already uses in practice: `xl` is
      // the 26px page title of `PageHeader`, `2xl` is the 32px stat number of
      // `StatCard`, `display` is the 46px login headline. They are transcribed
      // from the shipped components, not invented, so migrating an existing
      // `text-[26px]` onto `text-xl` moves nothing.
      //
      // Ratio between steps grows on purpose: 1.19 / 1.08 / 1.11 / 1.33 /
      // 1.30 / 1.23 / 1.44. The bottom of the scale is dense because 10-15px
      // is where labels, values and body text have to be TELLABLE APART at a
      // glance; the top is airy because a headline only competes with itself.
      //
      // Tracking follows size, as it must: at 46px a normal tracking reads as
      // a gap between letters, and at 10.5px a normal tracking reads as a
      // smudge. Hence -0.05em at the top and +0.12em at the bottom.
      //
      // NOTE — these six names (`xs`…`2xl`) REDEFINE Tailwind's stock steps,
      // so every existing `text-sm` resolves here from now on. The three that
      // moved visibly (`lg` +2px, `xl` +6px, `2xl` +8px) were repointed by
      // hand in the same commit that introduced this block; `xs`, `sm` and
      // `base` drift by at most 1px and were folded in as-is.
      //
      // Full rationale: `docs/ux/escala-tipografica.md`.
      // ---------------------------------------------------------------------
      fontSize: {
        /** Uppercase micro-label: table head, kicker, badge text. */
        "2xs": ["10.5px", { lineHeight: "1.4", letterSpacing: "0.12em" }],
        /** Secondary metadata: helper text, timestamps, chip text. */
        xs: ["12.5px", { lineHeight: "1.5", letterSpacing: "0em" }],
        /** Dense interface text: table cells, form labels, list rows. */
        sm: ["13.5px", { lineHeight: "1.5", letterSpacing: "-0.005em" }],
        /** Body copy and the default reading size of the product. */
        base: ["15px", { lineHeight: "1.45", letterSpacing: "-0.01em" }],
        /** Card title, dialog title, a name that leads a row. */
        lg: ["20px", { lineHeight: "1.2", letterSpacing: "-0.02em" }],
        /** Page title. The size `PageHeader` already ships. */
        xl: ["26px", { lineHeight: "1.15", letterSpacing: "-0.03em" }],
        /** Stat number. The size `StatCard` already ships. */
        "2xl": ["32px", { lineHeight: "1.05", letterSpacing: "-0.04em" }],
        /** Hero headline. Auth panel, landing, trainer "next session". */
        display: ["46px", { lineHeight: "0.95", letterSpacing: "-0.05em" }],
      },
      // Four tracking steps for the cases where a value has to CONTRADICT the
      // default its size step carries — an uppercase run at body size, or a
      // heading that must not inherit its step's tightening.
      //
      // The names are deliberately outside Tailwind's own vocabulary
      // (`tighter`/`tight`/`normal`/`wide`/`wider`/`widest`): `tracking-tight`
      // has 14 call sites and `tracking-wider` 8, none of them in scope here,
      // and redefining a key underneath them would move type nobody is
      // reviewing. Same rule applies to the `leading-*` steps below.
      letterSpacing: {
        /** Tighten at a size whose step does not tighten enough. */
        dense: "-0.02em",
        /** Cancel an inherited negative tracking (tabular data, code, IDs). */
        flat: "0em",
        /** Uppercase at small size. The `2xs` default, reusable elsewhere. */
        caps: "0.12em",
        /** Uppercase that has to read as a rule, not as a word. */
        "caps-wide": "0.2em",
      },
      // Three leading steps, same contract as the tracking ones: they exist to
      // override a step's default, not to replace it. `leading-relaxed` (47
      // call sites), `leading-tight` (7) and `leading-none` (7) keep their
      // stock values.
      lineHeight: {
        /** A headline that wraps and must stay one block. */
        crisp: "1.15",
        /** The `base` default, applied at another size. */
        body: "1.45",
        /** Long-form paragraph: help text, legal copy, empty-state prose. */
        prose: "1.55",
      },
      spacing: {
        "18": "4.5rem",
        "22": "5.5rem",
        "30": "7.5rem",
        "88": "22rem",
        // The vertical rhythm: three steps, one per job, each derived from a
        // metric the design already committed to rather than picked by eye.
        // Full argument in `docs/ux/ritmo-vertical.md`.
        //
        // These are NAMES, not a replacement for the numeric scale. Tailwind's
        // own steps stay: the rhythm is about the three jobs below, and a
        // one-off distance inside a component is not one of them.
        /** Between first-level blocks of a page. `.canvas` (:152). h-ctl / 2. */
        page: "20px",
        /** Between sibling cards, and between the parts of one. `.stats` (:222). = r-card. */
        section: "14px",
        /** Between a label and what it labels. `.note` (:104). r-card / 2. */
        field: "7px",
      },
      // Committed control metrics from `_sistema.css`. These are the reason
      // the UI primitives exist: a button is 40px because `h-ctl` is 40px,
      // not because a caller happened to pick `py-2.5`.
      //
      // `row` (60px) vs `drow` (56px) — which one, and when:
      //
      //   `row` is the LIST TABLE row: `.tbl tbody td`, one record per line in
      //   a paginated table you scan down. It is owned by `ui/Table`'s
      //   `TableCell` and that is the only place it should ever be written.
      //   A screen reaching for `h-row` directly is a screen rebuilding the
      //   table primitive, which is what this pass exists to stop.
      //
      //   `drow` is the DENSE row: the tighter line used inside a card that is
      //   not the page's main table — a roster inside an expanded panel, a
      //   student's own payment history, the rungs of the Niveles ladder. It is
      //   nearly always written as `min-h-drow`, because those rows wrap and
      //   the token is a floor rather than a fixed height.
      //
      // The test: is this the list the screen is FOR? Then it is a `ui/Table`
      // and the height comes with it. Is it a secondary list inside something
      // else? Then it is `min-h-drow`. A row height written as `py-*` is
      // neither, and is the drift both tokens exist to replace.
      height: {
        ctl: "40px",
        "ctl-sm": "32px",
        badge: "26px",
        row: "60px",
        thead: "44px",
        stat: "116px",
        drow: "56px",
      },
      minHeight: {
        ctl: "40px",
        "ctl-sm": "32px",
        badge: "26px",
        row: "60px",
        thead: "44px",
        stat: "116px",
        drow: "56px",
      },
      borderRadius: {
        card: "14px",
        ctl: "10px",
      },
      // Elevation. Every shadow is tinted with `coal` (19,19,22) instead of
      // pure black, so a card casts the same neutral the rest of the palette
      // is built from, and every one carries a real vertical offset — the
      // previous set was a near-symmetric 3-4% halo, which is decoration, not
      // depth. `card` is what the shared rule in `globals.css` gives every
      // paper surface at the card radius; `elevated` is reserved for things
      // that float over the page (modals, popovers, drag).
      //
      // The map holds TWO families, and they are not the same kind of thing.
      //
      // The ELEVATION LADDER (`soft` → `card` → `elevated` → `hero`) answers
      // "how far off the page is this". `float` is off the ladder on purpose:
      // it is the only entry whose object is DARK, and a 16% coal shadow under
      // a near-black disc is invisible, so depth there costs 30%.
      //
      // The INDICATOR RINGS (`selected`, `focus-*`) are not elevation at all.
      // They are drawn with `box-shadow` because an `outline` cannot be two
      // colours and a shadow follows the control's own `border-radius` for
      // free. They live here because `box-shadow` is one property and a
      // control cannot have two — so a ring and a resting shadow have to be
      // spelled as one value, which is exactly what `focus-duo-float` is.
      boxShadow: {
        soft: "0 1px 2px rgba(19, 19, 22, 0.04), 0 2px 8px -2px rgba(19, 19, 22, 0.05)",
        card: "0 1px 2px rgba(19, 19, 22, 0.06), 0 4px 10px -3px rgba(19, 19, 22, 0.08)",
        elevated:
          "0 2px 6px -1px rgba(19, 19, 22, 0.08), 0 14px 32px -8px rgba(19, 19, 22, 0.16)",
        /**
         * A card standing ALONE on the canvas with no page chrome around it —
         * the auth card and the `/unauthorized` card, the only two. Geometry
         * and alpha are `_sistema.css`'s own `.authcard` (line 394,
         * `0 8px 34px rgba(0,0,0,.07)`); only the tint moves, to the coal the
         * rest of this map is built from. It shipped as two hand-picked
         * values that straddled it — `0 12px 44px …/.07` and
         * `0 4px 24px …/.05` — one on each side of the value the prototype
         * actually declares.
         */
        hero: "0 8px 34px rgba(19, 19, 22, 0.07)",
        /** Resting shadow of the coal assistant launcher. */
        float: FLOAT_SHADOW,
        /**
         * The 1px coal ring that doubles a `border-coal` on a selected control
         * so the edge reads at 2px without the layout moving a pixel.
         * `_sistema.css` line 334, `.choice.on`.
         */
        selected: "0 0 0 1px #131316",
        /**
         * The coal companion band for the two controls that repaint the shared
         * `outline-ball` ring by hand, because `globals.css`'s `:is(…)` list
         * cannot reach them: a `[tabindex="-1"]` heading and a `<label>`. The
         * ball alone is 1.41:1 on paper; this band is 18.54:1 on paper and
         * 13.13:1 against the ball, and it is what carries the 3:1.
         * `focus-ring-usage.test.ts` requires one of these on every
         * `outline-ball`.
         */
        "focus-band": "0 0 0 4px #131316",
        /** The same band drawn inward, for a control that clips its overflow. */
        "focus-band-inset": "inset 0 0 0 4px #131316",
        /** Two-tone ring for a control that keeps no resting shadow. */
        "focus-duo": FOCUS_DUO,
        /** Two-tone ring for the launcher, which keeps its own while focused. */
        "focus-duo-float": `${FOCUS_DUO}, ${FLOAT_SHADOW}`,
      },
      maxWidth: {
        "8xl": "88rem",
      },
    },
  },
  plugins: [],
};

export default config;
