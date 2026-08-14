/**
 * EmptyState — one treatment, replacing the four the audit found.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent } from "@testing-library/react";
import { Calendar } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";

describe("EmptyState — content", () => {
  it("renders the title", () => {
    render(<EmptyState title="Todavía no registraste ninguna lista" />);
    expect(screen.getByText("Todavía no registraste ninguna lista")).toBeInTheDocument();
  });

  it("renders the description when supplied", () => {
    render(
      <EmptyState
        title="Todavía no registraste ninguna lista"
        description="Cuando pases lista en una sesión, los registros van a aparecer acá."
      />,
    );
    expect(
      screen.getByText("Cuando pases lista en una sesión, los registros van a aparecer acá."),
    ).toBeInTheDocument();
  });

  it("caps the description so it stays readable", () => {
    render(<EmptyState title="Sin registros" description="Una línea corta." />);
    expect(screen.getByText("Una línea corta.")).toHaveClass("max-w-[44ch]");
  });

  it("renders an action that stays clickable", () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        title="Sin registros"
        action={
          <Button variant="primary" onClick={onClick}>
            Pasar lista ahora
          </Button>
        }
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pasar lista ahora" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("omits description and action when they are not supplied", () => {
    const { container } = render(<EmptyState title="Sin registros" />);
    expect(container.querySelector("p")).toBeNull();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("EmptyState — icon", () => {
  it("puts the icon in a neutral disc", () => {
    const { container } = render(
      <EmptyState icon={<Calendar size={ICON.lg} />} title="Sin registros" />,
    );
    const disc = container.querySelector("span[aria-hidden='true']");
    expect(disc).toHaveClass("bg-state-neutral-bg", "rounded-full");
  });

  it("keeps the icon out of the accessibility tree", () => {
    const { container } = render(
      <EmptyState icon={<Calendar size={ICON.lg} />} title="Sin registros" />,
    );
    expect(container.querySelector("svg")?.closest("span")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("renders without an icon at all", () => {
    const { container } = render(<EmptyState title="Sin registros" />);
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("EmptyState — layout", () => {
  it("centers its column", () => {
    const { container } = render(<EmptyState title="Sin registros" />);
    expect(container.firstElementChild).toHaveClass(
      "flex",
      "flex-col",
      "items-center",
      "text-center",
    );
  });
});

/**
 * The surface used to belong to whoever called this, and twenty-two call sites
 * gave four answers: ten wrapped it in a card, eleven let it fall inside one
 * the screen had already opened, and three gave it nothing — so "no hay nada"
 * sat on paper on one screen and bare on the canvas on the next.
 */
describe("EmptyState — the surface it sits on", () => {
  it("draws the paper card by default, because a statement needs a surface", () => {
    const { container } = render(<EmptyState title="Sin registros" />);
    expect(container.firstElementChild).toHaveClass("card");
  });

  it("draws none when the screen already opened a card around it", () => {
    // A card inside a card is a border and a shadow the design never asks for.
    const { container } = render(<EmptyState title="Sin registros" surface="inset" />);
    expect(container.firstElementChild).not.toHaveClass("card");
    // The column itself is unchanged — only the surface goes.
    expect(container.firstElementChild).toHaveClass("flex", "flex-col", "items-center");
  });

  it("leaves no caller wrapping it in a card of their own", () => {
    // The acceptance criterion, on the sources. A `<div className="card">` whose
    // first child is an `EmptyState` is the wrapper this prop replaces, and it
    // now renders two nested cards rather than one.
    const src = join(__dirname, "..", "..", "..");
    const wrapped: string[] = [];

    for (const path of sourceFiles(src)) {
      const code = readFileSync(path, "utf8");
      if (/<div className="card">\s*\n\s*<EmptyState/.test(code)) {
        wrapped.push(path.slice(src.length + 1));
      }
    }

    expect(wrapped).toEqual([]);
  });
});

/**
 * D11b turned dead air into a measured number, and `/members` reports 25% —
 * 227px — the moment a search finds nobody: the empty-state card keeps the
 * height of its own three short lines and the rest of the column stays bare
 * canvas underneath it.
 *
 * `fill` is the answer, and it is a LAYOUT prop: the three parts D11 requires —
 * what is missing, why, what to do — are untouched. The card stretches to the
 * column it stands in, so the surplus lands INSIDE the surface as air instead
 * of under it as a hole.
 *
 * Why the statement is centred and not pinned to the foot: the repo already
 * measured the alternative. `SessionCard.tsx:26-29` records QA rejecting
 * exactly that treatment — "`mt-auto` on the actions left the surplus stranded
 * as dead air in the middle instead of respiro under them" — on a card whose
 * body did not grow to meet it. An empty state never grows, so it is that case
 * by definition. Splitting the surplus above and below reads as deliberate
 * air; pooling it all between the description and its button reads as the same
 * hole moved indoors.
 */
describe("EmptyState — the stretched card (D11b)", () => {
  it("does not stretch by default, so no existing caller's layout moves", () => {
    const { container } = render(<EmptyState title="Sin registros" />);
    expect(container.firstElementChild).not.toHaveClass("flex-1");
    expect(container.firstElementChild).not.toHaveClass("justify-center");
  });

  it("stretches to its column so the surplus falls inside the surface", () => {
    const { container } = render(<EmptyState title="Sin registros" fill />);
    expect(container.firstElementChild).toHaveClass("flex-1");
  });

  it("splits the surplus above and below the statement instead of pooling it at one end", () => {
    const { container } = render(<EmptyState title="Sin registros" fill />);
    expect(container.firstElementChild).toHaveClass("justify-center");
  });

  it("keeps the three parts together — the action never drifts to the foot", () => {
    // The action sits 4px under the body copy (`29-estados.html:67-72`), and
    // stretching the card is not a licence to move it: `mt-auto` is the
    // treatment SessionCard's own QA note rejected.
    const { container } = render(
      <EmptyState
        title="No se encontraron miembros"
        description="Ningún miembro coincide con la búsqueda."
        action={<Button>Limpiar búsqueda</Button>}
        fill
      />,
    );
    const action = screen.getByRole("button", { name: "Limpiar búsqueda" }).parentElement;
    expect(action).toHaveClass("mt-1");
    expect(action).not.toHaveClass("mt-auto");
  });

  it("still draws its own surface when it stretches", () => {
    const { container } = render(<EmptyState title="Sin registros" fill />);
    expect(container.firstElementChild).toHaveClass("card");
  });
});

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      found.push(...sourceFiles(full));
      continue;
    }
    if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) found.push(full);
  }
  return found;
}
