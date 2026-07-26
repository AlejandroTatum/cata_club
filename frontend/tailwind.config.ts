import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // -------------------------------------------------------------------
        // "La Paleta" design system — the brand values (coal, red, ball) and
        // the type/metric scale are transcribed from
        // `docs/ux/prototipos/_sistema.css` (the approved, executable spec).
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
        /** The ball — attention accent. `ball-ink` is its text-weight companion. */
        ball: {
          DEFAULT: "#FFD600",
          ink: "#8A6D00",
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
      fontFamily: {
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
      spacing: {
        "18": "4.5rem",
        "22": "5.5rem",
        "30": "7.5rem",
        "88": "22rem",
      },
      // Committed control metrics from `_sistema.css`. These are the reason
      // the UI primitives exist: a button is 40px because `h-ctl` is 40px,
      // not because a caller happened to pick `py-2.5`.
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
      boxShadow: {
        soft: "0 1px 2px rgba(19, 19, 22, 0.04), 0 2px 8px -2px rgba(19, 19, 22, 0.05)",
        card: "0 1px 2px rgba(19, 19, 22, 0.06), 0 4px 10px -3px rgba(19, 19, 22, 0.08)",
        elevated:
          "0 2px 6px -1px rgba(19, 19, 22, 0.08), 0 14px 32px -8px rgba(19, 19, 22, 0.16)",
      },
      maxWidth: {
        "8xl": "88rem",
      },
    },
  },
  plugins: [],
};

export default config;
