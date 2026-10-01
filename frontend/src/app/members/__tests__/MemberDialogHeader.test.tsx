import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MedicalRecordDialog from "../MedicalRecordDialog";
import PaymentsDialog from "../PaymentsDialog";
import type { MemberAccount } from "../members-utils";

const ACCOUNT: MemberAccount = {
  id: "1",
  role: "representante",
  nombres: "Ana",
  apellidos: "García",
  telefono: "0999999999",
  accountState: "active",
  estudiantes: [],
};

describe.each([
  ["Pagos", <PaymentsDialog key="p" account={ACCOUNT} onClose={() => {}} onMembershipCreated={() => {}} onDebtRegularized={() => {}} onMembresiaChanged={() => {}} onPaymentRegistered={() => {}} />],
  ["Ficha médica", <MedicalRecordDialog key="m" account={ACCOUNT} onClose={() => {}} />],
])("%s dialog header", (purpose, dialog) => {
  it("shows the shared identity header with the dialog purpose", () => {
    render(dialog);
    const root = screen.getByRole("dialog");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Ana García");
    expect(root).toHaveTextContent(purpose as string);
    expect(root).toHaveTextContent("AG");
    expect(root).toHaveTextContent("Representante");
    expect(root).toHaveTextContent("Activa");
  });
});
