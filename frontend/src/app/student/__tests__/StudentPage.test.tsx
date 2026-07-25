/**
 * Component tests for StudentPage's Pagos section and unavailable-membership
 * recovery state.
 *
 * Mirrors the mocking pattern established by PaymentsPage.test.tsx /
 * GroupsPage.test.tsx (ProtectedRoute, next/navigation, next/link,
 * next/image, AuthContext all stubbed; @/services/api mocked).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import StudentPage from "@/app/student/page";
import type { StudentPortalSummary, PagoPersona } from "@/services/api";

vi.mock("@/components/ProtectedRoute", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/student",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode; href: string }) => (
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

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: { id: "9", name: "Alumno Test", email: "alumno@cataclub.com", role: "estudiante", representanteId: null },
      roles: ["ALUMNO"],
      loggedInAt: "2026-07-01T12:00:00Z",
    },
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

const mockFetchStudentPortal = vi.fn();
const mockFetchPagosDePersona = vi.fn();

vi.mock("@/services/api", () => ({
  fetchStudentPortal: () => mockFetchStudentPortal(),
  fetchPagosDePersona: (personaId: string) => mockFetchPagosDePersona(personaId),
}));

const PORTAL: StudentPortalSummary = {
  self: {
    personaId: "9",
    nombres: "Alumno",
    apellidos: "Test",
    fechaNacimiento: "2010-05-14",
    ranking: { status: "unavailable", reason: "error" },
    recentSessions: [],
    membership: null,
  },
  representados: [],
  membershipPlans: [],
};

const PAGO_RECHAZADO: PagoPersona = {
  id: 1,
  monto: "35.00",
  motivoRechazo: "Comprobante ilegible",
  estadoPago: "RECHAZADO",
  tipoPago: "TRANSFERENCIA",
  fechaRegistro: "2026-06-01T09:00:00Z",
  fechaValidacion: "2026-06-02T14:30:00Z",
  fechaInicio: "2026-06-01",
  fechaFin: "2026-06-30",
  personaId: 9,
  membresiaId: 3,
  voucherUrl: null,
  voucherFormato: null,
};

const PAGO_APROBADO: PagoPersona = {
  id: 2,
  monto: "35.00",
  motivoRechazo: null,
  estadoPago: "APROBADO",
  tipoPago: "EFECTIVO",
  fechaRegistro: "2026-07-01T09:00:00Z",
  fechaValidacion: "2026-07-01T10:00:00Z",
  fechaInicio: "2026-07-01",
  fechaFin: "2026-07-31",
  personaId: 9,
  membresiaId: 3,
  voucherUrl: null,
  voucherFormato: null,
};

beforeEach(() => {
  mockFetchStudentPortal.mockReset().mockResolvedValue(PORTAL);
  mockFetchPagosDePersona.mockReset().mockResolvedValue([]);
});

describe("StudentPage — Agregar/Inscribir dependiente CTA", () => {
  it("links to the public enrollment wizard when the account has no dependents yet", async () => {
    render(<StudentPage />);

    const link = await screen.findByText("Inscribir hijo/dependiente");
    expect(link.closest("a")).toHaveAttribute("href", "/student/enroll?type=child");
  });

  it("links to the authenticated add-dependent wizard once the account already represents a dependent", async () => {
    mockFetchStudentPortal
      .mockReset()
      .mockResolvedValue({ ...PORTAL, representados: [{ ...PORTAL.self, personaId: "42" }] });

    render(<StudentPage />);

    const link = await screen.findByText("Agregar hijo/dependiente");
    expect(link.closest("a")).toHaveAttribute("href", "/student/add-dependent");
  });
});

describe("StudentPage — Pagos section", () => {
  it("fetches and renders the persona's payment history from the service", async () => {
    mockFetchPagosDePersona.mockResolvedValueOnce([PAGO_APROBADO]);

    render(<StudentPage />);

    await waitFor(() => {
      expect(mockFetchPagosDePersona).toHaveBeenCalledWith("9");
    });
    expect(await screen.findByText("Efectivo")).toBeInTheDocument();
  });

  it("shows the rejection reason for a RECHAZADO payment", async () => {
    mockFetchPagosDePersona.mockResolvedValueOnce([PAGO_RECHAZADO]);

    render(<StudentPage />);

    expect(await screen.findByText("Comprobante ilegible")).toBeInTheDocument();
  });

  it("does not show a rejection-reason block for an APROBADO payment", async () => {
    mockFetchPagosDePersona.mockResolvedValueOnce([PAGO_APROBADO]);

    render(<StudentPage />);

    await screen.findByText("Efectivo");
    expect(screen.queryByText(/motivo de rechazo/i)).not.toBeInTheDocument();
  });
});

describe("StudentPage — membership display", () => {
  it("renders active membership with plan details", async () => {
    mockFetchStudentPortal.mockResolvedValueOnce({
      ...PORTAL,
      self: { ...PORTAL.self!, membership: { id: 4, estado: "ACTIVA", personaId: 9, montoAplicado: "85.00", categoria: "Mensual", modalidad: "MENSUAL", franjaHoraria: "Tarde" } },
    });

    render(<StudentPage />);

    const heading = await screen.findByRole("heading", { name: /activa/i });
    expect(heading).toBeInTheDocument();
    const card = heading.closest("section")!;
    expect(card).toHaveTextContent("Mensual");
  });

  it("shows sin membresía when membership is null", async () => {
    render(<StudentPage />);

    const heading = await screen.findByRole("heading", { name: /sin membresía/i });
    expect(heading).toBeInTheDocument();
    const card = heading.closest("section")!;
    // Español neutro: "tenés" es voseo rioplatense y el producto es ecuatoriano.
    expect(card).toHaveTextContent("Aún no tiene una membresía");
  });

  it("shows pendiente de activación for INACTIVA state", async () => {
    mockFetchStudentPortal.mockResolvedValueOnce({
      ...PORTAL,
      self: { ...PORTAL.self!, membership: { id: 5, estado: "INACTIVA", personaId: 9, montoAplicado: "85.00", categoria: "Mensual", modalidad: "MENSUAL", franjaHoraria: null } },
    });

    render(<StudentPage />);

    const heading = await screen.findByRole("heading", { name: /pendiente de activación/i });
    expect(heading).toBeInTheDocument();
    const card = heading.closest("section")!;
    expect(card).toHaveTextContent("validación del primer pago");
  });
});
