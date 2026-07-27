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
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import StudentPage from "@/app/student/page";
import type { StudentPortalSummary } from "@/services/api";
import type { PagoPersona } from "@/services/api";

vi.mock("@/components/ProtectedRoute", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

/**
 * The dependent selection lives in `?alumno=` now (see `ManagedStudentPicker`),
 * so the search params and `router.replace` are part of this screen's contract.
 * Tests that care set `searchParams` before rendering and read `mockReplace`.
 */
let searchParams = new URLSearchParams();
const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/student",
  useRouter: () => ({ push: vi.fn(), replace: mockReplace }),
  useSearchParams: () => searchParams,
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
    refreshSession: vi.fn(),
  }),
}));

const mockFetchStudentPortal = vi.fn();
const mockFetchPagosDePersona = vi.fn();
const mockFetchHorariosPorAlumno = vi.fn();
const mockIndependizarPersona = vi.fn();

vi.mock("@/services/api", () => ({
  fetchStudentPortal: () => mockFetchStudentPortal(),
  // Still read here — the carnet's "Cobertura hasta" is the furthest
  // `fechaFin` among approved payments, the only real coverage date there is.
  fetchPagosDePersona: (...args: unknown[]) => mockFetchPagosDePersona(...args),
  // The student's REAL schedule assignments — the only source the "Próximos
  // entrenamientos" panel is allowed to state a future session from.
  fetchHorariosPorAlumno: (...args: unknown[]) => mockFetchHorariosPorAlumno(...args),
  independizarPersona: (...args: unknown[]) => mockIndependizarPersona(...args),
}));

/** One `AlumnoHorario` row, in the camelCase shape the backend actually serializes. */
function asignacion(dia: string, horaInicio: string, horaFin: string, id = 1) {
  return {
    id,
    personaId: 9,
    personaNombreCompleto: "Alumno Test",
    edad: 26,
    horarioId: id,
    horarioDia: dia,
    horarioHoraInicio: horaInicio,
    horarioHoraFin: horaFin,
    fechaAsignacion: "2026-07-01T09:00:00Z",
  };
}

const PORTAL: StudentPortalSummary = {
  self: {
    personaId: "9",
    nombres: "Alumno",
    apellidos: "Test",
    fechaNacimiento: "2000-05-14",
    ranking: { status: "unavailable", reason: "error" },
    recentSessions: [],
    membership: null,
    representante: null,
    representanteId: null,
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
  searchParams = new URLSearchParams();
  mockReplace.mockReset();
  window.sessionStorage.clear();
  mockFetchStudentPortal.mockReset().mockResolvedValue(PORTAL);
  mockFetchPagosDePersona.mockReset().mockResolvedValue([]);
  mockFetchHorariosPorAlumno.mockReset().mockResolvedValue([]);
  mockIndependizarPersona.mockReset().mockResolvedValue(undefined);
});

/**
 * The defect this pass exists for: a guardian picked her 16-year-old here,
 * clicked "Pagos" in the sidebar, and the next screen silently reverted to the
 * 10-year-old — same layout, different plan, different amount, different
 * history, and no signal at all that the subject had changed.
 *
 * The selection is route state now: `?alumno=` in the address bar, backed by a
 * per-account `sessionStorage` entry because the sidebar's plain
 * `/student/...` links cannot carry a query string.
 */
