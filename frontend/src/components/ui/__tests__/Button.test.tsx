/**
 * Button — the height contract is the reason this component exists, so it is
 * what these tests assert. The audit found `.btn-primary` shipping at four
 * distinct real heights because every caller re-derived it from padding.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Button, { buttonClasses, BUTTON_SIZES, BUTTON_VARIANTS } from "@/components/ui/Button";
import type { ButtonVariant } from "@/components/ui/Button";
import { committedHeight, committedRadius } from "./ui-test-utils";

/**
 * The variant list is READ from the component, never retyped here.
 *
 * It used to be spelled out as `["primary", "secondary", "dark", "tertiary"]`
 * in two separate loops, and `onCoal` — added later for the coal card — was in
 * neither. So the two sweeps that exist precisely to prove "every variant" held
 * the height and "no other variant is red" were, for one fifth of the system,
 * proving nothing. A hand-written list of a type's members is a list that stops
 * matching the type the day the type grows, and it does so silently.
 */
const NON_PRIMARY: ButtonVariant[] = BUTTON_VARIANTS.filter((variant) => variant !== "primary");

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

  /**
   * "Dos radios y nada más" (DESIGN.md, Shapes): the control radius says the
   * thing is a control, and the compact size is still a control. `sm` shipped
   * `rounded-lg` — 8px — which is a THIRD radius, and it was the only one in
   * the whole `ui/` folder. Nothing measured it, so every in-table action in
   * the product (the rows of `/groups`, `/discounts` and `/payments`) sat at
   * 8px next to 10px controls.
   */
  it("uses the same 10px control radius at every size", () => {
    for (const size of BUTTON_SIZES) {
      const { unmount } = render(<Button size={size}>Editar</Button>);
      expect(committedRadius(screen.getByRole("button"))).toBe("10px");
      unmount();
    }
  });

  it("holds its height for every variant", () => {
    for (const variant of BUTTON_VARIANTS) {
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
    // wearing it would dilute both meanings. The list comes from the type, so
    // a sixth variant is covered the moment it exists.
    for (const variant of NON_PRIMARY) {
      expect(buttonClasses(variant)).not.toContain("bg-cata-red");
    }
    expect(buttonClasses("primary")).toContain("bg-cata-red");
  });

  /**
   * The variant that the hand-written lists never reached. It is the secondary
   * action INSIDE a coal card, so what it must not do is put a light fill on a
   * dark surface — that reads as a second block competing with the card it
   * stands on, which is the reason `secondary` could not be used there.
   */
  it("paints onCoal as a translucent outline, never a filled surface", () => {
    const button = renderButton({ children: "Elegir otro horario", variant: "onCoal" });
    expect(button).toHaveClass("bg-transparent");
    expect(button).toHaveClass("text-white");
    expect(button).not.toHaveClass("bg-paper");
    expect(button).not.toHaveClass("bg-cata-red");
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
