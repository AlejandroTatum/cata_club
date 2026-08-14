/**
 * The parts of `/admin/crear-cuenta` that a screenshot proves once and a
 * rewrite loses silently.
 *
 * This screen carried more of the retired system than any other in the
 * product, and it carried it in one place, which is why nothing caught it: the
 * two sweeps that would have (`display-face-usage`, `arbitrary-style-values`)
 * are about the face and about magic numbers, and everything here was a
 * legitimate token spelled the old way.
 *
 *  · **The ink was an alpha, not a step.** Thirty-four `text-cata-text/NN`, and
 *    eight of them at `/40`, `/45` or `/50` — 2.36:1, 2.67:1 and 3.05:1 on
 *    paper. Six of the eight were the summary's own section labels, so the
 *    words naming each block of the account about to be created were the least
 *    legible strings on the screen. `lib/__tests__/ink-ramp-usage.test.ts` is
 *    the product-wide lock; these cases are this screen's.
 *  · **Red was the selected state.** All four account cards drew selection as
 *    `bg-cata-red/10` + `ring-cata-red/20` + `border-cata-red/40`, which "la
 *    regla del rojo único" forbids in as many words: *"Nunca es un estado
 *    seleccionado […] Un estado activo se dibuja con caucho más el punto
 *    amarillo."* It also collided with the screen's own hues — "Jugador" wears
 *    `cata-red/15` as its CATEGORY, so selecting it painted the same colour
 *    twice for two different reasons.
 *  · **Red was decoration.** Ten `text-cata-red` icons, one per step header and
 *    one per summary block, on a wizard with exactly one red button.
 *  · **The ids came from the labels.** Not one of the seven `WizardInput`s
 *    declared a `field`.
 *  · **The success screen reserved three quarters of the window.**
 *    `min-h-[75vh]` around four short lines, and its primary action was a
 *    `<button>` that called `router.push` — a navigation wearing the one shape
 *    the system reserves for something that is not one.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CrearCuentaPage from "@/app/admin/crear-cuenta/page";
import { resetTestHistory, useTestSearchParams } from "@/lib/__tests__/next-navigation-double";
import { fetchInstituciones } from "@/services/api";
import {
  CREAR_CUENTA_FIELD_TOKEN,
  crearCuentaFieldId,
  type CrearCuentaField,
} from "@/app/admin/crear-cuenta/crear-cuenta-utils";
import { slugifyLabel } from "@/components/wizard-fields";

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

/** Choose an account type and walk to the identity step. */
function goToPersonalStep(): void {
  fireEvent.click(screen.getByRole("button", { name: /^Jugador/ }));
  fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
}

/** Walk on to the health step, filling the identity the previous one demands. */
function goToHealthStep(): void {
  goToPersonalStep();
  fireEvent.change(screen.getByLabelText(/^Nombres/), { target: { value: "Mateo Andres" } });
  fireEvent.change(screen.getByLabelText(/^Apellidos/), { target: { value: "Zambrano Loor" } });
  fireEvent.change(screen.getByLabelText(/^Cédula/), { target: { value: "1798765432" } });
  fireEvent.change(screen.getByLabelText(/Fecha de nacimiento/), {
    target: { value: "1998-03-20" },
  });
  fireEvent.change(screen.getByLabelText(/^Teléfono$/), { target: { value: "0991234567" } });
  fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
}

