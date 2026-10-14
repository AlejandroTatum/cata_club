import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import FailedRecordsNotice from "../FailedRecordsNotice";
import type { SessionStudent } from "../attendance-utils";

const students: SessionStudent[] = [
  { id: "101", name: "Ana Torres", attendance: "present" },
  { id: "102", name: "Beto Luna", attendance: "absent" },
];

describe("FailedRecordsNotice", () => {
  it("names who already recorded a student another trainer got to first (ENT-04)", () => {
    render(
      <FailedRecordsNotice
        students={students}
        failed={[
          { personaId: 101, message: "ya registrada", alreadyRegistered: true, registradoPorNombre: "Luis Pérez" },
        ]}
      />,
    );

    expect(screen.getByText("1 jugador ya estaba registrado")).toBeInTheDocument();
    expect(screen.getByText(/Ana Torres — registrado por Luis Pérez/)).toBeInTheDocument();
    expect(screen.queryByText(/No se pudo guardar/)).not.toBeInTheDocument();
    // Nobody is actually missing, so no advice to "complete" the roster (ENT-03).
    expect(screen.queryByText(/complete solo a los jugadores que faltan/)).not.toBeInTheDocument();
  });

  it("keeps real failures apart from already-recorded students", () => {
    render(
      <FailedRecordsNotice
        students={students}
        failed={[
          { personaId: 102, message: "boom" },
          { personaId: 101, message: "ya", alreadyRegistered: true, registradoPorNombre: null },
          { personaId: 999, message: "boom" },
        ]}
      />,
    );

    expect(screen.getByText("No se pudieron guardar 2 registros")).toBeInTheDocument();
    expect(screen.getByText("Beto Luna")).toBeInTheDocument();
    expect(screen.getByText("Jugador #999")).toBeInTheDocument();
    // No author known (historic row): the name alone, no dangling "registrado por".
    expect(screen.getByText("Ana Torres")).toBeInTheDocument();
  });

  // ENT-03: everybody already filed — a summary, not 62 lines, and no "complete the missing ones".
  it("summarises a long already-registered list and drops the 'missing students' advice", () => {
    const many = Array.from({ length: 62 }, (_, i) => ({
      personaId: 200 + i,
      message: "ya",
      alreadyRegistered: true,
      registradoPorNombre: "Carlos Mendoza",
    }));
    render(<FailedRecordsNotice students={students} failed={many} />);

    expect(screen.getByText("62 jugadores ya estaban registrados por Carlos Mendoza")).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.queryByText(/complete solo a los jugadores que faltan/)).not.toBeInTheDocument();
  });

  // #1768: a batch refuses a player whose payment lapsed. That is a reason the
  // trainer cannot fix by retrying, so it is said apart, with the names.
  it("names the players refused for a pending payment, apart from real failures", () => {
    render(
      <FailedRecordsNotice
        students={students}
        failed={[
          { personaId: 101, message: "Ana Torres tiene un pago pendiente.", pendingPayment: true },
          { personaId: 102, message: "boom" },
        ]}
      />,
    );

    expect(screen.getByText("1 jugador con pago pendiente")).toBeInTheDocument();
    expect(screen.getByText(/no se les puede registrar asistencia hasta que paguen/i)).toBeInTheDocument();
    expect(screen.getByText("Ana Torres")).toBeInTheDocument();
    expect(screen.getByText("No se pudo guardar 1 registro")).toBeInTheDocument();
    expect(screen.getByText("Beto Luna")).toBeInTheDocument();
  });

  it("gives no «retry» advice when the only failures are pending payments", () => {
    render(
      <FailedRecordsNotice
        students={students}
        failed={[
          { personaId: 101, message: "x", pendingPayment: true },
          { personaId: 102, message: "x", pendingPayment: true },
        ]}
      />,
    );

    expect(screen.getByText("2 jugadores con pago pendiente")).toBeInTheDocument();
    expect(screen.queryByText(/No se pudo/)).not.toBeInTheDocument();
    expect(screen.queryByText(/completa solo a los jugadores que faltan/i)).not.toBeInTheDocument();
  });
});
