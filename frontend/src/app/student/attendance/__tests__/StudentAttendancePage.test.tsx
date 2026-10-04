/**
 * Component tests for `/student/attendance`.
 *
 * The behaviour worth protecting here is honesty about a small, capped data
 * set: a counted ratio instead of a rate, a breakdown that keeps
 * every state visible, and a stated window so five rows are never read as a
 * complete record.
 *
 * Mocking follows StudentPage.test.tsx (ProtectedRoute, next/navigation,
 * next/link, next/image, AuthContext stubbed; @/services/api mocked).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import StudentAttendancePage from "@/app/student/attendance/page";
import type { StudentPortalSummary, StudentProfileSummary } from "@/services/api";

vi.mock("@/components/ProtectedRoute", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

/** The dependent selection travels in `?alumno=` — see `ManagedStudentPicker`. */
let searchParams = new URLSearchParams();
const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/student/attendance",
  useRouter: () => ({ push: vi.fn(), replace: mockReplace }),
  useSearchParams: () => searchParams,
}));

const mockShowInfo = vi.fn();
vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ showInfo: mockShowInfo }),
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
vi.mock("@/services/api", () => ({
  fetchStudentPortal: () => mockFetchStudentPortal(),
}));

function sessionFor(role: "estudiante" | "representante") {
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

function portalWith(sessions: StudentProfileSummary["recentSessions"]): StudentPortalSummary {
  return {
    self: { ...BASE_PROFILE, recentSessions: sessions },
    representados: [],
    membershipPlans: [],
  };
}

const FIVE_SESSIONS: StudentProfileSummary["recentSessions"] = [
  { fecha: "2026-07-23", horario: "Jueves 15:00 — 16:00", estado: "present" },
  { fecha: "2026-07-21", horario: "Martes 15:00 — 16:00", estado: "late" },
  { fecha: "2026-07-16", horario: "Jueves 15:00 — 16:00", estado: "sick" },
  { fecha: "2026-07-14", horario: "Martes 15:00 — 16:00", estado: "absent" },
  { fecha: "2026-07-09", horario: "Jueves 15:00 — 16:00", estado: "present" },
];

beforeEach(() => {
  searchParams = new URLSearchParams();
  mockReplace.mockReset();
  window.sessionStorage.clear();
  mockUseAuth.mockReset().mockReturnValue(sessionFor("estudiante"));
  mockFetchStudentPortal.mockReset().mockResolvedValue(portalWith(FIVE_SESSIONS));
});

/**
 * The third screen the selection has to reach. A guardian who picked her
 * 16-year-old on `/student` and clicked "Asistencias" in the sidebar used to
 * land on the 10-year-old's record with nothing saying the subject had changed.
 */
describe("StudentAttendancePage — whose record this is", () => {
  const GUARDIAN_PORTAL: StudentPortalSummary = {
    self: null,
    representados: [
      { ...BASE_PROFILE, personaId: "41", nombres: "Sofía", apellidos: "Vera", recentSessions: [] },
      {
        ...BASE_PROFILE,
        personaId: "42",
        nombres: "Martín",
        apellidos: "Vera",
        recentSessions: FIVE_SESSIONS,
      },
    ],
    membershipPlans: [],
  };

  beforeEach(() => {
    mockUseAuth.mockReturnValue(sessionFor("representante"));
    mockFetchStudentPortal.mockReset().mockResolvedValue(GUARDIAN_PORTAL);
  });

  it("opens on the profile named by ?alumno= and says whose record it is", async () => {
    searchParams = new URLSearchParams("alumno=42");

    render(<StudentAttendancePage />);

    expect(await screen.findByText("Asistencia de Martín")).toBeInTheDocument();
    expect(screen.getByText("Sesiones registradas de Martín")).toBeInTheDocument();
    expect(screen.getByText("3 de 5 sesiones")).toBeInTheDocument();
  });

  it("restores the stored selection when the sidebar arrives without a param", async () => {
    window.sessionStorage.setItem("cata:student-portal:alumno:9", "42");

    render(<StudentAttendancePage />);

    expect(await screen.findByText("Asistencia de Martín")).toBeInTheDocument();
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/student/attendance?alumno=42", { scroll: false });
    });
  });
});

