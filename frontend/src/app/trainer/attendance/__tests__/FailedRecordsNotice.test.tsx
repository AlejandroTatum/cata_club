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

    expect(screen.getByText("1 alumno ya estaba registrado")).toBeInTheDocument();
    expect(screen.getByText(/Ana Torres — registrado por Luis Pérez/)).toBeInTheDocument();
    expect(screen.queryByText(/No se pudo guardar/)).not.toBeInTheDocument();
    expect(screen.getByText(/complete solo a los alumnos que faltan/)).toBeInTheDocument();
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
    expect(screen.getByText("Alumno #999")).toBeInTheDocument();
    // No author known (historic row): the name alone, no dangling "registrado por".
    expect(screen.getByText("Ana Torres")).toBeInTheDocument();
  });
});
