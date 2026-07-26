/**
 * ErrorState — the one "this did not load" block.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ErrorState from "../ErrorState";

describe("ErrorState", () => {
  it("announces itself as an alert", () => {
    render(<ErrorState message="Se cayó la red." />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("carries an honest default title when the caller has only a raw message", () => {
    render(<ErrorState message="500" />);
    expect(screen.getByText("No se pudo cargar la información")).toBeInTheDocument();
  });

  it("offers a retry that calls back — an error block is not a dead end", () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Falló" onRetry={onRetry} />);

    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders no button when there is genuinely nothing to re-run", () => {
    render(<ErrorState message="Falló" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("uses the shared bad state token rather than an ad-hoc red", () => {
    render(<ErrorState message="Falló" />);
    expect(screen.getByRole("alert")).toHaveClass("bg-state-bad-bg");
  });
});
