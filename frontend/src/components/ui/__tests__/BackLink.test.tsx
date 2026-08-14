/**
 * BackLink — the one back control the whole system shares. It always wears a
 * visible box (never a bare underline the user has to notice on their own), its
 * label always names the destination and never a bare "Volver", and it wears
 * whichever of two skins the field behind it calls for.
 *
 * The label is no longer a prop, so the "never a bare Volver" rule is not
 * asserted here any more — there is no string to pass. It moved to
 * `lib/__tests__/destinations.test.ts`, where the label is now made, along with
 * the sweep that keeps the prop from coming back.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BackLink from "@/components/ui/BackLink";
import { buttonSkin } from "@/components/ui/Button";

describe("BackLink — destination", () => {
  it("points at the given href", () => {
    render(<BackLink href="/payments" />);
    expect(screen.getByRole("link", { name: /volver a membresías y pagos/i })).toHaveAttribute(
      "href",
      "/payments",
    );
  });

  it("names the destination by reading the registry, not by being told", () => {
    // The whole API change in one assertion: the caller passed a path and the
    // control produced the sentence. Nothing here spells the copy.
    render(<BackLink href="/trainer" />);
    expect(screen.getByText("Volver a Mi día")).toBeInTheDocument();
  });

  it("contracts the preposition where the registry says to", () => {
    render(<BackLink href="/dashboard" />);
    expect(screen.getByText("Volver al Panel de Control")).toBeInTheDocument();
  });

  it("refuses an href no destination is registered for", () => {
    // The guard that replaces the old bare-"Volver" throw: a control that
    // cannot name where it goes does not render at all.
    expect(() => render(<BackLink href="/queue" />)).toThrow(/\/queue/);
  });
});

describe("BackLink — the light skin is the system's tertiary level", () => {
  // Not "looks like tertiary": IS tertiary. Read off the primitive so that
  // restyling the third button level restyles this control with it, which is
  // the point of taking the skin instead of copying the four values.
  const TERTIARY = buttonSkin("tertiary");

  it("wears the tertiary colours, taken from Button rather than cloned", () => {
    render(<BackLink href="/members" />);
    const link = screen.getByRole("link", { name: /volver a miembros/i });
    for (const cls of TERTIARY.split(" ")) {
      expect(link.className).toContain(cls);
    }
  });

  it("carries no red at all — it is the quietest control on the screen", () => {
    // The defect D12b names: a red outline says "this matters", and back is the
    // least important control on any screen that has one.
    render(<BackLink href="/members" />);
    const link = screen.getByRole("link", { name: /volver a miembros/i });
    expect(link.className).not.toMatch(/cata-red/);
  });

  it("keeps the box #202 asked for, drawn by the fill rather than by an outline", () => {
    render(<BackLink href="/members" />);
    const link = screen.getByRole("link", { name: /volver a miembros/i });
    expect(link).toHaveClass("bg-sunken");
    expect(link.className).toMatch(/\bborder\b/);
  });

  it("is 32px tall at the 10px control radius", () => {
    render(<BackLink href="/members" />);
    const link = screen.getByRole("link", { name: /volver a miembros/i });
    expect(link).toHaveClass("h-ctl-sm", "rounded-ctl");
  });
});

describe("BackLink — the coal skin, for the auth panel", () => {
  it("fills with translucent white and sets its label in white", () => {
    render(<BackLink href="/" tone="coal" />);
    const link = screen.getByRole("link", { name: /volver al inicio/i });
    expect(link).toHaveClass("bg-white/10", "text-white");
  });

  it("steps the fill up and shows a border on hover", () => {
    render(<BackLink href="/" tone="coal" />);
    const link = screen.getByRole("link", { name: /volver al inicio/i });
    expect(link.className).toMatch(/hover:bg-white\/\[0\.18\]/);
    expect(link.className).toMatch(/hover:border-white\/30/);
  });

  it("keeps the same shape as the light skin — only the colours differ", () => {
    render(<BackLink href="/" tone="coal" />);
    const link = screen.getByRole("link", { name: /volver al inicio/i });
    expect(link).toHaveClass("h-ctl-sm", "rounded-ctl");
    // The auth panel's link used to be 24px and boxless; nothing about the
    // dark field justifies a smaller control than the rest of the product.
    expect(link.className).not.toMatch(/min-h-\[24px\]/);
  });

  it("brings none of the light fill onto the dark field", () => {
    render(<BackLink href="/" tone="coal" />);
    const link = screen.getByRole("link", { name: /volver al inicio/i });
    expect(link).not.toHaveClass("bg-sunken");
    expect(link).not.toHaveClass("text-ink-2");
  });

  it("defaults to the light tone when none is asked for", () => {
    render(<BackLink href="/members" />);
    expect(screen.getByRole("link", { name: /volver a miembros/i })).toHaveClass("bg-sunken");
  });
});

describe("BackLink — passthrough", () => {
  it("forwards an extra className without dropping the canonical skin", () => {
    render(<BackLink href="/members" className="ml-2" />);
    const link = screen.getByRole("link", { name: /volver a miembros/i });
    expect(link).toHaveClass("ml-2", "bg-sunken");
  });
});

describe("BackLink — icon is decorative", () => {
  it("keeps its leading arrow out of the accessible name", () => {
    render(<BackLink href="/members" />);
    const link = screen.getByRole("link", { name: /volver a miembros/i });
    const icon = link.querySelector("svg");
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });
});

describe("BackLink — optional onClick", () => {
  // Some screens use BackLink for an in-page state reset rather than a
  // route change (e.g. a master-detail view whose "back" is local state, not
  // a URL) — `href` still names a real fallback destination, but the caller
  // also needs its own handler to run on click, exactly like the legacy
  // `components/BackLink.tsx` guard already does. That href is load-bearing
  // twice over now: it is also what the label is read from.
  it("still calls a caller-supplied onClick alongside the navigation", () => {
    const onClick = vi.fn();
    render(<BackLink href="/payments" onClick={onClick} />);
    fireEvent.click(screen.getByRole("link", { name: /volver a membresías y pagos/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("keeps working with no onClick at all", () => {
    expect(() => render(<BackLink href="/members" />)).not.toThrow();
  });
});
