import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import HowToPay from "../HowToPay";

const mockGetInfo = vi.fn();
vi.mock("@/lib/club-payment-info", () => ({ getClubPaymentInfo: () => mockGetInfo() }));

const FULL = {
  holder: "Titular Prueba",
  accountType: "Cuenta de Ahorros",
  accountNumber: "1234567890",
  bank: "Banco Prueba",
  holderId: "0102030405",
};

describe("HowToPay", () => {
  beforeEach(() => mockGetInfo.mockReset());

  it("renders the configured transfer data", () => {
    mockGetInfo.mockReturnValue(FULL);
    render(<HowToPay />);
    expect(screen.getByRole("heading", { name: "Cómo pagar" })).toBeInTheDocument();
    expect(screen.getByText("Titular Prueba")).toBeInTheDocument();
    expect(screen.getByText("Cuenta de Ahorros")).toBeInTheDocument();
    expect(screen.getByText("1234567890")).toBeInTheDocument();
    expect(screen.getByText("Banco Prueba")).toBeInTheDocument();
    expect(screen.getByText("C.I.: 0102030405")).toBeInTheDocument();
  });

  it("renders nothing when the config is missing", () => {
    mockGetInfo.mockReturnValue(null);
    const { container } = render(<HowToPay />);
    expect(container).toBeEmptyDOMElement();
  });

  it("omits QR, cash place and hours when not configured, with no placeholder", () => {
    mockGetInfo.mockReturnValue(FULL);
    render(<HowToPay />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText(/efectivo/i)).toBeNull();
    expect(screen.queryByText(/horario/i)).toBeNull();
  });

  it("renders the optional fields when configured", () => {
    mockGetInfo.mockReturnValue({ ...FULL, qrImageSrc: "/qr.png", cashPlace: "Secretaría del club", cashHours: "Lunes a viernes, 15:00 a 18:00" });
    render(<HowToPay />);
    expect(screen.getByRole("img", { name: /código qr/i })).toHaveAttribute("src", "/qr.png");
    expect(screen.getByText("Secretaría del club")).toBeInTheDocument();
    expect(screen.getByText("Lunes a viernes, 15:00 a 18:00")).toBeInTheDocument();
  });

  it("copies the account number and announces it", async () => {
    mockGetInfo.mockReturnValue(FULL);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<HowToPay />);
    const button = screen.getByRole("button", { name: "Copiar número" });
    expect(button.className).toMatch(/min-h-\[44px\]|min-h-11/);
    fireEvent.click(button);
    expect(writeText).toHaveBeenCalledWith("1234567890");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Número de cuenta copiado"));
  });

  it("tells the reader when copying fails", async () => {
    mockGetInfo.mockReturnValue(FULL);
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("no")) } });
    render(<HowToPay />);
    fireEvent.click(screen.getByRole("button", { name: "Copiar número" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No se pudo copiar"));
  });
});
