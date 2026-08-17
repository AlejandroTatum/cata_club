/**
 * IdentityCell — the initial, the name, and what the person IS at the club.
 *
 * D9 of `docs/ux/rediseno-visual-2026-08.md` names this cell a shared piece
 * rather than a layout six screens each draw for themselves ("La celda de
 * identidad —inicial, nombre arriba, roles abajo— es una pieza compartida, no
 * un maquetado suelto: se repite en seis pantallas"). These tests are the
 * rules that survived the six drawings, so they are written against behaviour
 * an admin can see, not against the component's internals.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import IdentityCell, { MEMBER_ROLE_LABELS } from "@/components/ui/IdentityCell";
import type { BackendTipoRol } from "@/types/domain";

/** The rendered second line, in the order the cell draws it. */
function roleLine(): string[] {
  const list = screen.queryByRole("list");
  if (!list) return [];
  return Array.from(list.querySelectorAll("li")).map((item) => item.textContent ?? "");
}

describe("IdentityCell — the two lines are stacked", () => {
  // The defect this asserts against was real: the name and its companion
  // shipped as two inline <span>s and rendered on ONE line, because nothing
  // in the markup said otherwise.
  it("gives the name a line of its own", () => {
    render(<IdentityCell name="Ana Pérez" roles={["ALUMNO"]} />);
    expect(screen.getByText("Ana Pérez")).toHaveClass("block");
  });

  it("puts the companion line in a block element that cannot share the row", () => {
    render(<IdentityCell name="Ana Pérez" roles={["ALUMNO"]} />);
    // A <ul> is block-level by the user agent stylesheet, so the stacking
    // survives a caller that strips the utility class.
    expect(screen.getByRole("list").tagName).toBe("UL");
  });
});

describe("IdentityCell — the companion line is a LIST", () => {
  it("draws one item per role, because a person can be several things at once", () => {
    render(
      <IdentityCell name="Marta Salas" roles={["ALUMNO", "REPRESENTANTE"]} represents={["Ana Pérez"]} />,
    );
    expect(roleLine()).toEqual(["Jugador", "Representante · 1 jugador"]);
  });

  it("draws the roles in one fixed order, whatever order they arrive in", () => {
    render(
      <IdentityCell name="Marta Salas" roles={["REPRESENTANTE", "ALUMNO"]} represents={["Ana Pérez"]} />,
    );
    expect(roleLine()).toEqual(["Jugador", "Representante · 1 jugador"]);
  });

  it("collapses a role the caller sent twice", () => {
    render(<IdentityCell name="Marta Salas" roles={["ALUMNO", "ALUMNO"]} />);
    expect(roleLine()).toEqual(["Jugador"]);
  });
});

describe("IdentityCell — one map owns the words", () => {
  it("spells the four roles the way the club says them", () => {
    expect(MEMBER_ROLE_LABELS.ALUMNO([])).toBe("Jugador");
    expect(MEMBER_ROLE_LABELS.REPRESENTANTE(["Ana Pérez"])).toBe("Representante · 1 jugador");
    expect(MEMBER_ROLE_LABELS.ENTRENADOR([])).toBe("Entrenador");
    expect(MEMBER_ROLE_LABELS.ADMINISTRADOR([])).toBe("Administrador");
  });

  it("renders exactly what the map returns, so the map is the only place to change a word", () => {
    const roles: BackendTipoRol[] = ["ALUMNO", "REPRESENTANTE", "ENTRENADOR", "ADMINISTRADOR"];
    render(<IdentityCell name="Marta Salas" roles={roles} represents={["Ana Pérez"]} />);
    expect(roleLine()).toEqual(roles.map((role) => MEMBER_ROLE_LABELS[role](["Ana Pérez"])));
  });

  it("never abbreviates — no 'Rep.', no 'Admin'", () => {
    // D9's rule of words: "la interfaz no abrevia. Si algo no entra, entra
    // menos información, nunca una palabra cortada." A trailing dot is what an
    // abbreviation looks like, and `useAccountRolesAndStatus.ROLE_LABELS`
    // ships "Admin" today, which is the other shape of the same mistake.
    for (const label of Object.values(MEMBER_ROLE_LABELS)) {
      expect(label(["Ana Pérez"])).not.toMatch(/\./);
      expect(label(["Ana Pérez"])).not.toBe("Admin");
    }
  });
});

/**
 * Estos candados decían los NOMBRES. Se cambian a conciencia, no se borran:
 * la celda pasó a contar porque una familia de siete llenaba la fila de la
 * grilla con siete nombres en una línea. Los nombres siguen existiendo, pero
 * ya no acá — la fila de `/members` se despliega y los muestra enteros.
 * Excepción escrita en `docs/ux/rediseno-visual-2026-08.md`.
 */
describe("IdentityCell — the representative counts who they represent", () => {
  it("counts one player", () => {
    render(<IdentityCell name="Marta Salas" roles={["REPRESENTANTE"]} represents={["Ana Pérez"]} />);
    // Con uno también cuenta: un formato por columna, sin excepciones.
    expect(roleLine()).toEqual(["Representante · 1 jugador"]);
  });

  it("counts two without naming either", () => {
    render(
      <IdentityCell
        name="Marta Salas"
        roles={["REPRESENTANTE"]}
        represents={["Ana Pérez", "Luis Pérez"]}
      />,
    );
    expect(roleLine()).toEqual(["Representante · 2 jugadores"]);
  });

  it("keeps one width whatever the family size, because that was the whole point", () => {
    render(
      <IdentityCell
        name="Marta Salas"
        roles={["REPRESENTANTE"]}
        represents={["Ana Pérez", "Luis Pérez", "Sofía Pérez"]}
      />,
    );
    expect(roleLine()).toEqual(["Representante · 3 jugadores"]);
    // El reclamo del dueño, como candado: los nombres no entran en la celda.
    expect(screen.queryByText(/Ana Pérez/)).not.toBeInTheDocument();
  });

  it("says the role alone when no name came with it", () => {
    render(<IdentityCell name="Marta Salas" roles={["REPRESENTANTE"]} />);
    expect(roleLine()).toEqual(["Representante"]);
  });
});

describe("IdentityCell — it names the person, never an absence", () => {
  it("says Jugador for a player with no representative and nothing else", () => {
    render(<IdentityCell name="Ana Pérez" roles={["ALUMNO"]} represents={[]} />);
    expect(roleLine()).toEqual(["Jugador"]);
    expect(screen.queryByText(/sin representante/i)).toBeNull();
    expect(screen.queryByText(/menor/i)).toBeNull();
  });

  it("draws no companion line at all when there is no role to name", () => {
    render(<IdentityCell name="Ana Pérez" roles={[]} />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText("Ana Pérez")).toBeInTheDocument();
  });
});

describe("IdentityCell — the initial", () => {
  it("draws the initials of the name", () => {
    const { container } = render(<IdentityCell name="Ana Pérez" roles={["ALUMNO"]} />);
    expect(container.textContent).toContain("AP");
  });

  it("keeps the initials out of the accessibility tree", () => {
    // The initials are the name, drawn smaller. Announcing them makes a screen
    // reader say the person's name twice, the second time letter by letter.
    const { container } = render(<IdentityCell name="Ana Pérez" roles={["ALUMNO"]} />);
    const initials = container.querySelector("[aria-hidden='true']");
    expect(initials?.textContent).toBe("AP");
  });
});
