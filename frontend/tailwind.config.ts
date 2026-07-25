import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
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
