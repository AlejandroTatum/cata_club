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

  // Issue #1195: /login/activacion is reached by an authenticated visitor
  // enrolling a child, not by staff — "Panel de gestión" told them
  // otherwise, and it must stay the DEFAULT for the three screens that never
  // pass their own (this file's own `renderShell`, unchanged above).
  it("lets a caller override the eyebrow for a visitor-facing screen", () => {
    render(
      <AuthShell title="Verifique su correo" eyebrow="Acceso al club">
        <button type="submit">Continuar</button>
      </AuthShell>,
    );

    expect(screen.getByText("Acceso al club")).toBeInTheDocument();
    expect(screen.queryByText("Panel de gestión")).not.toBeInTheDocument();
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
    expect(title.className).toContain("text-xl");
    expect(title.className).toContain("split:text-2xl");
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
// Admin v4 composition. The old screen centred a 360px card on a grey canvas
// and floated the brand cluster in the middle of the coal: dead space on both
// halves at 1920x1080. Geometry cannot be asserted in jsdom, so what is pinned
// here is the structure that produces it — the part a later edit could undo.
// ---------------------------------------------------------------------------

describe("AuthShell — rebalanced split", () => {
  it("gives the brand panel 5/12 of the width and anchors its content top and bottom", () => {
    renderShell();

    const dark = screen.getByTestId("auth-panel-dark");
    expect(dark.className).toContain("split:w-5/12");
    expect(dark.className).toContain("justify-between");
    expect(dark.className).not.toContain("grid-rows-[1fr_auto_1fr]");
    expect(screen.getByRole("banner", { name: "Marca de Cata Club" }).className).toContain("justify-between");
  });

  it("gives the form its own column instead of a small card floating on grey", () => {
    renderShell();

    const light = screen.getByTestId("auth-panel-light");
    expect(light.className).toContain("bg-paper");
    expect(light.className).not.toContain("bg-canvas");
    const column = screen.getByTestId("auth-card");
    expect(column.className).toContain("max-w-md");
    expect(column.className).toContain("w-full");
    // No box around the form: the panel is the surface.
    expect(column.className).not.toMatch(/\b(border|shadow-hero|rounded-\[18px\])\b/);
  });

  it("keeps the form and the help footer in one column", () => {
    renderShell();

    const column = screen.getByTestId("auth-card").parentElement?.parentElement as HTMLElement;
    expect(column.className).toContain("max-w-md");
    expect(column).toContainElement(screen.getByTestId("auth-help"));
  });

  it("groups the small print under a hairline inside the form column", () => {
    renderShell();

    const note = screen.getByText("Nota");
    expect(screen.getByTestId("auth-card")).toContainElement(note);
    expect(note.className).toContain("border-t");
  });

  it("shows three public facts, the first being the club's age", () => {
    renderShell();

    const figure = screen.getByTestId("auth-figure");
    expect(figure).toHaveTextContent(String(yearsSinceFounding()));
    expect(screen.getByText("años formando deportistas")).toBeInTheDocument();
    expect(screen.getByText("Desde el 10 de octubre")).toBeInTheDocument();
    expect(screen.getByText("Loja")).toBeInTheDocument();
    expect(screen.getByTestId("auth-brand-cluster")).not.toContainElement(figure);
    expect(screen.getByRole("banner", { name: "Marca de Cata Club" })).toContainElement(figure);
  });

  it("collapses the brand panel to a compact header on phones", () => {
    renderShell();

    // Supporting line, facts and copyright only exist from `split` up.
    expect(screen.getByText(/Cada entrenamiento/).className).toContain("hidden");
    expect(screen.getByTestId("auth-figure").closest("dl")?.className).toContain("hidden");
    expect(screen.getByText(/© 2026 Cata Club/).closest("footer")?.className).toContain("hidden");
  });

  // WCAG 2.2 SC 2.5.8 — the escape is the system's own back control: 32px.
  it("gives the escape back to the public site the system's control height", () => {
    renderShell();

    const back = screen.getByRole("link", { name: /volver al inicio/i });
    expect(back.className).toContain("h-ctl-sm");
    expect(back.className).not.toContain("min-h-[24px]");
  });

  it("dresses that escape in the coal skin rather than a second bare link", () => {
    renderShell();

    const back = screen.getByRole("link", { name: /volver al inicio/i });
    expect(back).toHaveClass("bg-white/10", "text-white");
    expect(back).not.toHaveClass("bg-sunken");
  });

  it("keeps the escape in the top row's flow, with an at-rest hairline", () => {
    // Pinned absolutely it overlapped the lockup on a narrow phone.
    renderShell();

    const back = screen.getByRole("link", { name: /volver al inicio/i });
    expect(back.className).toContain("ring-white/20");
    expect(back.className).not.toContain("absolute");
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
// The brand measure. A `ch` cap resolves against the element's own font size
// and cannot know the viewport, so the cluster caps in rem and the motto keeps
// the voice step (a fluid clamp). Real geometry belongs to the browser tests.
// ---------------------------------------------------------------------------

describe("AuthShell — the brand measure", () => {
  it("caps the brand cluster in rem, never in ch", () => {
    renderShell();

    const cluster = screen.getByTestId("auth-brand-cluster");
    expect(cluster.className).toContain("split:max-w-md");
    expect(cluster.className).not.toMatch(/max-w-\[\d+(?:\.\d+)?ch\]/);
  });

  it("keeps every size on the type scale, with no loose pixel left in the panel", () => {
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

// ---------------------------------------------------------------------------
// `hideBack` (#1045) — the ONE screen that is not public.
//
// /login/activacion is the exception among the five screens this shell
// serves: the person on it is already authenticated. The exit control this
// file draws always names a step in the PUBLIC site (the landing, or
// /login), and neither is where an authenticated person stuck at a gate
// should go — landing leaves the session open behind them, and /login just
// bounces them straight back here. The card's own "Cerrar sesión" is the
// deliberate exit for that state, so this prop lets exactly that one screen
// opt out of the corner control instead of showing a destination that is
// wrong for it. It defaults to `false`, so the four public screens that
// never pass it keep the exact behaviour every test above already pins.
// ---------------------------------------------------------------------------

function renderHiddenBackShell(): void {
  render(
    <AuthShell title="Active su cuenta" hideBack>
      <button type="submit">Continuar</button>
    </AuthShell>,
  );
}

describe("AuthShell — hideBack lets one authenticated screen opt out", () => {
  it("still shows the exit by default, unchanged for the public screens", () => {
    renderShell();

    expect(screen.getByRole("link", { name: /volver al inicio/i })).toBeInTheDocument();
  });

  it("renders no back control at all when hideBack is set", () => {
    renderHiddenBackShell();

    expect(screen.queryByRole("link", { name: /volver/i })).not.toBeInTheDocument();
  });

  it("keeps the brand cluster and its landmark even with the exit hidden", () => {
    renderHiddenBackShell();

    expect(screen.getByRole("banner", { name: "Marca de Cata Club" })).toBeInTheDocument();
    expect(screen.getByTestId("auth-brand-cluster")).toBeInTheDocument();
  });

  it("fills the brand panel with a real club photo, decorative and behind the copy", () => {
    renderShell();

    const photo = screen.getByTestId("auth-photo");
    expect(screen.getByTestId("auth-panel-dark")).toContainElement(photo);
    const img = photo.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src") ?? "").toMatch(/gallery-12-team/);
    // The photo is atmosphere; the lockup is the panel's one accessible logo.
    expect(img).toHaveAttribute("alt", "");
    // Hidden on phones, so it must not be fetched eagerly.
    expect(img).not.toHaveAttribute("fetchpriority", "high");
    expect(photo.className).toContain("hidden");
  });

  it("no longer renders the big crest disc or the old watermark silhouette", () => {
    renderShell();

    expect(screen.queryByTestId("auth-crest")).not.toBeInTheDocument();
    expect(document.querySelector('img[src*="cata-club-crest"]')).toBeNull();
  });

  it("anchors the form column above a help footer", () => {
    renderShell();

    const help = screen.getByTestId("auth-help");
    expect(help).toHaveTextContent("¿Problemas para ingresar?");
    expect(screen.getByRole("link", { name: /whatsapp/i })).toHaveAttribute(
      "href",
      expect.stringContaining("wa.me/"),
    );
    expect(screen.getByTestId("auth-panel-light")).toContainElement(help);
  });
});

// ---------------------------------------------------------------------------
// QA registro: the "Escuela de tenis de mesa" pill is gone, the way back sits
// top-left of the coal panel and the original lockup (small crest + wordmark)
// sits in the opposite corner.
// ---------------------------------------------------------------------------

describe("AuthShell — QA registro layout", () => {
  it("no longer renders the 'Escuela de tenis de mesa' pill", () => {
    renderShell();

    expect(screen.queryByText(/escuela de tenis de mesa/i)).not.toBeInTheDocument();
  });

  it("puts the way back first in the banner, ahead of the lockup", () => {
    renderShell();

    const banner = screen.getByRole("banner", { name: "Marca de Cata Club" });
    const back = screen.getByRole("link", { name: /volver al inicio/i });
    const lockup = screen.getByTestId("auth-lockup");
    expect(back.compareDocumentPosition(lockup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(banner).toContainElement(lockup);
    expect(lockup).toHaveTextContent(/cata club/i);
  });

  it("keeps the lockup in the top row even when the way back is hidden", () => {
    renderHiddenBackShell();

    expect(screen.getByTestId("auth-lockup")).toBeInTheDocument();
  });

  it("keeps the original lockup: the small crest as the accessible logo beside the wordmark", () => {
    renderShell();

    const lockup = screen.getByTestId("auth-lockup");
    const logo = lockup.querySelector("img");
    expect(logo).toHaveAttribute("alt", "Cata Club");
    expect(logo?.getAttribute("src") ?? "").toMatch(/cata-club-logo/);
    expect(lockup).toHaveTextContent(/cata club/i);
    expect(screen.getAllByRole("img", { name: "Cata Club" })).toHaveLength(1);
  });
});
