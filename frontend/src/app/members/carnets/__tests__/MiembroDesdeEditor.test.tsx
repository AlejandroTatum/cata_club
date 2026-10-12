/**
 * The admin's «Miembro desde» control for one player (issue #1749): a month
 * and a year, saved or cleared on its own, with the club's own range checked
 * before anything is sent.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import MiembroDesdeEditor from "@/app/members/carnets/MiembroDesdeEditor";

const mockSetMiembroDesde = vi.fn();
vi.mock("@/services/api", () => ({
  setMiembroDesde: (personaId: string, value: string | null) => mockSetMiembroDesde(personaId, value),
}));

const onSaved = vi.fn();

function renderEditor(value: string | null = null) {
  return render(<MiembroDesdeEditor personaId="7" name="Ana Vera" value={value} onSaved={onSaved} />);
}

function pick(value: string): void {
  fireEvent.change(screen.getByLabelText("Miembro desde de Ana Vera"), { target: { value } });
}

beforeEach(() => {
  mockSetMiembroDesde.mockReset();
  onSaved.mockReset();
});

describe("MiembroDesdeEditor", () => {
  it("starts from the month on record, and offers to clear it only when there is one", () => {
    renderEditor("2019-03-01");

    expect(screen.getByLabelText("Miembro desde de Ana Vera")).toHaveValue("2019-03");
    expect(screen.getByRole("button", { name: "Quitar" })).toBeInTheDocument();
  });

  it("starts empty with no clear button when nothing is on record", () => {
    renderEditor(null);

    expect(screen.getByLabelText("Miembro desde de Ana Vera")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Quitar" })).not.toBeInTheDocument();
  });

  it("saves the picked month as YYYY-MM and reports the stored value", async () => {
    mockSetMiembroDesde.mockResolvedValue({ miembroDesde: "2019-03-01" });
    renderEditor(null);

    pick("2019-03");
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("2019-03-01"));
    expect(mockSetMiembroDesde).toHaveBeenCalledWith("7", "2019-03");
    expect(screen.getByRole("status")).toHaveTextContent("Guardado");
  });

  it("clears the value with null", async () => {
    mockSetMiembroDesde.mockResolvedValue({ miembroDesde: null });
    renderEditor("2019-03-01");

    fireEvent.click(screen.getByRole("button", { name: "Quitar" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(null));
    expect(mockSetMiembroDesde).toHaveBeenCalledWith("7", null);
    expect(screen.getByLabelText("Miembro desde de Ana Vera")).toHaveValue("");
  });

  it("asks for a month before saving an empty field, without calling the server", () => {
    renderEditor(null);

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Elige un mes y un año.");
    expect(mockSetMiembroDesde).not.toHaveBeenCalled();
  });

  it("refuses a month before the club's founding, without calling the server", () => {
    renderEditor(null);

    pick("2013-09");
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(screen.getByRole("alert")).toHaveTextContent("No puede ser anterior a octubre de 2013.");
    expect(mockSetMiembroDesde).not.toHaveBeenCalled();
  });

  it("accepts the founding month itself", async () => {
    mockSetMiembroDesde.mockResolvedValue({ miembroDesde: "2013-10-01" });
    renderEditor(null);

    pick("2013-10");
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(mockSetMiembroDesde).toHaveBeenCalledWith("7", "2013-10"));
  });

  it("refuses a month in the future, without calling the server", () => {
    renderEditor(null);

    pick("2099-01");
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(screen.getByRole("alert")).toHaveTextContent("No puede estar en el futuro.");
    expect(mockSetMiembroDesde).not.toHaveBeenCalled();
  });

  it("shows the server's refusal and keeps the typed month", async () => {
    mockSetMiembroDesde.mockRejectedValue(
      Object.assign(new Error("«Miembro desde» solo se registra para jugadores."), { status: 400 }),
    );
    renderEditor(null);

    pick("2019-03");
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("solo se registra para jugadores");
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Miembro desde de Ana Vera")).toHaveValue("2019-03");
  });
});