describe("StudentPage — the dependent selection survives navigation", () => {
  const GUARDIAN_PORTAL: StudentPortalSummary = {
    self: null,
    representados: [
      { ...PORTAL.self!, personaId: "41", nombres: "Sofía", apellidos: "Vera" },
      { ...PORTAL.self!, personaId: "42", nombres: "Martín", apellidos: "Vera" },
    ],
    membershipPlans: [],
  };

  beforeEach(() => {
    mockFetchStudentPortal.mockReset().mockResolvedValue(GUARDIAN_PORTAL);
  });

  /** Whose carnet is on screen — the screen's own answer, not the select's. */
  async function carnetName(): Promise<string> {
    const carnet = await screen.findByTestId("student-carnet");
    return carnet.getAttribute("aria-label") ?? "";
  }

  it("opens on the profile named by ?alumno=, not on the first dependent", async () => {
    searchParams = new URLSearchParams("alumno=42");

    render(<StudentPage />);

    expect(await carnetName()).toBe("Carnet de socio de Martín Vera");
  });

  it("restores the stored selection when the sidebar drops it, and puts it back in the URL", async () => {
    // Exactly what clicking "Pagos" and then "Mi cuenta" in the sidebar does:
    // arrive at a bare `/student` with a selection already made.
    window.sessionStorage.setItem("cata:student-portal:alumno:9", "42");

    render(<StudentPage />);

    expect(await carnetName()).toBe("Carnet de socio de Martín Vera");
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/student?alumno=42", { scroll: false });
    });
  });

  it("writes an explicit switch to both the URL and the store", async () => {
    render(<StudentPage />);

    const select = await screen.findByLabelText("Estudiante");
    expect(await carnetName()).toBe("Carnet de socio de Sofía Vera");

    fireEvent.change(select, { target: { value: "42" } });

    expect(await carnetName()).toBe("Carnet de socio de Martín Vera");
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/student?alumno=42", { scroll: false });
    });
    expect(window.sessionStorage.getItem("cata:student-portal:alumno:9")).toBe("42");
  });

  it("ignores a stored id the account no longer manages instead of rendering nothing", async () => {
    window.sessionStorage.setItem("cata:student-portal:alumno:9", "999");

    render(<StudentPage />);

    expect(await carnetName()).toBe("Carnet de socio de Sofía Vera");
  });
});

describe("StudentPage — contextual dependent CTA", () => {
  it("offers NO dependent CTA to a self-managed student with no dependents", async () => {
    render(<StudentPage />);

    await screen.findByTestId("student-carnet");
    // The old CTA pointed at the PUBLIC wizard, which creates a second
    // account; /student/add-dependent is gated to `representante`, so this
    // account has no honest destination at all.
    expect(screen.queryByText(/hijo o dependiente/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /inscribir a un hijo o dependiente/i }),
    ).not.toBeInTheDocument();
  });

  it("links to the authenticated add-dependent wizard once the account already represents a dependent", async () => {
    mockFetchStudentPortal
      .mockReset()
      .mockResolvedValue({ ...PORTAL, representados: [{ ...PORTAL.self, personaId: "42" }] });

    render(<StudentPage />);

    const link = await screen.findByText("Agregar hijo o dependiente");
    expect(link.closest("a")).toHaveAttribute("href", "/student/add-dependent");
  });
});

