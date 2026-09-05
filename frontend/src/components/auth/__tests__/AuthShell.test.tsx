/**
 * AuthShell — the template all four public auth screens inherit.
 *
 * The authority for these screens is the login stage of
 * `docs/archive/prototypes/prototipo-rediseno.html`, NOT the smaller `docs/archive/prototypes/prototipos/`
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
 *  3. The motto is the club's VOICE — Playfair, on the `voice` step. It first
 *     shipped at 21px (half its intended size, which is what made the screen
 *     read as broken), was corrected to the 46px `display` step, and was still
 *     in the wrong FAMILY: Barlow ExtraBold is the interface face, and this
 *     line is the club talking. Its measure is re-derived from Playfair's own
 *     widths — see the measure block near the foot of this file.
 *  4. The coal panel is WIDER than the form panel (`flex:1.1` vs `flex:1`),
 *     not an equal half.
 *  5. The card is headed by the "Panel de gestión" eyebrow — no longer in red,
 *     which on this screen was one of six red elements competing with the one
 *     that was the action — and the single figure is `yearsSinceFounding()`, a
 *     real, public, unauthenticated fact rendered as an inline number +
 *     caption. It is NOT a student count: no endpoint an anonymous visitor can
 *     call returns one, and a fabricated figure is worse than no figure.
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
  it("draws exactly one main landmark, and it is the form panel", (): void => {
    // /login, /forgot-password and /reset-password reach the user through no
    // other shell, so if this component declares none the page has none. The
    // dark side is the brand rail; the errand is the form.
    renderShell();

    const landmarks = document.querySelectorAll("main");
    expect(landmarks).toHaveLength(1);
    expect(landmarks[0]).toHaveAttribute("data-testid", "auth-panel-light");
  });

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

  /**
   * This assertion changes families, and the reason is that the old one was
   * measuring the wrong thing correctly.
   *
   * It pinned the motto to `display`/`2xl` — the Graduate hero steps — because
   * the prototype wrote 42px and the scale's nearest neighbours were 46 and
   * 32. What nobody asked was which FACE. "Formando campeones para la vida" is
   * the club speaking in first person, which is the one job `DESIGN.md` gives
   * Playfair (*"la frase que el club le dice a la persona"*), and Playfair was
   * used in exactly zero files under `src/` — a whole brand family shipped,
   * loaded on every route, and spent nowhere. The motto was Barlow ExtraBold,
   * i.e. the interface face shouting.
   *
   * `font-normal` is not an oversight either: `playfair-display-600.woff2` is
   * a single 600 cut declared with no weight descriptor, so a CSS `600` makes
   * the browser synthesise a bold ON TOP of one that is already there and
   * thickens the strokes. `StatCard` learned the same lesson for Graduate.
   *
   * The size is now one fluid step instead of two fixed ones, which is why
   * there is no `split:` variant left to assert.
   */
  it("sets the motto in the club's own voice — Playfair, on the voice step", () => {
    renderShell();

    const headline = screen.getByTestId("auth-headline");
    expect(headline.className).toContain("font-serif");
    expect(headline.className).toContain("text-voice");
    expect(headline.className).not.toContain("font-extrabold");
    expect(headline.className).not.toContain("text-display");
    expect(headline).toHaveTextContent("Formando");
  });

  it("spends the voice exactly once on the screen", () => {
    // *"Playfair aparece una vez por pantalla. Una segunda frase en la misma
    // pantalla significa que ninguna de las dos es énfasis."*
    renderShell();

    expect(document.querySelectorAll(".font-serif")).toHaveLength(1);
  });

  /**
   * The eyebrow keeps its shape and loses its colour.
   *
   * `/login` had six red elements and exactly one of them was the action. The
   * rule of the single red is not about how many things may be red — it is
   * that red MEANS the action, and a screen where the eyebrow, two links, two
   * error lines and the submit button share one colour has no way left to say
   * which one to press. This label is a micro-label at 10.5px: it orients, it
   * cannot be pressed, and it was the loudest thing above the title.
   *
   * The two navigation links keep the red, because `DESIGN.md` gives it to
   * them by name (*"un enlace subrayado en rojo"*) — `LoginPage.test.tsx` holds
   * them to the underline that makes them read as links and to `red-dark`, the
   * only shade of it that passes AA as text.
   */
  it("heads the form card with a quiet eyebrow, not a red one competing with the action", () => {
    renderShell();

    const eyebrow = screen.getByText("Panel de gestión");
    expect(eyebrow.className).toContain("uppercase");
    expect(eyebrow.className).not.toContain("text-cata-red");
  });

  /**
   * The same defect `PageHeader` was fixed for, one screen over: an `<h1>` in
   * `font-extrabold` is Barlow, and Barlow is the interface face. This is the
   * title of a card on the first screen anybody sees, and Graduate is the club.
   *
   * `text-lg` rather than the 26px `xl` it used to take, and that is measured:
   * the card's content box is 236px, and "BIENVENIDO DE NUEVO" sets 241px wide
   * in Graduate at 20px — so it wraps to two balanced lines, where at 26px
   * (297px) it would wrap to two ragged ones. Uppercase Graduate runs ~35%
   * wider than Barlow at the same size, which is why the step goes DOWN while
   * the type gets louder on the page.
   */
  it("sets the card title in Graduate, at the card-title step", () => {
    renderShell();

    const title = screen.getByRole("heading", { name: "Bienvenido de nuevo" });
    expect(title.className).toContain("font-display");
    expect(title.className).toContain("text-lg");
    expect(title.className).toContain("uppercase");
    // One 400 cut — a weight class here asks the browser to fake a bold.
    expect(title.className).not.toMatch(/font-(bold|semibold|extrabold)/);
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
    // "Volver al sitio" was this screen's own name for a place the rail calls
    // "Inicio". D12b took the naming off the screen (see lib/destinations.ts).
    expect(screen.getAllByRole("link", { name: /volver al inicio/i }).length).toBeGreaterThan(0);
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
    // Placement, not just a class string: the string survived #931 unchanged
    // while `row-span-2` on the header collapsed the middle row to 0px
    // (#998). The header itself must own the middle row, same as the card
    // does on the light half.
    const banner = screen.getByRole("banner", { name: "Marca de Cata Club" });
    expect(banner.className).toContain("row-start-2");
    expect(banner.className).not.toContain("row-span-2");
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
  // It was padded out to a 24px minimum, and D12b then replaced the bare link
  // with the system's own back control: 32px, which is the product's compact
  // control height and clears 2.5.8 by 8px rather than by nothing.
  it("gives the escape back to the public site the system's control height", () => {
    renderShell();

    const back = screen.getByRole("link", { name: /volver al inicio/i });
    expect(back.className).toContain("h-ctl-sm");
    // The old floor is gone because it is no longer the binding number, not
    // because the target shrank.
    expect(back.className).not.toContain("min-h-[24px]");
  });

  it("dresses that escape in the coal skin rather than a second bare link", () => {
    // The defect D12b names: this screen carried the product's SECOND back
    // control — grey, boxless, under the system's control height — because the
    // light skin is unreadable on coal. One control, two tones.
    renderShell();

    const back = screen.getByRole("link", { name: /volver al inicio/i });
    expect(back).toHaveClass("bg-white/10", "text-white");
    expect(back).not.toHaveClass("bg-sunken");
  });

  // #1029 — `absolute left-0 top-0` sat the control flush against the
  // panel's (0,0), ignoring the panel's own padding, so on screens where the
  // coal panel reaches the viewport edge the exit hugged the SCREEN corner
  // and — with no border at rest — read as part of the background. The
  // offsets below ARE the panel's padding (`px-6 py-8` / `split:px-14
  // split:py-12`), so the control aligns with the panel's content column,
  // and the inset ring is the at-rest hairline that makes the box
  // discoverable before anyone hovers it. Same control, same href, same
  // derived label — one exit, easier to find.
  it("sits the escape inside the panel's padding with an at-rest hairline (#1029)", () => {
    renderShell();

    const back = screen.getByRole("link", { name: /volver al inicio/i });
    expect(back.className).toContain("left-6");
    expect(back.className).toContain("top-8");
    expect(back.className).toContain("split:left-14");
    expect(back.className).toContain("split:top-12");
    expect(back.className).toContain("ring-white/20");
    // The old flush-corner pinning is what this test retires.
    expect(back.className).not.toContain("left-0");
    expect(back.className).not.toContain("top-0");
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

// ---------------------------------------------------------------------------
// The dark rail's contents live in landmarks (#820). The way back, the brand
// cluster and the copyright used to sit outside every region a screen-reader
// user can jump to; they now ride in a named banner and a named contentinfo.
// The names are Spanish, like every user-facing label in the product
// ("Navegación principal", "Datos del club").
// ---------------------------------------------------------------------------

describe("AuthShell — the dark rail's contents live in landmarks", () => {
  it("holds the way back and the brand cluster in a named banner", () => {
    renderShell();

    const banner = screen.getByRole("banner", { name: "Marca de Cata Club" });
    expect(banner).toContainElement(screen.getByRole("link", { name: /volver al inicio/i }));
    expect(banner).toContainElement(screen.getByTestId("auth-brand-cluster"));
  });

  it("holds the copyright in a named contentinfo, outside the banner", () => {
    renderShell();

    const line = screen.getByText(/© 2026 Cata Club/);
    expect(screen.getByRole("contentinfo", { name: "Derechos de autor" })).toContainElement(line);
    expect(screen.getByRole("banner", { name: "Marca de Cata Club" })).not.toContainElement(line);
  });
});

// ---------------------------------------------------------------------------
// The frozen measure (#42).
//
// The brand block did not grow with the panel. Both caps that could have held
// it back were written in `ch`, which resolves against the element's OWN
// font-size and therefore cannot know how wide the viewport is:
//
//   wrapper  `max-width:44ch` at the inherited 16px -> a flat 440px
//   headline `max-w-[15ch]`   at the `display` step -> a flat 465px
//
// Measured in Chromium, the coal panel goes 749 -> 1000 -> 1336px across
// 1440/1920/2560 while the cluster stayed at 440 on all three, so it fell from
// 58.7% of the panel to 44.0% to 32.9%. The wrapper's 440px was the binding
// one; the headline's 465px was 25px looser and never bound anything on
// desktop, which is why the issue's reading of it as "the strangler" did not
// survive measurement.
//
// The real geometry is proved in `tests/e2e/content-measure.spec.ts`, where a
// browser can lay the page out. What is pinned here is the MECHANISM, i.e. the
// part a later edit could quietly revert: a fluid cap on the wrapper, and no
// `ch` cap on the headline above the `split` breakpoint.
// ---------------------------------------------------------------------------

describe("AuthShell — the brand measure tracks the panel", () => {
  it("caps the brand cluster with a fluid measure instead of a frozen ch count", () => {
    renderShell();

    const cluster = screen.getByTestId("auth-brand-cluster");
    // The percentage is what makes it track the panel; the two bounds are the
    // limits either side of which the composition breaks, and both were
    // RE-MEASURED when the motto changed face — Playfair sets a different
    // width per character than the Barlow ExtraBold these were calibrated
    // against, so carrying the old numbers over would have been an estimate
    // wearing a measurement's clothes.
    //
    // Measured in Chromium at 1440x900 against the shipped woff2: the motto is
    // 507px unbroken at the clamp's 31px ceiling, its natural first line is
    // 326px, and the supporting line under it is 350px. 22.5rem (360px) clears
    // the supporting line by 10px; 31rem (496px) stays 11px under the width at
    // which the motto collapses to one line.
    expect(cluster.className).toContain("max-w-[clamp(22.5rem,72%,31rem)]");
    // The frozen cap, in either spelling.
    expect(cluster.className).not.toContain("[max-width:44ch]");
    expect(cluster.className).not.toMatch(/max-w-\[\d+(?:\.\d+)?ch\]/);
  });

  it("drops the headline's own ch measure from the split breakpoint up", () => {
    renderShell();

    const headline = screen.getByTestId("auth-headline");
    // Phones keep a measure of their own, in rem rather than in `ch`: against
    // Playfair, `15ch` computes to ~150px and breaks the motto into four
    // lines. Measured at the clamp's 20px floor, the motto is 328px unbroken
    // and its first line 210px, so 16rem (256px) sets it on two inside a 342px
    // phone panel.
    expect(headline.className).toContain("max-w-[16rem]");
    expect(headline.className).not.toMatch(/max-w-\[\d+(?:\.\d+)?ch\]/);
    // Desktop has exactly one measure, and it belongs to the cluster. Leaving
    // the `ch` cap in place would re-clamp the motto to 465px and undo the
    // fluid wrapper above it.
    expect(headline.className).toContain("split:max-w-none");
  });

  it("keeps every size on the type scale, with no loose pixel left in the panel", () => {
    // #42 also asked for the Fase 1 scale to be applied here, against an
    // inventory of six raw sizes (42/26/14.5/13/12.5/12). #29 already did it:
    // the panel reads `display`, `2xl`, `xl`, `base`, `xs` and `2xs` and owns
    // no `text-[Npx]` at all. Asserted rather than assumed, so the panel cannot
    // drift back off the scale.
    renderShell();

    const dark = screen.getByTestId("auth-panel-dark");
    for (const node of [dark, ...Array.from(dark.querySelectorAll("*"))]) {
      expect(node.className.toString()).not.toMatch(/\btext-\[-?\d*\.?\d+(?:px|rem|em|pt)\]/);
    }
  });
});

// ---------------------------------------------------------------------------
// The exit names the screen's real previous step (#295)
//
// The control's destination was hardcoded to "/" in this component, and three
// screens inherit it — so /forgot-password and /reset-password both offered
// "Volver al Inicio" back to the public landing, when the step the user
// actually came from is /login. Worse, those two ALSO carried a second back
// control inside the card pointing at /login, so the screen contradicted
// itself.
//
// The destination is a prop now. It stays "/" by default, because /login is
// the one screen where the public site really is the previous step, and
// BackLink keeps deriving the label from the href (lib/destinations.ts) — so
// the sentence cannot disagree with where the control goes.
// ---------------------------------------------------------------------------

describe("AuthShell — the exit points at the previous step, not always at the site", () => {
  it("defaults to the public site, which is where /login came from", () => {
    renderShell();

    const back = screen.getByRole("link", { name: /volver al inicio/i });
    expect(back).toHaveAttribute("href", "/");
  });

  it("follows an explicit destination, and renames itself to match it", () => {
    render(
      <AuthShell title="Recuperar contraseña" backHref="/login">
        <button type="submit">Enviar</button>
      </AuthShell>,
    );

    const back = screen.getByRole("link", { name: /volver a iniciar sesión/i });
    expect(back).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("link", { name: /volver al inicio/i })).not.toBeInTheDocument();
  });

  it("keeps the coal skin whatever the destination is", () => {
    render(
      <AuthShell title="Recuperar contraseña" backHref="/login">
        <button type="submit">Enviar</button>
      </AuthShell>,
    );

    expect(screen.getByRole("link", { name: /volver a iniciar sesión/i })).toHaveClass(
      "bg-white/10",
      "text-white",
    );
  });
});