describe("StudentAttendancePage — the summary tiles", () => {
  it("prints the rate over its denominator, in a tile with a status word", async () => {
    render(<StudentAttendancePage />);

    // 3 of 5: two presents plus one tardanza = 60%, under the 75% goal.
    expect(await screen.findByText("3 de 5 sesiones")).toBeInTheDocument();
    const tile = screen.getByText("Asistencia", { selector: "span" }).parentElement as HTMLElement;
    expect(within(tile).getByText("60")).toBeInTheDocument();
    expect(tile.dataset.tone).toBe("warn");
    expect(within(tile).getByTestId("statcard-status")).toHaveTextContent("Bajo la meta de 75%");
  });

  it("turns the rate green with its word at or above the 75% goal", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue(
      portalWith([
        { fecha: "2026-07-23", horario: "Jueves 15:00 — 16:00", estado: "present" },
        { fecha: "2026-07-21", horario: "Martes 15:00 — 16:00", estado: "late" },
        { fecha: "2026-07-16", horario: "Jueves 15:00 — 16:00", estado: "present" },
        { fecha: "2026-07-14", horario: "Martes 15:00 — 16:00", estado: "absent" },
      ]),
    );
    render(<StudentAttendancePage />);

    const tile = (await screen.findByText("Asistencia", { selector: "span" })).parentElement as HTMLElement;
    expect(within(tile).getByText("75")).toBeInTheDocument();
    expect(tile.dataset.tone).toBe("ok");
    expect(within(tile).getByTestId("statcard-status")).toHaveTextContent("Buen ritmo");
  });

  it("gives present, late and absent their own semáforo tone and word", async () => {
    render(<StudentAttendancePage />);

    await screen.findByText("3 de 5 sesiones");
    const present = within(screen.getByTestId("breakdown-presente"));
    const late = within(screen.getByTestId("breakdown-tardanza"));
    const absent = within(screen.getByTestId("breakdown-ausente"));
    expect(present.getByTestId("statcard-status").closest("[data-tone]")).toHaveAttribute("data-tone", "ok");
    expect(late.getByTestId("statcard-status").closest("[data-tone]")).toHaveAttribute("data-tone", "warn");
    expect(absent.getByTestId("statcard-status").closest("[data-tone]")).toHaveAttribute("data-tone", "bad");
    expect(absent.getByTestId("statcard-status")).toHaveTextContent("No asistió");
  });

  it("stays quiet — neutral or green — when there is nothing to flag", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue(
      portalWith([{ fecha: "2026-07-23", horario: "Jueves 15:00 — 16:00", estado: "present" }]),
    );
    render(<StudentAttendancePage />);

    await screen.findByText("1 de 1 sesiones");
    const late = within(screen.getByTestId("breakdown-tardanza"));
    const absent = within(screen.getByTestId("breakdown-ausente"));
    expect(late.getByTestId("statcard-status").closest("[data-tone]")).toHaveAttribute("data-tone", "neutral");
    expect(absent.getByTestId("statcard-status")).toHaveTextContent("Sin ausencias");
  });

  it("keeps the tardanza and falta counting rule on the tiles", async () => {
    render(<StudentAttendancePage />);

    await screen.findByText("3 de 5 sesiones");
    expect(screen.getByText("cuentan como asistencia")).toBeInTheDocument();
    expect(screen.getByText("no cuentan como asistencia")).toBeInTheDocument();
  });

  it("tallies 'enfermo' and 'competencia' under the tiles so they stay visible", async () => {
    render(<StudentAttendancePage />);

    await screen.findByText("3 de 5 sesiones");
    const enfermo = screen.getByTestId("breakdown-enfermo");
    expect(within(enfermo).getByText("Enfermo")).toBeInTheDocument();
    expect(within(enfermo).getByText("1")).toBeInTheDocument();
    expect(within(screen.getByTestId("breakdown-competencia")).getByText("0")).toBeInTheDocument();
  });

  /**
   * RENEGOTIATED in the final batch, and only the shape of the assertion.
   *
   * This used to require BOTH statements on screen at once: the recap card's
   * "Todavía no hay sesiones registradas" and the record's "Aún no hay
   * asistencias registradas". They are the same fact said twice, two hundred
   * pixels apart, over a tally of four zeros — the recap has nothing to count
   * at zero, so it steps aside and the record carries the statement alone.
   *
   * What the case is FOR is unchanged and is now asserted directly: at zero
   * sessions the screen states the emptiness and claims no ratio. That is
   * stricter than the old spelling, which would have passed just as happily
   * on a screen that also printed "asistió a 0 de 0".
   */
  it("makes no attendance claim when nothing has been recorded", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue(portalWith([]));

    render(<StudentAttendancePage />);

    expect(await screen.findByText(/aún no hay asistencias registradas/i)).toBeInTheDocument();
    expect(screen.queryByText(/sesiones$/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("attendance-breakdown")).not.toBeInTheDocument();
  });
});

