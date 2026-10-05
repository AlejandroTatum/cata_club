/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import MemberCard from "@/app/student/MemberCard";
import type { MemberCardHorariosState } from "@/app/student/MemberCard";
import type { AlumnoHorario, StudentProfileSummary } from "@/services/api";

vi.mock("next/image", () => ({
  __esModule: true,
  default: (props: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; sizes?: string }) => {
    const { fill, sizes, ...rest } = props;
    void fill;
    void sizes;
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt="" {...rest} />;
  },
}));

const PROFILE: StudentProfileSummary = {
  personaId: "9",
  nombres: "Doménica",
  apellidos: "Rojas",
  cedula: "1150634549",
  fechaNacimiento: "2010-05-01",
  recentSessions: [],
  representante: null,
  representanteId: null,
  fotoUrl: null,
  membership: {
    id: 4,
    estado: "ACTIVA",
    personaId: 9,
    montoAplicado: "25.00",
    categoria: "Mensual Adulto",
    modalidad: "MENSUAL",
    fechaActivacion: "2026-10-04",
    fechaFin: null,
  },
};

function asignacion(dia: string, id: number): AlumnoHorario {
  return {
    id,
    personaId: 9,
    personaNombreCompleto: "Doménica Rojas",
    edad: 16,
    horarioId: id,
    horarioDia: dia,
    horarioHoraInicio: "13:00:00",
    horarioHoraFin: "14:00:00",
    fechaAsignacion: "2026-07-01T09:00:00Z",
  } as AlumnoHorario;
}

const READY: MemberCardHorariosState = {
  status: "ready",
  asignaciones: [asignacion("LUNES", 1), asignacion("VIERNES", 2)],
};

function renderCard(overrides: Partial<React.ComponentProps<typeof MemberCard>> = {}) {
  return render(
    <MemberCard
      profile={PROFILE}
      coverageEnd="2027-04-04"
      horariosState={READY}
      canManagePhoto={false}
      onPhotoUploaded={() => {}}
      {...overrides}
    />,
  );
}

describe("MemberCard", () => {
  it("renders the name, cédula, role label and the real logo with alt text", () => {
    renderCard();

    const card = screen.getByRole("group", { name: "Carnet de jugador de Doménica Rojas" });
    expect(within(card).getByText("Doménica Rojas")).toBeInTheDocument();
    expect(within(card).getByText("Cédula")).toBeInTheDocument();
    expect(within(card).getByText("1150634549")).toBeInTheDocument();
    expect(within(card).getByText("Jugador")).toBeInTheDocument();
    expect(within(card).getByRole("img", { name: "Logo de Cata Club" })).toHaveAttribute(
      "src",
      "/brand/cata-club-logo.jpeg",
    );
  });

  it("lists Plan, Franja, Jugador desde and Válido hasta in order", () => {
    renderCard();

    const facts = screen.getByTestId("carnet-facts");
    const rows = [...facts.children];
    expect(rows.map((row) => row.firstElementChild?.textContent)).toEqual([
      "Plan",
      "Franja",
      "Jugador desde",
      "Válido hasta",
    ]);
    expect(rows.map((row) => row.lastElementChild?.textContent)).toEqual([
      "Mensual Adulto",
      "13:00 — 14:00",
      "04/10/2026",
      "04/04/2027",
    ]);
  });

  it("falls back to a dash when there is no coverage end", () => {
    renderCard({ coverageEnd: null });

    const row = within(screen.getByTestId("carnet-facts")).getByText("Válido hasta").parentElement!;
    expect(row.lastElementChild?.textContent).toBe("—");
  });

  it("marks the training days through data attributes and a spoken label", () => {
    renderCard();

    const chips = screen.getByTestId("carnet-training-days");
    expect(chips).toHaveAttribute("aria-label", "Días de entrenamiento: Lunes y viernes");
    const states = [...chips.querySelectorAll<HTMLElement>("[data-day]")].map((chip) => [
      chip.dataset.day,
      chip.dataset.state,
    ]);
    expect(states).toEqual([
      ["lun", "activo"],
      ["mar", "inactivo"],
      ["mie", "inactivo"],
      ["jue", "inactivo"],
      ["vie", "activo"],
      ["sab", "inactivo"],
      ["dom", "inactivo"],
    ]);
  });

  it("draws no chips while the schedule lookup has not answered", () => {
    renderCard({ horariosState: { status: "loading" } });

    expect(screen.queryByTestId("carnet-training-days")).toBeNull();
    expect(screen.getByText("Consultando…")).toBeInTheDocument();
  });

  it("signs the card", () => {
    renderCard();

    expect(screen.getByText("¡Nos vemos en la mesa!")).toBeInTheDocument();
  });
});
