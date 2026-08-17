/**
 * Component tests for `/student/medical-record`.
 *
 * The finding this closes (FIC-4): the backend already authorizes a
 * representante to read and correct a representado's `FichaMedica` —
 * `PoliticaAccesoPersona.exigir_acceso` on `/fichas-medicas/*` — but no route
 * under `app/student/**` mounted `MedicalRecordEditor`, so a family had no way
 * to use the access the API already granted them.
 *
 * As of the merge with `feat/ficha-medica-propia`, this route also carries an
 * adult `estudiante`'s access to their OWN record — a separate, unrelated
 * grant (see `StudentOwnMedicalRecordPage.test.tsx`). So
 * `allowedRoles={["representante", "estudiante"]}` at the `ProtectedRoute`
 * boundary, but THIS suite only ever renders it with a representante
 * session — the picker-over-representados behavior below is unaffected by
 * the estudiante branch living in the same component.
 *
 * Mocking follows StudentAttendancePage.test.tsx (ProtectedRoute, next/navigation,
 * next/link, next/image, AuthContext stubbed; @/services/api mocked).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import StudentMedicalRecordPage from "@/app/student/medical-record/page";
import type { StudentPortalSummary, StudentProfileSummary } from "@/services/api";

const mockProtectedRoute = vi.fn();
vi.mock("@/components/ProtectedRoute", () => ({
  default: (props: { children: React.ReactNode; allowedRoles: string[] }) => {
    mockProtectedRoute(props.allowedRoles);
    return <>{props.children}</>;
  },
}));

/** The dependent selection travels in `?alumno=` — see `ManagedStudentPicker`. */
let searchParams = new URLSearchParams();
const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/student/medical-record",
  useRouter: () => ({ push: vi.fn(), replace: mockReplace }),
  useSearchParams: () => searchParams,
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

vi.mock("next/image", () => ({
  __esModule: true,
  default: (props: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; priority?: boolean }) => {
    const { fill, priority, sizes, ...rest } = props;
    void fill;
    void priority;
    void sizes;
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt="" {...rest} />;
  },
}));

const mockUseAuth = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));

const mockFetchStudentPortal = vi.fn();
const mockFetchFichaMedica = vi.fn();
const mockActualizarFichaMedica = vi.fn();
vi.mock("@/services/api", () => ({
  fetchStudentPortal: () => mockFetchStudentPortal(),
  fetchFichaMedica: (personaId: number) => mockFetchFichaMedica(personaId),
  actualizarFichaMedica: (personaId: number, data: unknown) =>
    mockActualizarFichaMedica(personaId, data),
}));

function representanteSession() {
  return {
    session: {
      user: { id: "9", name: "Madre Tutora", email: "madre@cataclub.com", role: "representante", representanteId: null },
      roles: ["REPRESENTANTE"],
      loggedInAt: "2026-07-01T12:00:00Z",
    },
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
    refreshSession: vi.fn(),
  };
}

const BASE_PROFILE: StudentProfileSummary = {
  personaId: "9",
  nombres: "Alumno",
  apellidos: "Test",
  fechaNacimiento: "2000-05-14",
  recentSessions: [],
  membership: null,
  representante: null,
  representanteId: null,
};

const SOFIA: StudentProfileSummary = {
  ...BASE_PROFILE,
  personaId: "41",
  nombres: "Sofía",
  apellidos: "Vera",
};

const MARTIN: StudentProfileSummary = {
  ...BASE_PROFILE,
  personaId: "42",
  nombres: "Martín",
  apellidos: "Vera",
};

function ficha(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    tipoSangre: "O_POSITIVO",
    enfermedades: [],
    alergias: "Ninguna",
    contactoEmergencia: null,
    telefonoEmergencia: null,
    ...overrides,
  };
}

beforeEach(() => {
  searchParams = new URLSearchParams();
  mockReplace.mockReset();
  mockProtectedRoute.mockReset();
  window.sessionStorage.clear();
  mockUseAuth.mockReset().mockReturnValue(representanteSession());
  mockFetchStudentPortal.mockReset().mockResolvedValue({
    self: null,
    representados: [SOFIA, MARTIN],
    membershipPlans: [],
  });
  mockFetchFichaMedica.mockReset().mockResolvedValue(ficha());
  mockActualizarFichaMedica.mockReset().mockResolvedValue(ficha());
});

describe("StudentMedicalRecordPage — who can reach it", () => {
  it("gates the route to representante only, never estudiante or unsupported", async () => {
    render(<StudentMedicalRecordPage />);
    // The page heading (`<h1>`, from `AppShell`) — distinct from
    // `MedicalRecordEditor`'s own "Ficha médica" `<h3>`, which also renders
    // once the picker resolves a default profile.
    await screen.findByRole("heading", { level: 1, name: "Ficha médica" });
    expect(mockProtectedRoute).toHaveBeenCalledWith(["representante", "estudiante"]);
  });
});

