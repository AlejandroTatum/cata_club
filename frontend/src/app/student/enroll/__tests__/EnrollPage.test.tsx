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
import { fillBirthDate } from "@/lib/__tests__/fill-birth-date";
import {
  fillEnrollStudentStep,
  fillEnrollHealthStep,
  completeSelfEnrollmentWizard,
} from "@/lib/__tests__/fill-enroll-student-step";
import { enrollFieldId } from "@/app/student/enroll/enroll-utils";
import { birthDatePartIds } from "@/components/wizard-fields";
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
    // #717: `refreshSession` answers with the session round trip's own
    // `SessionOutcome` — the wizard now reads it to decide whether it may
    // claim the auto-login took. These tests are the happy path, so the
    // browser kept the cookies.
    refreshSession: vi.fn().mockResolvedValue({ kind: "authenticated" }),
  }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ showError: vi.fn(), showSuccess: vi.fn() }),
}));

vi.mock("@/services/api", () => ({
  enrollStudent: vi.fn(),
  // The wizard loads the school catalogue on mount for the child flow.
  fetchInstituciones: vi.fn().mockResolvedValue([]),
  // Public tariff catalog shown on step 1 (issue #331) — mocked so the
  // wizard's fetch-on-mount effect resolves instead of hanging in jsdom.
  fetchTarifas: vi.fn().mockResolvedValue([{ categoria: "Categoria Test", precio: "1.00" }]),
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
  // A draft left by a previous case would decide where THIS one opens too —
  // sessionStorage is real jsdom storage here, not a fixture, so it survives
  // between tests unless cleared.
  window.sessionStorage.clear();
});

afterEach(() => {
  // Unmount before rewriting the URL — vitest runs `afterEach` in reverse
  // registration order, so testing-library's cleanup would otherwise run last.
  cleanup();
  resetTestHistory("/");
  window.sessionStorage.clear();
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

// #312 / hallazgo #33 — same gap on the representative step (paso 3).
describe("EnrollPage — autocomplete on the representative step", () => {
  it("declares autocomplete on the representative's own fields", () => {
    render(<EnrollPage />);
    fireEvent.click(screen.getByRole("button", { name: /^Representante Gestiono la inscripción/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ }));

    // The representative step's own fields carry PLAIN labels ("Nombres",
    // not "Nombres del representante") — the card title says whose data
    // this is, so only one "Nombres" field exists on screen at a time.
    expect(screen.getByLabelText(/^Nombres/)).toHaveAttribute("autoComplete", "given-name");
    expect(screen.getByLabelText(/^Apellidos/)).toHaveAttribute("autoComplete", "family-name");
    const fechaParts = birthDatePartIds(enrollFieldId("fechaNacimiento"));
    expect(document.getElementById(fechaParts.day)).toHaveAttribute("autoComplete", "bday-day");
    expect(document.getElementById(fechaParts.month)).toHaveAttribute("autoComplete", "bday-month");
    expect(document.getElementById(fechaParts.year)).toHaveAttribute("autoComplete", "bday-year");
    expect(screen.getByLabelText(/^Teléfono/)).toHaveAttribute("autoComplete", "tel");
    expect(screen.getByLabelText(/^Correo electrónico/)).toHaveAttribute("autoComplete", "email");
    expect(screen.getByLabelText(/^Contraseña/)).toHaveAttribute("autoComplete", "new-password");
  });
});

describe("EnrollPage — choice cards", () => {
  /**
   * Issue #874 moves this ONE selected state to `cata-red` — the wizard's own
   * carve-out from "la regla del rojo único" (DESIGN.md), so the selected
   * card's border stops competing with the primary button for the last
   * hierarchy signal on a screen that used to read flat white-grey. The
   * marker that reads without colour is unchanged: `aria-pressed` plus the
   * "Seleccionado" pill, still coal with the ball dot.
   */
  it("marks the selected type with the red border and the coal + ball pill", () => {
    render(<EnrollPage />);

    const selected = screen.getByRole("button", { name: /^Jugador Me inscribo yo al club/ });
    expect(selected).toHaveAttribute("aria-pressed", "true");
    expect(selected.className).toContain("border-cata-red");
    expect(selected.className).toContain("ring-cata-red");
    expect(screen.getByText("Seleccionado").className).toContain("bg-coal");

    const other = screen.getByRole("button", { name: /^Representante Gestiono la inscripción/ });
    expect(other).toHaveAttribute("aria-pressed", "false");
    expect(other.className).not.toMatch(/cata-red/);
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

    // A self enrollment signs in as the student, so its credentials are part
    // of this step (they moved here when the representante got its own step).
    fillEnrollStudentStep();

    expect(screen.getByRole("button", { name: /^Siguiente/ })).toBeEnabled();
    expect(screen.queryByText(/para continuar, revise:/i)).not.toBeInTheDocument();
  });

  // #312 / hallazgo #32 — the birth-date field had no min/max, no format
  // hint, and its LIVE preview (before blur, before studentBirthDateRule's
  // own message) showed a raw impossible age for a typo'd year. Issue #853
  // replaced the single native input with Día/Mes/Año — the bound now shows
  // on the Año part, the only one a calendar year applies to.
  it("bounds the birth-date year to plausible member ages", () => {
    render(<EnrollPage />);
    goToStudentStep();

    const year = screen.getByLabelText(/^Año/);
    const thisYear = new Date().getFullYear();
    expect(year).toHaveAttribute("min", `${thisYear - 75}`);
    expect(year).toHaveAttribute("max", `${thisYear - 5}`);
  });

  it("hints the expected format next to the birth-date field", () => {
    render(<EnrollPage />);
    goToStudentStep();

    const group = screen.getByRole("group", { name: /fecha de nacimiento/i });
    expect(group).toHaveAttribute("aria-describedby");
    const hintId = group.getAttribute("aria-describedby") as string;
    expect(document.getElementById(hintId)?.textContent).toMatch(/año/i);
  });

  it("says 'revise el año' instead of a four-digit age while the field still has focus", () => {
    render(<EnrollPage />);
    goToStudentStep();

    // The exact repro from the audit: a typo'd year (1015 for 2015), still
    // focused — the moment studentBirthDateRule's own message has not fired
    // yet.
    fillBirthDate(enrollFieldId("fechaNacimiento"), "1015-06-15");

    expect(screen.queryByText(/1011 años/)).not.toBeInTheDocument();
    expect(screen.getByText(/revise el año/i)).toBeInTheDocument();
  });

  // #312 / hallazgo #33 — ningún campo declaraba autocomplete, así que el
  // navegador no podía ofrecer nada guardado en un formulario de 17 campos.
  // Issue #853's Día/Mes/Año carries the three-part `bday-*` tokens instead
  // of the single `bday` the native input used.
  it("declares autocomplete on every field the browser can actually fill", () => {
    render(<EnrollPage />);
    goToStudentStep();

    expect(screen.getByLabelText(/^Nombres/)).toHaveAttribute("autoComplete", "given-name");
    expect(screen.getByLabelText(/^Apellidos/)).toHaveAttribute("autoComplete", "family-name");
    const fechaParts = birthDatePartIds(enrollFieldId("fechaNacimiento"));
    expect(document.getElementById(fechaParts.day)).toHaveAttribute("autoComplete", "bday-day");
    expect(document.getElementById(fechaParts.month)).toHaveAttribute("autoComplete", "bday-month");
    expect(document.getElementById(fechaParts.year)).toHaveAttribute("autoComplete", "bday-year");
    expect(screen.getByLabelText(/^Teléfono/)).toHaveAttribute("autoComplete", "tel");
    expect(screen.getByLabelText(/^Correo electrónico/)).toHaveAttribute("autoComplete", "email");
    expect(screen.getByLabelText(/^Contraseña/)).toHaveAttribute("autoComplete", "new-password");
    expect(screen.getByLabelText(/^Confirmar contraseña/)).toHaveAttribute("autoComplete", "new-password");
  });

  it("keeps a minor from self-enrolling, with the message on the birth-date field", () => {
    render(<EnrollPage />);
    goToStudentStep();

    fillBirthDate(enrollFieldId("fechaNacimiento"), "2015-06-15");
    fireEvent.blur(screen.getByLabelText(/^Año/));

    expect(screen.getByText(/menores de edad no pueden autoinscribirse/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Siguiente/ })).toBeDisabled();
  });

  /**
   * Issue #876: the confirmation blocks "Siguiente" the same way every other
   * field-level rule already does — a message beside the field, not just a
   * generic step alert.
   */
  it("blocks 'Siguiente' when the confirmation does not repeat the password", () => {
    render(<EnrollPage />);
    goToStudentStep();
    fillEnrollStudentStep();
    const confirm = screen.getByLabelText(/^Confirmar contraseña/);
    fireEvent.change(confirm, { target: { value: "otraClave9" } });
    fireEvent.blur(confirm);

    expect(screen.getByText("Las contraseñas no coinciden.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Siguiente/ })).toBeDisabled();

    fireEvent.change(confirm, { target: { value: "password8" } });
    expect(screen.getByRole("button", { name: /^Siguiente/ })).toBeEnabled();
  });
});

/**
 * Issue #876: the dependent's account is optional, and its confirmation
 * follows the same "both-or-neither" gate the password and correo already
 * use — it only exists while an account is actually being created.
 */
describe("EnrollPage — confirmación de la cuenta opcional del menor (#876)", () => {
  it("hides and clears the confirmation once the optional account is withdrawn", () => {
    render(<EnrollPage />);
    fireEvent.click(screen.getByRole("button", { name: /^Representante Gestiono la inscripción/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ }));

    const correo = screen.getByLabelText(/^Correo electrónico/);
    fireEvent.change(correo, { target: { value: "lucas@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Contraseña/), { target: { value: "password8" } });
    const confirm = screen.getByLabelText(/^Confirmar contraseña/);
    fireEvent.change(confirm, { target: { value: "otraClave9" } });
    fireEvent.blur(confirm);
    expect(screen.getByText("Las contraseñas no coinciden.")).toBeInTheDocument();

    // Withdraw the optional account: clearing both correo and contrasenia
    // takes the confirmation with them.
    fireEvent.change(correo, { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(/^Contraseña/), { target: { value: "" } });

    expect(screen.queryByLabelText(/^Confirmar contraseña/)).not.toBeInTheDocument();
    expect(screen.queryByText("Las contraseñas no coinciden.")).not.toBeInTheDocument();

    // Re-entering credentials starts from a clean, unmatched confirmation —
    // never resurrecting the withdrawn value.
    fireEvent.change(correo, { target: { value: "lucas@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Contraseña/), { target: { value: "password8" } });
    expect(screen.getByLabelText(/^Confirmar contraseña/)).toHaveValue("");
  });
});

/**
 * Issue #860: the emergency phone must differ from the student's own — a
 * contact of emergency that repeats the student's number cannot reach anyone
 * the student cannot already reach themselves.
 */
describe("EnrollPage — el teléfono de emergencia no puede repetir el del estudiante (#860)", () => {
  function goToHealthStep(): void {
    fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ })); // type -> personal
    fillEnrollStudentStep();
    fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ })); // personal -> health
  }

  it.each([
    ["the exact same local number", "0991234567"],
    ["the equivalent +593 form of the same number", "+593991234567"],
  ])("rejects %s beside 'Teléfono de emergencia' and keeps 'Siguiente' disabled", (_description, valor) => {
    render(<EnrollPage />);
    goToHealthStep();

    fireEvent.change(screen.getByLabelText(/tipo de sangre/i), { target: { value: "O_POSITIVO" } });
    fireEvent.change(screen.getByLabelText(/nombre del contacto/i), { target: { value: "Ana Martinez" } });
    const telefonoEmergencia = screen.getByLabelText(/teléfono de emergencia/i);
    fireEvent.change(telefonoEmergencia, { target: { value: valor } });
    fireEvent.blur(telefonoEmergencia);

    expect(
      screen.getByText("El teléfono de emergencia debe ser diferente del teléfono del estudiante."),
    ).toBeInTheDocument();
    expect(telefonoEmergencia).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: /^Siguiente/ })).toBeDisabled();
  });

  it("enables 'Siguiente' once the emergency phone is a different valid number", () => {
    render(<EnrollPage />);
    goToHealthStep();

    fillEnrollHealthStep();

    expect(screen.getByRole("button", { name: /^Siguiente/ })).toBeEnabled();
    expect(
      screen.queryByText("El teléfono de emergencia debe ser diferente del teléfono del estudiante."),
    ).not.toBeInTheDocument();
  });
});

/**
 * Task 2 (QA cycle 2026-08-12), revisited by issue #999: a duplicate-identity
 * 400 used to leave the visitor on the summary with only the generic message
 * — no indication of which step/field to revisit, and (until #999) only ONE
 * row flagged even though correo can collide in every enrollment type. The
 * fix flags every candidate row (student cédula, and correo whether it is
 * the student's own or the representative's) so the visitor's eye lands on
 * the right "Corregir" button, while the alert itself only ever names the
 * SET of fields that can collide ("cédula o correo") — never which one
 * actually matched, and never the value the visitor typed. `stepAlert`'s
 * equivalent here — the `role="alert"` box — is checked for exactly that:
 * mirroring `enroll-qa.spec.ts`'s S09.
 */
describe("EnrollPage — duplicate-identity recovery on the summary step", () => {
  function fillValidSelfEnrollment(): void {
    fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ }));
    fillEnrollStudentStep();
    fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ }));

    fillEnrollHealthStep();
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

  it("flags the Cédula AND Correo summary rows without confirming which one matched", async () => {
    render(<EnrollPage />);
    fillValidSelfEnrollment();
    await submitAndFailWithDuplicate();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(MENSAJE_IDENTIDAD_DUPLICADA);
    // The oracle guard, revisited by #999: the alert may name the SET of
    // fields that can collide ("cédula o correo") but must never repeat the
    // value the visitor typed, which is the only thing that would actually
    // confirm which one matched.
    expect(alert.textContent ?? "").not.toContain("1798765432");
    expect(alert.textContent ?? "").not.toContain("sofia@example.com");

    // The flag lives OUTSIDE the alert, on the summary row itself, right
    // next to the pre-existing "Corregir" button — no new navigation, no
    // identifier repeated inside the alert.
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

    // Issue #999: BOTH candidate rows get flagged, never just the one the
    // wizard happens to show first — a self enrollment collides on the same
    // "Correo" row a dependent's flow shows as "Correo del representante".
    const correoRow = screen.getByText("Correo").closest("li");
    expect(correoRow).not.toBeNull();
    expect(within(correoRow as HTMLElement).getByText(/revisar/i)).toBeInTheDocument();
    expect(within(correoRow as HTMLElement).getByRole("button", { name: /corregir/i })).toBeVisible();
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
function reachSummaryStep(): void {
  fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ }));
  fillEnrollStudentStep();
  fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ }));

  fillEnrollHealthStep();
  fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ }));
}

