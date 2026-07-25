/**
 * FilterPill — 40px, and its active state is coal + the yellow ball dot.
 * Never red: red belongs to the primary CTA and to destructive/error states.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FilterPill from "@/components/ui/FilterPill";
import { committedHeight } from "./ui-test-utils";

describe("FilterPill — committed dimensions", () => {
  it("is 40px tall, like every other control", () => {
    render(<FilterPill label="Todos" />);
    expect(committedHeight(screen.getByRole("button"))).toBe("40px");
  });

  it("stays 40px when active", () => {
    render(<FilterPill label="Todos" active />);
    expect(committedHeight(screen.getByRole("button"))).toBe("40px");
  });
});

describe("FilterPill — active state is coal + ball, never red", () => {
  it("fills with coal when active", () => {
    render(<FilterPill label="Pendientes" active />);
    expect(screen.getByRole("button")).toHaveClass("bg-coal", "border-coal");
  });

  it("shows the yellow ball dot when active", () => {
    render(<FilterPill label="Pendientes" active />);
    expect(screen.getByTestId("filterpill-ball-dot")).toHaveClass("bg-ball");
  });

  it("hides the dot when inactive", () => {
    render(<FilterPill label="Pendientes" />);
    expect(screen.queryByTestId("filterpill-ball-dot")).not.toBeInTheDocument();
  });

  it("never uses red for selection, in either state", () => {
    for (const active of [true, false]) {
      const { unmount } = render(<FilterPill label="Vencida" active={active} />);
      expect(screen.getByRole("button").className).not.toMatch(/red|state-bad/);
      unmount();
    }
  });

  it("sits on paper with a hairline border when inactive", () => {
    render(<FilterPill label="Vencida" />);
    expect(screen.getByRole("button")).toHaveClass("bg-paper", "border-line-2");
  });
});

describe("FilterPill — behavior", () => {
  it("exposes its selection through aria-pressed", () => {
    const { rerender } = render(<FilterPill label="Todos" />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
    rerender(<FilterPill label="Todos" active />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("renders an optional count", () => {
    render(<FilterPill label="Todos" count={44} />);
    expect(screen.getByText("44")).toBeInTheDocument();
  });

  it("renders a zero count rather than swallowing it", () => {
    // `count && ...` would hide a legitimate "0 pendientes".
    render(<FilterPill label="Pago pendiente" count={0} />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("fires onClick", () => {
    const onClick = vi.fn();
    render(<FilterPill label="Todos" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is a type=button so it cannot submit a surrounding filter form", () => {
    render(<FilterPill label="Todos" />);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });
});
