/**
 * StatCard — 116px fixed, ink numbers, and a coal `hot` variant that carries
 * the ball dot rather than a second color.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StatCard, { STAT_GRID, StatSpark, StatTrack } from "@/components/ui/StatCard";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { committedHeight, committedRadius } from "./ui-test-utils";

function card(): HTMLElement {
  return screen.getByText("Miembros").parentElement as HTMLElement;
}

describe("StatCard — committed dimensions", () => {
  it("is exactly 116px tall", () => {
    render(<StatCard label="Miembros" value={86} />);
    expect(committedHeight(card())).toBe("116px");
  });

  it("stays 116px in the hot variant", () => {
    render(<StatCard label="Miembros" value={86} variant="hot" hint="14 pendientes" />);
    expect(committedHeight(card())).toBe("116px");
  });

  it("uses the 14px card radius", () => {
    render(<StatCard label="Miembros" value={86} />);
    expect(committedRadius(card())).toBe("14px");
  });
});

describe("StatCard — content", () => {
  it("renders label, value, unit and hint", () => {
    render(
      <StatCard label="Miembros" value={17} unit="de 44" hint="responsables de pago" />,
    );
    expect(screen.getByText("Miembros")).toBeInTheDocument();
    expect(screen.getByText("17")).toBeInTheDocument();
    expect(screen.getByText("de 44")).toBeInTheDocument();
    expect(screen.getByText("responsables de pago")).toBeInTheDocument();
  });

  it("omits the unit and hint when not supplied", () => {
    render(<StatCard label="Miembros" value={86} />);
    expect(card().querySelector("small")).toBeNull();
    expect(screen.queryByTestId("statcard-ball-dot")).not.toBeInTheDocument();
  });
});

describe("StatCard — the number is never a color", () => {
  it("renders the default value in ink", () => {
    render(<StatCard label="Miembros" value={86} />);
    expect(screen.getByText("86")).toHaveClass("text-ink");
  });

  it("renders the hot value in white on coal — the spec's own coal treatment", () => {
    // White on coal is `.hero .big`; a green or red figure would not be.
    render(<StatCard label="Miembros" value={86} variant="hot" />);
    expect(card()).toHaveClass("bg-coal");
    expect(screen.getByText("86")).toHaveClass("text-white");
  });

  it("never paints the figure with a state or brand color", () => {
    for (const variant of ["default", "hot"] as const) {
      const { unmount } = render(<StatCard label="Miembros" value={86} variant={variant} />);
      const className = screen.getByText("86").className;
      expect(className).not.toMatch(/text-(state-|cata-red|ball)/);
      unmount();
    }
  });
});

/**
 * DESIGN.md's `stat` step is Graduate at 32px "en cifras tabulares", and this
 * tile is the only place the product spends it. Case does not arise — digits
 * have one — so what the display family buys here is the collegiate scoreboard
 * figure the system was named for, and what it costs is the weight: Graduate
 * ships a single 400 cut (`lib/fonts.ts`), so the `font-extrabold` this tile
 * used to carry would have been a browser-synthesised bold over it.
 *
 * The `unit` beside it is Barlow on purpose: it is `text-sm` (13.5px), below
 * Graduate's 15px floor, and it is a word ("de 44") rather than a figure. It
 * gets there by DECLARING `font-sans`, not by omitting `font-display` — it
 * renders inside the figure's span, so omission left it in Graduate.
 */
