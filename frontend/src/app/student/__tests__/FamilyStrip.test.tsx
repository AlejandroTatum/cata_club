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

function profile(personaId: string, nombres: string, cubiertoHasta: string | null): StudentProfileSummary {
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
      categoria: null,
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

    const group = screen.getByRole("group", { name: "Estudiante" });
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
});
