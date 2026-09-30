import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import SessionStatusGroups from "../SessionStatusGroups";
import type { SessionStudent } from "../attendance-utils";

const students: SessionStudent[] = [
  { id: "1", name: "Ana López", attendance: "present", reviewed: true },
  { id: "2", name: "Beto Ruiz", attendance: "present", reviewed: false },
  { id: "3", name: "Carla Paz", attendance: "absent", reviewed: true },
];

describe("SessionStatusGroups", () => {
  it("names students under the states that have someone and collapses the rest", () => {
    render(<SessionStatusGroups students={students} />);

    const present = screen.getByRole("region", { name: "Presente" });
    expect(within(present).getByText("Ana López")).toBeInTheDocument();
    expect(within(present).getByText("Beto Ruiz")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Ausente" })).getByText("Carla Paz")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Tardanza" })).not.toBeInTheDocument();
    expect(screen.getByText("Sin tardanzas, justificados, enfermos, competencias.")).toBeInTheDocument();
  });

  it("draws unreviewed rows dashed only when asked to flag them", () => {
    const { rerender } = render(<SessionStatusGroups students={students} flagUnreviewed />);
    expect(screen.getByText("Beto Ruiz")).toHaveClass("border-dashed");
    expect(screen.getByText("Ana López")).not.toHaveClass("border-dashed");

    rerender(<SessionStatusGroups students={students} />);
    expect(screen.getByText("Beto Ruiz")).not.toHaveClass("border-dashed");
  });
});
