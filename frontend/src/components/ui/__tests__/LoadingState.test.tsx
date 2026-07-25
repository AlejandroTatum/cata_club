/**
 * LoadingState — the one "we are fetching this" block.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LoadingState from "../LoadingState";

describe("LoadingState", () => {
  it("exposes itself as a polite live region so the wait is announced", () => {
    render(<LoadingState label="Cargando miembros…" />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Cargando miembros…");
  });

  it("renders a real spinner — the three replaced treatments included one that had no indicator at all", () => {
    const { container } = render(<LoadingState label="Cargando…" />);
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("shares EmptyState's geometry so the slot does not resize as it resolves", () => {
    render(<LoadingState label="Cargando…" />);
    expect(screen.getByRole("status")).toHaveClass("px-6", "py-11");
  });
});
