/**
 * The guardian's family strip: every dependent on one row with the one fact a
 * family checks first — is this child covered — and a click to switch.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import FamilyStrip from "@/app/student/FamilyStrip";
import type { StudentProfileSummary } from "@/services/api";

function profile(
  personaId: string,
  nombres: string,
  cubiertoHasta: string | null,
  categoria: string | null = null,
): StudentProfileSummary {
  return {
    personaId,
    nombres,
    apellidos: "Vera",
    fechaNacimiento: "2015-01-01",
    recentSessions: [],
    membership: {
      id: Number(personaId),
      estado: "ACTIVA",
      personaId: Number(personaId),
      montoAplicado: "40.00",
      categoria,
      modalidad: null,
      fechaActivacion: null,
      fechaFin: null,
      cubiertoHasta,
    },
    representante: null,
    representanteId: 9,
  } as StudentProfileSummary;
}

const TODAY = new Date(2026, 8, 29);

describe("FamilyStrip", () => {
  it("renders nothing for a single profile", () => {
    const { container } = render(
      <FamilyStrip profiles={[profile("1", "Martin", null)]} value="1" onChange={vi.fn()} today={TODAY} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lists each dependent with its coverage status and marks the selected one", () => {
    render(
      <FamilyStrip
        profiles={[profile("1", "Martin", "2026-10-03"), profile("2", "Sofia", "2026-09-01")]}
        value="1"
        onChange={vi.fn()}
        today={TODAY}
      />,
    );

    const group = screen.getByRole("group", { name: "Jugador" });
    const martin = within(group).getByRole("button", { name: /Martin/ });
    const sofia = within(group).getByRole("button", { name: /Sofia/ });
    expect(martin).toHaveAttribute("aria-pressed", "true");
    expect(sofia).toHaveAttribute("aria-pressed", "false");
    expect(martin).toHaveTextContent("4 días de cobertura");
    expect(sofia).toHaveTextContent("Vencida");
  });

  it("switches the selected profile on click", () => {
    const onChange = vi.fn();
    render(
      <FamilyStrip
        profiles={[profile("1", "Martin", null), profile("2", "Sofia", null)]}
        value="1"
        onChange={onChange}
        today={TODAY}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Sofia/ }));
    expect(onChange).toHaveBeenCalledWith("2");
  });

  it("gives each dependent an equal-width card with initials, plan and a status badge", () => {
    render(
      <FamilyStrip
        profiles={[
          profile("1", "Martin", "2026-10-03", "Mensual Adultos"),
          profile("2", "Sofia", "2026-09-01", "Mensual Infantil"),
        ]}
        value="1"
        onChange={vi.fn()}
        today={TODAY}
      />,
    );

    const martin = screen.getByRole("button", { name: /Martin/ });
    expect(within(martin).getByText("MV")).toBeInTheDocument();
    expect(within(martin).getByText("Mensual Adultos")).toBeInTheDocument();
    expect(within(martin).getByText("4 días de cobertura")).toBeInTheDocument();
    const sofia = screen.getByRole("button", { name: /Sofia/ });
    expect(within(sofia).getByText("Vencida")).toBeInTheDocument();
  });

  it("fills its row: a grid with one column per dependent (max 4), one column on a phone", () => {
    const { rerender } = render(
      <FamilyStrip profiles={[profile("1", "A", null), profile("2", "B", null)]} value="1" onChange={vi.fn()} today={TODAY} />,
    );
    const grid = () => screen.getByRole("group", { name: "Jugador" });
    expect(grid().className).toMatch(/\bgrid\b/);
    expect(grid().className).toMatch(/\bgrid-cols-1\b/);
    expect(grid().className).toMatch(/\blg:grid-cols-2\b/);

    rerender(
      <FamilyStrip
        profiles={[1, 2, 3].map((n) => profile(String(n), `N${n}`, null))}
        value="1"
        onChange={vi.fn()}
        today={TODAY}
      />,
    );
    expect(grid().className).toMatch(/\blg:grid-cols-3\b/);

    rerender(
      <FamilyStrip
        profiles={[1, 2, 3, 4, 5].map((n) => profile(String(n), `N${n}`, null))}
        value="1"
        onChange={vi.fn()}
        today={TODAY}
      />,
    );
    expect(grid().className).toMatch(/\blg:grid-cols-4\b/);
  });

  it("highlights the selected card beyond aria-pressed", () => {
    render(
      <FamilyStrip profiles={[profile("1", "Martin", null), profile("2", "Sofia", null)]} value="2" onChange={vi.fn()} today={TODAY} />,
    );
    expect(screen.getByRole("button", { name: /Sofia/ }).className).toMatch(/(?<![\w:-])border-ink(?![\w-])/);
    expect(screen.getByRole("button", { name: /Martin/ }).className).not.toMatch(/(?<![\w:-])border-ink(?![\w-])/);
  });
});
