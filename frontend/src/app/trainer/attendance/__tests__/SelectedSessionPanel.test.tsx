import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SelectedSessionPanel from "../SelectedSessionPanel";

const schedule = { id: 1, diaSemana: "mar" as const, horaInicio: "18:00", horaFin: "20:00", categoriaLabel: "Competitivo" };

describe("SelectedSessionPanel", () => {
  it("draws a ghost detail instead of a void when nothing is chosen", () => {
    render(
      <SelectedSessionPanel
        schedule={null}
        today="mar"
        recordedCount={0}
        preview={{ names: [], loading: false }}
        actions={<button type="button">Continuar</button>}
      />,
    );
    expect(screen.getByTestId("selected-session-ghost")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeInTheDocument();
  });

  it("shows the session, its status and a roster preview with overflow", () => {
    const names = Array.from({ length: 10 }, (_, i) => `Alumno ${i + 1}`);
    render(
      <SelectedSessionPanel
        schedule={schedule}
        today="mar"
        recordedCount={0}
        preview={{ names, loading: false }}
        actions={null}
      />,
    );
    expect(screen.getByText("Martes 18:00 — 20:00")).toBeInTheDocument();
    expect(screen.getByText("Competitivo")).toBeInTheDocument();
    expect(screen.getByText("Sin lista tomada hoy")).toBeInTheDocument();
    expect(screen.getByText("10 alumnos en la lista")).toBeInTheDocument();
    expect(screen.getByText("+2 más")).toBeInTheDocument();
  });
});
