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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
const mockShowWarning = vi.fn();
vi.mock("@/contexts/ToastContext", () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => ({
    showToast: vi.fn(),
    showError: vi.fn(),
    showSuccess: mockShowSuccess,
    showInfo: vi.fn(),
    showWarning: mockShowWarning,
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
const mockFetchBeneficio = vi.fn();
const mockAplicarBeneficio = vi.fn();

vi.mock("@/services/api", () => ({
  fetchStudentPortal: () => mockFetchStudentPortal(),
  fetchPagosDePersona: (...args: unknown[]) => mockFetchPagosDePersona(...args),
  subirVoucherPago: (...args: unknown[]) => mockSubirVoucherPago(...args),
  registrarPago: (...args: unknown[]) => mockRegistrarPago(...args),
  fetchBeneficio: (...args: unknown[]) => mockFetchBeneficio(...args),
  aplicarBeneficio: (...args: unknown[]) => mockAplicarBeneficio(...args),
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

// ---------------------------------------------------------------------------
// El reloj congelado y las fechas que se derivan de él
// ---------------------------------------------------------------------------

/**
 * El reloj de este archivo.
 *
 * La pantalla siembra el inicio del período de renovación con el mayor entre
 * hoy y la cobertura ya pagada, y decide el bloqueo por minoría de edad
 * comparando la fecha de nacimiento contra hoy. La fecha del sistema es
 * entonces un dato de entrada del test, igual que los mocks: si no se congela,
 * cada aserción de período queda atada al día en que corrió la suite y se
 * rompe sola al pasar esa fecha, sin que cambie una línea de producto.
 *
 * Se congela antes de `COVERAGE_END` para que la cobertura ya pagada gane la
 * comparación contra hoy, que es justamente el comportamiento bajo prueba.
 */
const NOW = new Date("2026-07-15T09:00:00-05:00");

/** Inicio del período del pago que siembra `makePago` por defecto. */
const PAGO_START = "2026-07-01";
/** Cobertura sembrada por defecto: posterior al reloj congelado. */
const COVERAGE_END = "2026-07-31";
/** Un mes desde `COVERAGE_END`, el período que propone la renovación. */
const RENEWAL_END = "2026-08-31";

/** Cobertura de los casos que pagan por adelantado. */
const COVERAGE_END_AHEAD = "2026-08-31";
/** Un mes desde `COVERAGE_END_AHEAD`; septiembre no tiene 31, y se recorta. */
const RENEWAL_END_AHEAD = "2026-09-30";

/** Fecha de nacimiento mayor de edad respecto del reloj congelado. */
const ADULT_BIRTH_DATE = "2000-05-14";
/** Fecha de nacimiento menor de edad respecto del reloj congelado. */
const MINOR_BIRTH_DATE = "2014-03-10";

/** Un `YYYY-MM-DD` en la gramática de fecha del producto. */
function shown(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

/** Un período tal como lo escribe la pantalla, con raya y no con guion. */
function shownRange(startIso: string, endIso: string): string {
  return `${shown(startIso)} – ${shown(endIso)}`;
}

const SELF: StudentProfileSummary = {
  personaId: "9",
  nombres: "Alumno",
  apellidos: "Test",
  fechaNacimiento: ADULT_BIRTH_DATE,
  recentSessions: [],
  membership: {
    id: 3,
    estado: "ACTIVA",
    personaId: 9,
    montoAplicado: "25.00",
    categoria: "Mensual Infantil",
    modalidad: "MENSUAL",
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
    fechaInicio: PAGO_START,
    fechaFin: COVERAGE_END,
    personaId: 9,
    membresiaId: 3,
    voucherUrl: null,
    voucherFormato: null,
    descuentoValorAplicado: null,
    descuentoPorcentajeAplicado: null,
    ...overrides,
  };
}

beforeEach(() => {
  // Solo `Date`: la pantalla no depende de temporizadores, y falsear también
  // `setTimeout` colgaría las consultas `findBy*`, que sondean con timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  searchParams = new URLSearchParams();
  mockReplace.mockReset();
  mockShowSuccess.mockReset();
  window.sessionStorage.clear();
  mockUseAuth.mockReset().mockReturnValue(authSession());
  mockFetchStudentPortal.mockReset().mockResolvedValue(PORTAL);
  mockFetchPagosDePersona.mockReset().mockResolvedValue([makePago()]);
  mockSubirVoucherPago.mockReset().mockResolvedValue(undefined);
  mockRegistrarPago.mockReset().mockResolvedValue({ id: 99, monto: "25.00" });
  // No active benefit by default — tests that care override this per-case.
  mockFetchBeneficio.mockReset().mockResolvedValue(null);
  mockAplicarBeneficio.mockReset().mockResolvedValue({ id: 1 });
});

afterEach(() => {
  vi.useRealTimers();
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
    mockFetchPagosDePersona.mockReset().mockResolvedValue([makePago({ fechaFin: COVERAGE_END_AHEAD })]);

    render(<StudentPaymentsPage />);

    // The period starts at the furthest approved `fechaFin`, not at today — a
    // family paying early must not lose the days they paid for. (The same date
    // also appears in the card's "Pagado hasta", hence the scoped lookup
    // inside the form's own period block.)
    const period = (await screen.findByText("Período que cubre")).parentElement!;
    expect(
      within(period).getByText(shownRange(COVERAGE_END_AHEAD, RENEWAL_END_AHEAD)),
    ).toBeInTheDocument();
  });

  it("does not force the form open on a minor's own account", async () => {
    searchParams = new URLSearchParams("registrar=1");
    mockFetchStudentPortal.mockReset().mockResolvedValue({
      ...PORTAL,
      self: { ...SELF, fechaNacimiento: MINOR_BIRTH_DATE },
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
      makePago({ id: 1, fechaFin: COVERAGE_END }),
      makePago({ id: 2, fechaFin: COVERAGE_END_AHEAD }),
    ]);

    render(<StudentPaymentsPage />);

    const card = await screen.findByTestId("membership-status");
    await waitFor(() => {
      expect(within(card).getByText(shown(COVERAGE_END_AHEAD))).toBeInTheDocument();
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

  // Issue #400 (slice 06): SUSPENDIDA used to fall through to the generic
  // "vencida" badge — misleading, since 5a's invariant is that a suspension
  // never forfeits the coverage already paid for.
  it("reads a SUSPENDIDA membership as suspended, never as expired", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue({
      ...PORTAL,
      self: { ...SELF, membership: { ...SELF.membership!, estado: "SUSPENDIDA" } },
    });

    render(<StudentPaymentsPage />);

    const card = await screen.findByTestId("membership-status");
    expect(within(card).getByText(/suspendida/i)).toBeInTheDocument();
    expect(within(card).queryByText(/membresía vencida/i)).not.toBeInTheDocument();
  });
});

/**
 * The socio could not know whether they had a discount before this slice —
 * `GET /personas/{id}/beneficio` was ADMINISTRADOR-only (issue #398). These
 * tests pin the relaxed read and the two shapes it drives: a partial benefit
 * only informs the estimate, a 100% one replaces the payment form outright.
 */
describe("StudentPaymentsPage — the club's benefit, read before paying", () => {
  const BENEFICIO_PARCIAL = {
    id: 1,
    personaId: 9,
    descuento: { id: 2, nombre: "Beca deportiva", porcentaje: "50.00", monto: null, activo: true },
    asignadoPorPersonaId: 1,
    asignadoEn: "2026-07-01T00:00:00Z",
    retiradoPorPersonaId: null,
    retiradoEn: null,
  };

  const BENEFICIO_TOTAL = {
    ...BENEFICIO_PARCIAL,
    id: 2,
    descuento: { id: 3, nombre: "Beca 100%", porcentaje: "100.00", monto: null, activo: true },
  };

  it("shows nothing when the persona has no active benefit", async () => {
    render(<StudentPaymentsPage />);

    await screen.findByTestId("membership-status");
    expect(screen.queryByText(/su beneficio/i)).not.toBeInTheDocument();
  });

  it("shows the benefit's percentage before the payment form, and folds it into the estimated total", async () => {
    mockFetchBeneficio.mockReset().mockResolvedValue(BENEFICIO_PARCIAL);

    render(<StudentPaymentsPage />);

    expect(await screen.findByText(/su beneficio/i)).toBeInTheDocument();
    expect(screen.getByText("50% OFF")).toBeInTheDocument();
    expect(screen.getByText("Beca deportiva")).toBeInTheDocument();

    // $25,00 a un mes, con 50% de beneficio = $12,50 estimado — el normal
    // RenewPaymentForm sigue siendo el formulario (no es 100%).
    fireEvent.click(screen.getByRole("button", { name: /registrar un pago/i }));
    expect(await screen.findByText(/total estimado: \$12,50/i)).toBeInTheDocument();
  });

  it("replaces the payment form with ApplyBenefitForm when the benefit is 100%, with no monto or voucher field", async () => {
    mockFetchBeneficio.mockReset().mockResolvedValue(BENEFICIO_TOTAL);

    render(<StudentPaymentsPage />);

    expect(await screen.findByText("100% OFF")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^registrar un pago$/i })).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: /aplicar mi beneficio/i }));

    expect(screen.queryByLabelText(/forma de pago/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("renew-voucher-input")).not.toBeInTheDocument();
    expect(screen.getByText(/sin costo — el beneficio cubre el 100%/i)).toBeInTheDocument();
  });

  it("applies the benefit only after the checkpoint, sending meses and no monto/tipoPago", async () => {
    mockFetchBeneficio.mockReset().mockResolvedValue(BENEFICIO_TOTAL);
    mockAplicarBeneficio.mockReset().mockResolvedValue({
      id: 9,
      membresiaId: 3,
      personaId: 9,
      fechaInicio: COVERAGE_END,
      fechaFin: RENEWAL_END,
    });

    render(<StudentPaymentsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /aplicar mi beneficio/i }));
    fireEvent.click(screen.getByRole("button", { name: /^aplicar beneficio$/i }));

    const confirm = await screen.findByTestId("benefit-confirm");
    expect(within(confirm).getByText(/beneficio del 100%/i)).toBeInTheDocument();
    expect(mockAplicarBeneficio).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /confirmar y aplicar/i }));

    await waitFor(() => {
      expect(mockAplicarBeneficio).toHaveBeenCalledWith(3, 1);
    });
    expect(mockShowSuccess).toHaveBeenCalledTimes(1);
    const [message] = mockShowSuccess.mock.calls[0];
    expect(message).toMatch(/cobertura activa/i);
  });
});

