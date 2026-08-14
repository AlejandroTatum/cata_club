/**
 * The parts of `/student/enroll` that a screenshot proves once and a rewrite
 * loses silently.
 *
 * Every case here fixes something the redesign of this screen found, and each
 * one is written against the reason rather than the pixel:
 *
 *  · **The ids are the field's, not the label's.** This is the load-bearing
 *    one. `WizardInput` used to derive the DOM id from the label text, and
 *    `tests/e2e/enroll-qa.spec.ts` reproduced that same slugifier to address
 *    roughly forty cases — so the visible copy WAS the selector, and renaming
 *    a label moved the ground under every case that pointed at it. The ids
 *    are declared in `ENROLL_FIELD_TOKEN` now; these cases are what says so
 *    before an end-to-end run does.
 *  · **The red is the action and nothing else.** Seven required asterisks per
 *    step in `cata-red` competed with the one red button that had earned the
 *    colour, and the error state borrowed the action red plus a translucent
 *    halo of the family already retired for measuring 1.27–1.96:1.
 *  · **The titles are in Graduate.** `display-face-usage.test.ts` scans for a
 *    heading left at the title step in the interface face; it cannot see a
 *    heading written at the DENSE step, which is what the card title was —
 *    13.5px, smaller than the labels of the fields inside it.
 *  · **A catalogue that fails to load says so.** `fetchInstituciones` was
 *    caught into `() => {}`, and the two school selects — which render only
 *    when the list has entries — vanished without a word.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import EnrollPage from "@/app/student/enroll/page";
import { resetTestHistory, useTestSearchParams } from "@/lib/__tests__/next-navigation-double";
import { fetchInstituciones } from "@/services/api";
import {
  ENROLL_FIELD_TOKEN,
  enrollFieldId,
  type EnrollField,
} from "@/app/student/enroll/enroll-utils";
import { slugifyLabel } from "@/components/wizard-fields";

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

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    session: null,
    isAuthenticated: false,
    isLoading: false,
    refreshSession: vi.fn(),
  }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ showError: vi.fn(), showSuccess: vi.fn() }),
}));

vi.mock("@/services/api", () => ({
  enrollStudent: vi.fn(),
  fetchInstituciones: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/enrollment-session", () => ({
  clearLegacyEnrollmentSession: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(fetchInstituciones).mockResolvedValue([]);
  resetTestHistory("/student/enroll");
});

afterEach(() => {
  cleanup();
  resetTestHistory("/");
  vi.unstubAllEnvs();
});

/** Advances one step by pressing "Siguiente". */
function next(): void {
  fireEvent.click(screen.getByRole("button", { name: /^Siguiente/ }));
}

function chooseRepresentative(): void {
  fireEvent.click(screen.getByRole("button", { name: /^Representante Gestiono la inscripción/ }));
}

function fillStudent(): void {
  fireEvent.change(screen.getByLabelText(/^Nombres/), { target: { value: "Lucas" } });
  fireEvent.change(screen.getByLabelText(/^Apellidos/), { target: { value: "Martinez" } });
  fireEvent.change(screen.getByLabelText(/fecha de nacimiento/i), { target: { value: "2015-06-15" } });
  fireEvent.change(screen.getByLabelText(/cédula de identidad/i), { target: { value: "1798765432" } });
  fireEvent.change(screen.getByLabelText(/^Teléfono/), { target: { value: "0991234567" } });
}

