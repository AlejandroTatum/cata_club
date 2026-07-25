import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // -------------------------------------------------------------------
        // "La Paleta" design system — every value below is transcribed from
        // `docs/ux/prototipos/_sistema.css` (the approved, executable spec).
        // Do not tune these by eye; change the spec first.
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
        },
        /** Hairlines. `--line` for dividers, `--line-2` for control borders. */
        line: {
          DEFAULT: "#E9E9EC",
          "2": "#D8D8DE",
        },
        /** Card/control surface. */
        paper: "#FFFFFF",
        /** App background behind the cards. */
        canvas: "#F5F5F7",

        // Status pairs (foreground + `-bg` fill). Namespaced under `state-` so
        // `neutral` does not shadow Tailwind's built-in neutral scale.
        state: {
          ok: "#157F3D",
          "ok-bg": "#E7F4EC",
          warn: "#B45309",
          "warn-bg": "#FBF0E2",
          neutral: "#63636E",
          "neutral-bg": "#EFEFF2",
          bad: "#D92128",
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
        l10: "#E9E9EC",

        cata: {
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
          "fuchsia-ink": "#A81257",
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
          border: "#E5E7EB",
          "border-hover": "rgba(255,255,255,0.15)",
          bg: "#F9FAFB",
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
      boxShadow: {
        soft: "0 2px 16px rgba(0, 0, 0, 0.04)",
        card: "0 1px 4px rgba(0, 0, 0, 0.04), 0 2px 12px rgba(0, 0, 0, 0.03)",
        elevated: "0 4px 24px rgba(0, 0, 0, 0.06), 0 1px 4px rgba(0, 0, 0, 0.04)",
      },
      maxWidth: {
        "8xl": "88rem",
      },
    },
  },
  plugins: [],
};

export default config;