describe("StudentPage — the club membership card (carnet)", () => {
  it("shows the student's name, real level and membership state", async () => {
    mockFetchStudentPortal.mockResolvedValueOnce({
      ...PORTAL,
      self: {
        ...PORTAL.self!,
        ranking: { status: "available", nivelNombre: "Nivel 3", estaEnRanking: true },
        membership: { id: 4, estado: "ACTIVA", personaId: 9, montoAplicado: "25.00", categoria: "Mensual", modalidad: "MENSUAL", franjaHoraria: "Tarde" },
      },
    });

    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    expect(within(carnet).getByText("Alumno Test")).toBeInTheDocument();
    expect(within(carnet).getByText("Nivel 3")).toBeInTheDocument();
    expect(within(carnet).getByText("Membresía activa")).toBeInTheDocument();
    // The carnet carries the whole membership: plan, modalidad and amount.
    expect(within(carnet).getByText("Plan")).toBeInTheDocument();
    expect(within(carnet).getByText("Modalidad")).toBeInTheDocument();
    expect(within(carnet).getAllByText("Mensual")).toHaveLength(2);
    // "Valor mensual", the same label `/student/payments` puts on the same
    // field — the carnet used to call it "Monto".
    expect(within(carnet).getByText("Valor mensual")).toBeInTheDocument();
    expect(within(carnet).getByText("$25,00")).toBeInTheDocument();
  });

  it("never prints a member number or a join date — neither reaches this client", async () => {
    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    expect(within(carnet).queryByText(/miembro n/i)).not.toBeInTheDocument();
    expect(within(carnet).queryByText(/^desde$/i)).not.toBeInTheDocument();
    expect(within(carnet).queryByText(/renueva/i)).not.toBeInTheDocument();
  });

  it("derives 'Cobertura hasta' from the furthest approved payment, never from an invented renewal date", async () => {
    mockFetchPagosDePersona.mockResolvedValueOnce([PAGO_APROBADO]);

    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    await waitFor(() => {
      expect(within(carnet).getByText("Cobertura hasta")).toBeInTheDocument();
    });
  });

  it("omits 'Cobertura hasta' entirely when nothing has been approved", async () => {
    mockFetchPagosDePersona.mockResolvedValueOnce([PAGO_RECHAZADO]);

    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    await waitFor(() => {
      expect(within(carnet).queryByText("Cobertura hasta")).not.toBeInTheDocument();
    });
  });

  it("lays the facts out on one grid, in order, so their columns line up", async () => {
    // Guards the alignment regression this card was polished for: as a
    // wrapping flex row each fact was only as wide as its own value, so the
    // labels landed at arbitrary x positions and no two rows shared a column.
    mockFetchStudentPortal.mockResolvedValueOnce({
      ...PORTAL,
      self: {
        ...PORTAL.self!,
        membership: {
          id: 4,
          estado: "ACTIVA",
          personaId: 9,
          montoAplicado: "25.00",
          categoria: "Mensual",
          modalidad: "MENSUAL",
          franjaHoraria: "Tarde",
          fechaActivacion: "2026-03-18",
        },
      },
    });
    mockFetchPagosDePersona.mockResolvedValueOnce([PAGO_APROBADO]);

    render(<StudentPage />);

    const facts = await screen.findByTestId("carnet-facts");
    await waitFor(() => {
      expect(within(facts).getByText("Cobertura hasta")).toBeInTheDocument();
    });
    expect(facts.className).toContain("grid");
    expect([...facts.children].map((cell) => cell.firstElementChild?.textContent)).toEqual([
      "Socio desde",
      "Plan",
      "Franja",
      "Modalidad",
      "Valor mensual",
      "Cobertura hasta",
    ]);
  });

  it("says 'Sin nivel asignado' rather than guessing a rung when the ranking is unavailable", async () => {
    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    expect(within(carnet).getByText("Sin nivel asignado")).toBeInTheDocument();
  });
});

/**
 * The panel the user asked for: "que le diga los próximos entrenamientos".
 *
 * Every date on it is the next calendar occurrence of a slot the club actually
 * assigned to this student (`AlumnoHorario`), never a projection off the
 * membership's `franjaHoraria` — which is a time range with no weekday in it.
 */
