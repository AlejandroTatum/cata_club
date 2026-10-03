/**
 * Component tests for `TipoSelectorForm`'s trigger button — issue #1317.
 *
 * `JoinAsPlayerAction` (the student portal CTA) needed the trigger to wear
 * the exact secondary-button classes its sibling `<Link>` uses, so the
 * component grew an optional `triggerClassName` override. The admin callers
 * (`CambiarPlanForm`, `CreateMembershipForm`) never pass it and must keep
 * the original red chip untouched — that is what this file guards.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Repeat } from "lucide-react";
import TipoSelectorForm from "@/components/admin/TipoSelectorForm";
import * as api from "@/services/api";

vi.mock("@/services/api", async () => {
  const actual = await vi.importActual<typeof api>("@/services/api");
  return {
    ...actual,
    fetchTiposMembresia: vi.fn(),
  };
});

beforeEach(() => {
  vi.mocked(api.fetchTiposMembresia).mockResolvedValue([]);
});

describe("TipoSelectorForm trigger", () => {
  it("keeps the admin chip classes when no triggerClassName is given", () => {
    render(
      <TipoSelectorForm
        triggerLabel="Cambiar plan"
        TriggerIcon={Repeat}
        submitLabel="Confirmar"
        SubmitIcon={Repeat}
        selectPlaceholder="Seleccionar plan…"
        submitFailureMessage="No se pudo cambiar el plan."
        onSubmit={async () => {}}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Cambiar plan" });
    expect(trigger).toHaveClass("bg-cata-red/15");
    expect(trigger).toHaveClass("mt-2.5");
  });
});

describe("TipoSelectorForm catalog", () => {
  it("asks only for visible tariffs: a hidden one can never be picked", async () => {
    render(
      <TipoSelectorForm
        triggerLabel="Cambiar plan"
        TriggerIcon={Repeat}
        submitLabel="Confirmar"
        SubmitIcon={Repeat}
        selectPlaceholder="Seleccionar plan…"
        submitFailureMessage="No se pudo cambiar el plan."
        onSubmit={async () => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cambiar plan" }));

    await waitFor(() => expect(api.fetchTiposMembresia).toHaveBeenCalledWith({ soloActivas: true }));
  });
});

describe("TipoSelectorForm options (ADMA-18)", () => {
  const CATALOGO = [
    { id: 1, categoria: "Mensual Adultos", precio: "40.00", modalidad: "MENSUAL" as const, activo: true, enUso: true },
    { id: 2, categoria: "Infantil", precio: "25.00", modalidad: "MENSUAL" as const, activo: true, enUso: true },
  ];

  async function openForm(extra: Partial<React.ComponentProps<typeof TipoSelectorForm>> = {}) {
    vi.mocked(api.fetchTiposMembresia).mockResolvedValue(CATALOGO);
    render(
      <TipoSelectorForm
        triggerLabel="Cambiar plan"
        TriggerIcon={Repeat}
        submitLabel="Confirmar"
        SubmitIcon={Repeat}
        selectPlaceholder="Seleccionar plan…"
        submitFailureMessage="No se pudo cambiar el plan."
        onSubmit={async () => {}}
        {...extra}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cambiar plan" }));
    await screen.findByRole("option", { name: /Infantil/ });
  }

  it("labels options with the price per month and never the internal modalidad", async () => {
    await openForm();
    expect(screen.getByRole("option", { name: "Mensual Adultos — $40,00 al mes" })).toBeInTheDocument();
    expect(screen.queryByText(/MENSUAL\)/)).not.toBeInTheDocument();
  });

  it("keeps the default field label", async () => {
    await openForm();
    expect(screen.getByLabelText(/Tipo de membresía/)).toBeInTheDocument();
  });

  it("uses a custom field label and leaves out the current plan", async () => {
    await openForm({ fieldLabel: "Plan nuevo", excludeCategoria: "Mensual Adultos" });
    expect(screen.getByLabelText(/Plan nuevo/)).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Mensual Adultos/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Infantil/ })).toBeInTheDocument();
  });
});
