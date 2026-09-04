/**
 * Issue #353 — a session that expired mid-wizard (401 on the refresh) bounced
 * the admin to /login and threw away everything typed so far: nombres,
 * apellidos, cédula, teléfono, ficha médica. Every OTHER resilience finding in
 * this QA round preserved the user's work (a slow/cut backend during
 * asistencia keeps the draft, the retry works); this was the one place data
 * typed by a human actually vanished.
 *
 * Follows the pattern issue #317 (K8) already shipped for the public
 * enrollment wizard: same `sessionStorage` persistence, same on-screen label
 * ("Recuperamos los datos..."), same moment of clearing (a successful
 * submit). See `EnrollPage.test.tsx` for the sibling coverage this mirrors.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CrearCuentaPage from "@/app/admin/crear-cuenta/page";
import { resetTestHistory, useTestSearchParams } from "@/lib/__tests__/next-navigation-double";
import { crearCuentaAdmin, fetchInstituciones } from "@/services/api";
import { crearCuentaFieldId } from "@/app/admin/crear-cuenta/crear-cuenta-utils";
import { fillBirthDate } from "@/lib/__tests__/fill-birth-date";

vi.mock("@/components/ProtectedRoute", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/shell/AppShell", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/crear-cuenta",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => useTestSearchParams(),
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ showError: vi.fn(), showSuccess: vi.fn() }),
}));

vi.mock("@/services/api", () => ({
  crearCuentaAdmin: vi.fn(),
  searchStudents: vi.fn().mockResolvedValue([]),
  fetchInstituciones: vi.fn().mockResolvedValue([]),
}));

const DRAFT_KEY = "cata_crear_cuenta_draft";

beforeEach(() => {
  window.sessionStorage.clear();
  vi.mocked(fetchInstituciones).mockResolvedValue([]);
  resetTestHistory("/admin/crear-cuenta");
});

afterEach(() => {
  cleanup();
});

describe("CrearCuentaPage — el borrador sobrevive una sesión expirada (issue #353)", () => {
  it("persiste lo tipeado en sessionStorage a medida que el admin avanza", async () => {
    render(<CrearCuentaPage />);

    fireEvent.click(screen.getByRole("button", { name: /^Jugador/ }));
    fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));

    fireEvent.change(screen.getByLabelText(/^Nombres/), { target: { value: "Mateo Andres" } });
    fireEvent.change(screen.getByLabelText(/^Cédula/), { target: { value: "1798765432" } });

    const stored = window.sessionStorage.getItem(DRAFT_KEY);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored as string);
    expect(parsed.accountType).toBe("JUGADOR");
    expect(parsed.nombres).toBe("Mateo Andres");
    expect(parsed.cedula).toBe("1798765432");
  });

  it("restaura los datos y los rotula como borrador sin enviar tras remontar el asistente (simula volver de /login)", async () => {
    const { unmount } = render(<CrearCuentaPage />);

    fireEvent.click(screen.getByRole("button", { name: /^Representante/ }));
    fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
    fireEvent.change(screen.getByLabelText(/^Nombres/), { target: { value: "Lucia" } });
    fireEvent.change(screen.getByLabelText(/^Apellidos/), { target: { value: "Vera Solis" } });
    fireEvent.change(screen.getByLabelText(/^Cédula/), { target: { value: "1712345678" } });

    // The session expiring mid-wizard unmounts this tree (redirected to
    // /login) and a later remount (after the admin logs back in) is a FRESH
    // mount of the same component — sessionStorage is what survives, not
    // React state.
    unmount();

    render(<CrearCuentaPage />);

    expect(
      screen.getByText(/Recuperamos los datos que ya había completado/i),
    ).toBeInTheDocument();
    // Still on step 1, but the restored value carries all the way to the
    // step where it lives.
    fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
    expect(screen.getByLabelText(/^Nombres/)).toHaveValue("Lucia");
    expect(screen.getByLabelText(/^Apellidos/)).toHaveValue("Vera Solis");
    expect(screen.getByLabelText(/^Cédula/)).toHaveValue("1712345678");
  });

  it("retira el rótulo de borrador en cuanto el admin vuelve a tocar el formulario", async () => {
    const { unmount } = render(<CrearCuentaPage />);
    fireEvent.click(screen.getByRole("button", { name: /^Jugador/ }));
    fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
    fireEvent.change(screen.getByLabelText(/^Nombres/), { target: { value: "Ana" } });
    unmount();

    render(<CrearCuentaPage />);
    expect(screen.getByText(/Recuperamos los datos/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
    fireEvent.change(screen.getByLabelText(/^Apellidos/), { target: { value: "Otra" } });

    expect(screen.queryByText(/Recuperamos los datos/i)).not.toBeInTheDocument();
  });

  it("descarta el borrador una vez que la cuenta se crea de verdad", async () => {
    vi.mocked(crearCuentaAdmin).mockResolvedValueOnce({
      persona_id: 1,
      usuario_id: 1,
      correo: "mateo@cataclub.test",
    });

    render(<CrearCuentaPage />);

    fireEvent.click(screen.getByRole("button", { name: /^Jugador/ }));
    fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
    fireEvent.change(screen.getByLabelText(/^Nombres/), { target: { value: "Mateo Andres" } });
    fireEvent.change(screen.getByLabelText(/^Apellidos/), { target: { value: "Zambrano Loor" } });
    fireEvent.change(screen.getByLabelText(/^Cédula/), { target: { value: "1798765432" } });
    fillBirthDate(crearCuentaFieldId("fechaNacimiento"), "1998-03-20");
    fireEvent.change(screen.getByLabelText(/^Teléfono/), { target: { value: "0991234567" } });
    fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));

    // Health step. Issue #730: this walk creates a Jugador, and a student's
    // medical record is no longer optional — leaving it blank stops the
    // wizard here, and this test never reaches the draft-clearing it
    // measures.
    fireEvent.change(screen.getByLabelText(/Tipo de sangre/), { target: { value: "O_POSITIVO" } });
    fireEvent.change(screen.getByLabelText(/Nombre del contacto de emergencia/), {
      target: { value: "Ana Perez" },
    });
    fireEvent.change(screen.getByLabelText(/Teléfono de emergencia/), {
      target: { value: "0991112233" },
    });
    fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));

    fireEvent.change(screen.getByLabelText(/correo electrónico/i), { target: { value: "mateo@example.com" } });
    // Anchored, not a bare `/contraseña/i`: issue #661's reveal toggle button
    // carries an `aria-label` ("Mostrar contraseña") that also contains the
    // word, and would otherwise tie for the same query.
    fireEvent.change(screen.getByLabelText(/^contraseña/i), { target: { value: "password8" } });
    fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));

    expect(window.sessionStorage.getItem(DRAFT_KEY)).not.toBeNull();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /crear cuenta/i }));

    await screen.findByText(/cuenta creada/i);

    expect(window.sessionStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});