describe("StatCard — the figure is the display face", () => {
  it("sets the number in the display family", () => {
    render(<StatCard label="Miembros" value={86} />);
    expect(screen.getByText("86")).toHaveClass("font-display");
  });

  it("keeps the figures tabular and asks for no weight the face lacks", () => {
    render(<StatCard label="Miembros" value={86} />);
    const figure = screen.getByText("86");
    expect(figure).toHaveClass("tabular-nums");
    expect(figure.className).not.toMatch(/\bfont-(semibold|bold|extrabold|black)\b/);
  });

  it("cancels the -0.04em its size step carries", () => {
    // `text-2xl`'s tracking is calibrated for Barlow. Graduate's digits are wide
    // and flat, and tightening them is what turns a scoreboard figure into a
    // block — so the tile takes the declared `tracking-flat` step.
    render(<StatCard label="Miembros" value={86} />);
    expect(screen.getByText("86")).toHaveClass("tracking-flat");
  });

  /**
   * This assertion used to read `not.toMatch(/font-display/)`, and it never
   * guaranteed the thing its name claimed.
   *
   * The unit renders INSIDE the figure's `font-display` span, so the face
   * arrives by inheritance and an absent class does not stop it. Measured in a
   * browser against the QA stack, "de 84" and "%" on `/dashboard` came out in
   * Graduate at 13.5px — under the 15px floor DESIGN.md's "regla de Graduate"
   * draws. The doc comment above this block asserted the opposite in prose for
   * as long as the test asserted it in a way that could not fail.
   *
   * Under inheritance, absence proves nothing: the reset has to be DECLARED.
   */
  it("declares the interface face on the trailing unit instead of inheriting Graduate", () => {
    render(<StatCard label="Miembros" value={17} unit="de 44" />);
    const unit = screen.getByText("de 44");
    expect(unit).toHaveClass("text-sm");
    expect(unit).toHaveClass("font-sans");
  });
});

describe("StatCard — hot variant dot", () => {
  it("carries the ball dot on its hint line", () => {
    render(
      <StatCard label="Miembros" value={14} variant="hot" hint="3 llevan más de una semana" />,
    );
    expect(screen.getByTestId("statcard-ball-dot")).toHaveClass("bg-ball");
  });

  it("does not show the dot on the default variant", () => {
    render(<StatCard label="Miembros" value={86} hint="en 44 cuentas" />);
    expect(screen.queryByTestId("statcard-ball-dot")).not.toBeInTheDocument();
  });
});

/**
 * D7's rule of shape: "la figura toma la forma de lo que mide: una proporción
 * lleva barra". `_sistema.css` `.track` (:319-320) is the bar the approved
 * system already declares, and `06-panel.html:86` is the tile that uses it —
 * label, figure, and the bar underneath, on the very stat this screen draws
 * ("Membresías activas 17 de 44").
 *
 * The bar is the whole point: a proportion drawn as a bare count makes the
 * reader do the division. It is the FIGURE that changes shape, not the data.
 */
describe("StatTrack — a proportion drawn as a proportion", () => {
  function track(): HTMLElement {
    return screen.getByTestId("stat-track");
  }

  function fill(): HTMLElement {
    return track().firstElementChild as HTMLElement;
  }

  it("fills the share the two figures actually measure", () => {
    // The screen's own numbers: 21 students with an active membership out of
    // the 69 the club has registered.
    render(<StatTrack value={21} total={69} />);
    expect(fill().style.width).toBe("30.4%");
  });

  it("draws an empty rail rather than dividing by zero", () => {
    render(<StatTrack value={0} total={0} />);
    expect(fill().style.width).toBe("0%");
  });

  it("never overflows its rail when the numerator exceeds the whole", () => {
    render(<StatTrack value={80} total={69} />);
    expect(fill().style.width).toBe("100%");
  });

  it("transcribes `.track`: a 6px `line` rail carrying a `coal` fill", () => {
    render(<StatTrack value={21} total={69} />);
    expect(track()).toHaveClass("h-1.5", "rounded-full", "bg-line", "overflow-hidden");
    expect(fill()).toHaveClass("rounded-full", "bg-coal");
  });

  it("stays out of the accessibility tree, because the tile already says the figures", () => {
    // A screen reader that announces both the count and a redundant meter
    // reads the same fact twice — the same reason `IdentityCell` hides its
    // initials.
    render(<StatTrack value={21} total={69} />);
    expect(track()).toHaveAttribute("aria-hidden", "true");
  });

  it("is phrasing content, so it can live inside the tile's own hint span", () => {
    // `StatCard` wraps `hint` in a `<span>`. A `<div>` in there is invalid
    // markup the parser silently repairs by breaking the tile apart.
    render(<StatTrack value={21} total={69} />);
    expect(track().tagName).toBe("SPAN");
    expect(fill().tagName).toBe("I");
  });

  it("rides in the hint slot without a colour of its own on the coal tile", () => {
    render(
      <StatCard label="Miembros" value={21} hint={<StatTrack value={21} total={69} />} />,
    );
    expect(screen.getByTestId("stat-track")).toBeInTheDocument();
    expect(committedHeight(card())).toBe("116px");
  });
});