describe("StudentPage — próximos entrenamientos", () => {
  it("lists the next occurrences of the schedule the club assigned, soonest first", async () => {
    // A Wednesday. The club's three consecutive one-hour blocks are one
    // window to the family, so the panel says 15:00 — 18:00, not three rows.
    // Only `Date` is faked — faking timers wholesale deadlocks `waitFor`.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-22T09:00:00-05:00"));
    mockFetchHorariosPorAlumno.mockResolvedValue([
      asignacion("MIERCOLES", "15:00:00", "16:00:00", 1),
      asignacion("MIERCOLES", "16:00:00", "17:00:00", 2),
      asignacion("MIERCOLES", "17:00:00", "18:00:00", 3),
      asignacion("VIERNES", "15:00:00", "18:00:00", 4),
    ]);

    render(<StudentPage />);

    const panel = await screen.findByTestId("student-situation");
    await waitFor(() => {
      expect(within(panel).getByText("Miércoles")).toBeInTheDocument();
    });
    expect(within(panel).getAllByText("15:00 — 18:00")).toHaveLength(2);
    // Today's window has not closed at 09:00, so today IS the next session.
    expect(within(panel).getByText("Hoy")).toBeInTheDocument();
    expect(within(panel).getByText("22/07/2026")).toBeInTheDocument();
    expect(within(panel).getByText("24/07/2026")).toBeInTheDocument();

    vi.useRealTimers();
  });

  it("lets the training rows absorb the card's spare height instead of pooling it", async () => {
    /*
     * The card is `h-full` so it matches the taller card beside it, the list is
     * `flex-1` and the footer is `mt-auto`. With at most three rows, all the
     * leftover height collected into one dead band between the last row and the
     * footer. Sharing it across the rows keeps the card full without inventing
     * content or letting the footer float.
     */
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-22T09:00:00-05:00"));
    mockFetchHorariosPorAlumno.mockResolvedValue([
      asignacion("MIERCOLES", "15:00:00", "18:00:00", 1),
    ]);

    render(<StudentPage />);

    const panel = await screen.findByTestId("student-situation");
    await waitFor(() => {
      expect(within(panel).getByText("Miércoles")).toBeInTheDocument();
    });

    const rows = within(panel).getAllByRole("listitem");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.className).toMatch(/\bflex-1\b/);
    }

    vi.useRealTimers();
  });

  it("moves past a window that has already closed today instead of calling it 'hoy'", async () => {
    // Same Wednesday, 21:00 — the 15:00–18:00 session is over.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-22T21:00:00-05:00"));
    mockFetchHorariosPorAlumno.mockResolvedValue([
      asignacion("MIERCOLES", "15:00:00", "18:00:00", 1),
    ]);

    render(<StudentPage />);

    const panel = await screen.findByTestId("student-situation");
    await waitFor(() => {
      expect(within(panel).getByText("29/07/2026")).toBeInTheDocument();
    });
    expect(within(panel).queryByText("Hoy")).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it("says the club has assigned no schedule rather than inventing one from the plan's franja", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue({
      ...PORTAL,
      self: {
        ...PORTAL.self!,
        membership: {
          id: 4,
          estado: "ACTIVA",
          personaId: 9,
          montoAplicado: "25.00",
          categoria: "Mensual Infantil",
          modalidad: "MENSUAL",
          // A time range with no weekday in it — not a schedule.
          franjaHoraria: "15:00-18:00",
        },
      },
    });
    mockFetchHorariosPorAlumno.mockResolvedValue([]);

    render(<StudentPage />);

    const panel = await screen.findByTestId("student-situation");
    await waitFor(() => {
      expect(
        within(panel).getByText(/todavía no tiene un horario asignado/i),
      ).toBeInTheDocument();
    });
    expect(within(panel).queryByText("15:00 — 18:00")).not.toBeInTheDocument();
  });

  it("keeps the payment band standing when the schedule lookup fails", async () => {
    mockFetchHorariosPorAlumno.mockRejectedValue(new Error("boom"));

    render(<StudentPage />);

    const panel = await screen.findByTestId("student-situation");
    await waitFor(() => {
      expect(within(panel).getByText(/no se pudo consultar el horario/i)).toBeInTheDocument();
    });
    expect(screen.getByTestId("student-payment-band")).toBeInTheDocument();
  });
});

