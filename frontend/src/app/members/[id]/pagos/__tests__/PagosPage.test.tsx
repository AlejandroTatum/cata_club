/**
 * #1668 — the dedicated per-member payments page (`/members/[id]/pagos`).
 *
 * The page loads ONE account by id (`fetchMember`), so a member beyond the
 * first page of the list, or a reload on the URL, still resolves. Its forms
 * are the same ones the old Pagos dialog rendered; they are stubbed here so
 * what is under test is what the page itself decides: the plain-language
 * state, the ONE primary action, the explanations and the way back.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import PagosPage from "../page";
import type { MemberAccount, MemberStudentSummary } from "@/app/members/members-utils";

const mockFetchMember = vi.fn();
const mockFetchMembers = vi.fn();
const mockFetchPagos = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "450" }),
  usePathname: () => "/members/450/pagos",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock("@/components/ProtectedRoute", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/shell/AppShell", () => ({
  default: ({ back, title, subtitle, children }: { back?: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode }) => (
    <div>
      {back}
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
      <main>{children}</main>
    </div>
  ),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: { user: { role: "admin" } }, isLoading: false }),
}));
vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: vi.fn(), showError: vi.fn(), showSuccess: vi.fn(), showInfo: vi.fn(), showWarning: vi.fn() }),
}));
vi.mock("@/services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/api")>();
  return {
    ...actual,
    fetchMember: (id: string) => mockFetchMember(id),
    fetchMembers: () => mockFetchMembers(),
    fetchPagosDePersona: (id: string) => mockFetchPagos(id),
  };
});
vi.mock("@/app/members/BeneficioSection", () => ({ default: () => <div /> }));
vi.mock("@/app/members/CambiarPlanForm", () => ({ default: () => <div /> }));
vi.mock("@/app/members/CreateMembershipForm", () => ({ default: () => <button type="button">Crear membresía</button> }));
vi.mock("@/app/members/RegisterPaymentForm", () => ({ default: () => <button type="button">Registrar pago</button> }));
vi.mock("@/app/members/RegularizarDeudaForm", () => ({ default: () => <button type="button">Cargar pagos atrasados</button> }));
vi.mock("@/app/members/SuspenderReactivarForm", () => ({
  default: ({ estado }: { estado: string }) => (
    <button type="button">{estado === "activa" ? "Suspender membresía" : "Reactivar membresía"}</button>
  ),
}));
vi.mock("@/app/members/MigrarSocioAntiguoForm", () => ({
  default: ({ onBack }: { onBack: () => void }) => (
    <div>
      <p>formulario socio antiguo</p>
      <button type="button" onClick={onBack}>volver</button>
    </div>
  ),
}));

function studentWith(overrides: Partial<MemberStudentSummary>): MemberStudentSummary {
  return { id: "450", nombres: "Lucía", apellidos: "Vera", activo: true, membresia: null, ultimoPago: null, ...overrides };
}

function accountWith(student: MemberStudentSummary): MemberAccount {
  return {
    id: "450",
    role: "estudiante",
    nombres: "Lucía",
    apellidos: "Vera",
    telefono: "0999999450",
    estudiantes: [student],
    dependientes: [],
  } as MemberAccount;
}

const membresia = (extra: Record<string, unknown> = {}): NonNullable<MemberStudentSummary["membresia"]> =>
  ({
    id: 77,
    tipo: "Mensual",
    estado: "activa",
    estadoBackend: "ACTIVA",
    fechaInicio: "2026-09-01",
    fechaFin: "2026-10-01",
    cubiertoHasta: "2026-12-01",
    monto: 25,
    ...extra,
  }) as NonNullable<MemberStudentSummary["membresia"]>;

const pagoUltimo = (estado: "pendiente_validacion" | "rechazado" | "aprobado") => ({
  estado,
  fechaPago: "2026-09-01",
  monto: 25,
  periodo: "",
});

function loadStudent(student: MemberStudentSummary): void {
  mockFetchMember.mockResolvedValue(accountWith(student));
}

async function primaryAction(): Promise<HTMLElement> {
  await screen.findByRole("heading", { name: "Pagos" });
  await waitFor(() => expect(document.querySelectorAll("[data-primary-action]").length).toBeGreaterThan(0));
  const primary = document.querySelectorAll("[data-primary-action]");
  expect(primary).toHaveLength(1);
  return primary[0] as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchPagos.mockResolvedValue([]);
});

describe("PagosPage — loading one member by id", () => {
  it("names the member and offers a clear way back to Miembros", async () => {
    loadStudent(studentWith({ membresia: membresia() }));
    render(<PagosPage />);

    expect(await screen.findByText("Lucía Vera")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /volver a miembros/i })).toHaveAttribute("href", "/members");
  });

  it("loads the single member by the id in the URL, never the whole list (a member past the first page still opens)", async () => {
    loadStudent(studentWith({ membresia: membresia() }));
    render(<PagosPage />);

    await screen.findByText("Lucía Vera");
    expect(mockFetchMember).toHaveBeenCalledWith("450");
    expect(mockFetchMembers).not.toHaveBeenCalled();
  });

  it("says plainly when the member does not exist and keeps the way back", async () => {
    const { ApiClientError } = await import("@/services/api");
    mockFetchMember.mockRejectedValue(new ApiClientError("No se encontró a este miembro.", 404));
    render(<PagosPage />);

    expect(await screen.findByText(/no encontramos a este miembro/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /volver a miembros/i })).toHaveAttribute("href", "/members");
    expect(screen.queryByText("Acciones")).not.toBeInTheDocument();
  });

  it("offers a retry when loading fails for another reason", async () => {
    mockFetchMember.mockRejectedValueOnce(new Error("boom"));
    loadStudent(studentWith({ membresia: membresia() }));
    render(<PagosPage />);

    fireEvent.click(await screen.findByRole("button", { name: /reintentar/i }));
    expect(await screen.findByText("Lucía Vera")).toBeInTheDocument();
    expect(mockFetchMember).toHaveBeenCalledTimes(2);
  });
});

describe("PagosPage — one plain state and ONE primary action each", () => {
  it("first payment: asks «socio nuevo o antiguo» first", async () => {
    loadStudent(studentWith({ membresia: null }));
    render(<PagosPage />);

    const primary = await primaryAction();
    expect(primary).toHaveAttribute("data-primary-action", "tipo-socio");
    expect(screen.getByText("Primer pago pendiente")).toBeInTheDocument();
  });

  it("pending review: leads to the review queue and says how to fix a wrong payment", async () => {
    loadStudent(studentWith({ membresia: membresia({ estado: "vencida", estadoBackend: "INACTIVA", cubiertoHasta: null }), ultimoPago: pagoUltimo("pendiente_validacion") }));
    render(<PagosPage />);

    const primary = await primaryAction();
    expect(primary).toHaveAttribute("data-primary-action", "revisar-pago");
    expect(within(primary).getByRole("link", { name: /revisar el pago/i })).toHaveAttribute("href", "/payments");
    expect(screen.getByText("Pago pendiente de revisión")).toBeInTheDocument();
    expect(screen.getByText(/recházalo en pagos pendientes y vuelve a registrarlo/i)).toBeInTheDocument();
  });

  it("rejected: register the payment again", async () => {
    loadStudent(studentWith({ membresia: membresia(), ultimoPago: pagoUltimo("rechazado") }));
    render(<PagosPage />);

    const primary = await primaryAction();
    expect(primary).toHaveAttribute("data-primary-action", "registrar-pago");
    expect(screen.getByText("Último pago rechazado")).toBeInTheDocument();
  });

  it("owes months: says how many and leads with registering them", async () => {
    loadStudent(studentWith({ membresia: membresia({ estado: "vencida", cubiertoHasta: "2026-06-30", mesesAdeudados: 3, montoAdeudado: 75 }) }));
    render(<PagosPage />);

    const primary = await primaryAction();
    expect(primary).toHaveAttribute("data-primary-action", "regularizar-deuda");
    expect(within(primary).getByRole("button", { name: "Cargar pagos atrasados" })).toBeInTheDocument();
    expect(screen.getAllByText("Debe 3 meses").length).toBeGreaterThan(0);
  });

  it("up to date: next payment, and no catch-up action at all", async () => {
    loadStudent(studentWith({ membresia: membresia({ mesesAdeudados: 0 }), ultimoPago: pagoUltimo("aprobado") }));
    render(<PagosPage />);

    const primary = await primaryAction();
    expect(primary).toHaveAttribute("data-primary-action", "registrar-pago");
    expect(screen.getAllByText("Al día").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /cargar pagos atrasados/i })).not.toBeInTheDocument();
  });

  it("suspended: reactivate first", async () => {
    loadStudent(studentWith({ membresia: membresia({ estado: "suspendida", estadoBackend: "SUSPENDIDA" }) }));
    render(<PagosPage />);

    const primary = await primaryAction();
    expect(primary).toHaveAttribute("data-primary-action", "reactivar");
  });
});

describe("PagosPage — first payment and «socio nuevo / antiguo»", () => {
  it("explains each choice in one sentence", async () => {
    loadStudent(studentWith({ membresia: null }));
    render(<PagosPage />);

    expect(await screen.findByText(/se inscribe ahora/i)).toBeInTheDocument();
    expect(screen.getByText(/ya pagaba antes de usar el sistema/i)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /socio nuevo/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /socio antiguo/i })).toBeInTheDocument();
  });

  it("«Socio nuevo» shows the membership step with a «Cancelar» that returns to the choice (#1664)", async () => {
    loadStudent(studentWith({ membresia: null }));
    render(<PagosPage />);

    fireEvent.click(await screen.findByRole("radio", { name: /socio nuevo/i }));
    expect(await screen.findByRole("button", { name: "Crear membresía" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(await screen.findByRole("radio", { name: /socio antiguo/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument();
  });

  it("«Socio antiguo» opens the old-member form and can go back", async () => {
    loadStudent(studentWith({ membresia: null }));
    render(<PagosPage />);

    fireEvent.click(await screen.findByRole("radio", { name: /socio antiguo/i }));
    expect(await screen.findByText("formulario socio antiguo")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "volver" }));
    expect(await screen.findByRole("radio", { name: /socio nuevo/i })).toBeInTheDocument();
  });
});