describe("StatSpark — a series drawn as a series", () => {
  function spark(): HTMLElement {
    return screen.getByTestId("stat-spark");
  }

  function bars(): HTMLElement[] {
    return Array.from(spark().children) as HTMLElement[];
  }

  it("draws one bar per period, in the order it was handed", () => {
    render(<StatSpark values={[52, 61, 48, 70]} />);
    expect(bars()).toHaveLength(4);
  });

  it("scales every bar against the tallest, so the shape is the comparison", () => {
    // A series read against a fixed 100 ceiling flattens four attendance rates
    // that live between 48% and 70% into four near-identical bars — the figure
    // would be drawn and still say nothing. The tallest period is the rail.
    render(<StatSpark values={[35, 70]} />);
    expect(bars()[1].style.height).toBe("100%");
    expect(bars()[0].style.height).toBe("50%");
  });

  it("gives a zero period a visible stub rather than nothing at all", () => {
    // A missing bar and a bar of zero are different facts, and a series with a
    // gap in it reads as three periods instead of four.
    render(<StatSpark values={[0, 70]} />);
    expect(bars()[0].style.height).toBe("2px");
  });

  it("draws an empty rail rather than dividing by zero", () => {
    render(<StatSpark values={[0, 0, 0, 0]} />);
    for (const bar of bars()) expect(bar.style.height).toBe("2px");
  });

  it("marks the newest period in coal and the rest in the hairline", () => {
    // The last bar is the one the figure above it reports; the earlier ones
    // are context. Same two inks `StatTrack` spends, for the same reason.
    render(<StatSpark values={[52, 61, 48, 70]} />);
    expect(bars()[3]).toHaveClass("bg-coal");
    expect(bars()[0]).toHaveClass("bg-line-2");
  });

  it("stays out of the accessibility tree, because the tile already says the figure", () => {
    render(<StatSpark values={[52, 61, 48, 70]} />);
    expect(spark()).toHaveAttribute("aria-hidden", "true");
  });

  it("is phrasing content, so it can live inside the tile's own hint span", () => {
    render(<StatSpark values={[52, 61, 48, 70]} />);
    expect(spark().tagName).toBe("SPAN");
    expect(bars()[0].tagName).toBe("I");
  });

  it("renders nothing at all when there is no series to draw", () => {
    // "Don't inventar un dato para completar una forma": no periods means no
    // trend, and a rail with no bars is a shape pretending to hold one.
    const { container } = render(<StatSpark values={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("rides in the hint slot without changing the tile's height", () => {
    render(
      <StatCard label="Miembros" value={52} unit="%" hint={<StatSpark values={[52, 61, 48, 70]} />} />,
    );
    expect(screen.getByTestId("stat-spark")).toBeInTheDocument();
    expect(committedHeight(card())).toBe("116px");
  });
});

describe("STAT_GRID — the shared stat row", () => {
  it("spends the section step on its gutter, like `.stats` (_sistema.css:222)", () => {
    // `.stats` declares `gap: 14px`, which is exactly `gap-section`. Before
    // this constant the same four-tile row was `gap-4 mb-5` on /dashboard and
    // /attendance but `gap-3.5 mb-6` on /members — one component, two gutters,
    // so the tiles visibly moved when an admin walked between the screens.
    expect(STAT_GRID).toContain("gap-section");
  });

  it("carries no margin, because the page rhythm is the shell's", () => {
    expect(STAT_GRID).not.toMatch(/\bm[btyx]?-/);
  });

  it("is the four-up arrangement, collapsing to two and then one", () => {
    expect(STAT_GRID).toBe("grid gap-section sm:grid-cols-2 lg:grid-cols-4");
  });

  it("is the only spelling the four-tile screens use", () => {
    // The acceptance criterion, asserted on the sources: a screen that draws
    // the row must reference the constant, never retype the classes.
    // /admin/crear-cuenta draws the same four-column shape but its cells are
    // account-type buttons, not tiles. Same grid, different job — it keeps its
    // own classes on purpose.
    const screens = [
      "src/app/dashboard/page.tsx",
      "src/app/attendance/page.tsx",
      "src/app/members/page.tsx",
    ];

    for (const path of screens) {
      const code = readFileSync(join(__dirname, "..", "..", "..", "..", path), "utf8");
      expect(code, path).toContain("STAT_GRID");
      expect(code, path).not.toMatch(/sm:grid-cols-2 lg:grid-cols-4/);
    }
  });
});
