/**
 * Component tests for the public enrollment wizard (`/student/enroll`).
 *
 * Covers the two things that only matter once the landing page routes every
 * enrollment CTA here: the demo quick-fill panel must never reach a
 * production build, and the back-link must not send an unauthenticated
 * visitor into the protected `/student` prefix.
 *
 * Mocking pattern mirrors StudentPage.test.tsx (next/link, AuthContext and
 * @/services/api stubbed).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import EnrollPage from "@/app/student/enroll/page";
import { resetTestHistory, useTestSearchParams } from "@/lib/__tests__/next-navigation-double";
import { enrollStudent } from "@/services/api";
import { MENSAJE_IDENTIDAD_DUPLICADA } from "@/lib/duplicate-identity";

// The wizard's step lives in the query string now. The double is backed by
// jsdom's real history so these tests walk the same URL a browser would.
vi.mock("next/navigation", () => ({
  usePathname: () => "/student/enroll",
  useSearchParams: () => useTestSearchParams(),
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

let mockIsAuthenticated = false;

let mockAuthRole: "admin" | "trainer" | "representante" | "estudiante" | "unsupported" | null = null;
let mockAuthLoading = false;
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    session: mockAuthRole ? { user: { role: mockAuthRole } } : null,
    isAuthenticated: mockIsAuthenticated,
    isLoading: mockAuthLoading,
    refreshSession: vi.fn(),
  }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ showError: vi.fn(), showSuccess: vi.fn() }),
}));

vi.mock("@/services/api", () => ({
  enrollStudent: vi.fn(),
  // The wizard loads the school catalogue on mount for the child flow.
  fetchInstituciones: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/enrollment-session", () => ({
  clearLegacyEnrollmentSession: vi.fn(),
}));

const DEMO_PANEL_LABEL = /rellenar datos de prueba/i;

beforeEach(() => {
  mockIsAuthenticated = false;
  // Every case starts on step 1 with a clean address bar; the wizard reads its
  // step from there, so a URL left by the previous case would decide where the
  // next one opens.
  resetTestHistory("/student/enroll");
});

afterEach(() => {
  // Unmount before rewriting the URL — vitest runs `afterEach` in reverse
  // registration order, so testing-library's cleanup would otherwise run last.
  cleanup();
  resetTestHistory("/");
  vi.unstubAllEnvs();
});

describe("EnrollPage — demo quick-fill panel", () => {
  it("renders the quick-fill panel outside production", () => {
    vi.stubEnv("NODE_ENV", "development");

    render(<EnrollPage />);

    expect(screen.getByText(DEMO_PANEL_LABEL)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Jugador" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Representante" })).toBeInTheDocument();
  });

  it("does not render the quick-fill panel in a production build", () => {
    vi.stubEnv("NODE_ENV", "production");

    render(<EnrollPage />);

    expect(screen.queryByText(DEMO_PANEL_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Jugador" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Representante" })).not.toBeInTheDocument();
  });
});

describe("EnrollPage — back link", () => {
  it("sends an unauthenticated visitor back to the landing page", () => {
    mockIsAuthenticated = false;

    render(<EnrollPage />);

    const link = screen.getByRole("link", { name: /volver al inicio/i });
    expect(link).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: /volver a mi cuenta/i })).not.toBeInTheDocument();
  });

  it("sends an authenticated user back to their account", () => {
    // El rol viaja CON la sesión: `isAuthenticated` es `session !== null` en el
    // contexto real, así que el destino se deriva de la sesión y no de los dos
    // valores por separado. Con los dos, podían contradecirse -- y la rama que
    // ganaba mandaba a un usuario logueado a la landing (#295, segunda pasada).
    mockIsAuthenticated = true;
    mockAuthRole = "estudiante";

    render(<EnrollPage />);

    const link = screen.getByRole("link", { name: /volver a mi cuenta/i });
    expect(link).toHaveAttribute("href", "/student");
  });
});

describe("EnrollPage — the named stepper", () => {
  it("names every step of a self enrollment from step one", () => {
    render(<EnrollPage />);

    const stepper = screen.getByRole("list", { name: /pasos de la inscripción/i });
    expect(within(stepper).getByText("Tipo")).toBeInTheDocument();
    expect(within(stepper).getByText("Estudiante")).toBeInTheDocument();
    expect(within(stepper).getByText("Salud")).toBeInTheDocument();
    expect(within(stepper).getByText("Confirmar")).toBeInTheDocument();
    // A self enrollment has no representante, so it never gets that step.
    expect(within(stepper).queryByText("Representante")).not.toBeInTheDocument();
  });

  it("adds the representante step once a dependent enrollment is chosen", () => {
    render(<EnrollPage />);

    fireEvent.click(screen.getByRole("button", { name: /^Representante Gestiono la inscripción/ }));

    const stepper = screen.getByRole("list", { name: /pasos de la inscripción/i });
    expect(within(stepper).getByText("Representante")).toBeInTheDocument();
  });
});

describe("EnrollPage — choice cards", () => {
  it("marks the selected type with the coal + ball pill, never a red one", () => {
    render(<EnrollPage />);

    const selected = screen.getByRole("button", { name: /^Jugador Me inscribo yo al club/ });
    expect(selected).toHaveAttribute("aria-pressed", "true");
    expect(selected.className).toContain("border-coal");
    expect(selected.className).not.toMatch(/cata-red/);

    const other = screen.getByRole("button", { name: /^Representante Gestiono la inscripción/ });
    expect(other).toHaveAttribute("aria-pressed", "false");
  });

  it("moves the selection when the other card is chosen", () => {
    render(<EnrollPage />);

    const representante = screen.getByRole("button", { name: /^Representante Gestiono la inscripción/ });
    fireEvent.click(representante);

    expect(representante).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: /^Jugador Me inscribo yo al club/ }),
    ).toHaveAttribute("aria-pressed", "false");
  });
});

describe("EnrollPage — error prevention on the student step", () => {
  function goToStudentStep(): void {
    fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ }));
  }

  it("disables 'Siguiente' on an empty step and says what is missing", () => {
    render(<EnrollPage />);
    goToStudentStep();

    const next = screen.getByRole("button", { name: /^Siguiente/ });
    expect(next).toBeDisabled();
    expect(screen.getByText(/para continuar, revise:/i)).toHaveTextContent("Nombres");
    expect(screen.getByText(/para continuar, revise:/i)).toHaveTextContent("Cédula de identidad");
  });

  it("shows the cédula message beside the field only after the visitor leaves it", () => {
    render(<EnrollPage />);
    goToStudentStep();

    const cedula = screen.getByLabelText(/cédula de identidad/i);
    fireEvent.change(cedula, { target: { value: "13100456" } });
    expect(screen.queryByText("La cédula de identidad debe tener 10 dígitos.")).not.toBeInTheDocument();

    fireEvent.blur(cedula);
    expect(screen.getByText("La cédula de identidad debe tener 10 dígitos.")).toBeInTheDocument();
    expect(cedula).toHaveAttribute("aria-invalid", "true");
  });

  it("counts the cédula digits as they are typed", () => {
    render(<EnrollPage />);
    goToStudentStep();

    fireEvent.change(screen.getByLabelText(/cédula de identidad/i), { target: { value: "13100456" } });
    expect(screen.getByText("Lleva 8 de 10 dígitos.")).toBeInTheDocument();
  });

  /**
   * #225 (original bug) — a bare `maxLength={10}` silently ate the 11th
   * digit with no explanation. PR #255 removed it and let the field carry
   * every digit typed, so the length rule could say why it was wrong.
   *
   * A later QA pass on this same field asked for the cap BACK ("no puede
   * tipear 11"), but never silent again: the 11th digit still doesn't land,
   * and now an explicit, `aria-live` warning fires the moment that happens
   * — the distinguishing feature from the original bug (see
   * `numeric-input.ts`). This is still not a native `maxLength`: that
   * attribute can't carry a warning, so the cap is enforced in JS instead.
   */
  it("caps the cédula input at 10 digits and warns instead of truncating silently (#225)", () => {
    render(<EnrollPage />);
    goToStudentStep();

    const cedula = screen.getByLabelText(/cédula de identidad/i);
    expect(cedula).not.toHaveAttribute("maxLength");
    expect(cedula).toHaveAttribute("inputMode", "numeric");
    expect(cedula).toHaveAttribute("pattern", "[0-9]{10}");

    fireEvent.change(cedula, { target: { value: "17123456789" } });
    // The 11th digit never lands...
    expect(cedula).toHaveValue("1712345678");
    // ...and the visitor is told why, not left to wonder where it went.
    const warning = screen.getByText(/alcanzó el máximo de 10 dígitos/i);
    expect(warning.closest("[aria-live]")).toHaveAttribute("aria-live", "polite");

    fireEvent.blur(cedula);
    // "1712345678" is EL PLACEHOLDER this same form suggests (see V03 in
    // enroll-qa.spec.ts): 10 digits, but the wrong check digit — the rule
    // still catches it, now with "not valid" instead of "wrong length".
    expect(screen.getByText("La cédula de identidad no es válida.")).toBeInTheDocument();
  });

  it("enables 'Siguiente' once every field on the step is valid", () => {
    render(<EnrollPage />);
    goToStudentStep();

    fireEvent.change(screen.getByLabelText(/^Nombres/), { target: { value: "Sofia" } });
    fireEvent.change(screen.getByLabelText(/^Apellidos/), { target: { value: "Martinez" } });
    fireEvent.change(screen.getByLabelText(/fecha de nacimiento/i), { target: { value: "1990-05-20" } });
    fireEvent.change(screen.getByLabelText(/cédula de identidad/i), { target: { value: "1798765432" } });
    fireEvent.change(screen.getByLabelText(/^Teléfono/), { target: { value: "0991234567" } });
    // A self enrollment signs in as the student, so its credentials are part
    // of this step (they moved here when the representante got its own step).
    fireEvent.change(screen.getByLabelText(/^Correo electrónico/), { target: { value: "sofia@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Contraseña/), { target: { value: "password8" } });

    expect(screen.getByRole("button", { name: /^Siguiente/ })).toBeEnabled();
    expect(screen.queryByText(/para continuar, revise:/i)).not.toBeInTheDocument();
  });

  // #312 / hallazgo #32 — the birth-date field had no min/max, no format
  // hint, and its LIVE preview (before blur, before studentBirthDateRule's
  // own message) showed a raw impossible age for a typo'd year.
  it("bounds the birth-date field to plausible member ages", () => {
    render(<EnrollPage />);
    goToStudentStep();

    const fecha = screen.getByLabelText(/fecha de nacimiento/i);
    const thisYear = new Date().getFullYear();
    expect(fecha).toHaveAttribute("min", `${thisYear - 75}-01-01`);
    expect(fecha).toHaveAttribute("max", `${thisYear - 5}-12-31`);
  });

  it("hints the expected year format next to the birth-date field", () => {
    render(<EnrollPage />);
    goToStudentStep();

    const fecha = screen.getByLabelText(/fecha de nacimiento/i);
    expect(fecha).toHaveAttribute("aria-describedby");
    const hintId = fecha.getAttribute("aria-describedby") as string;
    expect(document.getElementById(hintId)?.textContent).toMatch(/año/i);
  });

  it("says 'revise el año' instead of a four-digit age while the field still has focus", () => {
    render(<EnrollPage />);
    goToStudentStep();

    const fecha = screen.getByLabelText(/fecha de nacimiento/i);
    // The exact repro from the audit: a typo'd year (1015 for 2015), field
    // still focused — the moment studentBirthDateRule's own message has not
    // fired yet.
    fireEvent.change(fecha, { target: { value: "1015-06-15" } });

    expect(screen.queryByText(/1011 años/)).not.toBeInTheDocument();
    expect(screen.getByText(/revise el año/i)).toBeInTheDocument();
  });

  it("keeps a minor from self-enrolling, with the message on the birth-date field", () => {
    render(<EnrollPage />);
    goToStudentStep();

    const fecha = screen.getByLabelText(/fecha de nacimiento/i);
    fireEvent.change(fecha, { target: { value: "2015-06-15" } });
    fireEvent.blur(fecha);

    expect(screen.getByText(/menores de edad no pueden autoinscribirse/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Siguiente/ })).toBeDisabled();
  });
});

