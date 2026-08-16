/**
 * `SessionsCard` — el historial de sesiones en la columna de identidad.
 *
 * Es lo que cierra el hueco de ~500px que `/profile` dejaba en cuentas de
 * staff. La restricción que lo definió: no quedaba UN campo de `GET /auth/me`
 * sin mostrar, y este archivo ya había retirado dos rellenos por inventados
 * ("Cuenta activa", el conteo de dispositivos). Así que el dato es nuevo de
 * verdad, traído por su propia tabla.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import SessionsCard from "@/app/profile/SessionsCard";
import type { SesionPropia } from "@/services/api";

const mockFetchMisSesiones = vi.fn();
vi.mock("@/services/api", () => ({
  fetchMisSesiones: () => mockFetchMisSesiones(),
}));

function sesion(overrides: Partial<SesionPropia> = {}): SesionPropia {
  return {
    id: 1,
    dispositivo: "Linux · Chrome",
    iniciadaEn: "2026-08-16T09:30:00.000Z",
    vigente: true,
    actual: false,
    ...overrides,
  };
}

beforeEach(() => {
  mockFetchMisSesiones.mockReset().mockResolvedValue([sesion()]);
});

describe("SessionsCard", () => {
  it("names each session by its device and when it started", async () => {
    render(<SessionsCard />);

    const fila = await screen.findByTestId("sesion-1");
    expect(within(fila).getByText("Linux · Chrome")).toBeInTheDocument();
    expect(fila.textContent).toMatch(/16\/08\/2026/);
  });

  it("marks the caller's own session so the list can be read at all", async () => {
    // Con tres equipos bajo el mismo epoch, sin esta marca el usuario no
    // puede saber cuál cerrar. Es lo que el claim `sid` existe para permitir.
    mockFetchMisSesiones.mockResolvedValue([
      sesion({ id: 1, dispositivo: "iPhone · Safari" }),
      sesion({ id: 2, dispositivo: "Linux · Chrome", actual: true }),
    ]);
    render(<SessionsCard />);

    const propia = await screen.findByTestId("sesion-2");
    expect(within(propia).getByText("Este equipo")).toBeInTheDocument();
    expect(within(screen.getByTestId("sesion-1")).queryByText("Este equipo")).not.toBeInTheDocument();
  });

  it("shows a closed session as closed instead of hiding it", async () => {
    // Una sesión muerta sigue siendo información: es la prueba de que
    // "cerrar mis otras sesiones" hizo algo.
    mockFetchMisSesiones.mockResolvedValue([sesion({ id: 3, vigente: false })]);
    render(<SessionsCard />);

    expect(within(await screen.findByTestId("sesion-3")).getByText("Cerrada")).toBeInTheDocument();
  });

  it("never renders a raw user agent, whatever the backend sends", async () => {
    // El contrato de privacidad se afirma en los dos lados: el backend manda
    // una etiqueta, y esta tarjeta no tiene ningún campo donde volcar más.
    mockFetchMisSesiones.mockResolvedValue([sesion({ dispositivo: "Android · Chrome" })]);
    render(<SessionsCard />);

    await screen.findByTestId("sesion-1");
    expect(screen.queryByText(/Mozilla|AppleWebKit|\d+\.\d+\.\d+\.\d+/)).not.toBeInTheDocument();
  });

  it("stays quiet instead of breaking the profile when the history fails", async () => {
    // Contenido de compañía, no la razón por la que alguien abre /profile:
    // un fallo acá no puede tirar la pantalla ni gritar un error rojo.
    mockFetchMisSesiones.mockRejectedValue(new Error("network"));
    const { container } = render(<SessionsCard />);

    await waitFor(() => {
      expect(container.querySelector("[data-testid='profile-sessions']")).toBeNull();
    });
  });

  it("does not render at all while it has nothing to say", async () => {
    mockFetchMisSesiones.mockResolvedValue([]);
    const { container } = render(<SessionsCard />);

    await waitFor(() => {
      expect(container.querySelector("[data-testid='profile-sessions']")).toBeNull();
    });
  });

  it("asks the backend exactly once per mount", async () => {
    render(<SessionsCard />);
    await screen.findByTestId("sesion-1");

    expect(mockFetchMisSesiones).toHaveBeenCalledTimes(1);
  });
});