describe("StudentPage — training panel", () => {
  it("states a real attendance fact from the recorded sessions", async () => {
    mockFetchStudentPortal.mockResolvedValueOnce({
      ...PORTAL,
      self: {
        ...PORTAL.self!,
        recentSessions: [
          { fecha: "2026-07-20", horario: "Lunes 15:00 — 16:00", estado: "present" },
          { fecha: "2026-07-18", horario: "Viernes 15:00 — 16:00", estado: "absent" },
          { fecha: "2026-07-15", horario: "Lunes 15:00 — 16:00", estado: "late" },
        ],
      },
    });

    render(<StudentPage />);

    expect(await screen.findByText(/de sus últimas 3 sesiones registradas/i)).toBeInTheDocument();
    expect(screen.getByText("2 de 3")).toBeInTheDocument();
  });

  it("makes no attendance claim at all when nothing has been recorded", async () => {
    render(<StudentPage />);

    expect(
      await screen.findByText(/su asistencia aparecerá aquí en cuanto el entrenador tome lista/i),
    ).toBeInTheDocument();
  });
});

/**
 * The band is the screen's answer to "no se indica bien cómo ir a hacer el
 * pago": it opens the page, states what the club can prove about coverage, and
 * carries the one action — one click from here to an open form.
 */
describe("StudentPage — the payment band", () => {
  const MEMBERSHIP = {
    id: 3,
    estado: "ACTIVA",
    personaId: 9,
    montoAplicado: "35.00",
    categoria: "Mensual",
    modalidad: "MENSUAL" as const,
    franjaHoraria: "15:00-18:00",
  };

  function portalWithMembership(overrides: Record<string, unknown> = {}) {
    return {
      ...PORTAL,
      self: { ...PORTAL.self!, membership: MEMBERSHIP, ...overrides },
    };
  }

  it("puts the payment action above everything else and lands on an already-open form", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue(portalWithMembership());
    mockFetchPagosDePersona.mockResolvedValue([PAGO_APROBADO]);

    render(<StudentPage />);

    const band = await screen.findByTestId("student-payment-band");
    await waitFor(() => {
      // The CTA carries the profile it is about — `?registrar=1` says "this
      // reader came here to pay", `?alumno=` says whose payment it is.
      expect(within(band).getByText("Registrar un pago").closest("a")).toHaveAttribute(
        "href",
        "/student/payments?registrar=1&alumno=9",
      );
    });

    // …and it is the FIRST thing in the content column, ahead of the carnet.
    const carnet = screen.getByTestId("student-carnet");
    expect(band.compareDocumentPosition(carnet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("reports coverage from the furthest approved payment, and says so plainly", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue(portalWithMembership());
    mockFetchPagosDePersona.mockResolvedValue([PAGO_APROBADO]);

    render(<StudentPage />);

    const band = await screen.findByTestId("student-payment-band");
    await waitFor(() => {
      expect(within(band).getByText(/31\/07\/2026/)).toBeInTheDocument();
    });
  });

  it("says nothing has been approved rather than implying coverage it cannot prove", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue(portalWithMembership());
    mockFetchPagosDePersona.mockResolvedValue([PAGO_RECHAZADO]);

    render(<StudentPage />);

    const band = await screen.findByTestId("student-payment-band");
    await waitFor(() => {
      expect(within(band).getByText(/no tiene ningún pago aprobado/i)).toBeInTheDocument();
    });
  });

  it("states the plan's monthly price as a price, and never an amount owed", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue(portalWithMembership());
    mockFetchPagosDePersona.mockResolvedValue([]);

    render(<StudentPage />);

    const band = await screen.findByTestId("student-payment-band");
    await waitFor(() => {
      expect(within(band).getByText(/\$35,00 al mes/)).toBeInTheDocument();
    });
    // There is no debt concept anywhere in the backend, so the band never
    // states one.
    expect(within(band).queryByText(/adeuda|deuda|total a pagar|vence el/i)).not.toBeInTheDocument();
  });

  it("hands a pending payment back to the club instead of asking for a second one", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue(portalWithMembership());
    mockFetchPagosDePersona.mockResolvedValue([
      { ...PAGO_APROBADO, id: 3, estadoPago: "PENDIENTE_VALIDACION" },
    ]);

    render(<StudentPage />);

    const band = await screen.findByTestId("student-payment-band");
    await waitFor(() => {
      expect(within(band).getByText(/el club está validando/i)).toBeInTheDocument();
    });
    expect(within(band).queryByText("Registrar un pago")).not.toBeInTheDocument();
  });

  it("offers a minor on their own account the read-only route, never 'registrar un pago'", async () => {
    mockFetchStudentPortal
      .mockReset()
      .mockResolvedValue(portalWithMembership({ fechaNacimiento: "2014-03-10" }));
    mockFetchPagosDePersona.mockResolvedValue([]);

    render(<StudentPage />);

    const band = await screen.findByTestId("student-payment-band");
    expect(within(band).getByText("Ver los pagos").closest("a")).toHaveAttribute(
      "href",
      "/student/payments?alumno=9",
    );
    expect(within(band).queryByText("Registrar un pago")).not.toBeInTheDocument();
  });

  it("sends a minor with no representative on record to the club, not to a person who does not exist", async () => {
    mockFetchStudentPortal
      .mockReset()
      .mockResolvedValue(portalWithMembership({ fechaNacimiento: "2014-03-10" }));
    mockFetchPagosDePersona.mockResolvedValue([]);

    render(<StudentPage />);

    const band = await screen.findByTestId("student-payment-band");
    expect(within(band).getByText(/administración del club/i)).toBeInTheDocument();
    expect(within(band).queryByText(/lo hace su representante/i)).not.toBeInTheDocument();
  });

  it("still offers the real payment CTA when a guardian is looking at a minor dependent", async () => {
    // The session persona (9) is the guardian; the selected profile (42) is
    // the child. The backend authorizes the representative to pay, so the
    // screen must not degrade to the read-only link here.
    mockFetchStudentPortal.mockReset().mockResolvedValue({
      ...PORTAL,
      self: null,
      representados: [
        {
          ...PORTAL.self!,
          personaId: "42",
          nombres: "Sofía",
          fechaNacimiento: "2014-03-10",
          membership: MEMBERSHIP,
        },
      ],
    });
    mockFetchPagosDePersona.mockResolvedValue([]);

    render(<StudentPage />);

    const band = await screen.findByTestId("student-payment-band");
    await waitFor(() => {
      expect(within(band).getByText("Registrar un pago")).toBeInTheDocument();
    });
    // …and it names the child, because the reader is not the student.
    expect(within(band).getByText(/Sofía/)).toBeInTheDocument();
  });
});

