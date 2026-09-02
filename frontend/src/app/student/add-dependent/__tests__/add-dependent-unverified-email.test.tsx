/**
 * The sentence issue #790 wrote for an unverified representante has to reach
 * the screen, not just the translator.
 *
 * The backend answers `POST /personas/{id}/vincular-representado` with a
 * `403` carrying `MENSAJE_CORREO_SIN_VERIFICAR` — the one message on this
 * screen that tells a real guardian what to DO ("revise su bandeja de
 * entrada"). Every layer between that raise site and the alert box is a
 * place the sentence can be swallowed, and one of them was:
 * `STATUS_MESSAGES[403]` answered "No tiene permisos para realizar esta
 * acción." before `toUserMessage` ever looked at the detail.
 *
 * So this file asserts the END of the path and not a link in it. A unit test
 * on `toUserMessage` would have gone green the moment the translator changed
 * while the screen still rendered the canned line — the repo has already been
 * bitten by exactly that (a `400` reaching the client is not a `400` being
 * READ), and the rule it left behind is to measure the rendered text.
 *
 * `@/services/api` is mocked with `importActual` on purpose, so
 * `ApiClientError` is the REAL class. A hand-rolled double would let this
 * test invent a `safe` field the shipped error might not carry, which is the
 * other way a green test has lied here before.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AddDependentPage from "@/app/student/add-dependent/page";
import { installAddDependentHarness } from "./add-dependent-harness";
import { ApiClientError, crearRepresentado, vincularRepresentado } from "@/services/api";
import { addDependentFieldId, type AddDependentField } from "@/app/student/add-dependent/add-dependent-utils";
import { MENSAJE_IDENTIDAD_DUPLICADA } from "@/lib/duplicate-identity";
import { fillBirthDate } from "@/lib/__tests__/fill-birth-date";

/** Verbatim copy of `MENSAJE_CORREO_SIN_VERIFICAR` (backend `app/dominio/mensajes.py`). */
const MENSAJE_CORREO_SIN_VERIFICAR =
  "Para vincular a un representado primero debe verificar su correo. " +
  "Revise su bandeja de entrada o solicite un nuevo enlace de verificación.";

// The seven-mock preamble this wizard needs before it will mount lives in
// `add-dependent-harness`; see that module for why the bodies are there and
// the `vi.mock` calls are here.
// `vi.hoisted` so the binding exists before the hoisted `vi.mock` factories run.
const harness = vi.hoisted(() => () => import("./add-dependent-harness"));

vi.mock("@/components/ProtectedRoute", async () => (await harness()).protectedRouteDouble());
vi.mock("next/navigation", async () => (await harness()).navigationDouble());
vi.mock("next/link", async () => (await harness()).nextLinkDouble());
vi.mock("next/image", async () => (await harness()).nextImageDouble());
vi.mock("@/contexts/AuthContext", async () => (await harness()).authContextDouble());
vi.mock("@/contexts/ToastContext", async () => (await harness()).toastContextDouble());

// `@/services/api` stays here, and keeps `importOriginal`, because this suite
// builds `ApiClientError` instances: a hand-rolled double could invent a
// `safe` field the shipped error does not carry, which is the other way a
// green test has lied in this repo.
vi.mock("@/services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/api")>();
  return {
    ...actual,
    fetchStudentPortal: vi.fn(),
    crearRepresentado: vi.fn(),
    vincularRepresentado: vi.fn(),
    fetchInstituciones: vi.fn().mockResolvedValue([]),
  };
});

installAddDependentHarness();

afterEach(() => {
  vi.clearAllMocks();
});

/** Set a field addressed by the wizard's own declared id, not by its label. */
function setField(field: AddDependentField, value: string): void {
  const el = document.getElementById(addDependentFieldId(field));
  if (el === null) throw new Error(`missing field: ${field}`);
  fireEvent.change(el, { target: { value } });
}

/**
 * Walk the whole wizard to the summary step, tick the review checkbox, and
 * wait for the portal fetch that sources `representanteId` — the submit
 * button stays disabled until it lands, and a synchronous click would
 * silently do nothing.
 */
async function walkToReviewedSummary(): Promise<void> {
  setField("nombres", "Mateo Andres");
  setField("apellidos", "Zambrano Loor");
  setField("cedula", "1798765432");
  fillBirthDate(addDependentFieldId("fechaNacimiento"), "2014-05-12");
  setField("telefono", "0991234567");
  fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));

  // Credentials are optional and all-or-nothing: left blank, the step is complete.
  fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));

  setField("tipoSangre", "O_POSITIVO");
  setField("contactoEmergencia", "Laura Zambrano");
  setField("telefonoEmergencia", "0992223344");
  fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));

  fireEvent.click(screen.getByRole("checkbox"));

  await waitFor(() => {
    const submit = screen.getByRole("button", { name: /agregar dependiente/i });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });
}

/**
 * Reach the "Vincular a mi cuenta" button the only way a guardian can: the
 * cédula they typed already belongs to someone, so the duplicate-identity
 * alert offers linking instead of a dead end (INS-2).
 */
async function revealLinkButton(): Promise<HTMLElement> {
  vi.mocked(crearRepresentado).mockRejectedValue(
    new ApiClientError(MENSAJE_IDENTIDAD_DUPLICADA, 400),
  );
  render(<AddDependentPage />);
  await walkToReviewedSummary();
  fireEvent.click(screen.getByRole("button", { name: /agregar dependiente/i }));
  return await screen.findByRole("button", { name: /vincular a mi cuenta/i });
}

describe("an unverified representante is told to verify their e-mail", () => {
  it("renders the backend's own sentence, not the canned 403", async () => {
    const linkButton = await revealLinkButton();

    // Exactly what the live stack answers: 403, `mensaje_seguro: true`.
    vi.mocked(vincularRepresentado).mockRejectedValue(
      new ApiClientError(MENSAJE_CORREO_SIN_VERIFICAR, 403, true),
    );

    fireEvent.click(linkButton);

    const alert = await screen.findByRole("alert");
    await waitFor(() => {
      expect(alert.textContent).toMatch(/verificar su correo/i);
    });
    expect(alert.textContent).toMatch(/bandeja de entrada/i);
    expect(alert.textContent).not.toMatch(/No tiene permisos para realizar esta acción/i);
  });

  it("still hides an unmarked 403, so the screen is no oracle", async () => {
    const linkButton = await revealLinkButton();

    // The default every other 403 on this endpoint keeps: no `mensaje_seguro`.
    vi.mocked(vincularRepresentado).mockRejectedValue(
      new ApiClientError("persona_id=41 pertenece a otro representante", 403),
    );

    fireEvent.click(linkButton);

    const alert = await screen.findByRole("alert");
    await waitFor(() => {
      expect(alert.textContent).toMatch(/No tiene permisos para realizar esta acción/i);
    });
    expect(alert.textContent).not.toMatch(/persona_id/i);
  });
});
