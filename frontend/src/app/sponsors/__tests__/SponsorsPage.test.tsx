/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SponsorsPage from "../page";

const fetchSponsors = vi.fn(); const crearSponsor = vi.fn(); const eliminarSponsor = vi.fn();
vi.mock("@/components/ProtectedRoute", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/shell/AppShell", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/services/api", () => ({ fetchSponsors: () => fetchSponsors(), crearSponsor: (...args: unknown[]) => crearSponsor(...args), eliminarSponsor: (id: number) => eliminarSponsor(id) }));

describe("SponsorsPage", () => {
  beforeEach(() => { fetchSponsors.mockResolvedValue([{ id: 1, nombre: "Municipio", logoUrl: "https://cdn/logo.png" }]); crearSponsor.mockResolvedValue({}); eliminarSponsor.mockResolvedValue(undefined); vi.stubGlobal("confirm", vi.fn(() => true)); });
  it("lists uploaded logos with their accessible short names", async () => {
    render(<SponsorsPage />);
    expect(await screen.findByRole("img", { name: "Municipio" })).toHaveAttribute("src", "https://cdn/logo.png");
  });
  it("requires both the name and logo before upload", async () => {
    render(<SponsorsPage />); fireEvent.click(screen.getByRole("button", { name: "Subir logo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/nombre y seleccione/i);
    expect(crearSponsor).not.toHaveBeenCalled();
  });
  it("deletes a listed sponsor after confirmation", async () => {
    render(<SponsorsPage />); await screen.findByText("Municipio");
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(eliminarSponsor).toHaveBeenCalledWith(1));
  });
});
