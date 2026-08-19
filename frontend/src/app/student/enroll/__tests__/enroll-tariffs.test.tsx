/**
 * Public membership tariffs on the enrollment wizard (issue #331, consumes
 * the public BFF/backend contract of #394 — `GET /membresias/tarifas`).
 *
 * Before an unauthenticated visitor sees the first interactive field of step
 * 1 ("type"), the wizard must show the club's current tariffs so they know
 * the price before starting. This must NEVER hit the protected
 * `/membresias/tipos` endpoint (admin-only), and must NEVER hardcode a
 * price — everything shown comes from `fetchTarifas()`.
 *
 * Mocking pattern mirrors EnrollPage.test.tsx (next/link, next/navigation,
 * AuthContext and @/services/api stubbed).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import EnrollPage from "@/app/student/enroll/page";
import { resetTestHistory, useTestSearchParams } from "@/lib/__tests__/next-navigation-double";
import { fetchTarifas, fetchTiposMembresia } from "@/services/api";
import { formatCurrency } from "@/lib/format-utils";

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

// `fetchTiposMembresia` is the PROTECTED admin catalog — mocked here only so
// a test can assert the public wizard never touches it. If the component
// ever called it, the assertion below would fail loudly instead of the mock
// silently absorbing the call.
vi.mock("@/services/api", () => ({
  enrollStudent: vi.fn(),
  fetchInstituciones: vi.fn().mockResolvedValue([]),
  fetchTarifas: vi.fn(),
  fetchTiposMembresia: vi.fn(),
}));

vi.mock("@/lib/enrollment-session", () => ({
  clearLegacyEnrollmentSession: vi.fn(),
}));

// Deliberately NOT realistic production figures (see
// docs — el precio real de referencia es USD 35) so no assertion here could
// be mistaken for asserting an actual tariff.
const FAKE_TARIFAS = [
  { categoria: "Categoria Test A", precio: "12.50" },
  { categoria: "Categoria Test B", precio: "9.99" },
];

beforeEach(() => {
  resetTestHistory("/student/enroll");
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  resetTestHistory("/");
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

describe("EnrollPage — tarifas públicas antes del primer campo", () => {
  it("muestra las tarifas antes del primer botón interactivo del paso 1, en orden DOM", async () => {
    vi.mocked(fetchTarifas).mockResolvedValue(FAKE_TARIFAS);

    render(<EnrollPage />);

    const tariffNode = await screen.findByText("Categoria Test A");
    // The step-1 enrollment-type CARD, matched by its unique description —
    // NOT the dev-only demo quick-fill button of the same short name
    // ("Jugador"), which is a different control entirely.
    const jugadorCard = screen.getByRole("button", { name: /Me inscribo yo al club/i });

    // eslint-disable-next-line no-bitwise -- DOM position bitmask is the standard API for this.
    expect(tariffNode.compareDocumentPosition(jugadorCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Gestiono la inscripción de un hijo/i }),
    ).toBeInTheDocument();
  });

  it("nunca llama al catálogo protegido /membresias/tipos", async () => {
    vi.mocked(fetchTarifas).mockResolvedValue(FAKE_TARIFAS);

    render(<EnrollPage />);

    await screen.findByText("Categoria Test A");

    expect(fetchTarifas).toHaveBeenCalledTimes(1);
    expect(fetchTiposMembresia).not.toHaveBeenCalled();
  });

  it("formatea varias categorías con formatCurrency, sin un string de moneda hardcodeado", async () => {
    vi.mocked(fetchTarifas).mockResolvedValue(FAKE_TARIFAS);

    render(<EnrollPage />);

    expect(await screen.findByText("Categoria Test A")).toBeInTheDocument();
    expect(screen.getByText("Categoria Test B")).toBeInTheDocument();
    expect(screen.getByText(formatCurrency("12.50"))).toBeInTheDocument();
    expect(screen.getByText(formatCurrency("9.99"))).toBeInTheDocument();
  });

  it("mientras carga no muestra ningún precio ni un 0 falso", () => {
    vi.mocked(fetchTarifas).mockReturnValue(new Promise(() => {})); // never resolves

    render(<EnrollPage />);

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText(/\$\s?0[,.]00/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\$/)).not.toBeInTheDocument();
  });

  it("catálogo vacío muestra un estado honesto, sin inventar una tarifa", async () => {
    vi.mocked(fetchTarifas).mockResolvedValue([]);

    render(<EnrollPage />);

    // Wait on the state that actually depends on `fetchTarifas` resolving —
    // the step-1 "Jugador" button renders regardless of tariff-fetch status,
    // so finding it proves nothing about whether the empty state has landed
    // yet (a real race under CI's slower/different scheduling).
    await screen.findByText("Sin tarifas publicadas");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText(/^\$/)).not.toBeInTheDocument();
    expect(fetchTarifas).toHaveBeenCalledTimes(1);
  });

  it("un fallo es visible (role=alert) y el retry dispara una nueva request real", async () => {
    vi.mocked(fetchTarifas)
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(FAKE_TARIFAS);

    render(<EnrollPage />);

    const alert = await screen.findByRole("alert");
    expect(fetchTarifas).toHaveBeenCalledTimes(1);

    fireEvent.click(within(alert).getByRole("button", { name: /reintentar/i }));

    await screen.findByText("Categoria Test A");
    expect(fetchTarifas).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("las tarifas dejan de mostrarse en el paso 2 (personal)", async () => {
    vi.mocked(fetchTarifas).mockResolvedValue(FAKE_TARIFAS);

    render(<EnrollPage />);

    await screen.findByText("Categoria Test A");

    // `initialFormData.enrollmentType` is already "self" — advancing past
    // step 1 needs no extra click on the type card.
    fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));

    expect(screen.queryByText("Categoria Test A")).not.toBeInTheDocument();
  });
});
