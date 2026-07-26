/**
 * Component tests for `/student/payments`.
 *
 * The screen arrived from upstream unmigrated, so these tests pin the four
 * things that migration had to fix and that a future edit could quietly undo:
 * one currency grammar, one date grammar, a selection that is coal-and-ball
 * rather than red, and copy in Ecuadorian usted rather than voseo. Plus the
 * substantive correction: coverage is derived from approved payments, never
 * from `MembershipSummary.fechaFin`, which no adapter populates.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import StudentPaymentsPage from "@/app/student/payments/page";
import type { PagoPersona, StudentPortalSummary, StudentProfileSummary } from "@/services/api";

vi.mock("@/components/ProtectedRoute", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

/**
 * `?registrar=1` is how the home screen's payment band says "this reader came
 * here to pay", so the search params are part of this screen's contract now.
 * Tests that care set `searchParams` before rendering.
 */
let searchParams = new URLSearchParams();

const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/student/payments",
  useRouter: () => ({ push: vi.fn(), replace: mockReplace }),
  useSearchParams: () => searchParams,
}));

const mockShowSuccess = vi.fn();
vi.mock("@/contexts/ToastContext", () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => ({
    showToast: vi.fn(),
    showError: vi.fn(),
    showSuccess: mockShowSuccess,
    showInfo: vi.fn(),
    showWarning: vi.fn(),
  }),
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

const mockFetchStudentPortal = vi.fn();
const mockFetchPagosDePersona = vi.fn();
const mockSubirVoucherPago = vi.fn();
const mockRegistrarPago = vi.fn();

vi.mock("@/services/api", () => ({
  fetchStudentPortal: () => mockFetchStudentPortal(),
  fetchPagosDePersona: (...args: unknown[]) => mockFetchPagosDePersona(...args),
  subirVoucherPago: (...args: unknown[]) => mockSubirVoucherPago(...args),
  registrarPago: (...args: unknown[]) => mockRegistrarPago(...args),
}));

function authSession(role: "estudiante" | "representante" = "estudiante") {
  return {
    session: {
      user: { id: "9", name: "Alumno Test", email: "alumno@cataclub.com", role, representanteId: null },
      roles: role === "estudiante" ? ["ALUMNO"] : ["REPRESENTANTE"],
      loggedInAt: "2026-07-01T12:00:00Z",
    },
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
    refreshSession: vi.fn(),
  };
}

const SELF: StudentProfileSummary = {
  personaId: "9",
  nombres: "Alumno",
  apellidos: "Test",
  fechaNacimiento: "2000-05-14",
  ranking: { status: "unavailable", reason: "error" },
  recentSessions: [],
  membership: {
    id: 3,
    estado: "ACTIVA",
    personaId: 9,
    montoAplicado: "25.00",
    categoria: "Mensual Infantil",
    modalidad: "MENSUAL",
    franjaHoraria: "15:00-18:00",
    fechaActivacion: "2026-07-22T20:51:01",
    // Declared on the client type but never produced by the adapter — the
    // screen must not read it. Set to a conspicuous date so a regression that
    // starts reading it fails loudly here.
    fechaFin: "2099-12-31",
  },
  representante: null,
  representanteId: null,
};

const PORTAL: StudentPortalSummary = { self: SELF, representados: [], membershipPlans: [] };

function makePago(overrides: Partial<PagoPersona> = {}): PagoPersona {
  return {
    id: 1,
    monto: "25.00",
    motivoRechazo: null,
    estadoPago: "APROBADO",
    tipoPago: "TRANSFERENCIA",
    fechaRegistro: "2026-07-01T10:00:00",
    fechaValidacion: "2026-07-02T10:00:00",
    fechaInicio: "2026-07-01",
    fechaFin: "2026-07-31",
    personaId: 9,
    membresiaId: 3,
    voucherUrl: null,
    voucherFormato: null,
    ...overrides,
  };
}

beforeEach(() => {
  searchParams = new URLSearchParams();
  mockReplace.mockReset();
  mockShowSuccess.mockReset();
  window.sessionStorage.clear();
  mockUseAuth.mockReset().mockReturnValue(authSession());
  mockFetchStudentPortal.mockReset().mockResolvedValue(PORTAL);
  mockFetchPagosDePersona.mockReset().mockResolvedValue([makePago()]);
  mockSubirVoucherPago.mockReset().mockResolvedValue(undefined);
  mockRegistrarPago.mockReset().mockResolvedValue({ id: 99 });
});

/**
 * A guardian with exactly ONE dependent never sees the profile switcher (it
 * hides below two profiles), so before this pass the screen never once named
 * the student it was about: "Mis pagos", "Su membresía", and a form that
 * debited a persona the reader had no way to identify.
 */
describe("StudentPaymentsPage — whose payment this is", () => {
  const DEPENDENT = { ...SELF, personaId: "42", nombres: "Sofía", apellidos: "Vera" };

  function renderAsGuardian(): void {
    mockUseAuth.mockReturnValue(authSession("representante"));
    mockFetchStudentPortal.mockReset().mockResolvedValue({
      self: null,
      representados: [DEPENDENT],
      membershipPlans: [],
    });
    render(<StudentPaymentsPage />);
  }

  it("names the dependent on the membership card even with no switcher on screen", async () => {
    renderAsGuardian();

    expect(await screen.findByText("Membresía de Sofía")).toBeInTheDocument();
    expect(screen.queryByLabelText("Estudiante")).not.toBeInTheDocument();
  });

  it("names the dependent on the register button and inside the open form", async () => {
    renderAsGuardian();

    const open = await screen.findByRole("button", { name: /registrar un pago de sofía/i });
    fireEvent.click(open);

    expect(await screen.findByText(/se registra a nombre de/i)).toBeInTheDocument();
  });

  it("keeps usted for a student reading their own account", async () => {
    render(<StudentPaymentsPage />);

    expect(await screen.findByText("Su membresía")).toBeInTheDocument();
    expect(screen.queryByText(/Membresía de/)).not.toBeInTheDocument();
  });
});

describe("StudentPaymentsPage — arriving from the home band", () => {
  it("opens the form on ?registrar=1 so the route to paying is one click, not three", async () => {
    searchParams = new URLSearchParams("registrar=1");

    render(<StudentPaymentsPage />);

    // The collapsed state is a button; the open state is the amount field.
    expect(await screen.findByText("Período que cubre")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^registrar un pago$/i })).not.toBeInTheDocument();
  });

  it("waits for the payment history before opening, so the period starts where coverage ends", async () => {
    searchParams = new URLSearchParams("registrar=1");
    mockFetchPagosDePersona.mockReset().mockResolvedValue([makePago({ fechaFin: "2026-08-31" })]);

    render(<StudentPaymentsPage />);

    // The period starts at the furthest approved `fechaFin` (31/08/2026), not
    // at today — a family paying early must not lose the days they paid for.
    // (The same date also appears in the card's "Pagado hasta", hence the
    // scoped lookup inside the form's own period block.)
    const period = (await screen.findByText("Período que cubre")).parentElement!;
    expect(within(period).getByText(/^31\/08\/2026/)).toBeInTheDocument();
  });

  it("does not force the form open on a minor's own account", async () => {
    searchParams = new URLSearchParams("registrar=1");
    mockFetchStudentPortal.mockReset().mockResolvedValue({
      ...PORTAL,
      self: { ...SELF, fechaNacimiento: "2014-03-10" },
    });

    render(<StudentPaymentsPage />);

    expect(
      await screen.findByText(/no registra pagos desde su propia cuenta/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("Período que cubre")).not.toBeInTheDocument();
  });
});

