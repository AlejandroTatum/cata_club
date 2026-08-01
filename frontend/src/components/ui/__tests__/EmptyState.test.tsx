/**
 * EmptyState — one treatment, replacing the four the audit found.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
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