describe("the field ids are declared, not slugged from the label", () => {
  it("renders the student step under the ids `ENROLL_FIELD_TOKEN` declares", () => {
    render(<EnrollPage />);
    next();

    for (const field of ["nombres", "apellidos", "fechaNacimiento", "cedula", "telefono", "correo", "contrasenia"] as EnrollField[]) {
      expect(document.getElementById(enrollFieldId(field))).not.toBeNull();
    }
  });

  it("renders the representative step under those ids too, with labels that no longer repeat the card title", () => {
    render(<EnrollPage />);
    chooseRepresentative();
    next();
    fillStudent();
    next();

    const fields: EnrollField[] = [
      "nombreRepresentante",
      "apellidosRepresentante",
      "cedulaRepresentante",
      "fechaNacimientoRepresentante",
      "telefonoRepresentante",
      "correoRepresentante",
      "contraseniaRepresentante",
    ];
    for (const field of fields) {
      const input = document.getElementById(enrollFieldId(field));
      expect(input, `missing #${enrollFieldId(field)}`).not.toBeNull();

      // The point of the whole exercise: the id no longer follows the label.
      // Every one of these seven labels dropped "del Representante" — which is
      // what makes them ALL slug to something the id is not.
      const label = document.querySelector(`label[for="${enrollFieldId(field)}"]`);
      expect(label?.textContent ?? "").not.toMatch(/representante/i);
      expect(`enroll-${slugifyLabel(label?.textContent ?? "")}`).not.toBe(enrollFieldId(field));
    }
  });

  it("gives no two fields the same id", () => {
    const tokens = Object.values(ENROLL_FIELD_TOKEN);
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});

describe("the red is the action and nothing else", () => {
  it("marks the optional fields instead of painting the required ones red", () => {
    render(<EnrollPage />);
    // A self enrolment's student step: seven fields, all seven required. That
    // is exactly why the asterisk carried no information — it fired on
    // everything.
    next();

    // Nothing is marked, because nothing here is optional…
    expect(screen.queryByText("(opcional)")).not.toBeInTheDocument();
    // …and no label spends the action colour on a marker.
    for (const label of Array.from(document.querySelectorAll("label"))) {
      expect(label.innerHTML).not.toMatch(/cata-red/);
    }
  });

  it("marks the dependent's optional account with a word, not with the absence of a mark", () => {
    render(<EnrollPage />);
    chooseRepresentative();
    next();

    // The child flow's student credentials are the two optional inputs.
    expect(screen.getAllByText("(opcional)").length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the action colour off a field in error", () => {
    render(<EnrollPage />);
    next();

    const cedula = screen.getByLabelText(/cédula de identidad/i);
    fireEvent.change(cedula, { target: { value: "131" } });
    fireEvent.blur(cedula);

    expect(cedula).toHaveAttribute("aria-invalid", "true");
    expect(cedula.className).toContain("border-state-bad");
    expect(cedula.className).not.toMatch(/cata-red/);
    // The 3px translucent halo went with it — it measured 1.27–1.96:1, which
    // is decoration wearing the shape of an indicator.
    expect(cedula.className).not.toMatch(/ring-/);
  });
});

describe("the titles are in the club's face", () => {
  it("puts the card title at the title step in Graduate, with no weight class", () => {
    render(<EnrollPage />);

    const title = screen.getByRole("heading", { name: /tipo de inscripción/i });
    expect(title.className).toContain("font-display");
    expect(title.className).toContain("text-lg");
    expect(title.className).toContain("tracking-flat");
    // Graduate ships a single 400 cut: a weight utility here could only ask
    // the browser to synthesise one.
    expect(title.className).not.toMatch(/font-(bold|semibold|extrabold)/);
  });

  it("hands the page title to PageHeader instead of drawing an h1 in Barlow", () => {
    render(<EnrollPage />);

    const heading = screen.getByRole("heading", { level: 1, name: /inscripción de estudiante/i });
    expect(heading.className).toContain("font-display");
    expect(heading.className).not.toMatch(/font-extrabold/);
  });
});

describe("the school catalogue never fails in silence", () => {
  it("says so when the catalogue cannot be loaded", async () => {
    vi.mocked(fetchInstituciones).mockRejectedValueOnce(new Error("502"));
    render(<EnrollPage />);
    chooseRepresentative();
    next();

    expect(await screen.findByText(/no pudimos cargar la lista de escuelas/i)).toBeInTheDocument();
  });

  it("says nothing when the catalogue simply has no entries", async () => {
    render(<EnrollPage />);
    chooseRepresentative();
    next();

    // An empty club catalogue is not a failure, and the step must not claim
    // one: there is just nothing to choose from.
    expect(screen.queryByText(/no pudimos cargar la lista de escuelas/i)).not.toBeInTheDocument();
  });
});
