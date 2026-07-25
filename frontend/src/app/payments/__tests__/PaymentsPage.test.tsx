/**
 * Component tests for PaymentsPage — approve confirmation gating.
 * Covers: approve opens a confirmation before mutating; canceling leaves
 * status unchanged.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import PaymentsPage from "@/app/payments/page";
import type { PaymentValidationRequest } from "@/services/api";
import { ToastProvider } from "@/contexts/ToastContext";

vi.mock("@/components/ProtectedRoute", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// AppShell (the page's new sidebar layout) needs next/navigation, next/link,
// next/image, and AuthContext — none of which this page used directly
// before. Mocked minimally, matching the pattern in Header.test.tsx /
// AppShell.test.tsx.
vi.mock("next/navigation", () => ({
  usePathname: () => "/payments",
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
      user: { id: "u1", name: "Admin Test", email: "admin@cataclub.com", role: "admin", representanteId: null },
      roles: ["ADMINISTRADOR"],
      loggedInAt: "2026-07-01T12:00:00Z",
    },
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

const mockFetchPaymentValidations = vi.fn();
const mockUpdatePaymentValidation = vi.fn();

vi.mock("@/services/api", () => ({
  fetchPaymentValidations: () => mockFetchPaymentValidations(),
  updatePaymentValidation: (id: string, dto: unknown) =>
    mockUpdatePaymentValidation(id, dto),
}));

const PENDING_REQUEST: PaymentValidationRequest = {
  id: "req-1",
  studentName: "Juan Pérez",
  responsablePagoName: "María Pérez",
  membershipPeriod: "2026-Q1",
  membershipType: "Mensual",
  expectedAmount: 50,
  paymentMethod: "Transferencia",
  uploadedAt: "2026-07-01T10:00:00.000Z",
  currentMembershipStatus: "vencida",
  proofFileName: "comprobante.pdf",
  proofFileType: "pdf",
  validationStatus: "pendiente",
};

async function renderAndSelectPending(): Promise<void> {
  render(<ToastProvider><PaymentsPage /></ToastProvider>);
  await waitFor(() => {
    expect(screen.getByText("Juan Pérez")).toBeInTheDocument();
  });
  fireEvent.click(screen.getByText("Juan Pérez"));
  await screen.findByRole("button", { name: /aprobar pago/i });
}

describe("PaymentsPage — approve confirmation gating", () => {
  beforeEach(() => {
    mockFetchPaymentValidations.mockReset();
    mockUpdatePaymentValidation.mockReset();
    mockFetchPaymentValidations.mockResolvedValue([PENDING_REQUEST]);
    mockUpdatePaymentValidation.mockResolvedValue({
      ...PENDING_REQUEST,
      validationStatus: "validado",
    });
  });

  it("opens a confirmation dialog on 'Aprobar Pago' click without mutating yet", async () => {
    await renderAndSelectPending();

    fireEvent.click(screen.getByRole("button", { name: /aprobar pago/i }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mockUpdatePaymentValidation).not.toHaveBeenCalled();
  });

  it("mutates the payment status only after the confirm control is activated", async () => {
    await renderAndSelectPending();

    fireEvent.click(screen.getByRole("button", { name: /aprobar pago/i }));
    fireEvent.click(screen.getByRole("button", { name: /^confirmar$/i }));

    await waitFor(() => {
      expect(mockUpdatePaymentValidation).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdatePaymentValidation).toHaveBeenCalledWith("req-1", {
      action: "approved",
    });
  });

  it("leaves the payment status unchanged when the confirmation is canceled", async () => {
    await renderAndSelectPending();

    fireEvent.click(screen.getByRole("button", { name: /aprobar pago/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancelar$/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockUpdatePaymentValidation).not.toHaveBeenCalled();
  });
});

describe("PaymentsPage — voucher preview recovery", () => {
  it("replaces a failed voucher preview with a labeled download fallback", async () => {
    mockFetchPaymentValidations.mockResolvedValue([{ ...PENDING_REQUEST, proofPreviewUrl: "https://files.example/voucher.png" }]);

    await renderAndSelectPending();
    fireEvent.error(screen.getByRole("img", { name: /vista previa del comprobante/i }));

    expect(screen.getByRole("status")).toHaveTextContent("Comprobante no disponible");
    expect(screen.getByRole("link", { name: /descargar comprobante/i })).toHaveAttribute("href", "https://files.example/voucher.png");
  });

  it("allows a reviewer to retry the preview without changing the payment", async () => {
    mockFetchPaymentValidations.mockResolvedValue([{ ...PENDING_REQUEST, proofPreviewUrl: "https://files.example/voucher.png" }]);

    await renderAndSelectPending();
    fireEvent.error(screen.getByRole("img", { name: /vista previa del comprobante/i }));
    fireEvent.click(screen.getByRole("button", { name: /reintentar vista previa/i }));

    expect(screen.getByRole("img", { name: /vista previa del comprobante/i })).toBeInTheDocument();
    expect(mockUpdatePaymentValidation).not.toHaveBeenCalled();
  });

  it("does not claim the preview is unavailable while the voucher image is rendering successfully", async () => {
    mockFetchPaymentValidations.mockResolvedValue([{ ...PENDING_REQUEST, proofPreviewUrl: "https://files.example/voucher.png" }]);

    await renderAndSelectPending();

    expect(screen.getByRole("img", { name: /vista previa del comprobante/i })).toBeInTheDocument();
    expect(screen.queryByText(/vista previa no disponible/i)).not.toBeInTheDocument();
  });

  it("shows the unavailable message only when there is no preview URL at all", async () => {
    mockFetchPaymentValidations.mockResolvedValue([PENDING_REQUEST]); // no proofPreviewUrl

    await renderAndSelectPending();

    expect(screen.getByText(/vista previa no disponible/i)).toBeInTheDocument();
  });
});

describe("PaymentsPage — unrelated happy path", () => {
  it("does not add contextual help to the unrelated payment-review journey", async () => {
    await renderAndSelectPending();

    expect(screen.queryByRole("button", { name: /ayuda sobre/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Mobile horizontal overflow (P1).
//
// At a 390px viewport /payments measured scrollWidth 450 > innerWidth 390.
// The culprit was this status-filter row: `flex items-center gap-2` computes
// to `flex-wrap: nowrap`, so the heading plus four chips (430px of content)
// refused to wrap inside a 335px container and pushed the page sideways. The
// results table is NOT the cause — it already lives in an `overflow-x`
// scroll container of its own.
// ---------------------------------------------------------------------------

describe("PaymentsPage — status filter row fits a 390px viewport", () => {
  beforeEach(() => {
    mockFetchPaymentValidations.mockReset().mockResolvedValue([PENDING_REQUEST]);
    mockUpdatePaymentValidation.mockReset();
  });

  it("lets the status filter chips wrap instead of forcing the page to scroll sideways", async () => {
    render(<ToastProvider><PaymentsPage /></ToastProvider>);

    const heading = await screen.findByRole("heading", { name: "Filtrar por Estado" });
    const filterRow = heading.parentElement as HTMLElement;

    expect(filterRow).toHaveClass("flex", "flex-wrap");
    // Every chip really is inside this row — otherwise wrapping the row would
    // not be what keeps the page within the viewport.
    expect(within(filterRow).getAllByRole("button").length).toBeGreaterThanOrEqual(4);
  });
});
