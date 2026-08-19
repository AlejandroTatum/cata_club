/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { landingConfig, toWhatsAppLink, yearsSinceFounding } from "@/app/landing/landing-config";
import { GALLERY_PHOTOS } from "@/app/landing/landing-gallery";
import LandingPage from "@/app/landing/LandingPage";

vi.mock("next/image", (): { __esModule: boolean; default: (props: React.ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean; fill?: boolean }) => React.ReactElement } => ({
  __esModule: true,
  default: ({ priority, fill: _fill, sizes: _sizes, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean; fill?: boolean }): React.ReactElement => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt ?? ""} data-priority={priority ? "true" : undefined} {...props} />
  ),
}));

vi.mock("@/app/landing/LandingMap", (): { default: () => React.ReactElement } => ({
  default: (): React.ReactElement => <div aria-label="Mapa de ubicación de Cata Club" />,
}));

// `LandingMotion` (GSAP + Lenis) must load as a deferred, mockable module
// boundary rather than a plain synchronous import — that boundary is what the
// "progressive motion enhancement" suite below proves. `motionMount` fires
// exactly when the real component function runs, whether that happens inside
// a synchronous render (today) or only after a deferred `import()` resolves
// (once `LandingMotionLoader` exists).
const { motionMount } = vi.hoisted((): { motionMount: ReturnType<typeof vi.fn> } => ({
  motionMount: vi.fn(),
}));

vi.mock("@/app/landing/LandingMotion", (): { default: () => null } => ({
  default: (): null => {
    motionMount();
    return null;
  },
}));