describe("StudentPaymentsPage — the membership card", () => {
  it("derives coverage from the furthest approved payment, not from the unpopulated membership.fechaFin", async () => {
    mockFetchPagosDePersona.mockResolvedValueOnce([
      makePago({ id: 1, fechaFin: "2026-07-31" }),
      makePago({ id: 2, fechaFin: "2026-08-31" }),
    ]);

    render(<StudentPaymentsPage />);

    const card = await screen.findByTestId("membership-status");
    await waitFor(() => {
      expect(within(card).getByText("31/08/2026")).toBeInTheDocument();
    });
    expect(within(card).queryByText(/2099/)).not.toBeInTheDocument();
  });

  it("says no payment has been approved rather than showing an empty coverage line", async () => {
    mockFetchPagosDePersona.mockResolvedValueOnce([
      makePago({ estadoPago: "PENDIENTE_VALIDACION" }),
    ]);

    render(<StudentPaymentsPage />);

    const card = await screen.findByTestId("membership-status");
    await waitFor(() => {
      expect(within(card).getByText(/todavía no hay ningún pago aprobado/i)).toBeInTheDocument();
    });
  });

  it("renders the plan's monthly price in the product's single currency grammar", async () => {
    render(<StudentPaymentsPage />);

    const card = await screen.findByTestId("membership-status");
    expect(within(card).getByText("$25,00")).toBeInTheDocument();
    expect(within(card).queryByText("$25.00")).not.toBeInTheDocument();
  });
});

