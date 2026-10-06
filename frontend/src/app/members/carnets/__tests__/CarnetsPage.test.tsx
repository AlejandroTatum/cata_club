/**
 * The admin's carnet printing screen (issue #1670): one id is the player's own
 * `MemberCard`, several are A4 sheets of the same credential, no photo prints a
 * silhouette, and nobody but an admin gets past the route.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import CarnetsPage from "@/app/members/carnets/page";
import type { MemberAccount } from "@/app/members/members-utils";
import type { CarnetSummary } from "@/services/api";

const mockReplace = vi.fn();
const mockPush = vi.fn();
let mockSearch = "";

vi.mock("next/navigation", () => ({
  usePathname: () => "/members/carnets",
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

vi.mock("next/image", () => ({
  __esModule: true,
  default: (props: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; sizes?: string }) => {
    const { fill, sizes, ...rest } = props;
    void fill;
    void sizes;
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt="" {...rest} />;
  },
}));

// The shell is not under test (it needs notifications, navigation, session);
// `ProtectedRoute` is, so it stays real.
vi.mock("@/components/shell/AppShell", () => ({
  default: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: vi.fn() }));
import { useAuth } from "@/contexts/AuthContext";
const mockUseAuth = vi.mocked(useAuth);

function authAs(role: string, authenticated = true): ReturnType<typeof useAuth> {
  return {
    session: authenticated
      ? { user: { id: "1", name: "Test", email: "t@c.com", role, representanteId: null }, roles: [], loggedInAt: "2026-07-01T12:00:00Z" }
      : null,
    isAuthenticated: authenticated,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
    revalidate: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>;
}

const mockFetchCarnets = vi.fn();
const mockFetchMembers = vi.fn();
vi.mock("@/services/api", () => ({
  fetchCarnets: (ids: number[]) => mockFetchCarnets(ids),
  fetchMembers: () => mockFetchMembers(),
  subirFotoPersona: vi.fn(),
}));

function carnet(id: number, extra: Partial<CarnetSummary["profile"]> = {}): CarnetSummary {
  return {
    profile: {
      personaId: String(id),
      nombres: `Jugador${id}`,
      apellidos: "Prueba",
      cedula: `11500000${id}`,
      fechaNacimiento: "2012-01-01",
      recentSessions: [],
      representante: null,
      representanteId: null,
      fotoUrl: null,
      membership: null,
      ...extra,
    },
    coverageEnd: "2026-12-31",
    asignaciones: [],
  };
}

function respondWith(ids: number[], extra: Partial<CarnetSummary["profile"]> = {}, missing: number[] = []): void {
  mockFetchCarnets.mockResolvedValue({ carnets: ids.map((id) => carnet(id, extra)), missing });
}

beforeEach(() => {
  mockReplace.mockReset();
  mockPush.mockReset();
  mockFetchCarnets.mockReset();
  mockFetchMembers.mockReset();
  mockSearch = "";
  mockUseAuth.mockReturnValue(authAs("admin"));
});

describe("CarnetsPage — admin only", () => {
  it.each(["representante", "estudiante", "trainer"])(
    "sends %s to their own home without reading any carnet",
    async (role) => {
      mockUseAuth.mockReturnValue(authAs(role));
      mockSearch = "ids=1,2";
      render(<CarnetsPage />);

      await waitFor(() => expect(mockReplace).toHaveBeenCalled());
      expect(mockFetchCarnets).not.toHaveBeenCalled();
      expect(mockFetchMembers).not.toHaveBeenCalled();
      expect(screen.queryByTestId("carnet-batch")).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Carnets" })).not.toBeInTheDocument();
    },
  );

  it("sends a visitor without a session to the login", async () => {
    mockUseAuth.mockReturnValue(authAs("admin", false));
    mockSearch = "ids=1,2";
    render(<CarnetsPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/login"));
    expect(mockFetchCarnets).not.toHaveBeenCalled();
  });
});

describe("CarnetsPage — one player", () => {
  it("renders the same MemberCard the player sees, without the photo control", async () => {
    mockSearch = "ids=7";
    respondWith([7]);
    render(<CarnetsPage />);

    const panel = await screen.findByTestId("student-carnet-panel");
    expect(mockFetchCarnets).toHaveBeenCalledWith([7]);
    expect(within(panel).getByTestId("student-carnet")).toHaveAttribute("id", "carnet-print-area");
    expect(within(panel).getByText("Jugador7 Prueba")).toBeInTheDocument();
    expect(within(panel).getByText("115000007")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /imprimir carnet/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cambiar foto/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("carnet-batch")).not.toBeInTheDocument();
  });
});

describe("CarnetsPage — batch", () => {
  it("lays the chosen players out as one sheet of the same credential, nine to a page at most", async () => {
    mockSearch = "ids=1,2,3&titulo=Competitivo";
    respondWith([1, 2, 3]);
    render(<CarnetsPage />);

    const sheets = await screen.findAllByTestId("carnet-sheet");
    expect(sheets).toHaveLength(1);
    const cards = within(sheets[0]).getAllByTestId("carnet-sheet-card");
    expect(cards).toHaveLength(3);
    expect(mockFetchCarnets).toHaveBeenCalledWith([1, 2, 3]);
    expect(screen.getByText(/Competitivo: 3 carnets · 1 hoja A4/)).toBeInTheDocument();
    // The credential's own anatomy, not a lookalike.
    for (const card of cards) {
      expect(within(card).getByTestId("carnet-role")).toHaveTextContent("Jugador");
      expect(within(card).getByTestId("carnet-signature")).toBeInTheDocument();
      expect(card).not.toHaveAttribute("id");
    }
    // Payment status stays off the card.
    expect(screen.queryByText(/pago|cuota|deuda|pendiente/i)).not.toBeInTheDocument();
    // The panel's controls are not on the sheet.
    expect(screen.queryByTestId("student-carnet-panel")).not.toBeInTheDocument();
  });

  it("starts a new sheet after nine cards", async () => {
    const ids = Array.from({ length: 10 }, (_, index) => index + 1);
    mockSearch = `ids=${ids.join(",")}`;
    respondWith(ids);
    render(<CarnetsPage />);

    const sheets = await screen.findAllByTestId("carnet-sheet");
    expect(sheets.map((sheet) => within(sheet).getAllByTestId("carnet-sheet-card").length)).toEqual([9, 1]);
    expect(screen.getByText(/10 carnets · 2 hojas A4/)).toBeInTheDocument();
  });

  it("prints a silhouette for a player without a photo and the photo for one with it", async () => {
    mockSearch = "ids=1,2";
    mockFetchCarnets.mockResolvedValue({
      carnets: [carnet(1), carnet(2, { fotoUrl: "https://res.cloudinary.com/test/image/upload/foto.jpg" })],
      missing: [],
    });
    render(<CarnetsPage />);

    const [sinFoto, conFoto] = await screen.findAllByTestId("carnet-sheet-card");
    expect(within(sinFoto).getByTestId("carnet-photo-silhouette")).toBeInTheDocument();
    expect(within(sinFoto).queryByRole("img", { name: /foto de/i })).not.toBeInTheDocument();
    expect(within(conFoto).queryByTestId("carnet-photo-silhouette")).not.toBeInTheDocument();
    expect(within(conFoto).getByRole("img", { name: "Foto de Jugador2 Prueba" })).toBeInTheDocument();
  });

  it("prints through the browser dialog and says when someone could not be loaded", async () => {
    mockSearch = "ids=1,2,3";
    respondWith([1, 2], {}, [3]);
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    render(<CarnetsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Imprimir 2 carnets" }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Un jugador no se pudo cargar");
  });
});

describe("CarnetsPage — picking a batch", () => {
  const player: MemberAccount = {
    id: "11",
    role: "estudiante",
    nombres: "Ana",
    apellidos: "Jugadora",
    telefono: "1",
    estudiantes: [],
    backendRoles: ["ALUMNO"],
  };
  const trainer: MemberAccount = { ...player, id: "12", nombres: "Tito", apellidos: "Entrenador", backendRoles: ["ENTRENADOR"] };
  const minor: MemberAccount = { ...player, id: "13", nombres: "Mateo", apellidos: "Menor", backendRoles: undefined, representadoPor: "Ana Jugadora" };

  it("lists players only and prints the ones chosen", async () => {
    mockFetchMembers.mockResolvedValue({ accounts: [player, trainer, minor] });
    render(<CarnetsPage />);

    expect(await screen.findByRole("checkbox", { name: "Elegir a Ana Jugadora" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Elegir a Mateo Menor" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Tito/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ver e imprimir/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Elegir a Ana Jugadora" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Elegir a Mateo Menor" }));
    fireEvent.click(screen.getByRole("button", { name: /ver e imprimir/i }));

    expect(mockPush).toHaveBeenCalledWith("/members/carnets?ids=11%2C13");
  });
});