describe("EnrollPage — motivo del bloqueo en el paso 5 (#312 / #2, #9)", () => {
  it("names why 'Confirmar inscripción' is disabled, the same pattern steps 2-4 already use", () => {
    render(<EnrollPage />);
    reachSummaryStep();

    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    const confirmButton = screen.getByRole("button", { name: /confirmar inscripción/i });
    expect(confirmButton).toBeDisabled();
    expect(screen.getByText(/para continuar, marque la casilla de confirmación/i)).toBeInTheDocument();
  });

  it("links each grouped legal document to its public page", () => {
    render(<EnrollPage />);
    reachSummaryStep();

    expect(screen.getByRole("link", { name: /términos de uso/i })).toHaveAttribute("href", "/terminos");
    expect(screen.getByRole("link", { name: /aviso de privacidad/i })).toHaveAttribute("href", "/privacidad");
    expect(screen.getByRole("link", { name: /permiso de imagen fetm/i })).toHaveAttribute("href", "/permiso-imagen-fetm");
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

// ---------------------------------------------------------------------------
// #763 — the grouped legal consent already blocks the enrolment through the
// business rule, but it declared nothing to the browser or to assistive
// technology: the audit read `semanticRequired=false` on the deployed build.
// The native attribute is the missing half of the signal, and it has to arrive
// WITHOUT loosening the rule that actually stops the submit.
// ---------------------------------------------------------------------------
describe("EnrollPage — semántica nativa del consentimiento legal (#763)", () => {
  it("starts unchecked — the consent is never granted on the visitor's behalf", () => {
    render(<EnrollPage />);
    reachSummaryStep();

    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("declares the grouped consent required to the browser and to assistive technology", () => {
    render(<EnrollPage />);
    reachSummaryStep();

    const checkbox = screen.getByRole("checkbox");
    // The native attribute is what maps to the accessibility tree's "required"
    // state, so `toBeRequired` and the attribute are one assertion in two
    // registers: the semantics, and the markup that has to carry them.
    expect(checkbox).toBeRequired();
    expect(checkbox).toHaveAttribute("required");
  });

  it("keeps exactly the three legal documents, each one reachable and named", () => {
    render(<EnrollPage />);
    reachSummaryStep();

    const consent = screen.getByRole("checkbox").closest("label") as HTMLLabelElement;
    const links = within(consent).getAllByRole("link");

    expect(links).toHaveLength(3);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/terminos",
      "/privacidad",
      "/permiso-imagen-fetm",
    ]);
    links.forEach((link) => expect(link).toHaveAccessibleName());
  });

  it("still blocks the submit through the business rule, not through the browser's bubble", () => {
    vi.mocked(enrollStudent).mockClear();
    render(<EnrollPage />);
    reachSummaryStep();

    const form = screen.getByRole("checkbox").closest("form") as HTMLFormElement;
    fireEvent.submit(form);

    expect(enrollStudent).not.toHaveBeenCalled();
    expect(screen.getByText(/revise y confirme el resumen antes de finalizar/i)).toBeInTheDocument();
  });

  it("is never granted by the fill-everything shortcut — consent is the one field nothing else can answer", () => {
    render(<EnrollPage />);

    // The demo panel fills every field of a self enrollment in one click. It
    // is the only code path in the wizard that writes the whole form on the
    // visitor's behalf, so it is where an auto-acceptance would come from.
    fireEvent.click(screen.getByRole("button", { name: "Jugador" }));
    fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ }));

    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: /confirmar inscripción/i })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// #317 / hallazgo #31 — el asistente promete 4 pasos y pasa a 5 en cuanto el
// visitante elige inscribir a un dependiente, TODAVÍA en el paso 1. El
// compromiso de esfuerzo no puede cambiar en respuesta al mismo clic que lo
// hizo empezar.
// ---------------------------------------------------------------------------
describe("EnrollPage — el conteo de pasos no cambia mientras se decide (#317 / #31)", () => {
  it("no promete un número de pasos que el paso 1 todavía no puede saber", () => {
    render(<EnrollPage />);

    // Jugador es la selección por defecto — el número YA sería resoluble
    // (4), pero el paso 1 no lo afirma como definitivo porque el visitante
    // puede tocar la otra tarjeta a continuación.
    expect(screen.queryByText(/^paso 1 de \d/i)).not.toBeInTheDocument();
  });

  it("el texto del paso 1 no cambia al elegir Representante, todavía en el paso 1", () => {
    render(<EnrollPage />);

    const before = screen.getByText(/4 o 5 pasos/i).textContent;

    fireEvent.click(screen.getByRole("button", { name: /^Representante Gestiono la inscripción/ }));

    const after = screen.getByText(/4 o 5 pasos/i).textContent;
    expect(after).toBe(before);
    expect(screen.queryByText(/^paso 1 de \d/i)).not.toBeInTheDocument();
  });

  it("resuelve el número exacto de pasos recién al avanzar del paso 1", () => {
    render(<EnrollPage />);

    fireEvent.click(screen.getByRole("button", { name: /^Representante Gestiono la inscripción/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ }));

    expect(screen.getByText("Paso 2 de 5")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// #317 / hallazgo #62 — recargar el asistente perdía los datos ya cargados:
// `formData` vivía solo en memoria, así que un F5 en el paso 3 lo vaciaba
// entero. El borrador se persiste en `sessionStorage`, se rotula en pantalla
// como datos SIN enviar (nunca llegó al servidor, a diferencia del borrador
// que #310/K3 quitó de asistencias) y se limpia al completar la inscripción.
// ---------------------------------------------------------------------------
describe("EnrollPage — el borrador sobrevive a un reload (#317 / #62)", () => {
  /** Walks to the representative step (step 3 of 5) with step 2 fully filled. */
  function reachRepresentativeStep(): void {
    fireEvent.click(screen.getByRole("button", { name: /^Representante Gestiono la inscripción/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ }));
    fireEvent.change(screen.getByLabelText(/^Nombres/), { target: { value: "Lucas" } });
    fireEvent.change(screen.getByLabelText(/^Apellidos/), { target: { value: "Martinez" } });
    fillBirthDate(enrollFieldId("fechaNacimiento"), "2015-06-15");
    fireEvent.change(screen.getByLabelText(/cédula de identidad/i), { target: { value: "1723456719" } });
    fireEvent.change(screen.getByLabelText(/^Teléfono/), { target: { value: "991234567" } });
    fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ }));
  }

  it("conserva los datos ya cargados y los rotula como sin enviar tras un reload en el paso 3", async () => {
    const first = render(<EnrollPage />);
    reachRepresentativeStep();
    expect(screen.getByText("Paso 3 de 5")).toBeInTheDocument();

    // A "reload" is a full remount: React state is gone, but the URL
    // (`?paso=3`, real jsdom history) and `sessionStorage` both survive it —
    // exactly like an actual F5.
    first.unmount();
    render(<EnrollPage />);

    // The wizard is still standing on step 3, not bounced back to step 1 —
    // it can only know step 3 is reachable once the restored data makes
    // steps 1-2 look complete again.
    expect(await screen.findByText("Paso 3 de 5")).toBeInTheDocument();
    // The label the issue requires: this is unsent data, not a confirmed
    // record — the same "recuperamos" pattern the attendance wizard already
    // uses for its own (server-bound) draft.
    expect(screen.getByText(/no se ha[n]? enviado/i)).toBeInTheDocument();

    // Step 3 (representative) renders no student field, so the data that
    // matters here — what was typed on step 2 — is checked by walking back.
    // "Atrás" is the browser's real Back (`window.history.back()`), which
    // resolves via `popstate` on its own tick, not synchronously with the
    // click — and both step 2 and step 3 have a field literally labeled
    // "Nombres", so asserting before that tick would silently match the
    // WRONG one (the representative's, still empty) instead of failing.
    fireEvent.click(screen.getByRole("button", { name: /^Atrás/ }));
    expect(await screen.findByText("Paso 2 de 5")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Nombres/)).toHaveValue("Lucas");
    expect(screen.getByLabelText(/cédula de identidad/i)).toHaveValue("1723456719");
  });

  it("limpia el borrador al completar la inscripción con éxito", async () => {
    vi.mocked(enrollStudent).mockResolvedValueOnce({ enrolled: true });
    render(<EnrollPage />);

    await completeSelfEnrollmentWizard();
    expect(window.sessionStorage.getItem("cata_enroll_draft")).toBeNull();
  });
});

describe("EnrollPage — la confirmación no manda a una acción que el rol nuevo no puede hacer (#348)", () => {
  /** Same wizard walk as "limpia el borrador al completar la inscripción con
   * éxito" above — needed here only to reach the confirmation screen. */
  async function completarInscripcionPropia(): Promise<void> {
    vi.mocked(enrollStudent).mockResolvedValueOnce({ enrolled: true });
    render(<EnrollPage />);

    await completeSelfEnrollmentWizard();
  }

  it("no dice 'Registre el pago... desde Mis pagos' -- esa pantalla no tiene botón para el primer pago", async () => {
    await completarInscripcionPropia();

    // `membresia_pago_servicio.registrar_pago` exige una `membresia_id` ya
    // EXISTENTE (backend/app/servicios_negocio/membresia_pago_servicio.py:323),
    // y crear la membresía es ADMIN-only (`crear_membresia`, ROL_ADMIN). Un
    // socio recién inscrito no tiene membresía todavía, así que "Mis pagos"
    // no le ofrece ningún botón de alta -- student-utils.ts::
    // describePaymentSituation ya lo dice para ese mismo estado ("El club
    // crea la membresía al registrar el primer pago. Acérquese a
    // administración..."). La confirmación no puede prometer una acción que
    // esa pantalla no tiene.
    expect(
      screen.queryByText(/registre el pago y suba el comprobante desde mis pagos/i)
    ).not.toBeInTheDocument();
  });

  it("dice la verdad del primer pago: acercarse al club, no una ruta que el rol nuevo no puede usar", async () => {
    await completarInscripcionPropia();

    expect(screen.getByText(/administraci[oó]n/i)).toBeInTheDocument();
  });

  it("muestra la bienvenida de marca y la línea emocional en la confirmación (#877)", async () => {
    await completarInscripcionPropia();

    expect(screen.getByText("¡Le damos la bienvenida a Cata Club!")).toBeInTheDocument();
    expect(screen.getByText("Su camino en el tenis de mesa comienza aquí.")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// #1028, review round 2 — the public wizard's step-2 phone is LOCAL ONLY
// (09XXXXXXXX). The 593/+593 forms are no longer normalized behind the
// visitor's back: they stay as typed (digits only, capped) and the step rule
// rejects them with the message that teaches the 09 format.
// ---------------------------------------------------------------------------
describe("EnrollPage — step 2 takes only the 9 digits after +593 (#1028 review)", () => {
  function goToStudentStepLocal(): void {
    render(<EnrollPage />);
    fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ }));
  }

  it("valid 991234567 enables 'Siguiente'", () => {
    goToStudentStepLocal();
    fillEnrollStudentStep();

    expect(screen.getByLabelText(/^Teléfono/)).toHaveValue("991234567");
    expect(screen.queryByText(/no incluya el 0 inicial/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no repita el 593/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Siguiente/ })).toBeEnabled();
  });

  it("rejects a leading-0 entry by name and keeps 'Siguiente' disabled", () => {
    goToStudentStepLocal();
    fillEnrollStudentStep();

    const phone = screen.getByLabelText(/^Teléfono/);
    fireEvent.change(phone, { target: { value: "0991234567" } });
    fireEvent.blur(phone);

    // No silent normalization: the 0-leading entry stays as typed.
    expect(phone).toHaveValue("0991234567");
    expect(
      screen.getByText("No incluya el 0 inicial: escriba solo los 9 dígitos que siguen al +593."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Siguiente/ })).toBeDisabled();
  });

  it("rejects the 593 and +593 forms as repeated country codes", () => {
    goToStudentStepLocal();
    fillEnrollStudentStep();

    const phone = screen.getByLabelText(/^Teléfono/);
    fireEvent.change(phone, { target: { value: "+593991234567" } });
    fireEvent.blur(phone);
    expect(phone).toHaveValue("593991234567");
    expect(
      screen.getByText("No repita el 593: ya está en el campo. Escriba solo los 9 dígitos de su celular."),
    ).toBeInTheDocument();

    fireEvent.change(phone, { target: { value: "593991234567" } });
    fireEvent.blur(phone);
    expect(screen.getByText(/no repita el 593/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Siguiente/ })).toBeDisabled();
  });

  it("submits the canonical local 09XXXXXXXX form the backend contract expects", async () => {
    vi.mocked(enrollStudent).mockResolvedValueOnce({ enrolled: true });
    render(<EnrollPage />);

    await completeSelfEnrollmentWizard();

    // The visitor typed 991234567 after the fixed +593; the wire carries the
    // local 09XXXXXXXX form the contract has always expected.
    expect(enrollStudent).toHaveBeenCalledWith(
      expect.objectContaining({
        alumno: expect.objectContaining({ telefono: "0991234567" }),
      }),
    );
  });
});