describe("the field ids are declared, not slugged from the label", () => {
  it("renders the identity step under the ids the token table declares", () => {
    render(<CrearCuentaPage />);
    goToPersonalStep();

    for (const field of ["nombres", "apellidos", "cedula", "fechaNacimiento", "telefono"] as const) {
      expect(document.getElementById(crearCuentaFieldId(field))).not.toBeNull();
    }
  });

  it("renders the health step under those ids too", () => {
    render(<CrearCuentaPage />);
    goToHealthStep();

    for (const field of [
      "tipoSangre",
      "condicionesSalud",
      "alergias",
      "contactoEmergencia",
      "telefonoEmergencia",
    ] as const) {
      expect(document.getElementById(crearCuentaFieldId(field))).not.toBeNull();
    }
  });

  /**
   * The load-bearing pair. Both of these labels change in this batch — one for
   * Title Case, one for a missing accent — and under the old scheme each
   * rename silently moved an id.
   */
  it("names the birth-date and password fields after the field, not after the label", () => {
    expect(CREAR_CUENTA_FIELD_TOKEN.fechaNacimiento).toBe("fecha-nacimiento");
    expect(CREAR_CUENTA_FIELD_TOKEN.fechaNacimiento).not.toBe(slugifyLabel("Fecha de Nacimiento"));
    expect(CREAR_CUENTA_FIELD_TOKEN.contrasenia).toBe("contrasenia");
    expect(CREAR_CUENTA_FIELD_TOKEN.contrasenia).not.toBe(slugifyLabel("Contraseña"));
  });

  it("gives no two fields the same id", () => {
    const tokens = Object.values(CREAR_CUENTA_FIELD_TOKEN);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("declares an id for every field the payload carries", () => {
    const declared = Object.keys(CREAR_CUENTA_FIELD_TOKEN) as CrearCuentaField[];
    expect(declared).toContain("accountType");
    expect(declared).toContain("representanteId");
    expect(declared.length).toBeGreaterThanOrEqual(15);
  });
});

describe("the red is the action and nothing else", () => {
  /**
   * Coal plus the ball dot, which is how `FilterPill` — the primitive that
   * owns the rule — draws every selected thing in this product.
   */
  it("draws the chosen account type in coal with the ball dot, never in red", () => {
    render(<CrearCuentaPage />);

    const card = screen.getByRole("button", { name: /^Jugador/ });
    fireEvent.click(card);

    expect(card.getAttribute("aria-pressed")).toBe("true");
    expect(card.className).toMatch(/\bborder-coal\b/);
    expect(card.className).not.toMatch(/cata-red\/\d/);
    expect(screen.getByTestId("account-type-mark-JUGADOR")).toBeInTheDocument();
  });

  it("leaves the unchosen cards on the system's hairline", () => {
    render(<CrearCuentaPage />);

    fireEvent.click(screen.getByRole("button", { name: /^Jugador/ }));

    const other = screen.getByRole("button", { name: /^Entrenador/ });
    expect(other.getAttribute("aria-pressed")).toBe("false");
    // The RESTING border. `hover:border-coal/30` stays — an unchosen card
    // still has to say it can be chosen.
    expect(other.className).toMatch(/(?:^|\s)border-line-2\b/);
    expect(other.className).not.toMatch(/(?:^|\s)border-coal\b/);
    expect(screen.queryByTestId("account-type-mark-ENTRENADOR")).not.toBeInTheDocument();
  });

  /**
   * The step header and the summary blocks each drew a red icon. Ten of them,
   * on a wizard with one red button — "el rojo es la acción y solo la acción,
   * nunca decoración".
   */
  it("keeps the action colour off the decorative icons", () => {
    const { container } = render(<CrearCuentaPage />);
    goToHealthStep();

    expect(container.querySelectorAll(".text-cata-red")).toHaveLength(0);
  });
});

describe("the surfaces come from the system's own ladder", () => {
  it("names an ink step instead of dialling the body ink down", () => {
    const { container } = render(<CrearCuentaPage />);
    goToHealthStep();

    expect(container.innerHTML).not.toMatch(/text-cata-text\//);
  });

  it("keeps the wizard on the system's two radii", () => {
    const { container } = render(<CrearCuentaPage />);
    goToHealthStep();

    expect(container.querySelectorAll(".rounded-xl")).toHaveLength(0);
    expect(container.querySelectorAll(".rounded-lg")).toHaveLength(0);
  });
});

describe("one vocabulary for an example", () => {
  it("never abbreviates 'por ejemplo' in a placeholder", () => {
    render(<CrearCuentaPage />);
    goToHealthStep();

    for (const input of Array.from(document.querySelectorAll("input, textarea"))) {
      expect(input.getAttribute("placeholder") ?? "").not.toMatch(/p\.\s*ej\./i);
    }
    expect(
      document.getElementById(crearCuentaFieldId("alergias"))?.getAttribute("placeholder"),
    ).toMatch(/^Por ejemplo: /);
  });
});

describe("the progress is the named stepper, not an anonymous bar", () => {
  /**
   * The two student wizards draw `Stepper`: five named pills, so the visitor
   * can see what is behind and what is ahead. This one drew a filled bar and a
   * "Paso 1 de 5" — the same fact as a percentage, which tells nobody what
   * step four asks for. Two vocabularies for one job, in one product.
   */
  it("names every step the wizard has", () => {
    render(<CrearCuentaPage />);

    const stepper = screen.getByRole("list", { name: /pasos para crear una cuenta/i });
    expect(stepper).toBeInTheDocument();
    for (const label of ["Tipo", "Datos", "Salud", "Acceso", "Confirmar"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
