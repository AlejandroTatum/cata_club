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
  it("shows the student's name, plan and payment status band", async () => {
    mockFetchStudentPortal.mockResolvedValueOnce({
      ...PORTAL,
      self: {
        ...PORTAL.self!,
        membership: { id: 4, estado: "ACTIVA", personaId: 9, montoAplicado: "25.00", categoria: "Mensual", modalidad: "MENSUAL" },
      },
    });

    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    expect(within(carnet).getByText("Alumno Test")).toBeInTheDocument();
    // The carnet carries plan and amount; "Modalidad" moved off the carnet
    // entirely (see the doc comment on `Carnet` in page.tsx) and "Membresía
    // activa" is gone — the band below states the PAYMENT situation instead.
    expect(within(carnet).getByText("Plan")).toBeInTheDocument();
    expect(within(carnet).queryByText("Modalidad")).not.toBeInTheDocument();
    expect(within(carnet).getByText("Mensual")).toBeInTheDocument();
    // "Valor mensual", the same label `/student/payments` puts on the same
    // field — the carnet used to call it "Monto".
    expect(within(carnet).getByText("Valor mensual")).toBeInTheDocument();
    expect(within(carnet).getByText("$25,00")).toBeInTheDocument();
    expect(within(carnet).getByTestId("carnet-status-band")).toBeInTheDocument();
  });

  it("never prints a member number or a join date — neither reaches this client", async () => {
    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    expect(within(carnet).queryByText(/miembro n/i)).not.toBeInTheDocument();
    expect(within(carnet).queryByText(/^desde$/i)).not.toBeInTheDocument();
    expect(within(carnet).queryByText(/renueva/i)).not.toBeInTheDocument();
  });

  it("moves the coverage date off the carnet and onto the Cuota card, worded as the maquette draws it", async () => {
    mockFetchPagosDePersona.mockResolvedValueOnce([PAGO_APROBADO]);

    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    const cuota = await screen.findByTestId("student-cuota-card");
    // "Cubierta hasta", not the old carnet fact's "Cobertura hasta" — the
    // Cuota card's own row label matches the chosen maquette's wording.
    await waitFor(() => {
      expect(within(cuota).getByText("Cubierta hasta")).toBeInTheDocument();
    });
    expect(within(carnet).queryByText("Cubierta hasta")).not.toBeInTheDocument();
    expect(within(carnet).queryByText("Cobertura hasta")).not.toBeInTheDocument();
  });

  it("omits the coverage row entirely when nothing has been approved", async () => {
    mockFetchPagosDePersona.mockResolvedValueOnce([PAGO_RECHAZADO]);

    render(<StudentPage />);

    const cuota = await screen.findByTestId("student-cuota-card");
    await waitFor(() => {
      expect(within(cuota).queryByText("Cubierta hasta")).not.toBeInTheDocument();
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
          fechaActivacion: "2026-03-18",
        },
      },
    });
    mockFetchPagosDePersona.mockResolvedValueOnce([PAGO_APROBADO]);
    // "Franja" is one of the four cells, and it only exists when the club has
    // assigned a schedule to derive it from.
    mockFetchHorariosPorAlumno.mockResolvedValue([asignacion("LUNES", "15:00:00", "16:00:00", 1)]);

    render(<StudentPage />);

    const facts = await screen.findByTestId("carnet-facts");
    await waitFor(() => {
      expect(within(facts).getByText("Franja")).toBeInTheDocument();
    });
    expect(facts.className).toContain("grid");
    expect([...facts.children].map((cell) => cell.firstElementChild?.textContent)).toEqual([
      "Socio desde",
      "Plan",
      "Franja",
      "Valor mensual",
    ]);
  });

  // Fix 12c: the 360px cap on the fact grid was sized for when the carnet was
  // fix 12's ~1000px "wide" column. Now that the carnet and the rail split the
  // row evenly (matching the chosen maquette), a fixed cap would leave an
  // empty strip inside the card instead of filling it — reintroducing, inside
  // the carnet, the exact emptiness fix 12b already closed once.
  it("lets the facts grid fill the carnet's real width instead of capping at the old wide-column measure", async () => {
    render(<StudentPage />);

    const facts = await screen.findByTestId("carnet-facts");
    expect(facts.className).not.toMatch(/max-w-\[360px\]/);
  });
});