describe("StudentAttendancePage — the record", () => {
  it("renders every session it was given, with the product's date format", async () => {
    render(<StudentAttendancePage />);

    expect(await screen.findByText("23/07/2026")).toBeInTheDocument();
    expect(screen.getByText("09/07/2026")).toBeInTheDocument();
    // dd/mm/yyyy, never the raw ISO string the API sends.
    expect(screen.queryByText("2026-07-23")).not.toBeInTheDocument();
  });

  it("states the window it is showing, so the capped list is not read as the whole record", async () => {
    render(<StudentAttendancePage />);

    expect(
      await screen.findByText(/tu portal recibe las 30 sesiones más recientes/i),
    ).toBeInTheDocument();
  });

  it("never claims a next training session — the API cannot derive one per student", async () => {
    render(<StudentAttendancePage />);

    await screen.findByText("3 de 5 sesiones");
    expect(screen.queryByText(/próxim/i)).not.toBeInTheDocument();
  });
});

/**
 * The socio nuevo: nothing to list, so the record is ONE guiding line plus the
 * legend of states — never a card stretched to the window, which only draws
 * an empty frame (the hole relocated inside a border).
 */
describe("StudentAttendancePage — the socio nuevo", () => {
  it("keeps the card at its content height, with no ghost rows that read as loading", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue(portalWith([]));

    render(<StudentAttendancePage />);

    const card = await screen.findByTestId("sessions-card");
    expect(card.className).not.toMatch(/\bflex-1\b/);
    expect(screen.queryByTestId("session-ghost-rows")).toBeNull();
  });

  it("draws the empty state on a dotted ground instead of a bare block", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue(portalWith([]));

    render(<StudentAttendancePage />);

    const empty = await screen.findByTestId("sessions-empty");
    expect(empty.innerHTML).toMatch(/radial-gradient/);
    expect(within(empty).getByText(/aún no hay asistencias registradas/i)).toBeInTheDocument();
  });

  it("shows the states a session can carry in the legend glued under the record", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue(portalWith([]));

    render(<StudentAttendancePage />);

    const card = await screen.findByTestId("sessions-card");
    expect(within(card).getByTestId("attendance-legend")).toBeInTheDocument();
    for (const label of ["Presente", "Ausente", "Tardanza", "Enfermo", "Competencia"]) {
      expect(within(card).getByText(label)).toBeInTheDocument();
    }
  });

  it("does not stretch a single-session record or pad it with ghost rows", async () => {
    mockFetchStudentPortal
      .mockReset()
      .mockResolvedValue(portalWith([FIVE_SESSIONS[0]]));

    render(<StudentAttendancePage />);

    const card = await screen.findByTestId("sessions-card");
    expect(card.className).not.toMatch(/\blg:flex-1\b/);
    expect(within(card).queryByTestId("session-ghost-rows")).toBeNull();
  });
});

describe("StudentAttendancePage — guardian with dependents", () => {
  const DEPENDANT: StudentProfileSummary = {
    ...BASE_PROFILE,
    personaId: "20",
    nombres: "Sofia",
    apellidos: "Vera",
    fechaNacimiento: "2016-07-22",
    recentSessions: [{ fecha: "2026-07-22", horario: "Miércoles 16:00 — 17:00", estado: "present" }],
  };

  it("switches the record when the guardian picks another dependent", async () => {
    mockUseAuth.mockReturnValue(sessionFor("representante"));
    mockFetchStudentPortal.mockReset().mockResolvedValue({
      self: null,
      representados: [{ ...BASE_PROFILE, personaId: "19", nombres: "Juan", recentSessions: FIVE_SESSIONS }, DEPENDANT],
      membershipPlans: [],
    });

    render(<StudentAttendancePage />);

    expect(await screen.findByText("3 de 5 sesiones")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Sofia Vera/ }));

    expect(await screen.findByText("22/07/2026")).toBeInTheDocument();
    expect(mockShowInfo).toHaveBeenCalledWith("Ahora ves a Sofia");
    expect(screen.queryByText("3 de 5 sesiones")).not.toBeInTheDocument();
  });
});

/**
 * Issue #316 hallazgo #70: `/student/attendance` and `/student/payments` were
 * the only two second-level screens with no way back at all — `/ayuda` and
 * `/profile`, reached from the very same sidebar, both carry one.
 */
