/**
 * Component tests for `/student/medical-record` — the ADULT titular's own
 * access, closing the FIC-3 finding half the owner accepted: "un alumno
 * mayor de edad puede ver y corregir su propia ficha médica; un menor con
 * cuenta propia, no".
 *
 * Backend authority: `PoliticaAccesoPersona.exigir_acceso` on
 * `GET`/`PATCH /fichas-medicas/persona/{id}`, with `incluir_titular` now
 * resolved per-request by `ficha_medica_router.py::_es_titular_mayor_de_edad`
 * (age-gated). This screen never decides access on its own — it always calls
 * that same endpoint for the SESSION's own persona id, and this test suite's
 * job is only to prove it never offers the destination to a minor.
 *
 * The route's `ProtectedRoute` boundary is `allowedRoles={["representante",
 * "estudiante"]}` — it also carries `feat/ficha-medica-representante`'s
 * unrelated grant, a "representante" account's access to a REPRESENTADO's
 * record (see `StudentMedicalRecordPage.test.tsx`). THIS suite only ever
 * renders an "estudiante" session, so that branch is out of scope here.
 *
 * Mocking follows StudentPaymentsPage.test.tsx / the representante branch's
 * StudentMedicalRecordPage.test.tsx (ProtectedRoute, next/navigation,
 * AuthContext stubbed; @/services/api mocked).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import StudentOwnMedicalRecordPage from "@/app/student/medical-record/page";
import type { StudentPortalSummary, StudentProfileSummary } from "@/services/api";

const mockProtectedRoute = vi.fn();
vi.mock("@/components/ProtectedRoute", () => ({
  default: (props: { children: React.ReactNode; allowedRoles: string[] }) => {
    mockProtectedRoute(props.allowedRoles);
    return <>{props.children}</>;
  },
}));

const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/student/medical-record",
  useRouter: () => ({ push: vi.fn(), replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(),
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

function estudianteSession(personaId = "70") {
  return {
    session: {
      user: {
        id: personaId,
        name: "Alumno Propio",
        email: "alumno@cataclub.com",
        role: "estudiante",
        representanteId: null,
        fechaNacimiento: "1990-01-01",
        activo: true,
      },
      roles: ["ALUMNO"],
      loggedInAt: "2026-08-11T12:00:00Z",
    },
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
    refreshSession: vi.fn(),
  };
}

const ADULT_SELF: StudentProfileSummary = {
  personaId: "70",
  nombres: "Alumno",
  apellidos: "Propio",
  fechaNacimiento: "1990-01-01",
  recentSessions: [],
  membership: null,
  representante: null,
  representanteId: null,
};

const MINOR_SELF: StudentProfileSummary = {
  ...ADULT_SELF,
  personaId: "80",
  fechaNacimiento: "2015-01-01",
};

function portal(self: StudentProfileSummary | null): StudentPortalSummary {
  return { self, representados: [], membershipPlans: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchFichaMedica.mockResolvedValue({
    id: 1,
    personaId: 70,
    tipoSangre: "DESCONOCIDO",
    enfermedades: [],
    alergias: "",
    contactoEmergencia: "",
    telefonoEmergencia: "",
  });
});

describe("StudentOwnMedicalRecordPage", () => {
  it("shares the route with representante, gated by role inside the component", async () => {
    mockUseAuth.mockReturnValue(estudianteSession());
    mockFetchStudentPortal.mockResolvedValue(portal(ADULT_SELF));
    render(<StudentOwnMedicalRecordPage />);
    expect(mockProtectedRoute).toHaveBeenCalledWith(["representante", "estudiante"]);
    await waitFor(() => expect(mockFetchFichaMedica).toHaveBeenCalled());
  });

  it("renders the editor for the session's OWN persona when the titular is an adult", async () => {
    mockUseAuth.mockReturnValue(estudianteSession("70"));
    mockFetchStudentPortal.mockResolvedValue(portal(ADULT_SELF));
    render(<StudentOwnMedicalRecordPage />);

    await waitFor(() => expect(mockFetchFichaMedica).toHaveBeenCalledWith(70));
    expect(mockReplace).not.toHaveBeenCalled();
  });

  // The lock for the age decision on the frontend side: defense in depth for
  // a minor who reaches this URL directly (the nav entry already hides it —
  // see auth-utils.test.ts). The backend would 403 this call regardless
  // (test_el_titular_menor_de_edad_no_lee_su_propia_ficha_medica); this only
  // keeps a minor from ever seeing that 403 raw.
  it("redirects to /student instead of loading the editor when the titular is a minor", async () => {
    mockUseAuth.mockReturnValue(estudianteSession("80"));
    mockFetchStudentPortal.mockResolvedValue(portal(MINOR_SELF));
    render(<StudentOwnMedicalRecordPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/student"));
    expect(mockFetchFichaMedica).not.toHaveBeenCalled();
  });

  it("shows an error state and lets the reader retry when the portal fetch fails", async () => {
    mockUseAuth.mockReturnValue(estudianteSession("70"));
    mockFetchStudentPortal.mockRejectedValueOnce(new Error("network down"));
    mockFetchStudentPortal.mockResolvedValueOnce(portal(ADULT_SELF));
    render(<StudentOwnMedicalRecordPage />);

    await waitFor(() => expect(screen.getByRole("button", { name: /reintentar/i })).toBeInTheDocument());
  });
});