/**
 * The carnet's "Franja" and the "Próximos entrenamientos" panel are two
 * inches apart on one screen, and they used to disagree: the card printed
 * `tipo_membresia.franja_horaria`, a hand-typed String(80) that nothing kept
 * in sync, while the panel derived the real window from the horarios the club
 * assigned. An Adultos student read "20:00-21:00" on the card and
 * "20:00 — 21:15" on the list.
 *
 * These assertions are about COHERENCE, not existence: they read the window
 * off the panel and demand the card say the same thing. Dropping the column
 * without deriving its replacement leaves them red.
 */
describe("StudentPage — the carnet's franja agrees with the assigned schedule", () => {
  const ADULTOS_MEMBERSHIP = {
    id: 4,
    estado: "ACTIVA",
    personaId: 9,
    montoAplicado: "40.00",
    categoria: "Mensual Adultos",
    modalidad: "MENSUAL" as const,
  };

  function portalForAdultos() {
    return { ...PORTAL, self: { ...PORTAL.self!, membership: ADULTOS_MEMBERSHIP } };
  }

  function franjaValue(carnet: HTMLElement): string | undefined {
    return within(carnet).getByText("Franja").parentElement?.lastElementChild?.textContent ?? undefined;
  }

  it("states the window the club assigned (21:15), not the plan's stale 21:00", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue(portalForAdultos());
    mockFetchHorariosPorAlumno.mockResolvedValue([
      asignacion("LUNES", "20:00:00", "21:15:00", 1),
      asignacion("MIERCOLES", "20:00:00", "21:15:00", 2),
    ]);

    render(<StudentPage />);

    const panel = await screen.findByTestId("student-situation");
    await waitFor(() => {
      expect(within(panel).getAllByText("20:00 — 21:15").length).toBeGreaterThan(0);
    });
    const windowOnTheList = within(panel).getAllByText("20:00 — 21:15")[0].textContent;

    const carnet = await screen.findByTestId("student-carnet");
    await waitFor(() => {
      expect(franjaValue(carnet)).toBe(windowOnTheList);
    });
    expect(within(carnet).queryByText(/21:00/)).not.toBeInTheDocument();
  });

  it("merges the three contiguous afternoon blocks into the one window the panel shows", async () => {
    // Sofia Vera's real shape in the club's data: one student assigned to
    // FORMATIVO + INFANTIL + JUVENIL at once. Three rows, one window.
    mockFetchStudentPortal.mockReset().mockResolvedValue(portalForAdultos());
    mockFetchHorariosPorAlumno.mockResolvedValue([
      asignacion("MARTES", "15:00:00", "16:00:00", 1),
      asignacion("MARTES", "16:00:00", "17:00:00", 2),
      asignacion("MARTES", "17:00:00", "18:00:00", 3),
    ]);

    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    await waitFor(() => {
      expect(franjaValue(carnet)).toBe("15:00 — 18:00");
    });
  });

  it("keeps two windows apart rather than inventing the range that spans their gap", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue(portalForAdultos());
    mockFetchHorariosPorAlumno.mockResolvedValue([
      asignacion("MARTES", "15:00:00", "16:00:00", 1),
      asignacion("JUEVES", "20:00:00", "21:15:00", 2),
    ]);

    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    await waitFor(() => {
      expect(franjaValue(carnet)).toBe("15:00 — 16:00 · 20:00 — 21:15");
    });
    expect(within(carnet).queryByText("15:00 — 21:15")).not.toBeInTheDocument();
  });

  // Fix 12b (docs/fixes/12-mi-cuenta-carnet.md): the joined string used to
  // wrap wherever the browser found a space, which could split a single
  // window's own closing time from its dash ("20:00 —" / "21:15"). Each
  // window must be its own unbreakable run, so the ONLY place a wrap is
  // allowed to happen is between windows.
  it("keeps each window as one unbreakable run so a wrap can never split a time in half", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue(portalForAdultos());
    mockFetchHorariosPorAlumno.mockResolvedValue([
      asignacion("MARTES", "15:00:00", "16:00:00", 1),
      asignacion("JUEVES", "20:00:00", "21:15:00", 2),
    ]);

    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    let firstWindow: HTMLElement;
    let secondWindow: HTMLElement;
    await waitFor(() => {
      firstWindow = within(carnet).getByText("15:00 — 16:00");
      secondWindow = within(carnet).getByText("20:00 — 21:15");
    });
    expect(firstWindow!.className).toMatch(/whitespace-nowrap/);
    expect(secondWindow!.className).toMatch(/whitespace-nowrap/);
    // Still the same coherent fact, read in one breath.
    expect(franjaValue(carnet)).toBe("15:00 — 16:00 · 20:00 — 21:15");
  });

  it("omits the fact entirely when the club assigned no schedule", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue(portalForAdultos());
    mockFetchHorariosPorAlumno.mockResolvedValue([]);

    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    await waitFor(() => {
      expect(within(carnet).getByText("Plan")).toBeInTheDocument();
    });
    expect(within(carnet).queryByText("Franja")).not.toBeInTheDocument();
  });

  // The finding: a network failure and "the club assigned no schedule" both
  // used to omit the "Franja" row, so a parent reading the printed carnet
  // alone could not tell "reload the page" from "go ask at the front desk".
  // The row must reappear on failure, and it must say so honestly rather
  // than reusing the silence that means "nothing assigned".
  it("marks the franja as unavailable on a lookup failure instead of reading like no schedule was assigned", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue(portalForAdultos());
    mockFetchHorariosPorAlumno.mockRejectedValue(new Error("boom"));

    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    await waitFor(() => {
      expect(within(carnet).getByText("Franja")).toBeInTheDocument();
    });
    expect(franjaValue(carnet)).toMatch(/no se pudo consultar/i);
  });
});