interface MockedMediaQueryList extends MediaQueryList {
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

describe("LandingPage", (): void => {
  let reducedMotion = true;
  let matchMediaCalls: MockedMediaQueryList[] = [];

  beforeEach((): void => {
    reducedMotion = true;
    matchMediaCalls = [];
    motionMount.mockClear();
    vi.stubGlobal("ResizeObserver", class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    });
    vi.stubGlobal("matchMedia", vi.fn((query: string): MockedMediaQueryList => {
      const mql: MockedMediaQueryList = {
        matches: query === "(prefers-reduced-motion: reduce)" ? reducedMotion : !reducedMotion,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
      matchMediaCalls.push(mql);
      return mql;
    }));
  });

  afterEach((): void => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("draws exactly one main landmark, opening at the skip link's target", (): void => {
    // The landing reaches the user through no shell, so it declares its own.
    // `Navbar` and `Footer` stay outside it — the skip link exists to jump PAST
    // the nav, so a landmark that contained the nav would defeat it.
    const { container } = render(<LandingPage />);

    const landmarks = container.querySelectorAll("main");
    expect(landmarks).toHaveLength(1);

    const skipTarget = container.querySelector("#inicio") as HTMLElement;
    expect(landmarks[0].contains(skipTarget)).toBe(true);
    expect(landmarks[0].firstElementChild).toBe(skipTarget);

    const nav = container.querySelector("nav");
    expect(nav).not.toBeNull();
    expect(landmarks[0].contains(nav)).toBe(false);
  });

  it("renders every section in the approved order", (): void => {
    render(<LandingPage />);

    const headings = screen.getAllByRole("heading").map((heading): string | null => heading.textContent);
    expect(headings).toEqual(expect.arrayContaining([
      expect.stringMatching(/Formando campeones para la vida/i),
      "Misión y Visión",
      "Nuestros Valores",
      "Galería",
      "Horarios",
      "Ubicación",
    ]));
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });

  it("renders client-pending values from the centralized config", (): void => {
    render(<LandingPage />);

    expect(screen.getByText(landingConfig.schedules[0].hours)).toBeInTheDocument();
    expect(screen.getByText(landingConfig.contact.hours)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cata Club Loja" })).toHaveAttribute("href", landingConfig.contact.facebook);
    expect(screen.getByRole("link", { name: "@cataclub_tenis_de_mesa" })).toHaveAttribute("href", landingConfig.contact.instagram);
  });

  it("renders each configured schedule as its own card", (): void => {
    render(<LandingPage />);

    const scheduleSection = screen.getByRole("heading", { name: "Horarios" }).closest("section");
    expect(scheduleSection).not.toBeNull();
    const scheduleCards = Array.from(scheduleSection?.querySelectorAll("article") ?? []);
    expect(scheduleCards).toHaveLength(landingConfig.schedules.length);
    landingConfig.schedules.forEach((schedule, index): void => {
      expect(scheduleCards[index]).toHaveTextContent(schedule.category);
      expect(scheduleCards[index]).toHaveTextContent(schedule.audience);
      expect(scheduleCards[index]).toHaveTextContent(schedule.hours);
      expect(scheduleCards[index]).toHaveTextContent(schedule.days);
    });
  });

  it("points the hero's primary action at the live enrollment wizard", (): void => {
    render(<LandingPage />);

    const hero = document.querySelector(".landing-hero");
    expect(hero).not.toBeNull();
    const heroPrimary = within(hero as HTMLElement).getByRole("link", { name: /inscríbete/i });
    expect(heroPrimary).toHaveAttribute("href", "/student/enroll");
    expect(within(hero as HTMLElement).getByRole("link", { name: "Conoce el club" })).toHaveAttribute("href", "#nosotros");
  });

  it("never routes an enrollment CTA through the /register demo placeholder", (): void => {
    render(<LandingPage />);

    const enrollLinks = screen.getAllByRole("link", { name: /inscr/i });
    expect(enrollLinks.length).toBeGreaterThanOrEqual(3);
    enrollLinks.forEach((link): void => {
      expect(link).toHaveAttribute("href", "/student/enroll");
    });
    expect(document.querySelectorAll('a[href="/register"]')).toHaveLength(0);
  });

  it("keeps a single, visually demoted login entry point in the navbar", (): void => {
    render(<LandingPage />);

    const loginLinks = screen.getAllByText("ENTRAR").map((label): HTMLAnchorElement | null => label.closest("a"));
    expect(loginLinks).toHaveLength(1);
    expect(loginLinks[0]).toHaveAttribute("href", "/login");
    expect(loginLinks[0]?.className).toContain("landing-button-quiet");
    expect(loginLinks[0]?.className).not.toMatch(/(^|\s)landing-button(\s|$)/);
  });

  it("offers a mid-page enrollment CTA below the hero", (): void => {
    render(<LandingPage />);

    const motto = document.querySelector(".landing-motto");
    expect(motto).not.toBeNull();
    const mottoCta = within(motto as HTMLElement).getByRole("link");
    expect(mottoCta).toHaveAttribute("href", "/student/enroll");
  });

  it("turns every WhatsApp contact number into a wa.me link", (): void => {
    render(<LandingPage />);

    landingConfig.contact.whatsapp.forEach((number): void => {
      expect(screen.getByRole("link", { name: number })).toHaveAttribute("href", toWhatsAppLink(number));
    });
  });

  it("closes the contact card with a primary WhatsApp CTA and demotes the directions link", (): void => {
    render(<LandingPage />);

    const contact = document.querySelector(".landing-contact");
    expect(contact).not.toBeNull();

    const whatsappCta = within(contact as HTMLElement).getByRole("link", { name: /escríbenos por whatsapp/i });
    expect(whatsappCta).toHaveAttribute("href", toWhatsAppLink(landingConfig.contact.whatsapp[0]));
    expect(whatsappCta.className).toContain("landing-button");
    expect(contact?.lastElementChild).toBe(whatsappCta);

    const directions = within(contact as HTMLElement).getByRole("link", { name: /cómo llegar/i });
    expect(directions.className).toContain("landing-button-outline");
  });

  it("promotes the championship specifics into the visible gallery caption", (): void => {
    render(<LandingPage />);

    expect(screen.getByText(/Sudamericano Sub-11 y Sub-13/i)).toHaveTextContent("Asunción");
  });

  it("renders every configured photo as a carousel slide", (): void => {
    render(<LandingPage />);

    const slides = Array.from(document.querySelectorAll(".landing-slide"));
    expect(slides).toHaveLength(GALLERY_PHOTOS.length);
    GALLERY_PHOTOS.forEach((photo, index): void => {
      expect(slides[index].querySelector("img")).toHaveAttribute("src", photo.src);
      expect(slides[index].querySelector("img")).toHaveAttribute("alt", photo.alt);
      expect(slides[index].querySelector("figcaption")).toHaveTextContent(photo.caption);
    });
  });

  /**
   * The carousel is a progressive enhancement. The markup ships as a plain
   * scrollable strip so it stays usable before the motion layer loads, when JS
   * fails outright, and when the visitor prefers reduced motion — the script
   * only takes the track over once it is ready to drive it.
   */
  it("ships the carousel as a scrollable strip that works without the motion layer", (): void => {
    render(<LandingPage />);

    const track = document.querySelector(".landing-carousel");
    expect(track).not.toBeNull();
    expect(track).toHaveAttribute("data-carousel");
    expect(track?.className).not.toContain("is-enhanced");
  });

  it("exposes the active landing destination to assistive technology", (): void => {
    render(<LandingPage />);

    expect(screen.getByRole("link", { name: "Inicio" })).toHaveAttribute("aria-current", "page");
  });

  it("leaves the h1 free of a redundant aria-label", (): void => {
    render(<LandingPage />);

    expect(screen.getByRole("heading", { level: 1 })).not.toHaveAttribute("aria-label");
  });

  it("offers a skip link as the first focusable element", (): void => {
    render(<LandingPage />);

    const skipLink = screen.getByRole("link", { name: /saltar al contenido/i });
    expect(skipLink).toHaveAttribute("href", "#inicio");
    expect(document.querySelector(".landing-page")?.firstElementChild).toBe(skipLink);
  });

  it("reserves image priority for the LCP hero photo", (): void => {
    render(<LandingPage />);

    const prioritized = Array.from(document.querySelectorAll("img[data-priority='true']"));
    expect(prioritized).toHaveLength(1);
    expect(prioritized[0]).toHaveAttribute("src", "/landing/hero-action.jpeg");
  });

  /**
   * Fourteen carousel photos below the fold must not compete with the hero for
   * bandwidth, or the LCP image lands behind images nobody has scrolled to.
   */
  it("defers every carousel photo so it cannot delay the hero", (): void => {
    render(<LandingPage />);

    const slideImages = Array.from(document.querySelectorAll(".landing-slide img"));
    expect(slideImages.length).toBeGreaterThan(0);
    slideImages.forEach((image): void => {
      expect(image).toHaveAttribute("loading", "lazy");
    });
  });

  /**
   * The icon chips are gone on purpose. A 40x40 tinted square holding a generic
   * glyph is the visual signature of a bought template, and it was repeated six
   * times. Rank is now carried by an index, scale, and a single rule.
   */
  it("ranks the editorial blocks by index and typography rather than icon chips", (): void => {
    render(<LandingPage />);

    const blocks = Array.from(document.querySelectorAll(".landing-editorial-item"));
    expect(blocks).toHaveLength(2);
    expect(document.querySelectorAll(".landing-editorial-item svg")).toHaveLength(0);
    expect(blocks.map((block): string | null => block.querySelector(".landing-index")?.textContent ?? null))
      .toEqual(["01", "02"]);
  });

  it("numbers every value instead of giving it an icon", (): void => {
    render(<LandingPage />);

    const values = Array.from(document.querySelectorAll(".landing-value"));
    expect(values).toHaveLength(4);
    expect(document.querySelectorAll(".landing-value svg")).toHaveLength(0);
    expect(values.map((value): string | null => value.querySelector(".landing-index")?.textContent ?? null))
      .toEqual(["01", "02", "03", "04"]);
  });

  it("keeps each value's heading and description together in its own article", (): void => {
    render(<LandingPage />);

    const values = Array.from(document.querySelectorAll(".landing-value"));
    values.forEach((value): void => {
      expect(value.querySelector("h3")?.textContent).toBeTruthy();
      expect(value.querySelector("p")?.textContent).toBeTruthy();
    });
  });

  it("gives every footer service link its own destination", (): void => {
    render(<LandingPage />);

    const services = screen.getByRole("navigation", { name: "Servicios" });
    const hrefs = Array.from(services.querySelectorAll("a")).map((link): string | null => link.getAttribute("href"));
    expect(hrefs.length).toBeGreaterThan(0);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("derives the footer copyright year instead of hardcoding it", (): void => {
    render(<LandingPage />);

    expect(screen.getByText(new RegExp(`© ${new Date().getFullYear()}`))).toBeInTheDocument();
  });

  /**
   * Regression: the trust band read "0 — Años formando deportistas". The server
   * rendered the real 12, then the count-up seeded itself at 0 and overwrote
   * `textContent`, so a ScrollTrigger that never fired left 0 on screen. No
   * element may hand a figure to an animation that can show less than the truth.
   */
  it("renders the founding-years figure at its real value with motion enabled", (): void => {
    reducedMotion = false;

    render(<LandingPage />);

    const years = yearsSinceFounding();
    expect(years).toBeGreaterThan(0);
    const figure = screen.getByText("Años formando deportistas").parentElement?.querySelector("strong");
    expect(figure).toHaveTextContent(String(years));
    expect(figure).not.toHaveTextContent("0");
    expect(document.querySelectorAll("[data-counter]")).toHaveLength(0);
  });

  it("keeps reveal content in its final state when reduced motion is preferred", (): void => {
    reducedMotion = true;

    render(<LandingPage />);

    screen.getAllByTestId("motion-section").forEach((section): void => {
      expect(section).not.toHaveAttribute("aria-hidden", "true");
      expect(section).not.toHaveStyle({ opacity: "0" });
    });
  });

  /**
   * GSAP, its plugins, and Lenis must not sit on the landing's critical path
   * (issue #341): `LandingMotion` is a client boundary that only downloads
   * once the server-rendered page has already painted, and never at all when
   * the visitor prefers reduced motion — the server output already is that
   * reduced-motion end state (see `landing.css`: `[data-reveal]`,
   * `[data-split]`, `[data-hero-parallax]`, `[data-media-reveal]`, and
   * `[data-rule]` carry no hidden-by-default rule).
   */
  describe("progressive motion enhancement", (): void => {
    it("keeps the motion runtime out of the synchronous server render", (): void => {
      render(<LandingPage />);

      expect(motionMount).not.toHaveBeenCalled();
      // The content that must not wait on GSAP/Lenis is already there.
      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
      expect(screen.getAllByRole("link", { name: /inscr/i }).length).toBeGreaterThan(0);
      expect(document.querySelectorAll(".landing-slide")).toHaveLength(GALLERY_PHOTOS.length);
    });

    it("loads the motion runtime once the visitor does not prefer reduced motion", async (): Promise<void> => {
      reducedMotion = false;

      render(<LandingPage />);

      await waitFor((): void => {
        expect(motionMount).toHaveBeenCalledTimes(1);
      });
    });

    it("never imports the motion runtime when reduced motion is preferred", async (): Promise<void> => {
      reducedMotion = true;

      render(<LandingPage />);

      // Give any pending microtask an eager import would have scheduled a
      // bounded window to resolve — `waitFor` polls inside `act()`, so this
      // stays consistent with how React itself flushes updates — then
      // confirm it still never fired.
      await expect(
        waitFor((): void => { expect(motionMount).toHaveBeenCalled(); }, { timeout: 75 }),
      ).rejects.toThrow();
      expect(motionMount).not.toHaveBeenCalled();
    });

    it("removes its reduced-motion listener on unmount so a remount cannot double it up", async (): Promise<void> => {
      reducedMotion = false;

      const { unmount } = render(<LandingPage />);
      await waitFor((): void => {
        expect(motionMount).toHaveBeenCalledTimes(1);
      });

      const mql = matchMediaCalls.find((entry): boolean => entry.media === "(prefers-reduced-motion: reduce)");
      expect(mql).toBeDefined();
      expect(mql?.addEventListener).toHaveBeenCalledTimes(1);
      expect(mql?.addEventListener.mock.calls[0][0]).toBe("change");
      expect(mql?.removeEventListener).not.toHaveBeenCalled();

      unmount();

      expect(mql?.removeEventListener).toHaveBeenCalledTimes(1);
      expect(mql?.removeEventListener.mock.calls[0][1]).toBe(mql?.addEventListener.mock.calls[0][1]);
    });

    it("leaves a usable static page when the deferred motion import fails", async (): Promise<void> => {
      reducedMotion = false;
      const consoleError = vi.spyOn(console, "error").mockImplementation((): void => {});
      vi.resetModules();
      vi.doMock("@/app/landing/LandingMotion", (): never => {
        throw new Error("chunk load failed");
      });

      try {
        const { default: FreshLandingPage } = await import("@/app/landing/LandingPage");
        render(<FreshLandingPage />);

        await waitFor((): void => {
          expect(consoleError).toHaveBeenCalled();
        });
        expect(screen.getAllByRole("link", { name: /inscr/i }).length).toBeGreaterThan(0);
        expect(document.querySelectorAll(".landing-slide")).toHaveLength(GALLERY_PHOTOS.length);
      } finally {
        consoleError.mockRestore();
        vi.doUnmock("@/app/landing/LandingMotion");
        vi.resetModules();
      }
    });

    /**
     * Simulates JavaScript never running at all: `renderToStaticMarkup` never
     * commits, so no `useEffect` fires and no client bundle is evaluated —
     * this is the actual server output a visitor with JS disabled receives.
     */
    it("renders every key section from pure server output, with no client bundle involved", (): void => {
      const html = renderToStaticMarkup(<LandingPage />);

      expect(html).toMatch(/FORMANDO/);
      expect(html).toContain("Misión y Visión");
      expect(html).toContain("Horarios");
      expect(html).toContain(landingConfig.contact.hours);
      GALLERY_PHOTOS.forEach((photo): void => {
        expect(html).toContain(photo.caption);
      });
      expect(motionMount).not.toHaveBeenCalled();
    });
  });
});