/**
 * Task 2 (QA cycle 2026-08-12): a duplicate-identity 400 used to leave the
 * visitor on the summary with only the generic message — no indication of
 * which step/field to revisit. The fix flags the summary rows that hold a
 * candidate field (student cédula; for a dependent, also the representative's
 * cédula/correo) so the visitor's eye lands on the right "Corregir" button —
 * without the alert itself ever naming a field, which would turn the public
 * enrollment form into an oracle for probing who's already registered
 * (issue #233). `stepAlert`'s equivalent here — the `role="alert"` box — is
 * checked for exactly that absence, mirroring `enroll-qa.spec.ts`'s S09.
 */
describe("EnrollPage — duplicate-identity recovery on the summary step", () => {
  function fillValidSelfEnrollment(): void {
    fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ }));
    fireEvent.change(screen.getByLabelText(/^Nombres/), { target: { value: "Sofia" } });
    fireEvent.change(screen.getByLabelText(/^Apellidos/), { target: { value: "Martinez" } });
    fireEvent.change(screen.getByLabelText(/fecha de nacimiento/i), { target: { value: "1990-05-20" } });
    fireEvent.change(screen.getByLabelText(/cédula de identidad/i), { target: { value: "1798765432" } });
    fireEvent.change(screen.getByLabelText(/^Teléfono/), { target: { value: "0991234567" } });
    fireEvent.change(screen.getByLabelText(/^Correo electrónico/), { target: { value: "sofia@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Contraseña/), { target: { value: "password8" } });
    fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ }));

    fireEvent.change(screen.getByLabelText(/tipo de sangre/i), { target: { value: "O_POSITIVO" } });
    fireEvent.change(screen.getByLabelText(/nombre del contacto/i), { target: { value: "Ana Martinez" } });
    fireEvent.change(screen.getByLabelText(/teléfono de emergencia/i), { target: { value: "0999888777" } });
    fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ }));

    fireEvent.click(screen.getByRole("checkbox"));
  }

  async function submitAndFailWithDuplicate(): Promise<void> {
    vi.mocked(enrollStudent).mockRejectedValueOnce(
      Object.assign(new Error(MENSAJE_IDENTIDAD_DUPLICADA), { status: 400 }),
    );
    fireEvent.click(screen.getByRole("button", { name: /confirmar inscripción/i }));
    await screen.findByRole("alert");
  }

  it("flags the Cédula summary row without naming any field inside the alert itself", async () => {
    render(<EnrollPage />);
    fillValidSelfEnrollment();
    await submitAndFailWithDuplicate();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(MENSAJE_IDENTIDAD_DUPLICADA);
    // The oracle guard: the alert names no field, mirroring S09 in
    // enroll-qa.spec.ts at the unit level.
    expect(alert.textContent ?? "").not.toMatch(/cédula/i);
    expect(alert.textContent ?? "").not.toMatch(/correo/i);

    // The flag lives OUTSIDE the alert, on the summary row itself, right
    // next to the pre-existing "Corregir" button — no new navigation, no
    // field name inside the alert.
    //
    // `closest("li")` and not `closest("div")`: the summary rows are the items
    // of a `DataRowList` now, so the nearest `div` is the container that holds
    // EVERY row — which would make this assertion (and, worse, the unrelated-row
    // one below) pass on any row in the list. The element is the same one it
    // always was; only the tag it is asked for changed.
    const cedulaRow = screen.getByText("Cédula").closest("li");
    expect(cedulaRow).not.toBeNull();
    expect(within(cedulaRow as HTMLElement).getByText(/revisar/i)).toBeInTheDocument();
    expect(within(cedulaRow as HTMLElement).getByRole("button", { name: /corregir/i })).toBeVisible();
  });

  it("still offers the two exits (Iniciar sesión / Recuperar contraseña)", async () => {
    render(<EnrollPage />);
    fillValidSelfEnrollment();
    await submitAndFailWithDuplicate();

    const alert = screen.getByRole("alert");
    expect(within(alert).getByRole("link", { name: /iniciar sesión/i })).toHaveAttribute("href", "/login");
    expect(within(alert).getByRole("link", { name: /recuperar contraseña/i })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });

  it("keeps every 'Corregir' button visible — no auto-navigation away from the summary", async () => {
    render(<EnrollPage />);
    fillValidSelfEnrollment();
    await submitAndFailWithDuplicate();

    const corregirButtons = screen.getAllByRole("button", { name: /corregir/i });
    expect(corregirButtons.length).toBeGreaterThan(0);
    corregirButtons.forEach((button) => expect(button).toBeVisible());
  });

  it("does not flag an unrelated row (Teléfono is not a duplicate-identity candidate)", async () => {
    render(<EnrollPage />);
    fillValidSelfEnrollment();
    await submitAndFailWithDuplicate();

    const telefonoRow = screen.getByText("Teléfono").closest("li");
    expect(within(telefonoRow as HTMLElement).queryByText(/revisar/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// La salida del asistente (#295, segunda pasada)
//
// La primera pasada del #295 dio por bueno este control porque su condición se
// LEE bien: autenticado -> /student, si no -> /. Los dos lados están mal.
//
// Uno: decidía sin saber. `isAuthenticated` es false mientras la sesión se
// hidrata (AuthContext arranca en `session: null, isLoading: true`), así que
// un usuario logueado veía "Volver al Inicio" durante ese round trip y, si
// tocaba ahí, salía a la landing. Un control no puede afirmar un destino que
// todavía no conoce -- es el mismo defecto que el issue nombró, una pantalla
// más allá.
//
// Dos: `/student` no es la casa de todos. Un admin o un entrenador logueado
// no vuelve al portal del alumno.
// ---------------------------------------------------------------------------

describe("EnrollPage — la salida del asistente", () => {
  beforeEach(() => {
    mockIsAuthenticated = false;
    mockAuthRole = null;
    mockAuthLoading = false;
  });

  it("manda al sitio público al visitante anónimo, que es de donde vino", () => {
    render(<EnrollPage />);

    expect(screen.getByRole("link", { name: /^volver/i })).toHaveAttribute("href", "/");
  });

  it("no ofrece ningún destino mientras todavía no sabe si hay sesión", () => {
    // El caso que reportó el QA: logueado, pero la sesión no terminó de
    // hidratarse. Antes decía "Volver al Inicio" y cumplía la amenaza.
    mockAuthLoading = true;
    render(<EnrollPage />);

    expect(screen.queryByRole("link", { name: /^volver/i })).not.toBeInTheDocument();
  });

  it("devuelve a cada rol a SU casa, no al portal del alumno", () => {
    mockIsAuthenticated = true;

    mockAuthRole = "admin";
    const { unmount } = render(<EnrollPage />);
    expect(screen.getByRole("link", { name: /^volver/i })).toHaveAttribute("href", "/dashboard");
    unmount();

    mockAuthRole = "trainer";
    const segundo = render(<EnrollPage />);
    expect(screen.getByRole("link", { name: /^volver/i })).toHaveAttribute("href", "/trainer");
    segundo.unmount();

    mockAuthRole = "representante";
    render(<EnrollPage />);
    expect(screen.getByRole("link", { name: /^volver/i })).toHaveAttribute("href", "/student");
  });
});

// ---------------------------------------------------------------------------
// #312 / hallazgo #2 (bloqueante) — el paso 5 apagaba "Confirmar inscripción"
// sin decir por qué, rompiendo el patrón que los pasos 2-4 ya tienen
// ("Para continuar, revise: ..."). Hallazgo #9 — la casilla que lo destraba
// medía 16x16px, bajo el mínimo de 24x24 de WCAG 2.2 SC 2.5.8.
// ---------------------------------------------------------------------------
describe("EnrollPage — motivo del bloqueo en el paso 5 (#312 / #2, #9)", () => {
  function reachSummaryStep(): void {
    fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ }));
    fireEvent.change(screen.getByLabelText(/^Nombres/), { target: { value: "Sofia" } });
    fireEvent.change(screen.getByLabelText(/^Apellidos/), { target: { value: "Martinez" } });
    fireEvent.change(screen.getByLabelText(/fecha de nacimiento/i), { target: { value: "1990-05-20" } });
    fireEvent.change(screen.getByLabelText(/cédula de identidad/i), { target: { value: "1798765432" } });
    fireEvent.change(screen.getByLabelText(/^Teléfono/), { target: { value: "0991234567" } });
    fireEvent.change(screen.getByLabelText(/^Correo electrónico/), { target: { value: "sofia@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Contraseña/), { target: { value: "password8" } });
    fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ }));

    fireEvent.change(screen.getByLabelText(/tipo de sangre/i), { target: { value: "O_POSITIVO" } });
    fireEvent.change(screen.getByLabelText(/nombre del contacto/i), { target: { value: "Ana Martinez" } });
    fireEvent.change(screen.getByLabelText(/teléfono de emergencia/i), { target: { value: "0999888777" } });
    fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ }));
  }

  it("names why 'Confirmar inscripción' is disabled, the same pattern steps 2-4 already use", () => {
    render(<EnrollPage />);
    reachSummaryStep();

    const confirmButton = screen.getByRole("button", { name: /confirmar inscripción/i });
    expect(confirmButton).toBeDisabled();
    expect(screen.getByText(/para continuar, marque la casilla de confirmación/i)).toBeInTheDocument();
  });

  it("enables 'Confirmar inscripción' and drops the reason once the checkbox is checked", () => {
    render(<EnrollPage />);
    reachSummaryStep();

    fireEvent.click(screen.getByRole("checkbox"));

    const confirmButton = screen.getByRole("button", { name: /confirmar inscripción/i });
    expect(confirmButton).toBeEnabled();
    expect(screen.queryByText(/para continuar, marque la casilla de confirmación/i)).not.toBeInTheDocument();
  });

  it("gives the confirmation checkbox a >=24x24px target, not the old 16x16 (h-4 w-4)", () => {
    render(<EnrollPage />);
    reachSummaryStep();

    const checkbox = screen.getByRole("checkbox");
    // jsdom runs no layout, so it cannot report a real getBoundingClientRect
    // (that is how the audit itself measured 16x16px, in a real browser).
    // The equivalent, deterministic check here is the Tailwind size class —
    // `h-6 w-6` IS 24px and `h-4 w-4` IS 16px in this design system's
    // (un-overridden) spacing scale, see tailwind.config.ts.
    expect(checkbox.className).toMatch(/\bh-6\b/);
    expect(checkbox.className).toMatch(/\bw-6\b/);
    expect(checkbox.className).not.toMatch(/\bh-4\b/);
    expect(checkbox.className).not.toMatch(/\bw-4\b/);
  });
});