describe("StudentPaymentsPage — the history", () => {
  it("renders amounts and periods in the product's formats, never the raw API strings", async () => {
    render(<StudentPaymentsPage />);

    // The period is unique to the payment row; the amount is not (the
    // membership card states the same monthly price), so the row is anchored
    // on the period and the amount is asserted across both.
    expect(await screen.findByText(/01\/07\/2026 – 31\/07\/2026/)).toBeInTheDocument();
    expect(screen.getAllByText("$25,00").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/2026-07-01/)).not.toBeInTheDocument();
  });

  it("states the rejection reason in full — it is the only row that asks the reader to act", async () => {
    mockFetchPagosDePersona.mockResolvedValueOnce([
      makePago({ estadoPago: "RECHAZADO", motivoRechazo: "El comprobante es ilegible" }),
    ]);

    render(<StudentPaymentsPage />);

    expect(await screen.findByText("El comprobante es ilegible")).toBeInTheDocument();
    expect(screen.getByText("Motivo del rechazo")).toBeInTheDocument();
  });

  it("filters by status, and marks the active filter with the ball dot rather than red", async () => {
    mockFetchPagosDePersona.mockResolvedValueOnce([
      makePago({ id: 1, estadoPago: "APROBADO" }),
      makePago({ id: 2, estadoPago: "RECHAZADO", monto: "40.00" }),
    ]);

    render(<StudentPaymentsPage />);

    expect(await screen.findByText("$40,00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Aprobados/ }));

    await waitFor(() => {
      expect(screen.queryByText("$40,00")).not.toBeInTheDocument();
    });
    // `FilterPill` marks selection with coal + the yellow ball dot. Red is
    // reserved for the primary CTA and destructive intent.
    expect(screen.getAllByTestId("filterpill-ball-dot")).toHaveLength(1);
  });

  it("offers a way back when a filter empties the list", async () => {
    mockFetchPagosDePersona.mockResolvedValueOnce([makePago({ estadoPago: "APROBADO" })]);

    render(<StudentPaymentsPage />);

    expect(await screen.findByText(/01\/07\/2026 – 31\/07\/2026/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Rechazados/ }));

    expect(await screen.findByText("No hay pagos rechazados.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver todos los pagos" })).toBeInTheDocument();
  });
});

