/**
 * Component tests for `/student/attendance`.
 *
 * The behaviour worth protecting here is honesty about a small, capped data
 * set: a counted ratio instead of a rate, a four-way breakdown that keeps
 * "justificado" visible, and a stated window so five rows are never read as a
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
  { fecha: "2026-07-16", horario: "Jueves 15:00 — 16:00", estado: "justified" },
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
    expect(screen.getByText("3 de 5")).toBeInTheDocument();
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

describe("StudentAttendancePage — the recap", () => {
  it("states a counted ratio and never a percentage", async () => {
    render(<StudentAttendancePage />);

    // 3 of 5: two presents plus one tardanza. A "60%" here would read as an
    // attendance rate, which five records cannot support.
    expect(await screen.findByText(/asistió a/i)).toBeInTheDocument();
    expect(screen.getByText("3 de 5")).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("says out loud how a tardanza and a falta justificada are counted", async () => {
    render(<StudentAttendancePage />);

    expect(await screen.findByRole("heading", { name: /asistió a/i })).toBeInTheDocument();
    expect(
      screen.getByText(/una tardanza cuenta como asistencia; una falta justificada, no/i),
    ).toBeInTheDocument();
  });

  it("breaks the record into its four states so 'justificado' stays visible", async () => {
    render(<StudentAttendancePage />);

    await screen.findByText("3 de 5");
    const recap = screen.getByTestId("attendance-breakdown");
    for (const [label, count] of [
      ["Presente", "2"],
      ["Tardanza", "1"],
      ["Justificado", "1"],
      ["Ausente", "1"],
    ]) {
      const cell = within(recap).getByTestId(`breakdown-${label.toLowerCase()}`);
      expect(within(cell).getByText(label)).toBeInTheDocument();
      expect(within(cell).getByText(count)).toBeInTheDocument();
    }
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
    expect(screen.queryByText(/asistió a/i)).not.toBeInTheDocument();
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

  it("states the window it is showing, so five rows are not read as the whole record", async () => {
    render(<StudentAttendancePage />);

    expect(
      await screen.findByText(/su portal recibe las 30 sesiones más recientes/i),
    ).toBeInTheDocument();
  });

  it("never claims a next training session — the API cannot derive one per student", async () => {
    render(<StudentAttendancePage />);

    await screen.findByText("3 de 5");
    expect(screen.queryByText(/próxim/i)).not.toBeInTheDocument();
  });
});

/**
 * D11b — the socio nuevo is the state this screen is designed for FIRST.
 *
 * Measured at 1440x900 against QA before this batch: **434px, 48% of the
 * window**, under an empty record card that stopped at 466px. It is the same
 * shape `/student` and `/student/payments` closed in tanda 1 — `AppShell`
 * stretches `<main>` to the window and no first-level child of this screen
 * claimed the surplus, so everything the content did not use piled up under
 * the last block.
 *
 * The fix is the one `/student/payments` measured, not a new one: the record
 * claims the leftover WHEN AND ONLY WHEN it has nothing to list. Claiming it
 * unconditionally was measured and rejected there — with one row on file the
 * card stretches to the foot of the window and draws an empty frame under a
 * single line, which is the same emptiness moved inside a border and made
 * more visible than the canvas it replaced.
 */
describe("StudentAttendancePage — the socio nuevo", () => {
  it("lets the record claim the page's leftover height when it has nothing to list", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue(portalWith([]));

    render(<StudentAttendancePage />);

    const card = await screen.findByTestId("sessions-card");
    expect(card.className).toMatch(/\bflex-1\b/);
  });

  it("does not stretch the record once there is a single session in it", async () => {
    mockFetchStudentPortal
      .mockReset()
      .mockResolvedValue(portalWith([FIVE_SESSIONS[0]]));

    render(<StudentAttendancePage />);

    const card = await screen.findByTestId("sessions-card");
    expect(card.className).not.toMatch(/\bflex-1\b/);
  });

  /**
   * `EmptyState`'s `fill` centres the statement inside the stretched surface.
   * Without it the three lines pin to the top of a full-height card and the
   * hole is merely relocated inside a border — the reversion `SessionCard`
   * already recorded and `/student/payments` already measured.
   */
  it("centres the statement inside the stretched card instead of pinning it to the top", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue(portalWith([]));

    render(<StudentAttendancePage />);

    // `EmptyState` renders its title as the box's own `<b>`, so the box is
    // that element's parent — no test hook needed on the primitive.
    const box = (await screen.findByText(/aún no hay asistencias registradas/i)).parentElement;
    expect(box?.className).toMatch(/\bflex-1\b/);
    expect(box?.className).toMatch(/\bjustify-center\b/);
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

    expect(await screen.findByText("3 de 5")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Estudiante"), { target: { value: "20" } });

    expect(await screen.findByText("22/07/2026")).toBeInTheDocument();
    expect(screen.queryByText("3 de 5")).not.toBeInTheDocument();
  });
});
