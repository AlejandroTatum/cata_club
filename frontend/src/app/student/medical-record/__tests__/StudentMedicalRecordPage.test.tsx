/**
 * Component tests for `/student/medical-record`.
 *
 * The finding this closes (FIC-4): the backend already authorizes a
 * representante to read and correct a representado's `FichaMedica` —
 * `PoliticaAccesoPersona.exigir_acceso` on `/fichas-medicas/*` — but no route
 * under `app/student/**` mounted `MedicalRecordEditor`, so a family had no way
 * to use the access the API already granted them.
 *
 * This screen is representante-ONLY (`allowedRoles={["representante"]}`), not
 * `["representante", "estudiante", "unsupported"]` like `/student/payments`
 * and `/student/attendance`: the backend still excludes the titular's own
 * record (`incluir_titular=False`, `ficha_medica_router.py`), so a
 * self-managed "estudiante" account has nothing to look at here and must
 * never be routed to a screen that would only 403 it.
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
    expect(mockProtectedRoute).toHaveBeenCalledWith(["representante"]);
  });
});

describe("StudentMedicalRecordPage — reusing MedicalRecordEditor per representado", () => {
  it("opens on the profile named by ?alumno= and loads THAT persona's ficha", async () => {
    searchParams = new URLSearchParams("alumno=42");

    render(<StudentMedicalRecordPage />);

    await waitFor(() => expect(mockFetchFichaMedica).toHaveBeenCalledWith(42));
    // "Martín" also appears in the picker's own <option>; the heading is the
    // unambiguous "whose record is this" statement.
    expect(await screen.findByRole("heading", { name: "Ficha médica de Martín" })).toBeInTheDocument();
  });

  it("switches persona and refetches when the guardian picks another dependent", async () => {
    render(<StudentMedicalRecordPage />);

    await waitFor(() => expect(mockFetchFichaMedica).toHaveBeenCalledWith(41));

    fireEvent.change(screen.getByLabelText("Estudiante"), { target: { value: "42" } });

    await waitFor(() => expect(mockFetchFichaMedica).toHaveBeenCalledWith(42));
  });

  it("saves through the SAME editor the admin uses, for the selected representado", async () => {
    render(<StudentMedicalRecordPage />);

    await screen.findByLabelText("Tipo de sangre");
    fireEvent.click(screen.getByRole("button", { name: /Guardar ficha médica/i }));

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

    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Alergias").value).toBe("Polvo"));
    fireEvent.click(screen.getByRole("button", { name: /Guardar ficha médica/i }));

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