describe("StudentPaymentsPage — the history", () => {
  it("renders amounts and periods in the product's formats, never the raw API strings", async () => {
    render(<StudentPaymentsPage />);

    // The period is unique to the payment row; the amount is not (the
    // membership card states the same monthly price), so the row is anchored
    // on the period and the amount is asserted across both.
    expect(await screen.findByText(shownRange(PAGO_START, COVERAGE_END))).toBeInTheDocument();
    expect(screen.getAllByText("$25,00").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(PAGO_START, { exact: false })).not.toBeInTheDocument();
  });

  it("states the rejection reason in full — it is the only row that asks the reader to act", async () => {
    mockFetchPagosDePersona.mockResolvedValueOnce([
      makePago({ estadoPago: "RECHAZADO", motivoRechazo: "El comprobante es ilegible" }),
    ]);

    render(<StudentPaymentsPage />);

    expect(await screen.findByText("El comprobante es ilegible")).toBeInTheDocument();
    expect(screen.getByText("Motivo del rechazo")).toBeInTheDocument();
  });

  // Issue #400 (criterio 8): el comprobante OFICIAL que genera el club al
  // aprobar es distinto del voucher que sube el socio (`voucherUrl` /
  // "Ver el comprobante") — solo aparece cuando el backend lo pobló.
  it("shows a 'Descargar comprobante oficial' link when comprobanteOficialUrl is populated", async () => {
    mockFetchPagosDePersona.mockResolvedValueOnce([
      makePago({ estadoPago: "APROBADO", comprobanteOficialUrl: "https://files.example/comprobante-oficial.pdf" }),
    ]);

    render(<StudentPaymentsPage />);

    const link = await screen.findByRole("link", { name: /descargar comprobante oficial/i });
    expect(link).toHaveAttribute("href", "https://files.example/comprobante-oficial.pdf");
  });

  it("does NOT show the official comprobante link when comprobanteOficialUrl is absent", async () => {
    mockFetchPagosDePersona.mockResolvedValueOnce([
      makePago({ estadoPago: "APROBADO", comprobanteOficialUrl: null }),
    ]);

    render(<StudentPaymentsPage />);

    await screen.findByText(shownRange(PAGO_START, COVERAGE_END));
    expect(screen.queryByRole("link", { name: /descargar comprobante oficial/i })).not.toBeInTheDocument();
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

    expect(await screen.findByText(shownRange(PAGO_START, COVERAGE_END))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Rechazados/ }));

    expect(await screen.findByText("No hay pagos rechazados.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver todos los pagos" })).toBeInTheDocument();
  });

  /**
   * A pending transfer with no voucher is exactly what a failed upload after
   * `registrarPago()` succeeded leaves behind (PAG-1) — the ghost payment the
   * owner decided must survive, marked, rather than be reverted (decisiones
   * §7). This is the mark: distinct from a normal "awaiting validation" row,
   * with its own way out.
   */
  it("marks a transfer payment that is missing its voucher, with a button to upload it right there", async () => {
    mockFetchPagosDePersona.mockResolvedValueOnce([
      makePago({ estadoPago: "PENDIENTE_VALIDACION", tipoPago: "TRANSFERENCIA", voucherUrl: null }),
    ]);

    render(<StudentPaymentsPage />);

    expect(await screen.findByText("Falta el comprobante")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^subir comprobante$/i })).toBeInTheDocument();
  });

  it("does not mark an approved or a cash payment as missing its voucher", async () => {
    mockFetchPagosDePersona.mockResolvedValueOnce([
      makePago({ id: 1, estadoPago: "APROBADO", voucherUrl: null, monto: "25.00" }),
      makePago({
        id: 2,
        estadoPago: "PENDIENTE_VALIDACION",
        tipoPago: "EFECTIVO",
        voucherUrl: null,
        monto: "40.00",
      }),
    ]);

    render(<StudentPaymentsPage />);

    await screen.findByText("$40,00");
    expect(screen.queryByText("Falta el comprobante")).not.toBeInTheDocument();
  });

  it("uploads the missing voucher from that same row and refreshes the history", async () => {
    mockFetchPagosDePersona.mockResolvedValueOnce([
      makePago({ id: 77, estadoPago: "PENDIENTE_VALIDACION", tipoPago: "TRANSFERENCIA", voucherUrl: null }),
    ]);

    render(<StudentPaymentsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /^subir comprobante$/i }));

    const file = new File(["contenido"], "comprobante.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByTestId("pago-voucher-input"), { target: { files: [file] } });

    await waitFor(() => {
      expect(mockSubirVoucherPago).toHaveBeenCalledWith(77, file);
    });
    await waitFor(() => {
      expect(mockFetchPagosDePersona).toHaveBeenCalledTimes(2);
    });
  });
});