describe("StudentPaymentsPage — registering a payment", () => {
  it("starts the new period where the paid one ends, so paying early loses no days", async () => {
    mockFetchPagosDePersona.mockResolvedValueOnce([makePago({ fechaFin: "2026-08-31" })]);

    render(<StudentPaymentsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /registrar un pago/i }));

    // $25,00 at a $25 monthly price = one month, starting at the end of the
    // approved coverage.
    expect(await screen.findByText(/31\/08\/2026 – 30\/09\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/1 mes a \$25,00 por mes/i)).toBeInTheDocument();
  });

  it("refuses an amount that is not a whole number of months instead of silently truncating it", async () => {
    render(<StudentPaymentsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /registrar un pago/i }));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "37.5" } });

    expect(
      await screen.findByText(/el monto debe ser un múltiplo de \$25,00/i),
    ).toBeInTheDocument();
    expect(mockRegistrarPago).not.toHaveBeenCalled();
  });

  it("addresses the reader as usted — the portal is not voseo", async () => {
    render(<StudentPaymentsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /registrar un pago/i }));

    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/Adjuntá|Registrá|Esperá|Consultá|tenés|Seleccioná/);
  });

  it("does not offer a minor a renewal form on their own account, and says who can register it", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue({
      ...PORTAL,
      self: { ...SELF, fechaNacimiento: "2014-03-10" },
    });

    render(<StudentPaymentsPage />);

    expect(
      await screen.findByText(/no registra pagos desde su propia cuenta/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /registrar un pago/i })).not.toBeInTheDocument();
  });

  it("DOES let a representante register the payment of their minor dependent", async () => {
    // The gate used to read the age of the profile being VIEWED, which locked
    // a guardian out of the single thing a representante account exists for
    // and told them to ask the minor's representative — themselves.
    mockUseAuth.mockReturnValue(authSession("representante"));
    mockFetchStudentPortal.mockReset().mockResolvedValue({
      self: null,
      representados: [
        { ...SELF, personaId: "4", nombres: "Sofia", apellidos: "Vera", fechaNacimiento: "2016-07-22" },
      ],
      membershipPlans: [],
    });

    render(<StudentPaymentsPage />);

    expect(
      await screen.findByRole("button", { name: /registrar un pago/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/no registra pagos desde su propia cuenta/i)).not.toBeInTheDocument();
  });

  it("blocks a second registration while one is still awaiting validation", async () => {
    mockFetchPagosDePersona.mockResolvedValueOnce([
      makePago({ estadoPago: "PENDIENTE_VALIDACION" }),
    ]);

    render(<StudentPaymentsPage />);

    expect(await screen.findByText(/ya tiene un pago esperando validación/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /registrar un pago/i })).not.toBeInTheDocument();
  });

  // WCAG 2.2 SC 2.5.8 — the detach control was a bare 14px ✕ inside a button
  // with no padding, i.e. a 14x14 target, and it is the only way back from
  // attaching the wrong file. It gets 24x24 of hit area; the glyph stays 14px.
  it("gives the detach control a 24x24 target around its 14px glyph", async () => {
    render(<StudentPaymentsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /registrar un pago/i }));

    // Transferencia is the default method, so the voucher row is already up.
    const fileInput = screen.getByTestId("renew-voucher-input") as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(["x"], "comprobante.pdf", { type: "application/pdf" })] },
    });

    const detach = await screen.findByRole("button", { name: /quitar el comprobante/i });
    expect(detach).toHaveClass("h-6", "w-6");
    expect(detach).toHaveClass("items-center", "justify-center");
  });
});

/**
 * The backend exposes no way to delete or cancel a `Pago` — the whole surface
 * is create, attach-voucher and an admin-only `PATCH .../validar` — so a
 * "Deshacer" toast would have had nothing to call. The control the reader gets
 * is the checkpoint before the commit, and an honest statement of the real
 * recovery after it.
 */
