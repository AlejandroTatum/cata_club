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
      horariosState={READY}
      canManagePhoto={false}
      onPhotoUploaded={() => {}}
      {...overrides}
    />,
  );
}

describe("MemberCard — «Miembro desde» (#1749)", () => {
  it("prints «Miembro desde mar 2019» as a register row when the club has the month on record", () => {
    renderCard({ profile: { ...PROFILE, miembroDesde: "2019-03-01" } });

    const facts = screen.getByTestId("carnet-facts");
    const row = within(facts).getByText("Miembro desde").closest("div") as HTMLElement;
    expect(row).toHaveTextContent("Miembro desde");
    expect(within(row).getByText("mar 2019")).toBeInTheDocument();
  });

  it("no longer prints the membership's activation date as «Jugador desde» (#1749)", () => {
    // PROFILE carries `membership.fechaActivacion`; the carnet must not read it.
    renderCard({ profile: { ...PROFILE, miembroDesde: "2019-03-01" } });

    const facts = screen.getByTestId("carnet-facts");
    expect(within(facts).queryByText("Jugador desde")).not.toBeInTheDocument();
    expect(within(facts).queryByText("04/10/2026")).not.toBeInTheDocument();
  });

  it.each([[null], [undefined]])("shows nothing, and no fallback date, when the value is %s", (value) => {
    renderCard({ profile: { ...PROFILE, miembroDesde: value } });

    expect(screen.queryByText("Miembro desde")).not.toBeInTheDocument();
  });
});

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

  it("lists Plan, Franja and Miembro desde in order, with no Válido hasta", () => {
    renderCard({ profile: { ...PROFILE, miembroDesde: "2019-03-01" } });

    const facts = screen.getByTestId("carnet-facts");
    const rows = [...facts.children];
    expect(rows.map((row) => row.firstElementChild?.textContent)).toEqual([
      "Plan",
      "Franja",
      "Miembro desde",
    ]);
    expect(rows.map((row) => row.lastElementChild?.textContent)).toEqual([
      "Mensual Adulto",
      "13:00 — 14:00",
      "mar 2019",
    ]);
    expect(within(facts).queryByText("Válido hasta")).not.toBeInTheDocument();
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
