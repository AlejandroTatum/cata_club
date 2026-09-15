/**
 * Component tests for AccountInfoSection.
 *
 * Issue #1207: a represented minor without a phone of their own can reach
 * this dialog with `account.telefono` = `null` at runtime, even though
 * `MemberAccount.telefono` is typed `string` (`members-adapter.ts` coerces
 * `null` to `""` going forward, but this component defends on its own too —
 * `useState(account.telefono)` fed straight into a controlled `<input>`, and
 * `telefono.trim()` on save, both threw a `TypeError` on `null` before this
 * fix).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AccountInfoSection from "../AccountInfoSection";
import type { MemberAccount } from "../members-utils";

const mockActualizarPersona = vi.fn();

vi.mock("@/services/api", () => ({
  actualizarPersona: (personaId: number, data: unknown) => mockActualizarPersona(personaId, data),
}));

const ACCOUNT: MemberAccount = {
  id: "3",
  role: "estudiante",
  nombres: "Sofia",
  apellidos: "Martinez",
  telefono: "0991234567",
  estudiantes: [],
};

beforeEach(() => {
  mockActualizarPersona.mockReset().mockResolvedValue({});
});

describe("AccountInfoSection", () => {
  it("saves the trimmed nombres/apellidos/telefono on file normally", async () => {
    render(<AccountInfoSection account={ACCOUNT} />);

    fireEvent.click(screen.getByRole("button", { name: /guardar nombre, apellido y teléfono/i }));

    await waitFor(() =>
      expect(mockActualizarPersona).toHaveBeenCalledWith(3, {
        nombres: "Sofia",
        apellidos: "Martinez",
        telefono: "0991234567",
      }),
    );
  });

  it("does not throw for a phoneless represented minor and saves telefono as an empty string", async () => {
    // The type still promises `string` — this models the runtime shape a
    // phoneless minor's row actually had before members-adapter.ts coerced
    // it, and defends this component against any other caller that hands it
    // the same thing.
    const phonelessMinor = { ...ACCOUNT, telefono: null } as unknown as MemberAccount;

    render(<AccountInfoSection account={phonelessMinor} />);

    expect(screen.getByLabelText(/teléfono/i)).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: /guardar nombre, apellido y teléfono/i }));

    await waitFor(() =>
      expect(mockActualizarPersona).toHaveBeenCalledWith(3, {
        nombres: "Sofia",
        apellidos: "Martinez",
        telefono: "",
      }),
    );
  });
});
