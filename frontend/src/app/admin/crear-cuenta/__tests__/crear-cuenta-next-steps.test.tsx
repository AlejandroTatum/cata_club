/**
 * #317 / hallazgo #36: `/admin/crear-cuenta` declares 5 pasos — tipo, datos,
 * salud, acceso, confirmar — y ninguno es de plan, horario ni cobro. Al
 * terminar, la pantalla de "Cuenta creada" decía cómo el socio iba a entrar
 * (correo + contraseña) pero nada de cómo el club iba a cobrarle ni
 * inscribirlo en un horario. Un admin nuevo completaba las cinco pantallas,
 * veía la cuenta creada y no tenía forma de saber que faltaban dos
 * operaciones en dos secciones distintas para que el socio existiera de
 * verdad.
 *
 * El fix adelanta esa información al cierre del asistente — no agrega un
 * paso — señalando las dos pantallas donde el admin sigue: Horarios → Ver
 * alumnos (asignar horario) y la ficha del socio en Miembros (registrar el
 * primer pago).
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

beforeEach(() => {
  vi.mocked(fetchInstituciones).mockResolvedValue([]);
  resetTestHistory("/admin/crear-cuenta");
});

afterEach(() => {
  cleanup();
});

async function createAccountAndConfirm(accountType: "Jugador" | "Entrenador" = "Jugador"): Promise<void> {
  vi.mocked(crearCuentaAdmin).mockResolvedValueOnce({
    access_token: "a",
    refresh_token: "b",
    token_type: "bearer",
    persona_id: 1,
  });

  render(<CrearCuentaPage />);

  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${accountType}`) }));
  fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));

  fireEvent.change(screen.getByLabelText(/^Nombres/), { target: { value: "Mateo Andres" } });
  fireEvent.change(screen.getByLabelText(/^Apellidos/), { target: { value: "Zambrano Loor" } });
  fireEvent.change(screen.getByLabelText(/^Cédula/), { target: { value: "1798765432" } });
  fillBirthDate(crearCuentaFieldId("fechaNacimiento"), "1998-03-20");
  fireEvent.change(screen.getByLabelText(/^Teléfono/), { target: { value: "0991234567" } });
  fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));

  // Health step. Issue #730: for a Jugador (a student) the medical record is
  // now required, so the walk has to fill it — leaving it blank would stop
  // the wizard here and this test would fail on the health step instead of
  // reaching the confirmation screen it actually measures. For an Entrenador
  // it stays optional, which is why the fill is conditional and not
  // unconditional: doing it for everyone would hide a regression in exactly
  // the boundary #730 drew.
  if (accountType === "Jugador") {
    fireEvent.change(screen.getByLabelText(/Tipo de sangre/), { target: { value: "O_POSITIVO" } });
    fireEvent.change(screen.getByLabelText(/Nombre del contacto de emergencia/), {
      target: { value: "Ana Perez" },
    });
    fireEvent.change(screen.getByLabelText(/Teléfono de emergencia/), {
      target: { value: "0991112233" },
    });
  }
  fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));

  fireEvent.change(screen.getByLabelText(/correo electrónico/i), { target: { value: "mateo@example.com" } });
  // Anchored, not a bare `/contraseña/i`: issue #661's reveal toggle button
  // carries an `aria-label` ("Mostrar contraseña") that also contains the
  // word, and would otherwise tie for the same query.
  fireEvent.change(screen.getByLabelText(/^contraseña/i), { target: { value: "password8" } });
  fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));

  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: /crear cuenta/i }));

  await screen.findByText(/cuenta creada/i);
}

describe("CrearCuentaPage — qué falta después de crear la cuenta (#317 / #36)", () => {
  it("dice que falta asignar un horario y registrar el primer pago, con dónde hacerlo", async () => {
    await createAccountAndConfirm();

    expect(screen.getByRole("link", { name: /^horarios$/i })).toHaveAttribute("href", "/groups");
    expect(screen.getByText(/ver alumnos/i)).toBeInTheDocument();
    expect(screen.getByText(/primer pago/i)).toBeInTheDocument();
  });

  it("da solo acceso y navegación al entrenador, sin instrucciones de socio", async () => {
    await createAccountAndConfirm("Entrenador");

    expect(screen.getByRole("link", { name: "Mi día" })).toHaveAttribute("href", "/trainer");
    expect(document.body).not.toHaveTextContent(/pago|mensualidad|membresía|inscribir|estudiante|asignar un horario/i);
  });

  it("no lo dice como un paso nuevo del asistente — el wizard sigue en 5 pasos", async () => {
    render(<CrearCuentaPage />);
    // The 5-step promise itself must not grow just to carry this information.
    expect(screen.getByText("Paso 1 de 5")).toBeInTheDocument();
  });
});