/**
 * The panel the user asked for: "que le diga los próximos entrenamientos".
 *
 * Every date on it is the next calendar occurrence of a slot the club actually
 * assigned to this student (`AlumnoHorario`), never a projection off the
 * membership plan — a price carries no weekday and no hour.
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

  it("keeps the Cuota card standing when the schedule lookup fails", async () => {
    mockFetchHorariosPorAlumno.mockRejectedValue(new Error("boom"));

    render(<StudentPage />);

    const panel = await screen.findByTestId("student-situation");
    await waitFor(() => {
      expect(within(panel).getByText(/no se pudo consultar el horario/i)).toBeInTheDocument();
    });
    expect(screen.getByTestId("student-cuota-card")).toBeInTheDocument();
  });

  // Fix 12c (docs/fixes/12-mi-cuenta-carnet.md): the chosen maquette (Propuesta
  // 2, "El carnet manda") marks the closest upcoming session with a distinct
  // row background (`.row.next`), not with a badge that only fires when that
  // session happens to land on today's date. Real system time on purpose,
  // unlike the fake-timer tests above: `findNextTrainingSessions` always
  // returns its rows soonest-first regardless of what day "today" is, so the
  // row ordering itself is enough to prove the highlight tracks position
  // (`first`), not a date coincidence.
  it("highlights the nearest session's row instead of only badging it 'Hoy'", async () => {
    mockFetchHorariosPorAlumno.mockResolvedValue([
      asignacion("LUNES", "15:00:00", "16:00:00", 1),
      asignacion("MARTES", "16:00:00", "17:00:00", 2),
      asignacion("MIERCOLES", "17:00:00", "18:00:00", 3),
    ]);

    render(<StudentPage />);

    const panel = await screen.findByTestId("student-situation");
    let rows: HTMLElement[] = [];
    await waitFor(() => {
      rows = within(panel).getAllByRole("listitem");
      expect(rows.length).toBeGreaterThan(1);
    });

    expect(rows[0].className).toMatch(/bg-sunken/);
    expect(rows[1].className).not.toMatch(/bg-sunken/);
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
 * `describePaymentSituation` is the screen's one reading of "no se indica
 * bien cómo ir a hacer el pago": every branch below is the same single
 * source `PaymentBand` used to own, now split across the carnet's own status
 * band (the verdict, in full for anything but "al día") and the "Cuota" card
 * (the facts and the action) — see the doc comments on `CarnetStatusBand` and
 * `CuotaCard`.
 */
