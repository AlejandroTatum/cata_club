/**
 * AuthShell — the template all four public auth screens inherit.
 *
 * The authority for these screens is the login stage of
 * `docs/ux/prototipo-rediseno.html`, NOT the smaller `docs/ux/prototipos/`
 * login — EXCEPT for the two things the product owner overruled after seeing
 * the built screen. These tests pin both the overrides and the prototype
 * details that must survive them:
 *
 *  1. The composition FILLS THE VIEWPORT. It first shipped bounded at the
 *     prototype's `min-height:660px`, centred as an artboard, and was
 *     rejected: *"por qué el login no ocupa toda la pantalla"*. So there must
 *     be no max-width cap and no bounded min-height on the composition.
 *  2. The headline uses TYPOGRAPHIC DOUBLE QUOTES, never guillemets —
 *     *"esos signos de mayor y menor se ven muy mal"*.
 *  3. The headline is 42px on desktop / 30px on phones. It shipped at 21px —
 *     half its intended size — which is what made the screen read as broken.
 *  4. The coal panel is WIDER than the form panel (`flex:1.1` vs `flex:1`),
 *     not an equal half.
 *  5. The card carries the red "Panel de gestión" eyebrow, and the single
 *     figure is `yearsSinceFounding()` — a real, public, unauthenticated fact
 *     — rendered as an inline number + caption. It is NOT a student count: no
 *     endpoint an anonymous visitor can call returns one, and a fabricated
 *     figure is worse than no figure.
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import AuthShell, { AUTH_INPUT_CLASSES } from "@/components/auth/AuthShell";
import { yearsSinceFounding } from "@/app/landing/landing-config";

function renderShell(): void {
  render(
    <AuthShell title="Bienvenido de nuevo" subtitle="Inicie sesión para continuar" note="Nota">
      <button type="submit">Iniciar sesión</button>
    </AuthShell>,
  );
}

describe("AuthShell", () => {
  it("fills the viewport instead of floating as a bounded, centred artboard", () => {
    renderShell();

    const composition = screen.getByTestId("auth-composition");
    expect(composition.className).toContain("min-h-screen");
    expect(composition.className).toContain("w-full");
    // The rejected version capped the composition and bounded its height.
    expect(composition.className).not.toMatch(/max-w-\[\d+px\]/);
    expect(composition.className).not.toContain("min-h-[660px]");
  });

  it("renders the motto with typographic double quotes, never guillemets", () => {
    renderShell();

    const headline = screen.getByTestId("auth-headline");
    expect(headline.textContent).toContain("“");
    expect(headline.textContent).toContain("”");
    expect(headline.textContent).not.toContain("«");
    expect(headline.textContent).not.toContain("»");
  });

  it("renders the headline at 42px on desktop and 30px on phones", () => {
    renderShell();

    const headline = screen.getByTestId("auth-headline");
    expect(headline.className).toContain("min-[980px]:text-[42px]");
    expect(headline.className).toContain("text-[30px]");
    expect(headline.className).toContain("font-extrabold");
    expect(headline).toHaveTextContent("Formando");
  });

  it("makes the coal panel wider than the form panel, as flex:1.1 vs flex:1", () => {
    renderShell();

    expect(screen.getByTestId("auth-panel-dark").className).toContain("min-[980px]:flex-[1.1_1_0%]");
  });

  it("stacks the coal panel on phones instead of hiding it", () => {
    renderShell();

    // `@media (max-width:980px){ .auth{flex-direction:column} }` — the panel
    // moves above the form, so it must never carry a `hidden` base class.
    const dark = screen.getByTestId("auth-panel-dark");
    expect(dark.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(screen.getByTestId("auth-composition").className).toContain("min-[980px]:flex-row");
  });

  it("renders the red eyebrow the form card is headed by", () => {
    renderShell();

    const eyebrow = screen.getByText("Panel de gestión");
    expect(eyebrow.className).toContain("text-cata-red");
    expect(eyebrow.className).toContain("uppercase");
  });

  it("renders the single figure from the founding date, with its caption", () => {
    renderShell();

    const figure = screen.getByTestId("auth-figure");
    expect(figure).toHaveTextContent(String(yearsSinceFounding()));
    expect(screen.getByText("años formando deportistas")).toBeInTheDocument();
  });

  it("never claims a student count, which no public endpoint can produce", () => {
    renderShell();

    expect(screen.queryByText(/estudiantes inscritos/i)).not.toBeInTheDocument();
  });

  it("keeps the motto, the exit link and the card contents the four screens share", () => {
    renderShell();

    expect(screen.getByText(/Formando/)).toBeInTheDocument();
    expect(screen.getByText("campeones")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /volver al sitio/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Bienvenido de nuevo" })).toBeInTheDocument();
    expect(screen.getByText("Inicie sesión para continuar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Iniciar sesión" })).toBeInTheDocument();
    expect(screen.getByText("Nota")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The alignment defect: *"el login y la parte izquierda no están bien
// centradas, se ven desalineadas"*. Measured at 1440x900, the brand cluster
// centred at y=414 and the form card at y=398 — neither on the page's own
// 450 — because each half was centred inside its own leftover space. Both
// panels now run the same `1fr / auto / 1fr` grid, which puts the one object
// that matters in the auto row and forces the two rails equal, so both
// objects land on the viewport's middle. Geometry cannot be asserted in
// jsdom (no layout), so what is pinned here is the structure that produces
// it — the part a later edit could quietly undo.
// ---------------------------------------------------------------------------

describe("AuthShell — the two halves share one vertical axis", () => {
  it("centres the brand cluster with an elastic rail above and below it", () => {
    renderShell();

    const dark = screen.getByTestId("auth-panel-dark");
    expect(dark.className).toContain("grid-rows-[1fr_auto_1fr]");
    expect(screen.getByTestId("auth-brand-cluster").className).toContain("self-center");
  });

  it("centres the form card on the same axis, with its small print in the lower rail", () => {
    renderShell();

    const light = screen.getByTestId("auth-panel-light");
    expect(light.className).toContain("grid-rows-[1fr_auto_1fr]");
    // The card owns the auto row; the note and the assistant trigger hang
    // below it instead of dragging the card off-centre by their own height.
    expect(screen.getByTestId("auth-card").className).toContain("row-start-2");
    expect(screen.getByText("Nota").parentElement?.className).toContain("row-start-3");
  });

  it("closes the brand cluster with the figure rail instead of stranding it at the floor", () => {
    renderShell();

    // The figure used to pair with the copyright as a bottom rail, which left
    // a 194px hole between the subtitle and the hairline above it.
    const cluster = screen.getByTestId("auth-brand-cluster");
    expect(cluster).toContainElement(screen.getByTestId("auth-figure"));
    expect(cluster).not.toContainElement(screen.getByText(/© 2026 Cata Club/));
  });

  // WCAG 2.2 SC 2.5.8 — measured at 390x844 this escape hatch was
  // 101.8 x 19.5, i.e. a bare 13px line of type with no hit area of its own.
  it("gives the escape back to the public site a 24px-tall target", () => {
    renderShell();

    const back = screen.getByRole("link", { name: /volver al sitio/i });
    expect(back.className).toContain("min-h-[24px]");
    // Hit area only: the type and the 14px arrow are untouched.
    expect(back.className).toContain("text-[13px]");
  });

  it("does not restate a focus ring the system rule already outranks", () => {
    // `globals.css` paints the focus indicator from a 0,3,0 selector, which
    // beats Tailwind's 0,2,0 `focus:*` utilities. The `focus:ring-[3px]
    // focus:ring-cata-red/10` these fields carried never rendered — and at
    // 1.16:1 composited on paper it would have been decoration if it had.
    expect(AUTH_INPUT_CLASSES).not.toContain("focus:ring");
    // The border still darkens on focus: that is the field reacting, and it
    // is a real 5.00:1 state change, not an indicator.
    expect(AUTH_INPUT_CLASSES).toContain("focus:border-cata-red");
  });
});
