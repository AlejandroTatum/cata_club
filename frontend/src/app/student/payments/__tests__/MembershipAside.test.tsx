/**
 * `MembershipCard` — FAM-05: la familia ve por qué está suspendida la membresía.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MembershipCard } from "@/app/student/payments/MembershipAside";
import type { MembershipSummary } from "@/services/api";

function membership(overrides: Partial<MembershipSummary>): MembershipSummary {
  return {
    id: 1,
    estado: "SUSPENDIDA",
    personaId: 7,
    montoAplicado: "25.00",
    categoria: "Mensual",
    modalidad: "MENSUAL",
    fechaActivacion: "2026-01-10T00:00:00Z",
    esGratuidadFamiliar: false,
    cubiertoHasta: "2026-11-30",
    ...overrides,
  } as MembershipSummary;
}

function renderCard(m: MembershipSummary): void {
  render(
    <MembershipCard membership={m} coverageEnd={m.cubiertoHasta ?? null} studentName="Sofía" approvedCount={2}>
      <p>formulario</p>
    </MembershipCard>,
  );
}

describe("MembershipCard — suspension reason", () => {
  it("shows the reason the club recorded for a suspended membership", () => {
    renderCard(membership({ motivoSuspension: "Lesión de rodilla" }));

    expect(screen.getByTestId("suspension-reason")).toHaveTextContent(
      "Motivo de la suspensión: Lesión de rodilla",
    );
  });

  it("says no reason was recorded instead of leaving a blank", () => {
    renderCard(membership({ motivoSuspension: null }));

    expect(screen.getByTestId("suspension-reason")).toHaveTextContent(/no registró un motivo/i);
  });

  it("shows nothing for a membership that is not suspended", () => {
    renderCard(membership({ estado: "ACTIVA", motivoSuspension: null }));

    expect(screen.queryByTestId("suspension-reason")).toBeNull();
  });
});
