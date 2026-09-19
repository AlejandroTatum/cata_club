/**
 * Component tests for JoinAsPlayerAction — issue #1132's "Unirme como
 * jugador" self-service flow (see the component's own doc comment).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import JoinAsPlayerAction from "@/app/student/JoinAsPlayerAction";
import { ToastProvider } from "@/contexts/ToastContext";
import { buttonClasses } from "@/components/ui/Button";
import * as api from "@/services/api";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/services/api", async () => {
  const actual = await vi.importActual<typeof api>("@/services/api");
  return {
    ...actual,
    fetchTiposMembresia: vi.fn(),
    crearMembresiaPropia: vi.fn(),
  };
});

const TIPOS = [
  { id: 3, categoria: "Adultos", precio: "35.00", modalidad: "MENSUAL" as const },
  { id: 4, categoria: "Infantil", precio: "25.00", modalidad: "MENSUAL" as const },
];

function renderAction() {
  return render(
    <ToastProvider>
      <JoinAsPlayerAction accountPersonaId="9" />
    </ToastProvider>,
  );
}

beforeEach(() => {
  push.mockClear();
  vi.mocked(api.fetchTiposMembresia).mockResolvedValue(TIPOS);
  vi.mocked(api.crearMembresiaPropia).mockReset();
});

describe("JoinAsPlayerAction", () => {
  // Issue #1317: this CTA sits beside "Agregar hijo o dependiente" (a
  // `buttonClasses("secondary")` `<Link>`) in the same flex row, but
  // `TipoSelectorForm`'s default trigger is the admin chip (`bg-cata-red/15`,
  // `mt-2.5`) — height, radius, border and typography all mismatched the
  // sibling. The trigger must wear the SAME secondary-button classes and the
  // SAME trailing arrow the sibling has, not the chip.
  it("renders the trigger in the same secondary-button format as its sibling CTA", async () => {
    renderAction();

    const trigger = screen.getByRole("button", { name: "Unirme como jugador" });

    for (const cls of buttonClasses("secondary").split(" ")) {
      expect(trigger).toHaveClass(cls);
    }
    expect(trigger).not.toHaveClass("bg-cata-red/15");
    expect(trigger).not.toHaveClass("mt-2.5");

    const icons = trigger.querySelectorAll("svg");
    expect(icons).toHaveLength(2);
    expect(icons[0]).toHaveClass("lucide-user-plus");
    expect(icons[1]).toHaveClass("lucide-arrow-right");
  });

  it("shows the trigger and fetches the plan catalog only after it is clicked", async () => {
    renderAction();

    expect(api.fetchTiposMembresia).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Unirme como jugador" }));

    await waitFor(() => expect(api.fetchTiposMembresia).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Adultos/)).toBeInTheDocument();
  });

  it("creates the membership for the chosen plan and hands off to the payment door for the SESSION's own persona", async () => {
    vi.mocked(api.crearMembresiaPropia).mockResolvedValue({
      id: 55,
      estado: "INACTIVA",
      montoAplicado: "35.00",
      fechaActivacion: "2026-08-18T10:00:00.000000",
      personaId: 9,
      tipoMembresiaId: 3,
    });

    renderAction();
    fireEvent.click(screen.getByRole("button", { name: "Unirme como jugador" }));
    await screen.findByText(/Adultos/);

    fireEvent.change(screen.getByLabelText(/Tipo de membresía/), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Inscribirme" }));

    await waitFor(() => expect(api.crearMembresiaPropia).toHaveBeenCalledWith(3));
    // Never a hardcoded route param — the door reads whoever's own persona
    // this CTA belongs to, not a currently-selected dependent.
    await waitFor(() => expect(push).toHaveBeenCalledWith("/student/payments?registrar=1&alumno=9"));
  });

  it("shows the backend's own message on failure and does not navigate", async () => {
    vi.mocked(api.crearMembresiaPropia).mockRejectedValue(
      Object.assign(new Error("Ya existe una membresía activa o suspendida para esta persona."), { status: 400 }),
    );

    renderAction();
    fireEvent.click(screen.getByRole("button", { name: "Unirme como jugador" }));
    await screen.findByText(/Adultos/);
    fireEvent.change(screen.getByLabelText(/Tipo de membresía/), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Inscribirme" }));

    expect(await screen.findByText(/Ya existe una membresía activa o suspendida/)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
