/**
 * AuthShell — the template all four public auth screens inherit.
 *
 * These tests pin the two things the redesign got wrong and must not regress:
 *
 *  1. The composition is BOUNDED (`.auth { min-height: 560px }`,
 *     `_sistema.css:380`), centred in the page. It used to stretch to
 *     `min-h-screen`, which turned the coal panel into a ~900px void with the
 *     logo cluster marooned in the middle of it.
 *  2. The left panel carries its bottom third — the divider, the single figure
 *     and its caption (`.div` / `.n` / `.k`, `_sistema.css:388-390`). The
 *     figure is `yearsSinceFounding()`, derived from the founding date the
 *     landing already publishes: a real, public, unauthenticated fact. It is
 *     NOT a student count — no endpoint an anonymous visitor can call returns
 *     one, and a fabricated figure is worse than no figure.
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import AuthShell from "@/components/auth/AuthShell";
import { yearsSinceFounding } from "@/app/landing/landing-config";

function renderShell(): void {
  render(
    <AuthShell title="Bienvenido de nuevo" subtitle="Inicie sesión para continuar" note="Nota">
      <button type="submit">Iniciar sesión</button>
    </AuthShell>,
  );
}

describe("AuthShell", () => {
  it("bounds the composition at 560px instead of stretching it to the viewport", () => {
    renderShell();

    const composition = screen.getByTestId("auth-composition");
    // `.auth { min-height: 560px }` — a bounded block, not a full-height split.
    expect(composition.className).toContain("min-h-[560px]");
    // …and it is capped, so the panels never grow to an arbitrary width.
    expect(composition.className).toMatch(/max-w-\[\d+px\]/);
  });

  it("renders the single figure from the founding date, with its caption", () => {
    renderShell();

    const figure = screen.getByTestId("auth-figure");
    expect(figure).toHaveTextContent(String(yearsSinceFounding()));
    expect(screen.getByText("Años formando deportistas")).toBeInTheDocument();
  });

  it("never claims a student count, which no public endpoint can produce", () => {
    renderShell();

    expect(screen.queryByText(/estudiantes inscritos/i)).not.toBeInTheDocument();
  });

  it("keeps the motto, the exit link and the card contents the four screens share", () => {
    renderShell();

    expect(screen.getByText(/Formando/)).toBeInTheDocument();
    expect(screen.getByText("campeones")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /volver al sitio/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Bienvenido de nuevo" })).toBeInTheDocument();
    expect(screen.getByText("Inicie sesión para continuar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Iniciar sesión" })).toBeInTheDocument();
    expect(screen.getByText("Nota")).toBeInTheDocument();
  });
});
