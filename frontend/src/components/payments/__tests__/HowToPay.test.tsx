import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import HowToPay from "../HowToPay";

const mockGetInfo = vi.fn();
vi.mock("@/services/api", () => ({ fetchClubPaymentInfo: () => mockGetInfo() }));

let mockSession: object | null = { user: { id: "u1", role: "estudiante" } };
let mockAuthLoading = false;
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: mockSession, isLoading: mockAuthLoading }),
}));

const FULL = {
  holder: "Titular Prueba",
  accountType: "Cuenta de Ahorros",
  accountNumber: "1234567890",
  bank: "Banco Prueba",
  holderId: "0102030405",
};

describe("HowToPay", () => {
  beforeEach(() => {
    mockGetInfo.mockReset();
    mockSession = { user: { id: "u1", role: "estudiante" } };
    mockAuthLoading = false;
  });

  it("renders the configured transfer data", async () => {
    mockGetInfo.mockResolvedValue(FULL);
    render(<HowToPay />);
    expect(await screen.findByRole("heading", { name: "Cómo pagar" })).toBeInTheDocument();
    expect(screen.getByText("Titular Prueba")).toBeInTheDocument();
    expect(screen.getByText("Cuenta de Ahorros")).toBeInTheDocument();
    expect(screen.getByText("1234567890")).toBeInTheDocument();
    expect(screen.getByText("Banco Prueba")).toBeInTheDocument();
    expect(screen.getByText("C.I.: 0102030405")).toBeInTheDocument();
  });

  it("renders nothing when the config is missing", async () => {
    mockGetInfo.mockResolvedValue(null);
    const { container } = render(<HowToPay />);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows an anonymous visitor a sign-in notice and never requests the data", () => {
    mockSession = null;
    render(<HowToPay />);
    expect(screen.getByText("Los datos para transferencia se muestran al iniciar sesión.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Iniciar sesión" })).toHaveAttribute("href", "/login?next=/ayuda");
    expect(screen.queryByText("Titular Prueba")).toBeNull();
    expect(mockGetInfo).not.toHaveBeenCalled();
  });

  it("announces loading, then a retryable error when the data cannot be fetched", async () => {
    mockGetInfo.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(FULL);
    render(<HowToPay />);
    expect(screen.getByRole("status")).toHaveTextContent(/cargando/i);
    fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Titular Prueba")).toBeInTheDocument();
  });

  it("shows the sign-in notice, not an error, when the session has expired", async () => {
    mockGetInfo.mockRejectedValue(Object.assign(new Error("No autenticado."), { status: 401 }));
    render(<HowToPay />);
    expect(await screen.findByText("Los datos para transferencia se muestran al iniciar sesión.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
  });

  it("shows a local retryable error on a 503 and never the sign-in notice", async () => {
    mockGetInfo.mockRejectedValue(Object.assign(new Error("down"), { status: 503 }));
    render(<HowToPay />);
    expect(await screen.findByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    expect(screen.queryByTestId("how-to-pay-signin")).toBeNull();
  });

  it("omits QR, cash place and hours when not configured, with no placeholder", async () => {
    mockGetInfo.mockResolvedValue(FULL);
    render(<HowToPay />);
    await screen.findByText("Titular Prueba");
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText(/efectivo/i)).toBeNull();
    expect(screen.queryByText(/horario/i)).toBeNull();
  });

  it("renders the optional fields when configured", async () => {
    mockGetInfo.mockResolvedValue({ ...FULL, qrImageSrc: "/qr.png", cashPlace: "Secretaría del club", cashHours: "Lunes a viernes, 15:00 a 18:00" });
    render(<HowToPay />);
    expect(await screen.findByRole("img", { name: /código qr/i })).toHaveAttribute("src", "/qr.png");
    expect(screen.getByText("Secretaría del club")).toBeInTheDocument();
    expect(screen.getByText("Lunes a viernes, 15:00 a 18:00")).toBeInTheDocument();
  });

  it("copies the account number and announces it", async () => {
    mockGetInfo.mockResolvedValue(FULL);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<HowToPay />);
    const button = await screen.findByRole("button", { name: "Copiar número" });
    expect(button.className).toMatch(/min-h-\[44px\]|min-h-11/);
    fireEvent.click(button);
    expect(writeText).toHaveBeenCalledWith("1234567890");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Número de cuenta copiado"));
  });

  it("tells the reader when copying fails", async () => {
    mockGetInfo.mockResolvedValue(FULL);
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("no")) } });
    render(<HowToPay />);
    fireEvent.click(await screen.findByRole("button", { name: "Copiar número" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No se pudo copiar"));
  });
});
