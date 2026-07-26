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
  ranking: { status: "unavailable", reason: "error" },
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

  it("makes no attendance claim when nothing has been recorded", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue(portalWith([]));

    render(<StudentAttendancePage />);

    expect(await screen.findByText(/todavía no hay sesiones registradas/i)).toBeInTheDocument();
    expect(screen.getByText(/aún no hay asistencias registradas/i)).toBeInTheDocument();
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
