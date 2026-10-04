/**
 * The "tarjeta de emergencia": health risks first (warning tone), the contact
 * and phone grouped, the phone a dialable link, the blood badge kept.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import EmergencyCard, { type EmergencyCardValues } from "@/app/members/EmergencyCard";

const FULL: EmergencyCardValues = {
  tipoSangre: "O POSITIVO",
  alergias: "Penicilina",
  enfermedades: "Asma",
  contactoEmergencia: "María Pérez",
  telefonoEmergencia: "099 123 4567",
};
const EMPTY: EmergencyCardValues = { tipoSangre: "", alergias: "", enfermedades: "", contactoEmergencia: "", telefonoEmergencia: "" };

function renderCard(values: EmergencyCardValues) {
  render(<EmergencyCard studentName="Ana" values={values} ownerIsViewer={false} />);
  return screen.getByTestId("emergency-card");
}

describe("EmergencyCard — hierarchy (QA R2 S8)", () => {
  it("emphasizes allergies and conditions in a warning block when present", () => {
    const card = renderCard(FULL);
    const alert = within(card).getByTestId("emergency-card-health");
    expect(alert).toHaveClass("bg-state-warn-bg");
    expect(within(alert).getByText("Alergias")).toBeInTheDocument();
    expect(within(alert).getByText("Penicilina")).toBeInTheDocument();
    expect(within(alert).getByText("Enfermedades")).toBeInTheDocument();
    expect(within(alert).getByText("Asma")).toBeInTheDocument();
  });

  it("shows no warning block when there is nothing to warn about, and says so quietly", () => {
    const card = renderCard(EMPTY);
    expect(within(card).queryByTestId("emergency-card-health")).toBeNull();
    expect(within(card).getAllByText("Sin registrar").length).toBeGreaterThanOrEqual(3);
  });

  it("warns only for what is filled", () => {
    const card = renderCard({ ...EMPTY, alergias: "Polen" });
    const alert = within(card).getByTestId("emergency-card-health");
    expect(within(alert).getByText("Polen")).toBeInTheDocument();
    expect(within(alert).queryByText("Enfermedades")).toBeNull();
  });

  it("groups contact and phone, the phone being a tel: link", () => {
    const card = renderCard(FULL);
    const group = within(card).getByTestId("emergency-card-contact");
    expect(within(group).getByText("María Pérez")).toBeInTheDocument();
    const link = within(group).getByRole("link", { name: /099 123 4567/ });
    expect(link).toHaveAttribute("href", "tel:0991234567");
  });

  it("keeps a +country phone dialable and renders plain text when there is no phone", () => {
    const card = renderCard({ ...FULL, telefonoEmergencia: "+593 99 123 4567" });
    expect(within(card).getByRole("link", { name: /\+593 99 123 4567/ })).toHaveAttribute("href", "tel:+593991234567");
  });

  it("does not render a link without a phone", () => {
    const card = renderCard({ ...FULL, telefonoEmergencia: "" });
    expect(within(card).queryByRole("link")).toBeNull();
    expect(within(within(card).getByTestId("emergency-card-contact")).getByText("Teléfono sin registrar")).toBeInTheDocument();
  });

  it("keeps the blood type badge", () => {
    renderCard(FULL);
    expect(screen.getByTestId("emergency-card-blood")).toHaveTextContent("O+");
  });
});