describe("StudentMedicalRecordPage — reusing MedicalRecordEditor per representado", () => {
  it("opens on the profile named by ?alumno= and loads THAT persona's ficha", async () => {
    searchParams = new URLSearchParams("alumno=42");

    render(<StudentMedicalRecordPage />);

    await waitFor(() => expect(mockFetchFichaMedica).toHaveBeenCalledWith(42));
    // "Martín" also appears in the picker's own <option>, so the unambiguous
    // "whose record is this" statement is the editor's own pinned heading —
    // the one element that stays on screen while the fields scroll under it.
    //
    // This used to be a THIRD heading, in a card of its own above the editor,
    // whose <h2> repeated what the editor's header already said and whose <p>
    // repeated the page subtitle. D11c allows one: the page's <h1> names the
    // screen, the card's heading names the person.
    const heading = await screen.findByRole("heading", { name: "Ficha médica de Martín" });
    expect(heading.closest("header")).not.toBeNull();
  });

  it("does not repeat the page subtitle in a card of its own", async () => {
    render(<StudentMedicalRecordPage />);

    // El editor abre en reposo cuando la ficha ya existe, así que lo que
    // marca "ya montó" es su botón «Editar», no el select.
    await screen.findByRole("button", { name: "Editar" });
    expect(
      screen.queryByText(/Alergias, enfermedades, tipo de sangre y contacto de emergencia/i),
    ).toBeNull();
  });

  it("switches persona and refetches when the guardian picks another dependent", async () => {
    render(<StudentMedicalRecordPage />);

    await waitFor(() => expect(mockFetchFichaMedica).toHaveBeenCalledWith(41));

    fireEvent.change(screen.getByLabelText("Estudiante"), { target: { value: "42" } });

    await waitFor(() => expect(mockFetchFichaMedica).toHaveBeenCalledWith(42));
  });

  it("saves through the SAME editor the admin uses, for the selected representado", async () => {
    render(<StudentMedicalRecordPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => {
      expect(mockActualizarFichaMedica).toHaveBeenCalledWith(
        41,
        expect.objectContaining({ tipoSangre: "O_POSITIVO" }),
      );
    });
  });

  it("persists every field the editor collects — not just a subset", async () => {
    mockFetchFichaMedica.mockResolvedValue(
      ficha({ alergias: "Polvo", contactoEmergencia: "Ana Vera", telefonoEmergencia: "0991234567" }),
    );

    render(<StudentMedicalRecordPage />);

    // En reposo el valor guardado se LEE; recién al editar vuelve a ser input.
    expect(await screen.findByText("Polvo")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect(screen.getByLabelText<HTMLInputElement>("Alergias").value).toBe("Polvo");
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => {
      expect(mockActualizarFichaMedica).toHaveBeenCalledWith(
        41,
        expect.objectContaining({
          tipoSangre: "O_POSITIVO",
          alergias: "Polvo",
          contactoEmergencia: "Ana Vera",
          telefonoEmergencia: "0991234567",
        }),
      );
    });
  });
});

describe("StudentMedicalRecordPage — no representados", () => {
  it("shows an honest empty state instead of an editor with nothing to edit", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue({
      self: null,
      representados: [],
      membershipPlans: [],
    });

    render(<StudentMedicalRecordPage />);

    expect(
      await screen.findByText(/no se encontraron estudiantes asociados a esta cuenta/i),
    ).toBeInTheDocument();
    expect(mockFetchFichaMedica).not.toHaveBeenCalled();
  });
});

/**
 * D11b — the ficha médica measured the worst dead air of the whole product
 * (57% as an adult titular, 42% as a guardian, at 1440x900), and it is the one
 * screen where that is PURE layout: five controls that never grow with data,
 * drawn on `max-w-8xl` — the product's WIDEST measure for its narrowest
 * content.
 *
 * `measure="short"` is the instrument `AppShell` already documents for exactly
 * this ("a page whose height is a function of the records that exist, not of a
 * page size"), and until now only `/discounts` and `/groups` used it. It does
 * not remove the emptiness and this suite does not claim it does — it reframes
 * a runt block on a 1356px measure as a column with a margin on 972px, which
 * is the same trade #85 recorded and accepted.
 */
describe("StudentMedicalRecordPage — drawn on the short measure, not the widest one", () => {
  it("caps the pane at the short measure the design system reserves for pages that cannot grow", async () => {
    const { container } = render(<StudentMedicalRecordPage />);

    await screen.findByRole("button", { name: "Editar" });
    expect(container.querySelector(".max-w-5xl")).not.toBeNull();
    expect(container.querySelector(".max-w-8xl")).toBeNull();
  });
});

/**
 * D11 — the empty state's third part, "what to do", plus `fill` so the
 * statement owns the box it stands in rather than floating at the top of a
 * page whose remaining 500px stay blank.
 */
describe("StudentMedicalRecordPage — the no-representados state fills its page", () => {
  it("centres its statement in the height the page reserves for it", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue({
      self: null,
      representados: [],
      membershipPlans: [],
    });

    render(<StudentMedicalRecordPage />);

    const title = await screen.findByText(/no se encontraron estudiantes asociados a esta cuenta/i);
    const emptyState = title.parentElement;
    expect(emptyState?.className).toMatch(/\bflex-1\b/);
    expect(emptyState?.className).toMatch(/justify-center/);
  });
});