describe("StudentPage — the Cuota card and the carnet's status band", () => {
  const MEMBERSHIP = {
    id: 3,
    estado: "ACTIVA",
    personaId: 9,
    montoAplicado: "35.00",
    categoria: "Mensual",
    modalidad: "MENSUAL" as const,
  };

  function portalWithMembership(overrides: Record<string, unknown> = {}) {
    return {
      ...PORTAL,
      self: { ...PORTAL.self!, membership: MEMBERSHIP, ...overrides },
    };
  }

  it("puts the carnet first and lands the Cuota card's CTA on an already-open form", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue(portalWithMembership());
    mockFetchPagosDePersona.mockResolvedValue([PAGO_APROBADO]);

    render(<StudentPage />);

    const cuota = await screen.findByTestId("student-cuota-card");
    await waitFor(() => {
      // The CTA carries the profile it is about — `?registrar=1` says "this
      // reader came here to pay", `?alumno=` says whose payment it is.
      expect(within(cuota).getByText("Registrar un pago").closest("a")).toHaveAttribute(
        "href",
        "/student/payments?registrar=1&alumno=9",
      );
    });

    // "El carnet manda": the identity card leads, the Cuota card is the
    // secondary rail item — the opposite order the old full-width band used.
    const carnet = screen.getByTestId("student-carnet");
    expect(carnet.compareDocumentPosition(cuota) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("reports coverage from the furthest approved payment, and says so plainly", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue(portalWithMembership());
    mockFetchPagosDePersona.mockResolvedValue([PAGO_APROBADO]);

    render(<StudentPage />);

    const cuota = await screen.findByTestId("student-cuota-card");
    // Exact string, not a substring regex: the detail sentence below also
    // names the same date ("El último pago aprobado cubrió hasta el
    // 31/07/2026."), so a partial match finds both and this specifically
    // wants the "Cubierta hasta" row's own value.
    await waitFor(() => {
      expect(within(cuota).getByText("31/07/2026")).toBeInTheDocument();
    });
  });

  it("says nothing has been approved rather than implying coverage it cannot prove", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue(portalWithMembership());
    mockFetchPagosDePersona.mockResolvedValue([PAGO_RECHAZADO]);

    render(<StudentPage />);

    // The sentence now leads the carnet's own status band (this state is
    // urgent — no approved payment at all), not the Cuota card.
    const carnet = await screen.findByTestId("student-carnet");
    await waitFor(() => {
      expect(within(carnet).getByText(/no tiene ningún pago aprobado/i)).toBeInTheDocument();
    });
  });

  it("states the plan's monthly price as a price, and never an amount owed", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue(portalWithMembership());
    mockFetchPagosDePersona.mockResolvedValue([]);

    render(<StudentPage />);

    const cuota = await screen.findByTestId("student-cuota-card");
    await waitFor(() => {
      expect(within(cuota).getByText("$35,00")).toBeInTheDocument();
    });
    // There is no debt concept anywhere in the backend, so the card never
    // states one.
    expect(within(cuota).queryByText(/adeuda|deuda|total a pagar|vence el/i)).not.toBeInTheDocument();
  });

  it("hands a pending payment back to the club instead of asking for a second one", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue(portalWithMembership());
    mockFetchPagosDePersona.mockResolvedValue([
      { ...PAGO_APROBADO, id: 3, estadoPago: "PENDIENTE_VALIDACION" },
    ]);

    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    await waitFor(() => {
      expect(within(carnet).getByText(/el club está validando/i)).toBeInTheDocument();
    });
    const cuota = screen.getByTestId("student-cuota-card");
    expect(within(cuota).queryByText("Registrar un pago")).not.toBeInTheDocument();
  });

  it("offers a minor on their own account the read-only route, never 'registrar un pago'", async () => {
    mockFetchStudentPortal
      .mockReset()
      .mockResolvedValue(portalWithMembership({ fechaNacimiento: "2014-03-10" }));
    mockFetchPagosDePersona.mockResolvedValue([]);

    render(<StudentPage />);

    const cuota = await screen.findByTestId("student-cuota-card");
    expect(within(cuota).getByText("Ver los pagos").closest("a")).toHaveAttribute(
      "href",
      "/student/payments?alumno=9",
    );
    expect(within(cuota).queryByText("Registrar un pago")).not.toBeInTheDocument();
  });

  it("sends a minor with no representative on record to the club, not to a person who does not exist", async () => {
    mockFetchStudentPortal
      .mockReset()
      .mockResolvedValue(portalWithMembership({ fechaNacimiento: "2014-03-10" }));
    mockFetchPagosDePersona.mockResolvedValue([]);

    render(<StudentPage />);

    const cuota = await screen.findByTestId("student-cuota-card");
    await waitFor(() => {
      expect(within(cuota).getByText(/administración del club/i)).toBeInTheDocument();
    });
    expect(within(cuota).queryByText(/lo hace su representante/i)).not.toBeInTheDocument();
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

    const cuota = await screen.findByTestId("student-cuota-card");
    await waitFor(() => {
      expect(within(cuota).getByText("Registrar un pago")).toBeInTheDocument();
    });
    // …and the carnet's own band names the child, because the reader is not
    // the student.
    expect(await screen.findByText(/Sofía no tiene ningún pago aprobado/i)).toBeInTheDocument();
  });
});

