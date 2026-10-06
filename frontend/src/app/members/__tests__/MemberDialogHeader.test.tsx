import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MedicalRecordDialog from "../MedicalRecordDialog";
import MemberDialogHeader from "../MemberDialogHeader";
import type { MemberAccount } from "../members-utils";

const ACCOUNT: MemberAccount = {
  id: "1",
  role: "representante",
  nombres: "Ana",
  apellidos: "García",
  telefono: "0999999999",
  accountState: "active",
  backendRoles: ["REPRESENTANTE"],
  estudiantes: [],
};

describe.each([
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

describe("dialog header live state (ADMA-06)", () => {
  it("shows the live account state and roles when they are passed in", () => {
    render(
      <MemberDialogHeader
        account={{ ...ACCOUNT, backendRoles: ["ADMINISTRADOR"], accountState: "active" }}
        titleId="t"
        purpose="Editar cuenta"
        closeButtonRef={{ current: null }}
        onClose={() => {}}
        liveAccountState="inactive"
        liveRoles={["ENTRENADOR"]}
      />,
    );
    expect(screen.getByText("Inactiva")).toBeInTheDocument();
    expect(screen.queryByText("Activa")).not.toBeInTheDocument();
    expect(screen.getByText("Entrenador")).toBeInTheDocument();
  });

  it("names an admin account «Administrador»", () => {
    render(
      <MemberDialogHeader
        account={{ ...ACCOUNT, backendRoles: ["ADMINISTRADOR"] }}
        titleId="t"
        purpose="Editar cuenta"
        closeButtonRef={{ current: null }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("Administrador")).toBeInTheDocument();
    expect(screen.queryByText("Representante")).not.toBeInTheDocument();
  });
});

describe("dialog header role caption (ADM-20)", () => {
  it('shows "Sin rol asignado" for a person with no role and nobody represented', () => {
    render(
      <MedicalRecordDialog account={{ ...ACCOUNT, backendRoles: undefined }} onClose={() => {}} />,
    );
    const root = screen.getByRole("dialog");
    expect(root).toHaveTextContent("Sin rol asignado");
    expect(root).not.toHaveTextContent("Representante");
  });
});