describe("StudentAttendancePage — the way back", () => {
  it("offers a real BackLink to Mi cuenta, not only the sidebar", async () => {
    mockUseAuth.mockReturnValue(sessionFor("estudiante"));
    mockFetchStudentPortal.mockReset().mockResolvedValue(portalWith([]));

    render(<StudentAttendancePage />);

    const back = await screen.findByRole("link", { name: /volver a mi cuenta/i });
    expect(back).toHaveAttribute("href", "/student");
  });

  /**
   * Issue #1396: placement is a document-order guarantee, not a CSS one — the
   * back control must PRECEDE the page title in the DOM, so tab order and a
   * screen reader's read-out meet "Volver" before the screen's own name. It
   * travels through `AppShell`'s `back` slot, which draws it before
   * `PageHeader`; as a child of the screen it landed after the title by
   * construction.
   */
  it("renders the BackLink above the page title in document order", async () => {
    mockUseAuth.mockReturnValue(sessionFor("estudiante"));
    mockFetchStudentPortal.mockReset().mockResolvedValue(portalWith([]));

    render(<StudentAttendancePage />);

    const back = await screen.findByRole("link", { name: /volver a mi cuenta/i });
    const title = screen.getByRole("heading", { name: "Asistencias" });
    expect(back.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("StudentAttendancePage — the legend", () => {
  it("always shows how attendance is recorded, with every state's meaning", async () => {
    render(<StudentAttendancePage />);

    const legend = await screen.findByTestId("attendance-legend");
    expect(within(legend).getByText("Faltó por enfermedad")).toBeInTheDocument();
    expect(within(legend).getByText(/si un registro no es correcto, pide la corrección/i)).toBeInTheDocument();
  });

  it("sits under the list, not in a rail beside it", async () => {
    render(<StudentAttendancePage />);

    const legend = await screen.findByTestId("attendance-legend");
    expect(screen.getByTestId("sessions-card")).toContainElement(legend);
    expect(legend.closest("aside")).toBeNull();
  });

  it("gives the socio nuevo the legend but no tiles", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue(portalWith([]));
    render(<StudentAttendancePage />);

    await screen.findByTestId("sessions-card");
    expect(screen.getByTestId("attendance-legend")).toBeInTheDocument();
    expect(screen.queryByTestId("attendance-breakdown")).toBeNull();
  });
});

describe("StudentAttendancePage — QA4 findings", () => {
  // FAM-22: «Enfermo» and «Competencia» were missing, so the tallies summed to less than the list.
  it("tallies all five states so the counters add up to the sessions listed", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue(
      portalWith([
        ...FIVE_SESSIONS,
        { fecha: "2026-07-02", horario: "Jueves 15:00 — 16:00", estado: "competition" },
      ]),
    );
    render(<StudentAttendancePage />);

    const recap = await screen.findByTestId("attendance-breakdown");
    for (const [label, count] of [
      ["Presente", "2"],
      ["Tardanza", "1"],
      ["Ausente", "1"],
      ["Enfermo", "1"],
      ["Competencia", "1"],
    ]) {
      const cell = within(recap).getByTestId(`breakdown-${label.toLowerCase()}`);
      expect(within(cell).getByText(count)).toBeInTheDocument();
    }
  });

  // FAM-21
  it("renders the WhatsApp address of a failed load as a link", async () => {
    mockFetchStudentPortal.mockReset().mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    render(<StudentAttendancePage />);

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("link")).toHaveAttribute("href", expect.stringContaining("wa.me"));
  });
});

// QA4 FAM-01: a representative who joined as a player keeps the single role
// REPRESENTANTE; her own membership (pending included) puts her in the selector.
describe("StudentAttendancePage — the representative with her own membership (FAM-01)", () => {
  it("lists her next to her children, even with a pending membership", async () => {
    mockUseAuth.mockReturnValue(sessionFor("representante"));
    mockFetchStudentPortal.mockReset().mockResolvedValue({
      self: {
        ...BASE_PROFILE,
        nombres: "Marta",
        apellidos: "Reyes",
        membership: { id: 11, estado: "INACTIVA", personaId: 9, montoAplicado: "40.00", categoria: "Mensual Adultos", modalidad: "MENSUAL", fechaActivacion: "2026-07-22T20:51:01", fechaFin: "" },
      },
      representados: [{ ...BASE_PROFILE, personaId: "41", nombres: "Sofía", apellidos: "Vera" }],
      membershipPlans: [],
    } satisfies StudentPortalSummary);

    render(<StudentAttendancePage />);

    const strip = await screen.findByRole("group", { name: "Jugador" });
    expect(within(strip).getByRole("button", { name: /Marta Reyes/ })).toBeInTheDocument();
    expect(within(strip).getByRole("button", { name: /Sofía Vera/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("Estudiante")).not.toBeInTheDocument();
  });
});
