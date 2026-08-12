/**
 * BackLink — the one back control the whole system shares. It always wears a
 * visible border (never a bare underline the user has to notice on their
 * own) and its label always names the destination, never a bare "Volver".
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BackLink from "@/components/ui/BackLink";

describe("BackLink — destination", () => {
  it("points at the given href", () => {
    render(<BackLink href="/queue" label="Volver a la cola" />);
    expect(screen.getByRole("link", { name: /volver a la cola/i })).toHaveAttribute(
      "href",
      "/queue",
    );
  });

  it("renders the exact label it was given, not a generic caption", () => {
    render(<BackLink href="/members" label="Volver a miembros" />);
    expect(screen.getByText("Volver a miembros")).toBeInTheDocument();
  });
});

describe("BackLink — never a bare \"Volver\"", () => {
  it("refuses to render with a bare 'Volver' label", () => {
    expect(() => render(<BackLink href="/queue" label="Volver" />)).toThrow(/destination/i);
  });

  it("refuses a bare 'Volver' regardless of casing or surrounding space", () => {
    expect(() => render(<BackLink href="/queue" label="  volver  " />)).toThrow(/destination/i);
  });

  it("refuses an empty label the same way", () => {
    expect(() => render(<BackLink href="/queue" label="   " />)).toThrow(/destination/i);
  });

  it("accepts any label that names something beyond the bare verb", () => {
    expect(() => render(<BackLink href="/queue" label="Volver al inicio" />)).not.toThrow();
  });
});

describe("BackLink — the canonical red-outline skin", () => {
  it("wears a real border in the institutional red, not a bare link", () => {
    render(<BackLink href="/queue" label="Volver a la cola" />);
    const link = screen.getByRole("link", { name: /volver a la cola/i });
    expect(link.className).toMatch(/\bborder\b/);
    expect(link).toHaveClass("border-cata-red");
  });

  it("rests on a transparent background, below the filled primary CTA", () => {
    render(<BackLink href="/queue" label="Volver a la cola" />);
    const link = screen.getByRole("link", { name: /volver a la cola/i });
    expect(link).toHaveClass("bg-transparent");
    expect(link).not.toHaveClass("bg-cata-red");
  });

  it("sets text in the AA stop of the institutional red", () => {
    render(<BackLink href="/queue" label="Volver a la cola" />);
    const link = screen.getByRole("link", { name: /volver a la cola/i });
    expect(link).toHaveClass("text-cata-red-dark");
  });

  it("gives hover and focus-visible a clearly visible red wash", () => {
    render(<BackLink href="/queue" label="Volver a la cola" />);
    const link = screen.getByRole("link", { name: /volver a la cola/i });
    expect(link.className).toMatch(/hover:bg-cata-red\/10/);
    expect(link.className).toMatch(/focus-visible:bg-cata-red\/10/);
  });

  it("keeps the accessible minimum pointer/touch target height", () => {
    render(<BackLink href="/queue" label="Volver a la cola" />);
    const link = screen.getByRole("link", { name: /volver a la cola/i });
    expect(link).toHaveClass("h-ctl-sm");
  });
});

describe("BackLink — passthrough", () => {
  it("forwards an extra className without dropping the canonical skin", () => {
    render(<BackLink href="/queue" label="Volver a la cola" className="ml-2" />);
    const link = screen.getByRole("link", { name: /volver a la cola/i });
    expect(link).toHaveClass("ml-2", "border-cata-red");
  });
});

describe("BackLink — icon is decorative", () => {
  it("keeps its leading arrow out of the accessible name", () => {
    render(<BackLink href="/queue" label="Volver a la cola" />);
    const link = screen.getByRole("link", { name: /volver a la cola/i });
    const icon = link.querySelector("svg");
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });
});

describe("BackLink — optional onClick", () => {
  // Some screens use BackLink for an in-page state reset rather than a
  // route change (e.g. a master-detail view whose "back" is local state, not
  // a URL) — `href` still names a real fallback destination, but the caller
  // also needs its own handler to run on click, exactly like the legacy
  // `components/BackLink.tsx` guard already does.
  it("still calls a caller-supplied onClick alongside the navigation", () => {
    const onClick = vi.fn();
    render(<BackLink href="/payments" label="Volver a la cola" onClick={onClick} />);
    fireEvent.click(screen.getByRole("link", { name: /volver a la cola/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("keeps working with no onClick at all", () => {
    expect(() =>
      render(<BackLink href="/queue" label="Volver a la cola" />),
    ).not.toThrow();
  });
});