describe("StudentPaymentsPage — the checkpoint before the money moves", () => {
  async function openFormInCash(): Promise<void> {
    fireEvent.click(await screen.findByRole("button", { name: /registrar un pago/i }));
    fireEvent.change(await screen.findByLabelText(/forma de pago/i), {
      target: { value: "EFECTIVO" },
    });
  }

  it("does not register anything on the first click — it states what is about to happen", async () => {
    render(<StudentPaymentsPage />);
    await openFormInCash();

    fireEvent.click(screen.getByRole("button", { name: /^registrar pago$/i }));

    const confirm = await screen.findByTestId("renew-confirm");
    expect(within(confirm).getByText("$25,00")).toBeInTheDocument();
    expect(within(confirm).getByText("31/07/2026 – 31/08/2026")).toBeInTheDocument();
    expect(mockRegistrarPago).not.toHaveBeenCalled();
  });

  it("names the dependent in the checkpoint, so a guardian sees whose money this is", async () => {
    mockUseAuth.mockReturnValue(authSession("representante"));
    mockFetchStudentPortal.mockReset().mockResolvedValue({
      self: null,
      representados: [{ ...SELF, personaId: "42", nombres: "Martín", apellidos: "Vera" }],
      membershipPlans: [],
    });

    render(<StudentPaymentsPage />);
    await openFormInCash();

    fireEvent.click(screen.getByRole("button", { name: /^registrar pago$/i }));

    const confirm = await screen.findByTestId("renew-confirm");
    expect(within(confirm).getByText("Martín")).toBeInTheDocument();
    expect(within(confirm).getByText(/no puede eliminarlo desde el portal/i)).toBeInTheDocument();
  });

  it("lets the reader back out of the checkpoint without registering", async () => {
    render(<StudentPaymentsPage />);
    await openFormInCash();
    fireEvent.click(screen.getByRole("button", { name: /^registrar pago$/i }));
    await screen.findByTestId("renew-confirm");

    fireEvent.click(screen.getByRole("button", { name: /volver a corregir/i }));

    await waitFor(() => {
      expect(screen.queryByTestId("renew-confirm")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /^registrar pago$/i })).toBeInTheDocument();
    expect(mockRegistrarPago).not.toHaveBeenCalled();
  });

  it("commits only on the second, explicit click and then says where the recovery lives", async () => {
    render(<StudentPaymentsPage />);
    await openFormInCash();
    fireEvent.click(screen.getByRole("button", { name: /^registrar pago$/i }));
    await screen.findByTestId("renew-confirm");

    fireEvent.click(screen.getByRole("button", { name: /confirmar y registrar/i }));

    await waitFor(() => {
      expect(mockRegistrarPago).toHaveBeenCalledTimes(1);
    });
    expect(mockRegistrarPago).toHaveBeenCalledWith(
      expect.objectContaining({ monto: 25, tipoPago: "EFECTIVO", personaId: 9, membresiaId: 3 }),
    );

    // No "Deshacer": there is no endpoint behind one. The toast says what the
    // club does instead, which is the only recovery that actually exists.
    const [message, detail] = mockShowSuccess.mock.calls[0];
    expect(message).toMatch(/en revisión/i);
    expect(detail.description).toMatch(/lo rechaza indicando el motivo/i);
    expect(document.body.textContent).not.toMatch(/deshacer/i);
  });
});

describe("StudentPaymentsPage — the dependent selection survives navigation", () => {
  const GUARDIAN_PORTAL = {
    self: null,
    representados: [
      { ...SELF, personaId: "41", nombres: "Sofía", apellidos: "Vera" },
      {
        ...SELF,
        personaId: "42",
        nombres: "Martín",
        apellidos: "Vera",
        membership: { ...SELF.membership!, id: 7, montoAplicado: "40.00", categoria: "Mensual Adultos" },
      },
    ],
    membershipPlans: [],
  };

  beforeEach(() => {
    mockUseAuth.mockReturnValue(authSession("representante"));
    mockFetchStudentPortal.mockReset().mockResolvedValue(GUARDIAN_PORTAL);
  });

  it("opens on the profile named by ?alumno=, with that child's plan and amount", async () => {
    searchParams = new URLSearchParams("alumno=42");

    render(<StudentPaymentsPage />);

    const card = await screen.findByTestId("membership-status");
    expect(within(card).getByText("Membresía de Martín")).toBeInTheDocument();
    expect(within(card).getByText("$40,00")).toBeInTheDocument();
    expect(mockFetchPagosDePersona).toHaveBeenCalledWith("42");
  });

  it("restores the stored selection when the sidebar arrives without a param", async () => {
    // The evaluator's exact path: pick Martín on /student, click "Pagos" in the
    // sidebar — a plain /student/payments link that cannot carry a query.
    window.sessionStorage.setItem("cata:student-portal:alumno:9", "42");

    render(<StudentPaymentsPage />);

    const card = await screen.findByTestId("membership-status");
    expect(within(card).getByText("Membresía de Martín")).toBeInTheDocument();
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/student/payments?alumno=42", { scroll: false });
    });
  });

  it("keeps ?registrar=1 alive while it writes the selection into the URL", async () => {
    searchParams = new URLSearchParams("registrar=1");
    window.sessionStorage.setItem("cata:student-portal:alumno:9", "42");

    render(<StudentPaymentsPage />);

    await screen.findByTestId("membership-status");
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/student/payments?registrar=1&alumno=42", {
        scroll: false,
      });
    });
  });
});