describe("StudentPage — the training panel", () => {
  it("ends in the screen that owns the attendance record", async () => {
    render(<StudentPage />);

    const panel = await screen.findByTestId("student-situation");
    expect(within(panel).getByText("Ver mis asistencias").closest("a")).toHaveAttribute(
      "href",
      "/student/attendance?alumno=9",
    );
  });

  it("names the dependent instead of telling a guardian about their own attendance", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue({
      ...PORTAL,
      self: null,
      representados: [{ ...PORTAL.self!, personaId: "42", nombres: "Sofía" }],
    });

    render(<StudentPage />);

    const panel = await screen.findByTestId("student-situation");
    expect(
      within(panel).getByText("Ver las asistencias de Sofía").closest("a"),
    ).toHaveAttribute("href", "/student/attendance?alumno=42");
  });
});

describe("StudentPage — membership state on the carnet", () => {
  it("shows sin membresía when there is no membership row", async () => {
    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    expect(within(carnet).getByText("Sin membresía")).toBeInTheDocument();
  });

  it("shows membresía pendiente for an INACTIVA membership", async () => {
    mockFetchStudentPortal.mockResolvedValueOnce({
      ...PORTAL,
      self: { ...PORTAL.self!, membership: { id: 5, estado: "INACTIVA", personaId: 9, montoAplicado: "85.00", categoria: "Mensual", modalidad: "MENSUAL", franjaHoraria: null } },
    });

    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    expect(within(carnet).getByText("Membresía pendiente")).toBeInTheDocument();
  });
});
