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

  /**
   * jsdom computes no styles, so this pins the declared `bg-state-bad-bg`
   * token, not the color it resolves to. No Playwright spec covers
   * ErrorState's rendered color today — there is no live counterpart to
   * name here.
   */
  it("uses the shared bad state token rather than an ad-hoc red", () => {
    render(<ErrorState message="Falló" />);
    expect(screen.getByRole("alert")).toHaveClass("bg-state-bad-bg");
  });
});

describe("ErrorState — links in the message (FAM-21)", () => {
  it("renders an address inside the message as a clickable link", () => {
    render(<ErrorState message="Escríbenos: https://wa.me/593999999999." />);
    const link = screen.getByRole("link", { name: /wa\.me|WhatsApp/i });
    expect(link).toHaveAttribute("href", "https://wa.me/593999999999");
  });

  it("gives the link a 24px minimum hit target (FAM-21)", () => {
    render(<ErrorState message="Escríbanos: https://wa.me/593999999999." />);
    const link = screen.getByRole("link", { name: /wa\.me|WhatsApp/i });
    // LinkifiedText takes no className, so the message wrapper styles its anchors.
    const wrapper = link.closest("p");
    expect(wrapper?.className).toContain("[&_a]:min-h-6");
    expect(wrapper?.className).toContain("[&_a]:inline-flex");
    expect(wrapper?.className).toContain("[&_a]:items-center");
  });
});