describe("StudentPaymentsPage — registering a payment", () => {
  it("starts the new period where the paid one ends, so paying early loses no days", async () => {
    mockFetchPagosDePersona.mockResolvedValueOnce([makePago({ fechaFin: COVERAGE_END_AHEAD })]);

    render(<StudentPaymentsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /registrar un pago/i }));

    // $25,00 at a $25 monthly price = one month, starting at the end of the
    // approved coverage.
    expect(
      await screen.findByText(shownRange(COVERAGE_END_AHEAD, RENEWAL_END_AHEAD)),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 mes a \$25,00 por mes/i)).toBeInTheDocument();
  });

  // Issue #400 (slice 06): the free-form monto input (and the "must be a
  // whole multiple of the monthly price" error it could produce) is gone.
  // `MonthCountField` only ever holds a whole number of months, picked with
  // +/- buttons, clamped to [1, 12] — the same bound `PagoCreateDTO.meses`
  // enforces server-side.
  it("lets the reader pick a whole number of months with +/- buttons instead of typing an amount", async () => {
    render(<StudentPaymentsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /registrar un pago/i }));

    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.getByText(/1 mes a \$25,00 por mes/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /un mes más/i }));

    expect(await screen.findByText(/2 meses a \$25,00 por mes/i)).toBeInTheDocument();
    expect(
      await screen.findByText(shownRange(COVERAGE_END, "2026-09-30")),
    ).toBeInTheDocument();
  });

  it("clamps the month count between 1 and 12", async () => {
    render(<StudentPaymentsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /registrar un pago/i }));

    expect(screen.getByRole("button", { name: /un mes menos/i })).toBeDisabled();

    for (let i = 0; i < 11; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: /un mes más/i }));
    }

    expect(await screen.findByText(/12 meses a \$25,00 por mes/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /un mes más/i })).toBeDisabled();

    // One more click past the ceiling does nothing.
    fireEvent.click(screen.getByRole("button", { name: /un mes más/i }));
    expect(screen.getByText(/12 meses a \$25,00 por mes/i)).toBeInTheDocument();
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
      self: { ...SELF, fechaNacimiento: MINOR_BIRTH_DATE },
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
        { ...SELF, personaId: "4", nombres: "Sofia", apellidos: "Vera", fechaNacimiento: MINOR_BIRTH_DATE },
      ],
      membershipPlans: [],
    });

    render(<StudentPaymentsPage />);

    expect(
      await screen.findByRole("button", { name: /registrar un pago/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/no registra pagos desde su propia cuenta/i)).not.toBeInTheDocument();
  });

  // Issue #400 (slice 4c-b): gratuity stopped zeroing `montoAplicado` — the
  // membership below carries a real, nonzero price ($35,00) AND
  // `esGratuidadFamiliar: true`, exactly the combination that would have
  // walked a family through paying a real amount before this slice's gate.
  it("blocks the renewal form for a gratuitous membership and explains why, without showing its real price as owed", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue({
      ...PORTAL,
      self: {
        ...SELF,
        membership: { ...SELF.membership!, montoAplicado: "35.00", esGratuidadFamiliar: true },
      },
    });

    render(<StudentPaymentsPage />);

    expect(await screen.findByText(/gratuidad familiar/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /registrar un pago/i })).not.toBeInTheDocument();
    const card = await screen.findByTestId("membership-status");
    expect(within(card).queryByText("$35,00")).not.toBeInTheDocument();
    expect(within(card).queryByText("Valor mensual")).not.toBeInTheDocument();
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
    expect(within(confirm).getByText(shownRange(COVERAGE_END, RENEWAL_END))).toBeInTheDocument();
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
      expect.objectContaining({ meses: 1, tipoPago: "EFECTIVO", personaId: 9, membresiaId: 3 }),
    );

    // No "Deshacer": there is no endpoint behind one. The toast says what the
    // club does instead, which is the only recovery that actually exists.
    const [message, detail] = mockShowSuccess.mock.calls[0];
    expect(message).toMatch(/en revisión/i);
    expect(detail.description).toMatch(/lo rechaza indicando el motivo/i);
    expect(document.body.textContent).not.toMatch(/deshacer/i);
  });
});

