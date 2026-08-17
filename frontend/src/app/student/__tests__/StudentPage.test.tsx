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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { STAT_GRID } from "@/components/ui";
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

/**
 * The authenticated session, mutable per-test so the dual-role scenario
 * (REPRESENTANTE + ALUMNO) from #269 can be exercised. `user.role` is the
 * single primary role; `roles` is the full backend array.
 */
let mockAuthSession = {
  user: { id: "9", name: "Alumno Test", email: "alumno@cataclub.com", role: "estudiante", representanteId: null },
  roles: ["ALUMNO"],
  loggedInAt: "2026-07-01T12:00:00Z",
};

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    session: mockAuthSession,
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
const mockSubirFotoPersona = vi.fn();

vi.mock("@/services/api", () => ({
  fetchStudentPortal: () => mockFetchStudentPortal(),
  // Still read here — the carnet's "Cobertura hasta" is the furthest
  // `fechaFin` among approved payments, the only real coverage date there is.
  fetchPagosDePersona: (...args: unknown[]) => mockFetchPagosDePersona(...args),
  // The student's REAL schedule assignments — the only source the "Próximos
  // entrenamientos" panel is allowed to state a future session from.
  fetchHorariosPorAlumno: (...args: unknown[]) => mockFetchHorariosPorAlumno(...args),
  independizarPersona: (...args: unknown[]) => mockIndependizarPersona(...args),
  subirFotoPersona: (...args: unknown[]) => mockSubirFotoPersona(...args),
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
  mockAuthSession = {
    user: { id: "9", name: "Alumno Test", email: "alumno@cataclub.com", role: "estudiante", representanteId: null },
    roles: ["ALUMNO"],
    loggedInAt: "2026-07-01T12:00:00Z",
  };
  searchParams = new URLSearchParams();
  mockReplace.mockReset();
  window.sessionStorage.clear();
  mockFetchStudentPortal.mockReset().mockResolvedValue(PORTAL);
  mockFetchPagosDePersona.mockReset().mockResolvedValue([]);
  mockFetchHorariosPorAlumno.mockReset().mockResolvedValue([]);
  mockIndependizarPersona.mockReset().mockResolvedValue(undefined);
  mockSubirFotoPersona.mockReset().mockResolvedValue(undefined);
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

/**
 * #269 — the backend grants every representante account ALUMNO as well
 * (`admin_cuenta_servicio.py:45`), but `hasAlumnoRole` used to read the single
 * primary role, so the screen behaved as if a dual account had no student
 * profile: it offered the role the account already holds and silently
 * redirected the student view to the first dependent.
 */
describe("StudentPage — dual-role account (REPRESENTANTE + ALUMNO)", () => {
  const DUAL_PORTAL: StudentPortalSummary = {
    self: { ...PORTAL.self!, personaId: "9", nombres: "Alumno", apellidos: "Test" },
    representados: [{ ...PORTAL.self!, personaId: "42", nombres: "Martín", apellidos: "Vera" }],
    membershipPlans: [],
  };

  beforeEach(() => {
    mockAuthSession = {
      user: {
        id: "9",
        name: "Representante Test",
        email: "rep@cataclub.com",
        role: "representante",
        representanteId: null,
      },
      roles: ["REPRESENTANTE", "ALUMNO"],
      loggedInAt: "2026-07-01T12:00:00Z",
    };
    mockFetchStudentPortal.mockReset().mockResolvedValue(DUAL_PORTAL);
  });

  it("does not offer the join-as-player CTA to an account that already holds ALUMNO", async () => {
    render(<StudentPage />);

    // The dual account keeps its representante CTA...
    expect(await screen.findByText("Agregar hijo o dependiente")).toBeInTheDocument();
    // ...but is never offered the role it already has (#269 symptom 1).
    expect(screen.queryByRole("link", { name: /unirme como jugador/i })).not.toBeInTheDocument();
  });

  it("keeps the account's own student profile selected instead of rewriting to the first dependent (#269 symptom 2)", async () => {
    render(<StudentPage />);

    // Without the fix, hasAlumnoRole was false (primary role: representante),
    // the self profile fell out of managedProfiles and the picker silently
    // fell back to the first dependent as the subject.
    expect(await screen.findByTestId("student-carnet")).toHaveAttribute(
      "aria-label",
      "Carnet de socio de Alumno Test",
    );
  });
});

describe("StudentPage — the club membership card (carnet)", () => {
  it("shows the student's name and plan, and no payment state at all", async () => {
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
    // activa" is gone.
    expect(within(carnet).getByText("Plan")).toBeInTheDocument();
    expect(within(carnet).queryByText("Modalidad")).not.toBeInTheDocument();
    expect(within(carnet).getByText("Mensual")).toBeInTheDocument();
    // "Valor mensual", the same label `/student/payments` puts on the same
    // field — the carnet used to call it "Monto".
    expect(within(carnet).getByText("Valor mensual")).toBeInTheDocument();
    expect(within(carnet).getByText("$25,00")).toBeInTheDocument();
    // THE VERDICT LEFT. The owner read the running card and said so in as many
    // words: «No tiene ningún pago aprobado — esa info muévala a la sección de
    // pagos, no al carnet.» A carnet is an identity document; a payment state
    // is not an identity fact. It lives in `CuotaCard` now.
    expect(within(carnet).queryByTestId("carnet-status-band")).not.toBeInTheDocument();
    expect(screen.getByTestId("student-cuota-card")).toBeInTheDocument();
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

  it("lays the figures out on one grid, in order, value before label, so their columns line up", async () => {
    // Guards the alignment regression this card was polished for: as a
    // wrapping flex row each fact was only as wide as its own value, so the
    // labels landed at arbitrary x positions and no two rows shared a column.
    // That rationale is untouched by the "B · Marcador" redesign — one grid,
    // a deterministic order, columns that line up.
    //
    // What DID change is the content and the cell's internal order. The grid
    // carries three figures, not four ("Plan" left for the kicker above the
    // name), and each cell reads VALUE FIRST, LABEL SECOND — the inversion IS
    // the scoreboard, so the label is now the cell's LAST element child.
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
    expect(facts).toHaveAttribute("data-testid", "carnet-facts");

    const cells = [...facts.children];
    expect(cells).toHaveLength(3);
    expect(cells.map((cell) => cell.lastElementChild?.textContent)).toEqual([
      "Franja",
      "Valor mensual",
      "Socio desde",
    ]);

    // The scoreboard inversion, and the thing most likely to be silently
    // reverted later: inside a cell the figure comes first and the label
    // reads underneath it.
    for (const cell of cells) {
      const value = cell.firstElementChild;
      const label = cell.lastElementChild;
      expect(value).not.toBe(label);
      expect(
        value!.compareDocumentPosition(label!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }

    // "Franja" leads because it is the figure a family consults daily. It no
    // longer needs a `col-span-2` to take the whole row: the portrait carnet
    // stacks its figures in ONE column on both media, so every cell is already
    // the full width and a span would conjure an implicit second column.
    expect(cells[0].className).not.toMatch(/\bcol-span-2\b/);
    expect(facts.className).toMatch(/\bgrid-cols-1\b/);
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

describe("StudentPage — the carnet shows the student's photo", () => {
  it("renders the photo when fotoUrl is present", async () => {
    mockFetchStudentPortal.mockResolvedValueOnce({
      ...PORTAL,
      self: { ...PORTAL.self!, fotoUrl: "https://res.cloudinary.com/test/image/upload/perfil-fake.jpg" },
    });

    render(<StudentPage />);

    const photo = await screen.findByTestId("carnet-photo");
    expect(within(photo).getByRole("img")).toHaveAttribute(
      "src",
      "https://res.cloudinary.com/test/image/upload/perfil-fake.jpg",
    );
  });

  it("falls back to initials instead of showing a broken image when the photo fails to load", async () => {
    mockFetchStudentPortal.mockResolvedValueOnce({
      ...PORTAL,
      self: { ...PORTAL.self!, fotoUrl: "https://broken.example/foto.jpg" },
    });

    render(<StudentPage />);

    const photo = await screen.findByTestId("carnet-photo");
    fireEvent.error(within(photo).getByRole("img"));

    await waitFor(() => {
      expect(within(photo).queryByRole("img")).not.toBeInTheDocument();
      expect(within(photo).getByText("A")).toBeInTheDocument();
    });
  });

  it("shows initials when there is no photo, never a broken image", async () => {
    render(<StudentPage />);

    const photo = await screen.findByTestId("carnet-photo");
    expect(within(photo).queryByRole("img")).not.toBeInTheDocument();
    expect(within(photo).getByText("A")).toBeInTheDocument();
  });

  it("offers the upload trigger on the account's own carnet", async () => {
    render(<StudentPage />);

    await screen.findByTestId("student-carnet");
    expect(screen.getByRole("button", { name: /cambiar foto/i })).toBeInTheDocument();
  });

  it("offers the upload trigger on a represented dependent's carnet", async () => {
    mockFetchStudentPortal.mockResolvedValueOnce({
      ...PORTAL,
      self: null,
      representados: [
        { ...PORTAL.self!, personaId: "42", nombres: "Sofía", apellidos: "Vera", representanteId: 9 },
      ],
    });

    render(<StudentPage />);

    await screen.findByTestId("student-carnet");
    expect(screen.getByRole("button", { name: /cambiar foto/i })).toBeInTheDocument();
  });

  it("uploads the selected file for the selected profile and refetches the portal", async () => {
    render(<StudentPage />);

    await screen.findByTestId("student-carnet");

    const input = screen.getByTestId("carnet-photo-input") as HTMLInputElement;
    const archivo = new File(["contenido"], "foto.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [archivo] } });

    await waitFor(() => {
      expect(mockSubirFotoPersona).toHaveBeenCalledWith("9", archivo);
    });
    await waitFor(() => {
      expect(mockFetchStudentPortal).toHaveBeenCalledTimes(2);
    });
  });
});

/**
 * #286 slice 2 — el carnet imprime como credencial independiente.
 *
 * La hoja `@media print` de globals.css oculta todo el layout y deja solo
 * `#carnet-print-area` visible (tamaño 54×85.6mm, sobre blanco). Estos tests
 * fijan el CONTRATO del DOM que esa hoja presupone: el área de impresión en
 * el carnet, el botón que dispara `window.print`, y que la banda de estado y
 * los botones no viajan al impreso (`print:hidden`).
 */
describe("StudentPage — the carnet prints as a standalone credential", () => {
  it("marks the carnet as the print area the @media print sheet keeps visible", async () => {
    render(<StudentPage />);

    expect(await screen.findByTestId("student-carnet")).toHaveAttribute(
      "id",
      "carnet-print-area",
    );
  });

  it("offers an Imprimir carnet button that triggers window.print", async () => {
    const printSpy = vi.fn();
    window.print = printSpy;
    render(<StudentPage />);

    const boton = await screen.findByRole("button", { name: /imprimir carnet/i });
    fireEvent.click(boton);

    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it("hides the action buttons from the printed sheet", async () => {
    render(<StudentPage />);

    const imprimir = await screen.findByRole("button", { name: /imprimir carnet/i });
    // El contenedor de acciones (Imprimir + Cambiar foto) no viaja al impreso.
    expect(imprimir.closest("div")).toHaveClass("print:hidden");
  });

  // THIS LOCK INVERTS. It used to pin the status band inside a `print:hidden`
  // wrapper — on the sound argument that a plasticised card printed «vencido»
  // ages badly. The owner then read the same argument back one step further:
  // if a payment state is too perishable to print on an identity document, it
  // is not an identity fact on screen either. The band does not hide on print
  // any more; it is not on the carnet at all, in either medium.
  it("renders no payment state on the carnet, on screen or on paper", async () => {
    mockFetchPagosDePersona.mockResolvedValue([]);

    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    // Wait for the situation to settle, so this is not passing merely because
    // the payment history is still in flight.
    await screen.findByTestId("student-cuota-card");
    expect(carnet.querySelector('[data-testid="carnet-status-band"]')).toBeNull();
    // Not the testid alone: the wording itself must not be anywhere on the
    // card, however it might be re-dressed.
    expect(within(carnet).queryByText(/pago aprobado|al día|venció|validando/i)).toBeNull();
  });
});

/**
 * The print SHEET itself — `globals.css`'s `@media print` block.
 *
 * These read the stylesheet as text because jsdom applies no stylesheet: there
 * is no computed geometry to assert against, and the rules below are the ones
 * a browser measurement actually caught out. Three prior rounds shipped a
 * carnet that printed "fine" in the DOM and wrong on paper.
 *
 * Two defects are pinned here, both measured in a real Chromium:
 *
 *   - THREE PAGES came out of a one-card print. `visibility: hidden` preserves
 *     LAYOUT, so hiding the app left the document three pages tall with only
 *     the carnet inked. The visibility technique stays — it is the only way to
 *     hide arbitrary ancestors — and what gets clamped is the layout it leaves
 *     standing.
 *   - The card printed at x=0, y=0, flush into the sheet's corner, on a page
 *     sized to the card itself. The owner asked for it CENTRED and BORDERED:
 *     they print on whatever paper is in the tray and cut it out, so the sheet
 *     is an ordinary page and the cut line has to be visible.
 */
describe("globals.css — the carnet's print sheet", () => {
  const sheet = readFileSync(join(__dirname, "..", "..", "globals.css"), "utf8");
  const printBlock = sheet.slice(sheet.indexOf("@media print"));

  it("clamps the app's layout, not the document, so only one page comes out", () => {
    // MEASURED, not reasoned: clamping the ROOT (`html, body { height: 100%;
    // overflow: hidden }`) took it from three pages to two and stopped there —
    // Chrome propagates the root element's overflow to the viewport and
    // ignores it when paginating. Clamping an ordinary element does work,
    // because its `overflow: hidden` really clips. That is why this lock reads
    // `body > *` and deliberately does NOT accept a root clamp as the answer.
    expect(printBlock).toMatch(/body\s*>\s*\*\s*\{[^}]*height:\s*0/);
    expect(printBlock).toMatch(/body\s*>\s*\*\s*\{[^}]*overflow:\s*hidden/);
    // The clamp is a HEIGHT, never a `display: none`: the carnet is a fixed
    // descendant of these boxes, so zero height leaves it standing while
    // `display: none` on an ancestor would take it with them.
    expect(printBlock).not.toMatch(/body\s*>\s*\*\s*\{[^}]*display:\s*none/);
    // `visibility` is kept on purpose — see this block's doc comment.
    expect(printBlock).toMatch(/body\s*\*\s*\{\s*visibility:\s*hidden/);
  });

  it("prints on an ordinary sheet rather than on a card-sized page", () => {
    // The user prints on whatever paper they have and cuts. A `size: 54mm
    // 85.6mm` page asks the tray for card stock nobody has.
    expect(printBlock).toMatch(/@page\s*\{[^}]*size:\s*auto/);
    expect(printBlock).not.toMatch(/size:\s*54mm\s+85\.6mm/);
    expect(printBlock).toMatch(/@page\s*\{[^}]*margin:\s*\d/);
  });

  it("centres the card on the sheet at credential size", () => {
    const area = printBlock.slice(printBlock.indexOf("#carnet-print-area {"));
    // `position: fixed` + `inset: 0` + `margin: auto` centres against the page
    // box; `position: absolute` was what pinned it to 0,0.
    expect(area).toMatch(/position:\s*fixed/);
    expect(area).toMatch(/inset:\s*0/);
    expect(area).toMatch(/margin:\s*auto/);
    expect(area).toMatch(/width:\s*54mm/);
    expect(area).toMatch(/height:\s*85\.6mm/);
  });

  it("draws the cut line as a real border, not as a shadow Chrome drops", () => {
    const area = printBlock.slice(printBlock.indexOf("#carnet-print-area {"));
    // Chrome omits backgrounds and box-shadows unless "Background graphics" is
    // ticked, and it is off by default. A `border` prints either way, so the
    // cut line is unambiguous on the sheet the family actually gets.
    expect(area).toMatch(/border:\s*[\d.]+(?:px|mm)\s+solid/);
    expect(area).toMatch(/box-shadow:\s*none/);
  });

  // THE CRUX OF THE IDENTITY PRINT. Chrome omits every background and every
  // background-derived colour unless "Gráficos en segundo plano" is ticked,
  // and it is OFF by default — it is off in the owner's own print dialog.
  // A coal carnet that only appears when the reader finds that checkbox is
  // not a coal carnet; it is the Paint card with extra steps.
  //
  // `print-color-adjust: exact` is the one mechanism that overrides it, and
  // the `-webkit-` prefix is not optional: Chrome shipped the prefixed
  // property first and still honours it, and Safari knows nothing else.
  it("forces the card's own colours through Chrome's background-graphics default", () => {
    const area = printBlock.slice(printBlock.indexOf("#carnet-print-area"));
    expect(area).toMatch(/-webkit-print-color-adjust:\s*exact/);
    expect(area).toMatch(/(?<!-webkit-)print-color-adjust:\s*exact/);
    // It has to reach the DESCENDANTS too — the halftone, the photo ring and
    // the banner rule are painted by children, not by the card box.
    expect(printBlock).toMatch(/#carnet-print-area\s*\*[^{]*\{[^}]*print-color-adjust:\s*exact/);
  });
});

/**
 * R2 — the printed carnet carries the club's identity.
 *
 * This reverses decision #286 slice 2, which made print a white sheet with
 * grey ink and no mark on the reasoning that a home printer halftones a
 * photograph into a smudge and that a solid dark card is heavy ink. Both
 * observations were true; the conclusion was not. The owner printed it and
 * said «el pdf aún está verde… imagino imprimir el carnet y parezca paint,
 * tenemos que darle identidad del club». A credential with no colour, no
 * mark and no rule is not a cheaper version of the club's card — it is a
 * different, blanker object.
 *
 * The ink cost is real and is recorded in the component, not re-argued here.
 */
describe("StudentPage — the printed carnet is the same object as the screen one", () => {
  it("prints the club's mark instead of hiding it", async () => {
    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    const mark = carnet.querySelector('img[src*="cata-club-logo"]');
    expect(mark).not.toBeNull();
    // The mark used to leave the composition under `print:` — the wordmark
    // beneath it was doing the naming and a JPEG was expected to smudge.
    // With the coal ground printing, the blank white disc where the mark had
    // been was the most conspicuous thing on the sheet.
    expect(mark?.parentElement?.className).not.toMatch(/print:hidden/);
  });

  it("prints the plan kicker in the club's accent, not in grey", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue({
      ...PORTAL,
      self: {
        ...PORTAL.self!,
        membership: { id: 4, estado: "ACTIVA", personaId: 9, montoAplicado: "25.00", categoria: "Mensual", modalidad: "MENSUAL" as const },
      },
    });

    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    const kicker = within(carnet).getByText("Mensual").parentElement!;
    expect(kicker.className).toMatch(/\btext-ball\b/);
    // `print:text-coal/55` was the whole of the yellow's disappearance.
    expect(kicker.className).not.toMatch(/print:text-coal/);
  });

  it("keeps the card's one red rule and its white ink on paper", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue({
      ...PORTAL,
      self: {
        ...PORTAL.self!,
        membership: { id: 4, estado: "ACTIVA", personaId: 9, montoAplicado: "25.00", categoria: "Mensual", modalidad: "MENSUAL" as const, fechaActivacion: "2026-03-18" },
      },
    });
    mockFetchHorariosPorAlumno.mockResolvedValue([asignacion("LUNES", "15:00:00", "16:00:00", 1)]);

    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    await waitFor(() => {
      expect(within(carnet).getByText("Franja")).toBeInTheDocument();
    });
    const banner = within(carnet).getByText("Cata Club").parentElement!.parentElement!;
    expect(banner.className).toMatch(/\bborder-cata-red\b/);
    expect(banner.className).not.toMatch(/print:border-/);

    // The scoreboard's ink and its hairline follow the ground, and the ground
    // no longer flips.
    const facts = within(carnet).getByTestId("carnet-facts");
    expect(facts.className).not.toMatch(/print:border-coal/);
    for (const cell of [...facts.children]) {
      expect(cell.firstElementChild?.className).not.toMatch(/print:text-coal/);
      expect(cell.lastElementChild?.className).not.toMatch(/print:text-coal/);
    }

    // The photo keeps its own ring on the coal ground rather than inverting.
    const photo = screen.getByTestId("carnet-photo");
    expect(photo.className).not.toMatch(/print:bg-coal/);
    expect(photo.className).not.toMatch(/print:ring-coal/);
  });
});

/**anel are two
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

  // The scoreboard inverts the cell: the VALUE is the first element child and
  // the label follows it (see the "B · Marcador" locks at the foot of this
  // file). Only the accessor moved — every assertion below still reads the
  // same fact off the same cell.
  function franjaValue(carnet: HTMLElement): string | undefined {
    return within(carnet).getByText("Franja").parentElement?.firstElementChild?.textContent ?? undefined;
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

  // Fix 12b (docs/archive/fixes/12-mi-cuenta-carnet.md): the joined string used to
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

  // Fix 12c (docs/archive/fixes/12-mi-cuenta-carnet.md): the chosen maquette (Propuesta
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

    // La cifra vive en la tile "Asistencia" de la fila de pulso; el pie del
    // panel se quedó con el ALCANCE, que es lo que la tile no puede decir.
    // Estar en los dos lugares sería el recap duplicado que el panel del
    // entrenador ya borró una vez.
    expect(await screen.findByText(/sobre sus últimas 3 sesiones registradas/i)).toBeInTheDocument();

    const pulso = within(screen.getByTestId("student-pulse"));
    expect(pulso.getByText("Asistencia")).toBeInTheDocument();
    // 2 de 3 asistidas (present + late) = 67%.
    expect(pulso.getByText("67")).toBeInTheDocument();
    expect(pulso.getByText("2 de 3 sesiones")).toBeInTheDocument();
  });

  it("no repite la cifra de asistencia fuera de su tile", async () => {
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
    await screen.findByTestId("student-pulse");

    expect(screen.getAllByText("2 de 3 sesiones")).toHaveLength(1);
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
describe("StudentPage — the Cuota card carries the whole payment reading", () => {
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

    // The owner's own words: «esa info muévala a la sección de pagos, no al
    // carnet». The sentence leads the Cuota card — this screen's payments
    // block — and appears nowhere on the identity card.
    const cuota = await screen.findByTestId("student-cuota-card");
    await waitFor(() => {
      expect(within(cuota).getByText(/no tiene ningún pago aprobado/i)).toBeInTheDocument();
    });
    const carnet = screen.getByTestId("student-carnet");
    expect(within(carnet).queryByText(/no tiene ningún pago aprobado/i)).toBeNull();
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

    const cuota = await screen.findByTestId("student-cuota-card");
    await waitFor(() => {
      expect(within(cuota).getByText(/el club está validando/i)).toBeInTheDocument();
    });
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
    // …and the Cuota card's verdict names the child, because the reader is
    // not the student.
    expect(within(cuota).getByText(/Sofía no tiene ningún pago aprobado/i)).toBeInTheDocument();
  });
});

/**
 * The candado for the redesign's own stated risk ("pesa mucho cuando no hay
 * nada que resolver", docs/archive/fixes/12-mi-cuenta-carnet.md): an overdue family
 * and an up-to-date one must not render the same amount of card.
 *
 * The subject moved with the verdict. It used to be the CARNET that had to
 * earn its space, because the carnet carried the status band; the band is on
 * the Cuota card now, so the weight — and this lock — belongs there.
 */
describe("StudentPage — the Cuota card earns its space when the cuota is up to date", () => {
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

    // The verdict LEADS the Cuota card, carrying the urgency the carnet's
    // band used to carry — same `paymentBandTone`, same wording, a payments
    // block instead of an identity document.
    const verdict = await screen.findByTestId("cuota-verdict");
    await waitFor(() => {
      expect(verdict).toHaveAttribute("data-urgent", "true");
    });
    expect(verdict).toHaveAttribute("data-tone", "bad");
    expect(within(verdict).getByText(/venció/i)).toBeInTheDocument();

    const cuota = screen.getByTestId("student-cuota-card");
    expect(cuota).toHaveAttribute("data-compact", "false");
    // The verdict reads FIRST, before the evidence and the action.
    const detalle = within(cuota).getByText("A pagar");
    expect(verdict.compareDocumentPosition(detalle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(cuota).getByText("Registrar un pago")).toBeInTheDocument();
  });

  it("states the al día verdict itself and stays compact when the cuota is up to date", async () => {
    mockFetchStudentPortal.mockReset().mockResolvedValue(portalWithMembership());
    // Coverage stretches well past today plus the "ending soon" window.
    mockFetchPagosDePersona.mockResolvedValue([
      { ...PAGO_APROBADO, fechaInicio: "2026-08-01", fechaFin: "2026-12-31" },
    ]);

    render(<StudentPage />);

    // THE COMPACT BRANCH STATES THE VERDICT ITSELF. It used to lean on the
    // carnet's pill ("no button — the carnet's own pill already said 'Al
    // día'"); with the pill gone, a compact card that only says "Cubierta
    // hasta 31/12/2026" leaves the reader to infer the verdict from a date.
    await screen.findByText(/está al día con el club/i);
    const verdict = screen.getByTestId("cuota-verdict");
    expect(verdict).toHaveAttribute("data-urgent", "false");
    expect(verdict).toHaveAttribute("data-tone", "ok");

    const cuota = screen.getByTestId("student-cuota-card");
    expect(verdict.closest('[data-testid="student-cuota-card"]')).toBe(cuota);
    // Still compact: the verdict is one line, not a reason to reopen the card.
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
 * Fix 12b (docs/archive/fixes/12-mi-cuenta-carnet.md): stretching the carnet to match
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
 * Fix 12c (docs/archive/fixes/12-mi-cuenta-carnet.md) widened the carnet column to
 * `1fr 1fr` because the card's FOUR-cell grid could not fill the 340px rail's
 * complement. That condition no longer holds: the card is a portrait column of
 * three stacked figures, and a 566px-wide column is precisely what stopped it
 * from being one. The ratio moves back — for the opposite reason, not by
 * accident — and the rail takes the width the carnet stops needing.
 */
describe("StudentPage — the carnet column is card-width and the rail takes the rest", () => {
  it("narrows the carnet column to the card's own width instead of splitting the row evenly", async () => {
    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    const rail = carnet.parentElement?.parentElement;
    // `PAGE_RAIL`'s own `lg:grid-cols-[…_340px]` is still present in the
    // string (`cn` concatenates, it does not deduplicate) — the `!important`
    // override wins at the CSS layer, not by removing the losing utility from
    // the class list. See the comment above this `<div>` in page.tsx for why
    // that is the established mechanism, not a workaround.
    expect(rail?.className).toMatch(/lg:!grid-cols-\[minmax\(0,380px\)_minmax\(0,1fr\)\]/);
    expect(rail?.className).not.toMatch(/lg:!grid-cols-\[minmax\(0,1fr\)_minmax\(0,1fr\)\]/);
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
describe("StudentPage — the verdict reads the payment situation, not Membresia.estado", () => {
  // The HOST moved — carnet band to Cuota card — and the reading did not.
  // `describeMembershipState` stays retired: there is still exactly one
  // wording of the money on this screen, and it is derived from coverage
  // rather than from an admin-set `estado` that can disagree with it.
  it("says the account has no membership yet when there is no membership row", async () => {
    render(<StudentPage />);

    const cuota = await screen.findByTestId("student-cuota-card");
    expect(within(cuota).getByText(/todavía no tiene una membresía/i)).toBeInTheDocument();
  });

  it("says no payment has been approved for an INACTIVA membership with nothing on file", async () => {
    mockFetchStudentPortal.mockResolvedValueOnce({
      ...PORTAL,
      self: { ...PORTAL.self!, membership: { id: 5, estado: "INACTIVA", personaId: 9, montoAplicado: "85.00", categoria: "Mensual", modalidad: "MENSUAL" } },
    });

    render(<StudentPage />);

    const cuota = await screen.findByTestId("student-cuota-card");
    await waitFor(() => {
      expect(within(cuota).getByText(/no tiene ningún pago aprobado/i)).toBeInTheDocument();
    });
  });
});

/**
 * D11b, the shared root cause of the three socio screens' dead air.
 *
 * `AppShell`'s `<main>` is `flex flex-1 flex-col` inside a `min-h-screen`
 * chain, so it is ALREADY stretched to the viewport. Nothing on this screen
 * claimed that height, so every pixel the content did not use piled up under
 * the last block — 38% of the window for a self-managed adult at 1440x900.
 *
 * The fix is not a margin. `margin-top: auto` was tried on the profile screen
 * and did nothing, because a margin can only absorb free space that its
 * container actually has, and no container here had any. The height has to be
 * CLAIMED first: the content grid takes the leftover, and the rail column
 * stretches inside it — which is what finally switches on the three mechanisms
 * this file already believed in (`TrainingPanel`'s `flex-1`, `TrainingRow`'s
 * `flex-1`, and the panel footer's `mt-auto`).
 *
 * The carnet is deliberately NOT part of that chain — see the fix 12b block
 * above, which reverted exactly that.
 */
describe("StudentPage — the page's leftover height is claimed, not abandoned", () => {
  it("lets the content grid take the height `main` already reserved", async () => {
    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    const grid = carnet.parentElement?.parentElement;
    expect(grid?.className).toMatch(/\bflex-1\b/);
  });

  it("stretches the rail column so the panel's own flex-1 and mt-auto can bite", async () => {
    render(<StudentPage />);

    const panel = await screen.findByTestId("student-situation");
    const railColumn = panel.parentElement;
    expect(railColumn?.className).toMatch(/lg:self-stretch/);
  });

  it("still leaves the carnet at its natural height inside the stretched grid", async () => {
    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    // Fix 12b again: the grid grows, the carnet does not.
    expect(carnet.className).not.toMatch(/\bflex-1\b/);
    expect(carnet.parentElement?.className).not.toMatch(/self-stretch/);
    // The card DOES declare a height of its own, and that is a different
    // thing: 602px is ID-1's 54:85.6 at the rail's 380px, derived from the
    // object the card is a picture of. Fix 12b's height came from the RAIL,
    // an external number that moved whenever the panel beside it did, and
    // that is what put a hole inside the card. A `min-h` also never clips —
    // a three-line name still grows the card past it.
    expect(carnet.className).toMatch(/\bmin-h-\[602px\]/);
    expect(carnet.className).toMatch(/\bprint:min-h-0\b/);
  });
});

/**
 * D11c — "la ayuda no vive suelta".
 *
 * The switcher used to carry a permanent sentence explaining how the selection
 * behaves across the three family screens. It is a "cómo funciona", not a
 * "qué es", so it belongs behind "Ver ayuda" like every other procedure note
 * in the product (`/discounts`, `/members`, `/student/enroll`). It rode along
 * on all three socio screens at once, which is three copies of the same
 * floating paragraph.
 */
describe("StudentPage — the switcher's procedure note is disclosed, not permanent", () => {
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

  it("keeps the note behind 'Ver ayuda' instead of printing it beside the select", async () => {
    render(<StudentPage />);

    await screen.findByLabelText("Estudiante");
    expect(screen.queryByText(/Se mantiene en Mi cuenta, Pagos y Asistencias/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cómo funciona esta elección" }));

    expect(
      screen.getByText(/Se mantiene en Mi cuenta, Pagos y Asistencias/i),
    ).toBeInTheDocument();
  });
});

/**
 * D11 — an empty state has three parts: what is missing, why, and WHAT TO DO.
 * This one had the first two and no way out, and it did not fill the box it
 * stands in, so the stretched panel would have shown a centred statement with
 * canvas above and below it.
 */
describe("StudentPage — the no-schedule state fills its box and offers a way out", () => {
  it("gives the reader somewhere to go when the club has assigned no schedule", async () => {
    mockFetchHorariosPorAlumno.mockResolvedValue([]);

    render(<StudentPage />);

    const panel = await screen.findByTestId("student-situation");
    await waitFor(() => {
      expect(within(panel).getByText(/todavía no tiene un horario asignado/i)).toBeInTheDocument();
    });

    // The label is the destination's registered name (D12b), not a hand-written
    // phrase: `/ayuda` is "Preguntas frecuentes" everywhere else in the shell.
    const action = within(panel).getByRole("link", { name: /Preguntas frecuentes/i });
    expect(action).toHaveAttribute("href", "/ayuda");
  });

  it("fills the stretched panel instead of leaving canvas above and below", async () => {
    mockFetchHorariosPorAlumno.mockResolvedValue([]);

    render(<StudentPage />);

    const panel = await screen.findByTestId("student-situation");
    const title = await within(panel).findByText(/todavía no tiene un horario asignado/i);
    // `EmptyState`'s `fill` — `flex-1 justify-center` on the statement's own box.
    const emptyState = title.parentElement;
    expect(emptyState?.className).toMatch(/\bflex-1\b/);
    expect(emptyState?.className).toMatch(/justify-center/);
  });
});

// ---------------------------------------------------------------------------
// La fila de pulso — /student en la gramática de /dashboard
//
// El dueño aprueba el panel de admin y pidió que esta pantalla se rehiciera
// sobre esa. Lo que faltaba era la FORMA: el vocabulario ya estaba (el carnet
// es coal con su cifra en `font-display`), pero no había ninguna fila de
// tiles. Lo que NO se portó es el carnet como banda a lo ancho: tiene
// proporciones de credencial imprimible (#297) y el fix 12b ya probó
// estirarlo, con el sobrante cayendo dentro de la tarjeta.
// ---------------------------------------------------------------------------

/**
 * The carnet redesign — it stops being a card with data on it and becomes the
 * club's identity object, and print stops being the screen shrunk down.
 *
 * Every lock below is one of the seven defects the redesign closes. They are
 * written against the SAME DOM the screen renders: print is a breakpoint here,
 * not a second markup tree, so `within(carnet).getByText(...)` still finds
 * exactly one of everything.
 */
describe("StudentPage — the carnet as the club's identity object", () => {
  const FULL_MEMBERSHIP = {
    id: 4,
    estado: "ACTIVA",
    personaId: 9,
    montoAplicado: "25.00",
    categoria: "Mensual",
    modalidad: "MENSUAL" as const,
    fechaActivacion: "2026-03-18",
  };

  /** A carnet with every fact the card can carry, so the grid is real. */
  function renderFullCarnet() {
    mockFetchStudentPortal
      .mockReset()
      .mockResolvedValue({ ...PORTAL, self: { ...PORTAL.self!, membership: FULL_MEMBERSHIP } });
    mockFetchHorariosPorAlumno.mockResolvedValue([asignacion("LUNES", "15:00:00", "16:00:00", 1)]);
    render(<StudentPage />);
  }

  // D1 — "la regla de la acción": todo lo demás vive al pie del bloque que
  // modifica, y ninguna acción flota en medio del contenido. The action row
  // used to sit BETWEEN the name and the status band.
  it("puts the carnet's actions at the foot of the card, after the fact grid", async () => {
    renderFullCarnet();

    const facts = await screen.findByTestId("carnet-facts");
    const imprimir = screen.getByRole("button", { name: /imprimir carnet/i });

    expect(facts.compareDocumentPosition(imprimir) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // "La regla del aire": the leftover height becomes deliberate air at the
    // foot, not a hole in the middle.
    expect(imprimir.closest("div")?.className).toMatch(/\bmt-auto\b/);
  });

  // D2 — "no agregar un cuarto vocabulario para algo que ya tiene uno"
  // (DESIGN.md). The system already owns "the secondary action INSIDE a coal
  // card": `Button`'s `onCoal` variant. These three hand-rolled a fifth.
  it("builds the carnet's actions on the system's onCoal control, not on a hand-rolled capsule", async () => {
    render(<StudentPage />);
    await screen.findByTestId("student-carnet");

    for (const name of [/imprimir carnet/i, /cambiar foto/i]) {
      const boton = screen.getByRole("button", { name });
      // The `onCoal` skin, verbatim from `Button.tsx`.
      expect(boton.className).toContain("border-white/25");
      // A capsule is a badge; a control wears the control radius at the
      // compact control height (32px).
      expect(boton.className).toMatch(/\brounded-ctl\b/);
      expect(boton.className).not.toMatch(/rounded-full/);
      expect(boton.className).toMatch(/\bh-ctl-sm\b/);
    }
    // The upload trigger keeps its disabled handling.
    expect(screen.getByRole("button", { name: /cambiar foto/i }).className).toMatch(
      /disabled:cursor-not-allowed/,
    );
  });

  // D3 — Graduate is "lo que el club dice de sí mismo". It was absent from the
  // club's own membership card, whose wordmark was 12.5px Barlow.
  it("sets the club's wordmark in Graduate above its 15px floor, and leaves the student's name in Barlow", async () => {
    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    const wordmark = within(carnet).getByText("Cata Club");
    expect(wordmark.className).toMatch(/\bfont-display\b/);
    expect(wordmark.className).toMatch(/\buppercase\b/);
    // "B · Marcador" lets the club speak first: the wordmark leads the banner
    // at `text-xl` (26px) instead of the 15px floor it used to sit exactly on.
    // The floor itself is unchanged and still holds — see the dedicated lock
    // for it. It takes no print override, so the club signs the credential at
    // the weight it signs the screen.
    expect(wordmark.className).toMatch(/\btext-xl\b/);
    expect(wordmark.className).not.toMatch(/print:text-(2xs|xs|sm)\b/);

    // The hard boundary: Graduate has almost no vertical range and reads as
    // texture, so a person's name on an identity object stays in Barlow.
    const nombre = within(carnet).getByText("Alumno Test");
    expect(nombre.className).not.toMatch(/font-display/);
    // "Tenis de mesa" is read as words too — Barlow, unchanged.
    expect(within(carnet).getByText("Tenis de mesa").className).not.toMatch(/font-display/);
  });

  // D4 — the photo was avatar-sized (48px) on the one object that is about the
  // person, and it SHRANK to 36px on the printed credential.
  it("gives the photo the size of the subject on screen, and keeps it large on the printed card", async () => {
    render(<StudentPage />);

    const photo = await screen.findByTestId("carnet-photo");
    // The portrait carnet makes the photo the SUBJECT on screen too, not a
    // 56px avatar sitting beside the name: the screen composition is the
    // credential's own centred column, so the photo leads it at 100px.
    expect(photo.className).toMatch(/\bh-\[100px\]/);
    expect(photo.className).toMatch(/\bw-\[100px\]/);
    // On the credential it steps down in ABSOLUTE px and up in PROPORTION:
    // 68px of a 46mm field is a larger share than 100px of a 380px card. That
    // is physical scale, the one difference the two media are allowed.
    expect(photo.className).toMatch(/\bprint:h-\[68px\]/);
    expect(photo.className).toMatch(/\bprint:w-\[68px\]/);
    expect(photo.className).not.toMatch(/print:h-9\b/);
  });

  // D5 — the 150px `bg-ball/[0.08]` circle was category-default glow. The club
  // owns a texture of its own, and DESIGN.md permits it exactly here: "la trama
  // halftone… solo va donde no hay nada que leer, o donde hay algo que
  // celebrar".
  it("wears the club's own halftone texture instead of a decorative glow, and never prints it", async () => {
    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    const halftone = carnet.querySelector(".carnet-halftone");
    expect(halftone).not.toBeNull();
    expect(halftone).toHaveAttribute("aria-hidden", "true");
    expect(halftone?.className).toMatch(/pointer-events-none/);
    expect(halftone?.className).toMatch(/print:hidden/);
    // It sits BEHIND the content: every readable child is `relative z-10`.
    expect(halftone?.className).not.toMatch(/\bz-10\b/);
    // The generic glow is gone, not merely covered up.
    expect(carnet.querySelector('[class*="bg-ball/"]')).toBeNull();
  });

  // D6 — DESIGN.md's `typography.label` is weight 800. The carnet's labels had
  // drifted to `font-semibold` (600).
  it("weights the fact labels at the system's label token", async () => {
    renderFullCarnet();

    const facts = await screen.findByTestId("carnet-facts");
    await waitFor(() => {
      expect(within(facts).getByText("Franja")).toBeInTheDocument();
    });
    for (const cell of [...facts.children]) {
      // The label is the cell's LAST element child since the scoreboard
      // inversion — the figure leads, the label reads underneath it.
      const label = cell.lastElementChild;
      expect(label?.className).toMatch(/\bfont-extrabold\b/);
      expect(label?.className).not.toMatch(/\bfont-semibold\b/);
    }
  });

  // D7a — the printed carnet identifies BELONGING. A monthly price neither
  // identifies the person nor survives a price change, and it is private data
  // to carry in a wallet. It stays on screen and leaves the printed card.
  //
  // Declared per fact (`omitOnPrint`), never as a positional `:last-child`
  // selector — that would silently drop whichever fact happens to be last the
  // day the fact list changes.
  it("drops the monthly price from the printed card only, and keeps every other fact on it", async () => {
    renderFullCarnet();

    const facts = await screen.findByTestId("carnet-facts");
    await waitFor(() => {
      expect(within(facts).getByText("Franja")).toBeInTheDocument();
    });

    /** The fact CELL carrying a given label. */
    function cellFor(label: string): Element {
      const cell = within(facts).getByText(label).parentElement;
      expect(cell).not.toBeNull();
      return cell!;
    }

    expect(cellFor("Valor mensual").className).toMatch(/print:hidden/);
    // Still on screen, and still in the DOM — hidden at the print breakpoint
    // by a class, not removed from the markup.
    expect(within(facts).getByText("$25,00")).toBeInTheDocument();
    // "Plan" is no longer a cell here — it is the kicker above the name — so
    // the two figures that survive to paper are the two named below.
    for (const label of ["Socio desde", "Franja"]) {
      expect(cellFor(label).className).not.toMatch(/print:hidden/);
    }
  });

  // D7b — the owner's own read of the running app: «que igual como se ve en web
  // que en imprimible, solo cambia el fondo blanco». Print used to be a
  // DIFFERENT composition on the same DOM — a centred portrait column on paper,
  // a left-aligned landscape row on screen — and the two did not look like the
  // same object. There is ONE composition now, and the only differences the
  // card is allowed are the ground, the ink, the physical scale, and the parts
  // that legitimately do not print.
  it("composes screen and print the same way, differing only in ground, ink and scale", async () => {
    renderFullCarnet();

    const carnet = await screen.findByTestId("student-carnet");
    const facts = await screen.findByTestId("carnet-facts");
    const photo = screen.getByTestId("carnet-photo");

    // The card distributes its blocks over the 85.6mm field rather than
    // stacking them at the top, inside a credential-scale margin.
    expect(carnet.className).toMatch(/print:justify-between/);
    expect(carnet.className).toMatch(/print:p-\[4mm\]/);

    // THE GROUND AND THE INK NO LONGER CHANGE. This pair inverts: the card
    // used to print white with coal ink, and the owner's read of the result
    // was «imagino imprimir el carnet y parezca paint». Only the physical
    // scale and the parts that legitimately do not print differ now — the
    // coal card is the same object on both media.
    expect(carnet.className).not.toMatch(/print:bg-white/);
    expect(carnet.className).not.toMatch(/print:bg-none/);
    expect(carnet.className).not.toMatch(/print:text-coal\b/);
    expect(carnet.className).toMatch(/\bfrom-coal\b/);

    // The banner stacks and centres on BOTH media — no `print:` prefix on the
    // arrangement itself, or the two compositions drift apart again.
    const wordmark = within(carnet).getByText("Cata Club");
    const header = wordmark.closest("div")?.parentElement;
    expect(header?.className).toMatch(/\bflex-col\b/);
    expect(header?.className).toMatch(/\bitems-center\b/);
    expect(header?.className).not.toMatch(/print:flex-col/);

    // The photo leads a centred column, with the name beneath it — on both.
    const subject = photo.parentElement;
    expect(subject?.className).toMatch(/\bflex-col\b/);
    expect(subject?.className).toMatch(/\bitems-center\b/);
    expect(subject?.className).toMatch(/\btext-center\b/);
    expect(subject?.className).not.toMatch(/print:flex-col/);

    // The facts read as one left-aligned column, screen and paper alike.
    expect(facts.className).toMatch(/\bgrid-cols-1\b/);
    expect(facts.className).not.toMatch(/\bgrid-cols-2\b/);
    expect(facts.className).toMatch(/\btext-left\b/);
  });
});

/**
 * "B · Marcador" — the club speaks first, and the data reads as a scoreboard:
 * the figure, then what it measures.
 *
 * Same DOM, two compositions. Every lock below is written against the one
 * markup tree the screen renders, so `within(carnet).getByText(...)` still
 * finds exactly one of everything whether the utility that governs it is a
 * screen one or a `print:` one.
 */
describe("StudentPage — the carnet reads as a scoreboard (B · Marcador)", () => {
  const FULL_MEMBERSHIP = {
    id: 4,
    estado: "ACTIVA",
    personaId: 9,
    montoAplicado: "25.00",
    categoria: "Mensual",
    modalidad: "MENSUAL" as const,
    fechaActivacion: "2026-03-18",
  };

  /** A carnet with every figure the card can carry, so the scoreboard is real. */
  function renderFullCarnet() {
    mockFetchStudentPortal
      .mockReset()
      .mockResolvedValue({ ...PORTAL, self: { ...PORTAL.self!, membership: FULL_MEMBERSHIP } });
    mockFetchHorariosPorAlumno.mockResolvedValue([asignacion("LUNES", "15:00:00", "16:00:00", 1)]);
    render(<StudentPage />);
  }

  /**
   * The type scale, transcribed from `tailwind.config.ts`. A className is the
   * only place a component's resolved size is observable in jsdom — no
   * stylesheet is applied here — so the floor lock reads the utilities and
   * maps them back to the px the config assigns them.
   */
  const FONT_SIZE_PX: Record<string, number> = {
    "2xs": 10.5,
    xs: 12.5,
    sm: 13.5,
    base: 15,
    lg: 20,
    xl: 26,
    "2xl": 32,
    display: 46,
  };

  /** Every type size an element declares, screen and `print:` alike, in px. */
  function declaredSizesPx(className: string): number[] {
    return className.split(/\s+/).flatMap((token) => {
      const utility = token.replace(/^print:/, "");
      const arbitrary = /^text-\[(\d+(?:\.\d+)?)px\]$/.exec(utility);
      if (arbitrary) return [Number(arbitrary[1])];
      const named = /^text-(2xs|xs|sm|base|lg|xl|2xl|display)$/.exec(utility);
      return named ? [FONT_SIZE_PX[named[1]]] : [];
    });
  }

  // The banner: the club signs the card before the card says whose it is.
  it("leads with the wordmark in Graduate over the card's one red rule", async () => {
    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    const wordmark = within(carnet).getByText("Cata Club");
    expect(wordmark.className).toMatch(/\bfont-display\b/);
    // The top of the type scale below the stat and hero steps — the club
    // leads the banner instead of captioning the mark.
    expect(wordmark.className).toMatch(/\btext-xl\b/);

    const banner = wordmark.parentElement?.parentElement;
    expect(banner?.className).toMatch(/\bborder-b-2\b/);
    expect(banner?.className).toMatch(/\bborder-cata-red\b/);
    // The banner used to be a `justify-between` ROW — mark pinned to the far
    // edge, wordmark to the near one — which is the landscape arrangement the
    // portrait card replaces. It is a centred column on both media now.
    expect(banner?.className).not.toMatch(/\bjustify-between\b/);
    expect(banner?.className).toMatch(/\bflex-col\b/);
    expect(banner?.className).toMatch(/\btext-center\b/);

    // DESIGN.md rations red. The whole card spends its one appearance on the
    // line that divides the club from the person — nowhere else.
    expect(carnet.querySelectorAll('[class*="cata-red"]')).toHaveLength(1);
  });

  // THIS LOCK INVERTS. It used to pin "Tenis de mesa" to the printed banner
  // ALONE, on the argument that a reader on screen is already inside the
  // club's own product. That argument survived until the owner put the two
  // side by side and asked for one object, not two: a line present on paper
  // and absent on screen is precisely the kind of difference that makes the
  // printed card read as a different card. It is on both banners now.
  it("renders «Tenis de mesa» on the screen banner and on the printed one", async () => {
    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    const tagline = within(carnet).getByText("Tenis de mesa");
    expect(tagline.className).toMatch(/\bblock\b/);
    expect(tagline.className).not.toMatch(/\bhidden\b/);
    expect(tagline.className).not.toMatch(/\bprint:block\b/);
    // The ground stopped changing, so the ink stops changing with it: the
    // tagline is white on coal on paper exactly as it is on screen.
    expect(tagline.className).not.toMatch(/print:text-coal/);
    expect(tagline.className).toMatch(/\btext-white\/60\b/);
  });

  // The companion lock for `getByText("Plan")` further up this file. That
  // assertion still passes, but for a DIFFERENT reason — the label is now
  // `sr-only` — so the arrangement it used to describe is pinned here
  // explicitly rather than left to be inferred from an unchanged line.
  it("renders the plan as the kicker above the name, keeping its label for screen readers", async () => {
    renderFullCarnet();

    const carnet = await screen.findByTestId("student-carnet");
    const value = within(carnet).getByText("Mensual");
    const kicker = value.parentElement!;

    // Visible: the value alone, in the club's rationed accent.
    expect(kicker.className).toMatch(/\btext-ball\b/);
    expect(kicker.className).toMatch(/\btext-2xs\b/);
    expect(kicker.className).toMatch(/\bfont-extrabold\b/);

    // A bare value floating above a name is ambiguous to a screen reader, so
    // the label does not disappear — it stops being VISIBLE.
    const srLabel = within(kicker).getByText("Plan");
    expect(srLabel.className).toMatch(/\bsr-only\b/);
    expect(
      srLabel.compareDocumentPosition(value) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // It reads BEFORE the name, and it is no longer a scoreboard cell.
    const name = within(carnet).getByText("Alumno Test");
    expect(kicker.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const facts = within(carnet).getByTestId("carnet-facts");
    expect(within(facts).queryByText("Plan")).not.toBeInTheDocument();
  });

  it("renders no kicker at all when the membership carries no categoría", async () => {
    // `PORTAL.self.membership` is null: no label, no placeholder, no empty row.
    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    expect(within(carnet).queryByText("Plan")).not.toBeInTheDocument();
  });

  it("sizes the photo at 100px on screen and keeps it the subject at 68px on the credential", async () => {
    render(<StudentPage />);

    const photo = await screen.findByTestId("carnet-photo");
    expect(photo.className).toMatch(/\bh-\[100px\]/);
    expect(photo.className).toMatch(/\bw-\[100px\]/);
    expect(photo.className).toMatch(/\bprint:h-\[68px\]/);
    expect(photo.className).toMatch(/\bprint:w-\[68px\]/);
  });

  it("leads the scoreboard with Franja in a single full-width column", async () => {
    renderFullCarnet();

    const facts = await screen.findByTestId("carnet-facts");
    await waitFor(() => {
      expect(within(facts).getByText("Franja")).toBeInTheDocument();
    });

    const first = facts.children[0];
    expect(first.lastElementChild?.textContent).toBe("Franja");
    // The grid is ONE column on both media now, so a cell is already the full
    // width. A `col-span-2` here would conjure an implicit second column, and
    // a `print:col-span-1` would be undoing a span nothing declares.
    expect(facts.className).toMatch(/\bgrid-cols-1\b/);
    expect(first.className).not.toMatch(/col-span/);
  });

  // A value that is not a figure must not be set in Graduate: "No se pudo
  // consultar" is the state of a QUERY, not a figure of the club. Driven from
  // the real `horariosState` error path, and from an explicit per-cell flag in
  // the component — never from sniffing the string.
  it("sets a franja that could not be consulted in Barlow, never in Graduate", async () => {
    mockFetchStudentPortal
      .mockReset()
      .mockResolvedValue({ ...PORTAL, self: { ...PORTAL.self!, membership: FULL_MEMBERSHIP } });
    mockFetchHorariosPorAlumno.mockRejectedValue(new Error("boom"));

    render(<StudentPage />);

    const carnet = await screen.findByTestId("student-carnet");
    let value: HTMLElement;
    await waitFor(() => {
      value = within(carnet).getByText("No se pudo consultar");
    });
    expect(value!.className).toMatch(/\bfont-sans\b/);
    expect(value!.className).not.toMatch(/font-display/);

    // The figures around it are unaffected — the exception is per cell.
    const socioDesde = within(carnet).getByText("Socio desde").parentElement!;
    expect(socioDesde.firstElementChild?.className).toMatch(/font-display/);
  });

  // Fix 12b, carried into the new cell: the ONLY place a multi-window franja
  // may wrap is the " · " between windows, never inside one.
  it("splits a multi-window franja only at the separator, each window unbreakable", async () => {
    mockFetchStudentPortal
      .mockReset()
      .mockResolvedValue({ ...PORTAL, self: { ...PORTAL.self!, membership: FULL_MEMBERSHIP } });
    mockFetchHorariosPorAlumno.mockResolvedValue([
      asignacion("MARTES", "15:00:00", "16:00:00", 1),
      asignacion("JUEVES", "20:00:00", "21:15:00", 2),
    ]);

    render(<StudentPage />);

    const facts = await screen.findByTestId("carnet-facts");
    await waitFor(() => {
      expect(within(facts).getByText("Franja")).toBeInTheDocument();
    });

    const value = within(facts).getByText("Franja").parentElement!.firstElementChild!;
    expect(value.className).toMatch(/font-display/);
    const windows = [...value.querySelectorAll("span")];
    expect(windows.map((w) => w.textContent)).toEqual(["15:00 — 16:00", "20:00 — 21:15"]);
    for (const w of windows) {
      expect(w.className).toMatch(/whitespace-nowrap/);
    }
    // Still one coherent fact, read in one breath.
    expect(value.textContent).toBe("15:00 — 16:00 · 20:00 — 21:15");
  });

  // Identifying belonging is not publishing a price, and the price is the
  // first thing on this card to age.
  it("carries the print omission on Valor mensual alone", async () => {
    renderFullCarnet();

    const facts = await screen.findByTestId("carnet-facts");
    await waitFor(() => {
      expect(within(facts).getByText("Franja")).toBeInTheDocument();
    });

    const cellFor = (label: string) => within(facts).getByText(label).parentElement!;
    expect(cellFor("Valor mensual").className).toMatch(/print:hidden/);
    expect(cellFor("Franja").className).not.toMatch(/print:hidden/);
    expect(cellFor("Socio desde").className).not.toMatch(/print:hidden/);
  });

  // Graduate's 15px floor is a property of the FACE, not a screen convention:
  // it holds on paper too. Barlow labels may drop to 8px on the credential —
  // that is a different medium and a different face.
  it("never sets Graduate below its 15px floor, print utilities included", async () => {
    renderFullCarnet();

    const carnet = await screen.findByTestId("student-carnet");
    await waitFor(() => {
      expect(within(carnet).getByText("Franja")).toBeInTheDocument();
    });

    const graduate = [...carnet.querySelectorAll('[class*="font-display"]')];
    // The wordmark plus the three figures — if this ever finds nothing the
    // assertion below would pass vacuously.
    expect(graduate.length).toBeGreaterThanOrEqual(4);
    for (const element of graduate) {
      const sizes = declaredSizesPx(element.className);
      expect(sizes.length).toBeGreaterThan(0);
      for (const px of sizes) {
        expect(px).toBeGreaterThanOrEqual(15);
      }
    }
  });
});

describe("StudentPage — la fila de pulso", () => {
  it("usa la misma grilla de tiles que el panel de admin", async () => {
    render(<StudentPage />);

    expect((await screen.findByTestId("student-pulse")).className).toBe(STAT_GRID);
  });

  it("cuenta los entrenamientos de la semana como ventanas, no como filas", async () => {
    render(<StudentPage />);
    const pulso = within(await screen.findByTestId("student-pulse"));

    expect(pulso.getByText("Entrenamientos")).toBeInTheDocument();
    expect(pulso.getByText("por semana")).toBeInTheDocument();
  });

  // Issue #313 (K5 hallazgo #52): el tile decía "5 por semana" y la tarjeta
  // "Esta semana" — que se llama a sí misma "el horario semanal" — listaba
  // solo 3 días, con un tope fijo (`findNextTrainingSessions(..., 3)`) que
  // no tenía nada que ver con cuántos entrenamientos el propio tile contaba.
  // Ambas cifras ahora salen de la MISMA lista de ventanas semanales.
  it("lista TODOS los entrenamientos de la semana en 'Esta semana', no un tope fijo de 3", async () => {
    mockFetchHorariosPorAlumno.mockResolvedValue([
      asignacion("LUNES", "17:00:00", "18:00:00", 1),
      asignacion("MARTES", "17:00:00", "18:00:00", 2),
      asignacion("MIERCOLES", "17:00:00", "18:00:00", 3),
      asignacion("JUEVES", "17:00:00", "18:00:00", 4),
      asignacion("VIERNES", "17:00:00", "18:00:00", 5),
    ]);

    render(<StudentPage />);

    const pulso = within(await screen.findByTestId("student-pulse"));
    await waitFor(() => {
      expect(pulso.getByText("5")).toBeInTheDocument();
    });

    const panel = await screen.findByTestId("student-situation");
    await waitFor(() => {
      expect(within(panel).getAllByRole("listitem")).toHaveLength(5);
    });
  });

  it("dice que no sabe en vez de decir cero cuando el horario no cargó", async () => {
    // Un horario que falló no es un alumno sin entrenamientos, y un 0 se
    // dibujaría con la misma confianza que una cifra real.
    mockFetchHorariosPorAlumno.mockRejectedValue(new Error("network"));
    render(<StudentPage />);
    const pulso = within(await screen.findByTestId("student-pulse"));

    await waitFor(() => {
      expect(pulso.getByText("horario no disponible")).toBeInTheDocument();
    });
  });

  it("distingue no haber pagado nunca de que la cobertura venza hoy", async () => {
    // Sin pago aprobado no hay días que contar: la tile lo dice, no inventa
    // un 0 que se leería como "se te vence hoy".
    mockFetchPagosDePersona.mockResolvedValue([]);
    render(<StudentPage />);
    const pulso = within(await screen.findByTestId("student-pulse"));

    await waitFor(() => {
      expect(pulso.getByText("sin pago aprobado todavía")).toBeInTheDocument();
    });
  });

  it("declara los pagos que esperan validación del club", async () => {
    render(<StudentPage />);
    const pulso = within(await screen.findByTestId("student-pulse"));

    expect(pulso.getByText("Pagos en revisión")).toBeInTheDocument();
  });
});
