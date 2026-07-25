/**
 * StatCard — 116px fixed, ink numbers, and a coal `hot` variant that carries
 * the ball dot rather than a second color.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StatCard from "@/components/ui/StatCard";
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
