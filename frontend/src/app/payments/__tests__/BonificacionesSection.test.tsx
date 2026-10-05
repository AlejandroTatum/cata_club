import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { BonificacionesSection } from "../BonificacionesSection";

function mockFetchOnce(body: unknown, ok = true) {
  vi.spyOn(global, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status: ok ? 200 : 500, headers: { "Content-Type": "application/json" } }),
  );
}

const item = {
  id: 4,
  personaId: 9,
  personaNombreCompleto: "Ana Pérez",
  membresiaId: 3,
  monto: "0.00",
  fechaInicio: "2026-08-01",
  fechaFin: "2026-09-01",
  otorgadaEn: "2026-08-01T09:00:00Z",
};

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("BonificacionesSection (admin review)", () => {
  it("lists each 100% coverage with $0,00 and an official receipt link", async () => {
    mockFetchOnce({ items: [item], total: 1 });
    render(<BonificacionesSection />);

    expect(await screen.findByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /bonificaciones/i })).toBeInTheDocument();
    expect(screen.getByText("$0,00")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /recibo oficial/i });
    expect(link).toHaveAttribute("href", "/api/membresias/coberturas/4/comprobante");
  });

  it("renders nothing when there are no coverages", async () => {
    mockFetchOnce({ items: [], total: 0 });
    const { container } = render(<BonificacionesSection />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the request fails", async () => {
    mockFetchOnce({ message: "boom" }, false);
    const { container } = render(<BonificacionesSection />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
