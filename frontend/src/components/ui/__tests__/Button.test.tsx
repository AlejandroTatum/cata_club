/**
 * Button — the height contract is the reason this component exists, so it is
 * what these tests assert. The audit found `.btn-primary` shipping at four
 * distinct real heights because every caller re-derived it from padding.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Button, { buttonClasses } from "@/components/ui/Button";
import { committedHeight, committedRadius } from "./ui-test-utils";

function renderButton(props: Parameters<typeof Button>[0] = { children: "Guardar" }) {
  render(<Button {...props} />);
  return screen.getByRole("button");
}

describe("Button — committed dimensions", () => {
  it("is 40px tall by default", () => {
    expect(committedHeight(renderButton({ children: "Guardar" }))).toBe("40px");
  });

  it("is 32px tall at size sm — the in-table action height", () => {
    expect(committedHeight(renderButton({ children: "Editar", size: "sm" }))).toBe("32px");
  });

  it("uses the 10px control radius at the default size", () => {
    expect(committedRadius(renderButton({ children: "Guardar" }))).toBe("10px");
  });

  it("holds its height for every variant", () => {
    for (const variant of ["primary", "secondary", "dark", "ghost"] as const) {
      const { unmount } = render(<Button variant={variant}>Acción</Button>);
      expect(committedHeight(screen.getByRole("button"))).toBe("40px");
      unmount();
    }
  });
});

describe("Button — variants", () => {
  it("paints primary with the brand red", () => {
    expect(renderButton({ children: "Revisar ahora", variant: "primary" })).toHaveClass(
      "bg-cata-red",
    );
  });

  it("paints dark with coal, not red", () => {
    const button = renderButton({ children: "+ Nuevo miembro", variant: "dark" });
    expect(button).toHaveClass("bg-coal");
    expect(button).not.toHaveClass("bg-cata-red");
  });

  it("defaults to the secondary paper surface", () => {
    const button = renderButton({ children: "Ver todo" });
    expect(button).toHaveClass("bg-paper");
    expect(button).not.toHaveClass("bg-cata-red");
  });

  it("reserves red for primary alone", () => {
    // Red means "the one CTA" or "this is destructive". Any other variant
    // wearing it would dilute both meanings.
    for (const variant of ["secondary", "dark", "ghost"] as const) {
      expect(buttonClasses(variant)).not.toContain("bg-cata-red");
    }
    expect(buttonClasses("primary")).toContain("bg-cata-red");
  });
});

describe("Button — behavior", () => {
  it("defaults to type=button so it never submits a form by accident", () => {
    expect(renderButton({ children: "Cancelar" })).toHaveAttribute("type", "button");
  });

  it("honors an explicit submit type", () => {
    expect(renderButton({ children: "Entrar", type: "submit" })).toHaveAttribute(
      "type",
      "submit",
    );
  });

  it("calls onClick when pressed", () => {
    const onClick = vi.fn();
    fireEvent.click(renderButton({ children: "Guardar", onClick }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not call onClick while disabled", () => {
    const onClick = vi.fn();
    fireEvent.click(renderButton({ children: "Guardar", onClick, disabled: true }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("appends caller classes without dropping its own", () => {
    const button = renderButton({ children: "Guardar", className: "w-full" });
    expect(button).toHaveClass("w-full");
    expect(committedHeight(button)).toBe("40px");
  });
});

describe("buttonClasses", () => {
  it("gives anchors the same skin as the component", () => {
    render(
      <a href="/pagos" className={buttonClasses("primary")}>
        Revisar ahora
      </a>,
    );
    const link = screen.getByRole("link");
    expect(committedHeight(link)).toBe("40px");
    expect(link).toHaveClass("bg-cata-red");
  });
});