/**
 * The candado for the redesign's own stated risk ("pesa mucho cuando no hay
 * nada que resolver", docs/fixes/12-mi-cuenta-carnet.md): an overdue family
 * and an up-to-date one must not render the same amount of carnet.
 */
describe("StudentPage — the carnet earns its space when the cuota is up to date", () => {
  const MEMBERSHIP = {
    id: 7,
    estado: "ACTIVA",
    personaId: 9,
    montoAplicado: "35.00",
    categoria: "Mensual",
    modalidad: "MENSUAL" as const,
  };

  function portalWithMembership() {
    return { ...PORTAL, self: { ...PORTAL.self!, membership: MEMBERSHIP } };
  }

  it("renders the full-weight strip and the full Cuota card when the cuota is overdue", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue(portalWithMembership());
    // Approved, but its coverage already ran out.
    mockFetchPagosDePersona.mockResolvedValue([PAGO_APROBADO]);

    render(<StudentPage />);

    const band = await screen.findByTestId("carnet-status-band");
    await waitFor(() => {
      expect(band).toHaveAttribute("data-urgent", "true");
    });
    expect(band).toHaveAttribute("data-tone", "bad");
    expect(within(band).getByText(/venció/i)).toBeInTheDocument();

    const cuota = screen.getByTestId("student-cuota-card");
    expect(cuota).toHaveAttribute("data-compact", "false");
    expect(within(cuota).getByText("A pagar")).toBeInTheDocument();
    expect(within(cuota).getByText("Registrar un pago")).toBeInTheDocument();
  });

  it("renders a compact pill and a one-line Cuota card when the cuota is up to date", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue(portalWithMembership());
    // Coverage stretches well past today plus the "ending soon" window.
    mockFetchPagosDePersona.mockResolvedValue([
      { ...PAGO_APROBADO, fechaInicio: "2026-08-01", fechaFin: "2026-12-31" },
    ]);

    render(<StudentPage />);

    // Not `findByTestId` first: while the payment history is still loading
    // the band renders as the (non-compact) strip — a `<div>` — and once it
    // settles into "covered" it swaps to the pill `<span>`. Capturing the
    // element before that swap would hold a reference to the detached old
    // node, so wait for the settled text first and query fresh afterwards.
    await screen.findByText("Al día");
    const band = screen.getByTestId("carnet-status-band");
    expect(band).toHaveAttribute("data-urgent", "false");
    expect(band).toHaveAttribute("data-tone", "ok");

    const cuota = screen.getByTestId("student-cuota-card");
    expect(cuota).toHaveAttribute("data-compact", "true");
    // The compressed card gives up the amount row and the full-width button
    // an overdue family still needs — that is the whole point of compressing
    // it — but the action itself survives, as a quiet text link rather than
    // a button, so a family paying ahead of time is never blocked.
    expect(within(cuota).queryByText("A pagar")).not.toBeInTheDocument();
    const link = within(cuota).getByText("Registrar un pago").closest("a");
    expect(link?.className).not.toMatch(/w-full/);
  });
});