/**
 * PAG-1, the auditoría's only blocking finding: `registrarPago()` succeeds,
 * `subirVoucherPago()` fails (a file over 5 MB, a bad extension, Cloudinary
 * down), and the old form stayed open re-offering "Confirmar y registrar" —
 * which called `registrarPago()` again and collided with the payment it had
 * just created ("ya tiene un pago pendiente"). The owner's decision
 * (decisiones §7) is that the payment is NOT reverted: it survives, marked
 * as missing its voucher (covered above), and the form must get out of the
 * reader's way instead of dead-ending them.
 */
describe("StudentPaymentsPage — a voucher failure after the payment is already registered", () => {
  const voucherFile = new File(["contenido"], "comprobante.pdf", { type: "application/pdf" });

  async function openFormWithVoucher(): Promise<void> {
    fireEvent.click(await screen.findByRole("button", { name: /registrar un pago/i }));
    const fileInput = await screen.findByTestId("renew-voucher-input");
    fireEvent.change(fileInput, { target: { files: [voucherFile] } });
  }

  it("closes the form, states the payment survived, and refreshes the history instead of reoffering the same button", async () => {
    mockRegistrarPago.mockResolvedValueOnce({ id: 77 });
    mockSubirVoucherPago.mockRejectedValueOnce(
      Object.assign(new Error("El archivo supera el límite de 5 MB (6.0 MB)."), { status: 400 }),
    );

    render(<StudentPaymentsPage />);
    await openFormWithVoucher();
    fireEvent.click(screen.getByRole("button", { name: /^registrar pago$/i }));
    await screen.findByTestId("renew-confirm");

    fireEvent.click(screen.getByRole("button", { name: /confirmar y registrar/i }));

    await waitFor(() => {
      expect(mockSubirVoucherPago).toHaveBeenCalledWith(77, voucherFile);
    });

    // Gone, not reoffered: a second click here used to call registrarPago()
    // again and create the ghost-payment collision.
    await waitFor(() => {
      expect(screen.queryByTestId("renew-confirm")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /confirmar y registrar/i })).not.toBeInTheDocument();
    });

    expect(mockShowWarning).toHaveBeenCalledTimes(1);
    const [message, detail] = mockShowWarning.mock.calls[0];
    expect(message).toMatch(/se registró/i);
    expect(message).toMatch(/no pudimos subir el comprobante/i);
    expect(detail.description).toMatch(/límite de 5 MB/i);
    expect(detail.description).toMatch(/historial/i);

    // The reader must not have to reload by hand to see the row it can now
    // finish from.
    expect(mockFetchPagosDePersona).toHaveBeenCalledTimes(2);

    // No success toast for a payment that is still missing its voucher.
    expect(mockShowSuccess).not.toHaveBeenCalled();
  });

  it("still shows the inline error and keeps the form open when registrarPago itself fails", async () => {
    mockRegistrarPago.mockRejectedValueOnce(
      Object.assign(new Error("El monto no coincide con la membresía activa."), { status: 400 }),
    );

    render(<StudentPaymentsPage />);
    await openFormWithVoucher();
    fireEvent.click(screen.getByRole("button", { name: /^registrar pago$/i }));
    await screen.findByTestId("renew-confirm");

    fireEvent.click(screen.getByRole("button", { name: /confirmar y registrar/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/el monto no coincide/i);
    // The checkpoint is still here: nothing was created, so retrying from it
    // is safe and is exactly what should happen.
    expect(screen.getByTestId("renew-confirm")).toBeInTheDocument();
    expect(mockSubirVoucherPago).not.toHaveBeenCalled();
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

/**
 * D11c — "la ayuda no vive suelta".
 *
 * "Cómo se registra un pago" is a procedure, top to bottom: three numbered
 * steps saying what the form will ask for and who validates it. The subtitle
 * of the page already says WHAT this screen is; everything that explains HOW
 * it works belongs behind "Ver ayuda", which is the contract the admin panel
 * has honoured since #199 and the family screens never adopted.
 *
 * It was also the layout defect. The rail was a block of FIXED height, so in
 * the thin state — one payment, or none — it was the tallest item on the
 * screen and its height became the row's. The comment it carried admitted as
 * much ("dejaba un hueco de 170px"); moving it behind the disclosure removes
 * the item that was setting the height, rather than compensating for it.
 */
describe("StudentPaymentsPage — the procedure is disclosed, not a permanent rail", () => {
  it("keeps the three steps behind 'Ver ayuda' instead of printing them beside the card", async () => {
    render(<StudentPaymentsPage />);

    await screen.findByTestId("membership-status");
    expect(screen.queryByText(/Son tres pasos y terminan en el club/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cómo se registra un pago" }));

    expect(screen.getByText(/Son tres pasos y terminan en el club/i)).toBeInTheDocument();
    expect(screen.getByText(/hasta 5 MB/i)).toBeInTheDocument();
  });

  it("discloses the club-registers-it variant for a minor on their own account", async () => {
    mockUseAuth.mockReturnValue(authSession("estudiante"));
    mockFetchStudentPortal.mockResolvedValue({
      self: { ...SELF, fechaNacimiento: MINOR_BIRTH_DATE },
      representados: [],
      membershipPlans: [],
    });

    render(<StudentPaymentsPage />);

    await screen.findByTestId("membership-status");
    fireEvent.click(screen.getByRole("button", { name: "Cómo se paga esta membresía" }));

    expect(screen.getByText(/Acérquese a administración del club/i)).toBeInTheDocument();
  });
});

/**
 * D11b — the history is the block that grows with the family's real record, so
 * it is the one that claims the height `main` already reserved. Everything
 * else on this screen is a fixed summary.
 *
 * D11 — and its empty state gets the third part it was missing. The `action`
 * used to appear ONLY when a filter was on, which is backwards: a filtered
 * empty list is the recoverable case, and the case with no payments at all —
 * the socio nuevo D11b says to design for FIRST — was the one left with no way
 * out.
 */
describe("StudentPaymentsPage — the history claims the page's leftover height", () => {
  /*
   * Both directions, because the first draft of this pass got it wrong in a
   * way only a browser showed.
   *
   * Stretching the history unconditionally read fine in jsdom and was measured
   * as a defect at 1440x900: with one payment on file the card ran to the foot
   * of the window and drew a 200px empty frame under a single row. That is the
   * same emptiness the redesign is closing, moved inside a border — and a
   * bordered empty box is MORE visible than the canvas it replaced, not less.
   *
   * Stretching earns its keep only where `EmptyState`'s `fill` can centre a
   * statement in the box, which is the empty case — and that is also the case
   * D11b says to design for first, because a socio nuevo has no payments.
   */
  it("leaves the card at its own height while there are rows to show", async () => {
    render(<StudentPaymentsPage />);

    const history = await screen.findByLabelText("Historial de pagos");
    expect(history.className).not.toMatch(/\bflex-1\b/);
  });

  it("claims the page's leftover height only when there is nothing to list", async () => {
    mockFetchPagosDePersona.mockResolvedValue([]);

    render(<StudentPaymentsPage />);

    await screen.findByText("Todavía no hay pagos registrados.");
    expect(screen.getByLabelText("Historial de pagos").className).toMatch(/\bflex-1\b/);
  });

  it("gives a family with no payments at all somewhere to go", async () => {
    mockFetchPagosDePersona.mockResolvedValue([]);

    render(<StudentPaymentsPage />);

    expect(await screen.findByText("Todavía no hay pagos registrados.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Registrar un pago/i })).toBeInTheDocument();
  });

  it("fills the stretched card rather than floating its statement at the top", async () => {
    mockFetchPagosDePersona.mockResolvedValue([]);

    const { container } = render(<StudentPaymentsPage />);

    const title = await screen.findByText("Todavía no hay pagos registrados.");
    const emptyState = title.parentElement;
    expect(emptyState?.className).toMatch(/\bflex-1\b/);
    expect(emptyState?.className).toMatch(/justify-center/);
    void container;
  });
});

/**
 * Issue #316 hallazgo #70: `/student/payments` and `/student/attendance` were
 * the only two second-level screens with no way back at all — `/ayuda` and
 * `/profile`, reached from the very same sidebar, both carry one.
 */
describe("StudentPaymentsPage — the way back", () => {
  it("offers a real BackLink to Mi cuenta, not only the sidebar", async () => {
    render(<StudentPaymentsPage />);

    const back = await screen.findByRole("link", { name: /volver a mi cuenta/i });
    expect(back).toHaveAttribute("href", "/student");
  });
});

/**
 * El descuento que el club ya aplicó — hallazgo de QA humana del 17/08/2026:
 * «a la hora de pagar no se me muestra el apartado de descuentos».
 *
 * El socio no elige descuentos: aplicarlos es potestad exclusiva del
 * administrador (`registrar_pago` rechaza `descuento_ids` de cualquier otro
 * rol; issue #11 §4). Pero el pago le llega con el monto ya descontado, y
 * hasta acá el historial mostraba ese número solo, sin una palabra que lo
 * explicara. El precio de lista no es un campo del backend: `Pago.monto` ES
 * el monto final, y el base se reconstruye sumándole el valor congelado.
 */
describe("StudentPaymentsPage — el descuento que el club ya aplicó", () => {
  it("explains the three numbers behind a discounted amount", async () => {
    mockFetchPagosDePersona.mockResolvedValue([
      makePago({
        monto: "17.50",
        descuentoValorAplicado: "17.50",
        descuentoPorcentajeAplicado: "50.00",
      }),
    ]);

    render(<StudentPaymentsPage />);

    const detalle = await screen.findByTestId("pago-descuento");
    expect(within(detalle).getByText("Descuento aplicado por el club")).toBeInTheDocument();
    expect(within(detalle).getByText("Precio de lista")).toBeInTheDocument();
    expect(within(detalle).getByText("$35,00")).toBeInTheDocument();
    expect(within(detalle).getByText("Descuento")).toBeInTheDocument();
    expect(within(detalle).getByText("−$17,50 (50%)")).toBeInTheDocument();
    expect(within(detalle).getByText("Monto final")).toBeInTheDocument();
  });

  it("omits the percentage when the discount was a fixed amount", async () => {
    mockFetchPagosDePersona.mockResolvedValue([
      makePago({
        monto: "25.00",
        descuentoValorAplicado: "10.00",
        descuentoPorcentajeAplicado: null,
      }),
    ]);

    render(<StudentPaymentsPage />);

    const detalle = await screen.findByTestId("pago-descuento");
    expect(within(detalle).getByText("−$10,00")).toBeInTheDocument();
    expect(within(detalle).queryByText(/%/)).not.toBeInTheDocument();
  });

  it("shows nothing at all when there was no discount — never a «Descuentos: 0»", async () => {
    render(<StudentPaymentsPage />);

    await screen.findByLabelText("Historial de pagos");
    expect(screen.queryByTestId("pago-descuento")).not.toBeInTheDocument();
    expect(screen.queryByText(/descuento/i)).not.toBeInTheDocument();
  });
});