/**
 * Fix 12b (docs/fixes/12-mi-cuenta-carnet.md): stretching the carnet to match
 * the rail's height ("lg:!items-stretch" + the carnet's own `flex-1`) left the
 * card with its OWN empty canvas underneath its fact grid whenever the rail
 * (Cuota + Esta semana) was taller than the carnet's real content — the exact
 * "vacío que no se llena" complaint this redesign existed to close, just
 * moved from the page into the card. The carnet keeps its natural height and
 * sits at the top of the row instead.
 */
describe("StudentPage — the carnet keeps its own proportions instead of stretching", () => {
  it("does not force the carnet's height to match the rail's", async () => {
    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    expect(carnet.className).not.toMatch(/\bflex-1\b/);

    // The grid that splits the carnet column from the rail — two levels up
    // from the carnet itself (the carnet's own flex column, then the grid).
    const rail = carnet.parentElement?.parentElement;
    expect(rail?.className).not.toMatch(/items-stretch/);
  });
});

/**
 * Fix 12c (docs/fixes/12-mi-cuenta-carnet.md): the owner's own read of the
 * screen against the maquette — "si decido eso, pues debería verse igual".
 * The chosen maquette (Propuesta 2) draws its desktop split as
 * `grid-template-columns: 1fr 1fr`. Reusing `PAGE_RAIL`'s own 340px rail
 * unmodified left the carnet at roughly three-quarters of the row and the
 * rail at one-quarter — the actual root of the "empty carnet" defect chased
 * across fix 12 and 12b, neither of which touched the column ratio.
 */
describe("StudentPage — the carnet and the rail split the row evenly", () => {
  it("matches the chosen maquette's 1fr/1fr desktop grid instead of a 340px rail", async () => {
    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    const rail = carnet.parentElement?.parentElement;
    // `PAGE_RAIL`'s own `lg:grid-cols-[…_340px]` is still present in the
    // string (`cn` concatenates, it does not deduplicate) — the `!important`
    // override wins at the CSS layer, not by removing the losing utility from
    // the class list. See the comment above this `<div>` in page.tsx for why
    // that is the established mechanism, not a workaround.
    expect(rail?.className).toMatch(/lg:!grid-cols-\[minmax\(0,1fr\)_minmax\(0,1fr\)\]/);
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

/**
 * The carnet's band used to read `Membresia.estado` through
 * `describeMembershipState` ("Membresía activa/pendiente/vencida"). The
 * redesign replaces it with `describePaymentSituation` — see the doc comment
 * on `Carnet` in page.tsx for why: the two could disagree, and the maquette
 * draws exactly one band, worded for whether the family can act on it.
 */
describe("StudentPage — the carnet's band reads the payment situation, not Membresia.estado", () => {
  it("says the account has no membership yet when there is no membership row", async () => {
    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    expect(within(carnet).getByText(/todavía no tiene una membresía/i)).toBeInTheDocument();
  });

  it("says no payment has been approved for an INACTIVA membership with nothing on file", async () => {
    mockFetchStudentPortal.mockResolvedValueOnce({
      ...PORTAL,
      self: { ...PORTAL.self!, membership: { id: 5, estado: "INACTIVA", personaId: 9, montoAplicado: "85.00", categoria: "Mensual", modalidad: "MENSUAL" } },
    });

    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    expect(within(carnet).getByText(/no tiene ningún pago aprobado/i)).toBeInTheDocument();
  });
});
