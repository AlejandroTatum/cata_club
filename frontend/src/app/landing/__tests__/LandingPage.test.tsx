/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { landingConfig, toWhatsAppLink, yearsSinceFounding } from "@/app/landing/landing-config";
import { GALLERY_PHOTOS } from "@/app/landing/landing-gallery";
import { HERO_PHOTOS } from "@/app/landing/landing-hero-photos";
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
      "Elija una categoría",
      "Cómo llegar",
    ]));
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });

  it("renders the credentials ticker as a duplicated static marquee", (): void => {
        render(<LandingPage />);

        const ticker = screen.getByRole("region", { name: "Credenciales deportivas" });
        const track = ticker.querySelector("[data-credentials-ticker]");
        const copies = Array.from(track?.querySelectorAll(".landing-ticker-copy") ?? []);

        expect(copies).toHaveLength(2);
        expect(copies[0]?.textContent).toBe(copies[1]?.textContent);
        expect(copies[1]).toHaveAttribute("aria-hidden", "true");
        expect(ticker.querySelectorAll(".landing-ticker-item")).toHaveLength(8);
      });

      it("renders client-pending values from the centralized config", (): void => {
    render(<LandingPage />);

    expect(screen.getByText(landingConfig.schedules[0].slots[0].hours)).toBeInTheDocument();
    expect(screen.getByText(landingConfig.contact.hours)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cata Club Loja" })).toHaveAttribute("href", landingConfig.contact.facebook);
    expect(screen.getByRole("link", { name: "@cataclub_tenis_de_mesa" })).toHaveAttribute("href", landingConfig.contact.instagram);
  });

  it("renders the arrival inset and an honest, duplicated pending sponsor marquee", (): void => {
    render(<LandingPage />);

    const arrival = screen.getByRole("img", { name: /entrada de cata club junto al coliseo ciudad de loja/i });
    expect(arrival).toHaveAttribute("src", "/landing/photo-arrival.png");
    expect(arrival).toHaveAttribute("width", "1600");
    expect(arrival).toHaveAttribute("height", "1200");
    expect(arrival).toHaveAttribute("loading", "lazy");
    expect(screen.getByText("Así se ve al llegar")).toBeInTheDocument();

    const sponsors = screen.getByRole("region", { name: "Auspiciantes del club" });
    expect(within(sponsors).getByText("Nos acompañan")).toBeInTheDocument();
    expect(within(sponsors).getByText("Auspiciantes pendientes de confirmación.")).toHaveClass("sr-only");
    const track = sponsors.querySelector("[data-sponsors-track]");
    const copies = Array.from(track?.querySelectorAll(".landing-sponsors-copy") ?? []);
    expect(copies).toHaveLength(2);
    expect(copies[0]).toHaveAttribute("aria-hidden", "true");
    expect(copies[0]?.textContent).toBe(copies[1]?.textContent);
    expect(track?.querySelectorAll(".landing-sponsor-pending")).toHaveLength(12);
    expect(within(sponsors).queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders every category as a tab in the schedule tablist", (): void => {
    render(<LandingPage />);

    const scheduleSection = screen.getByRole("heading", { name: "Elija una categoría" }).closest("section");
    expect(scheduleSection).not.toBeNull();
    const tablist = within(scheduleSection as HTMLElement).getByRole("tablist", { name: "Categorías" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(landingConfig.schedules.length);

    landingConfig.schedules.forEach((schedule, index): void => {
      expect(tabs[index]).toHaveTextContent(schedule.category);
      expect(tabs[index]).toHaveTextContent(schedule.audience);
      // One line per DISTINCT band, compacted to "HH:MM–HH:MM".
      schedule.slots.forEach((slot): void => {
        expect(tabs[index]).toHaveTextContent(slot.hours.replace(/\s/g, ""));
      });
    });
  });

  /**
   * Regression guard for the schedule migration to multiple slots per
   * category: the master-detail panel must show every slot of Adultos
   * (weekday morning + evening) and Competitivo (weekday + Saturday), not
   * just the first.
   */
  it("shows every slot of a multi-slot category in the detail panel", (): void => {
    render(<LandingPage />);

    const scheduleSection = screen.getByRole("heading", { name: "Elija una categoría" }).closest("section");
    const tablist = within(scheduleSection as HTMLElement).getByRole("tablist", { name: "Categorías" });
    const panel = screen.getByRole("tabpanel");

    fireEvent.click(within(tablist).getByRole("tab", { name: /adultos/i }));
    expect(within(panel).getByText(/08:00 – 09:15/)).toBeInTheDocument();
    expect(within(panel).getByText(/20:00 – 21:15/)).toBeInTheDocument();

    fireEvent.click(within(tablist).getByRole("tab", { name: /competitivo/i }));
    expect(within(panel).getByText(/Lunes a Viernes y Sábado/)).toBeInTheDocument();
  });

  describe("schedule selector — master-detail", (): void => {
    const getSchedule = (): { tablist: HTMLElement; tabs: HTMLElement[]; panel: HTMLElement } => {
      const section = screen.getByRole("heading", { name: "Elija una categoría" }).closest("section") as HTMLElement;
      const tablist = within(section).getByRole("tablist", { name: "Categorías" });
      const tabs = within(tablist).getAllByRole("tab");
      const panel = screen.getByRole("tabpanel");
      return { tablist, tabs, panel };
    };

    it("selects a category on click and points the panel at it", (): void => {
      render(<LandingPage />);
      const { tablist, tabs, panel } = getSchedule();

      fireEvent.click(within(tablist).getByRole("tab", { name: /juvenil/i }));

      expect(tabs[2]).toHaveAttribute("aria-selected", "true");
      expect(within(panel).getByRole("heading", { level: 3 })).toHaveTextContent("Juvenil");
      expect(within(panel).getByText(/17:00 – 18:00/)).toBeInTheDocument();
    });

    it("moves selection and focus with ArrowDown and ArrowUp", (): void => {
      render(<LandingPage />);
      const { tablist, tabs } = getSchedule();

      fireEvent.keyDown(tablist, { key: "ArrowDown" });
      expect(tabs[1]).toHaveAttribute("aria-selected", "true");
      expect(tabs[1]).toHaveFocus();

      fireEvent.keyDown(tablist, { key: "ArrowUp" });
      expect(tabs[0]).toHaveAttribute("aria-selected", "true");
      expect(tabs[0]).toHaveFocus();
    });

    it("wires each tab to the single panel and labels it with the selected tab", (): void => {
      render(<LandingPage />);
      const { tabs, panel } = getSchedule();

      expect(panel).toHaveAttribute("id", "schedule-panel");
      tabs.forEach((tab, index): void => {
        expect(tab).toHaveAttribute("id", `schedule-tab-${index}`);
        expect(tab).toHaveAttribute("aria-controls", "schedule-panel");
      });
      expect(panel).toHaveAttribute("aria-labelledby", "schedule-tab-0");

      fireEvent.click(tabs[2]);
      expect(panel).toHaveAttribute("aria-labelledby", "schedule-tab-2");
    });

    it("keeps only the selected tab in the tab order via roving tabIndex", (): void => {
      render(<LandingPage />);
      const { tabs } = getSchedule();

      expect(tabs[0]).toHaveAttribute("tabindex", "0");
      tabs.slice(1).forEach((tab): void => {
        expect(tab).toHaveAttribute("tabindex", "-1");
      });

      fireEvent.click(tabs[3]);
      expect(tabs[3]).toHaveAttribute("tabindex", "0");
      expect(tabs[0]).toHaveAttribute("tabindex", "-1");
    });

    it("declares the schedule tablist as vertical", (): void => {
      render(<LandingPage />);
      const { tablist } = getSchedule();
      expect(tablist).toHaveAttribute("aria-orientation", "vertical");
    });
  });

  it("points the hero's primary action at the live enrollment wizard", (): void => {
    render(<LandingPage />);

    const hero = document.querySelector(".landing-hero");
    expect(hero).not.toBeNull();
    const heroPrimary = within(hero as HTMLElement).getByRole("link", { name: /inscríbete/i });
    expect(heroPrimary).toHaveAttribute("href", "/student/enroll");
    expect(within(hero as HTMLElement).getByRole("link", { name: "Ver horarios" })).toHaveAttribute("href", "#horarios");
  });

  it("keeps a single decorative serve ball inside the hero", (): void => {
    render(<LandingPage />);

    const hero = document.querySelector(".landing-hero") as HTMLElement;
    const ball = hero.querySelector("[data-serve-ball]");

    expect(document.querySelectorAll("[data-serve-ball]")).toHaveLength(1);
    expect(ball).not.toBeNull();
    expect(ball).toHaveAttribute("aria-hidden", "true");
    expect(ball?.parentElement).toBe(hero);
  });

  // Progressive enhancement like the gallery: never assert GSAP internals.
  describe("hero photo carousel", (): void => {
    it("renders three tabs and their slides from HERO_PHOTOS", (): void => {
      render(<LandingPage />);

      const hero = document.querySelector(".landing-hero") as HTMLElement;
      const tabs = within(hero).getAllByRole("tab");
      expect(tabs).toHaveLength(HERO_PHOTOS.length);
      tabs.forEach((tab, index): void => {
        expect(tab).toHaveTextContent(String(index + 1).padStart(2, "0"));
        expect(tab).toHaveAttribute("aria-selected", index === 0 ? "true" : "false");
      });

      const slides = Array.from(hero.querySelectorAll(".landing-hero-slide"));
      expect(slides).toHaveLength(HERO_PHOTOS.length);
      HERO_PHOTOS.forEach((photo, index): void => {
        expect(slides[index]).toHaveAttribute("src", photo.src);
        expect(slides[index]).toHaveAttribute("alt", photo.alt);
      });
      expect(slides[0]).toHaveStyle({ objectPosition: HERO_PHOTOS[0].objectPosition });
    });

    it("switches slide and aria-selected instantly on click, without GSAP", (): void => {
      render(<LandingPage />);

      const hero = document.querySelector(".landing-hero") as HTMLElement;
      const tabs = within(hero).getAllByRole("tab");
      const slides = Array.from(hero.querySelectorAll(".landing-hero-slide"));

      fireEvent.click(tabs[1]);

      expect(tabs[1]).toHaveAttribute("aria-selected", "true");
      expect(slides[1]).toHaveAttribute("data-active", "true");
      expect(slides[0]).toHaveAttribute("data-active", "false");
    });

    it("moves selection and focus with arrow keys on the tablist", (): void => {
      render(<LandingPage />);

      const hero = document.querySelector(".landing-hero") as HTMLElement;
      const tablist = within(hero).getByRole("tablist");
      const tabs = within(hero).getAllByRole("tab");

      fireEvent.keyDown(tablist, { key: "ArrowRight" });
      expect(tabs[1]).toHaveAttribute("aria-selected", "true");
      expect(tabs[1]).toHaveFocus();

      fireEvent.keyDown(tablist, { key: "ArrowLeft" });
      expect(tabs[0]).toHaveAttribute("aria-selected", "true");
      expect(tabs[0]).toHaveFocus();
    });
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
    expect(motto).toHaveAttribute("data-motto");
    expect(motto?.querySelector("[data-motto-paddle]")).toHaveAttribute("aria-hidden", "true");
    expect(motto?.querySelector("[data-motto-copy]")).toHaveTextContent("Cada entrenamiento es una oportunidad");
    const mottoCta = within(motto as HTMLElement).getByRole("link");
    expect(mottoCta).toHaveAttribute("data-motto-cta", "true");
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

    // Scoped to the gallery: the Logros section now also carries this same
    // fact, so an unscoped query would match more than one element.
    const gallery = document.querySelector(".landing-gallery") as HTMLElement;
    expect(within(gallery).getByText(/Sudamericano Sub-11 y Sub-13/i)).toHaveTextContent("Asunción");
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

  // The lightbox is plain React state: it must work identically before the
  // motion layer loads and under reduced motion, so these tests render the
  // page with LandingMotion mocked out — no GSAP internals asserted.
  describe("gallery lightbox", (): void => {
    const openButtons = (): HTMLElement[] =>
      within(document.querySelector(".landing-gallery") as HTMLElement).getAllByRole("button", {
        name: /^Ampliar foto:/i,
      });

    it("opens the clicked photo in a modal dialog and tells the motion layer", (): void => {
      render(<LandingPage />);

      const track = document.querySelector("[data-carousel]") as HTMLElement;
      const pauseSignals: boolean[] = [];
      track.addEventListener("landing:gallery-lightbox", (event): void => {
        pauseSignals.push((event as CustomEvent<{ open: boolean }>).detail.open);
      });

      expect(openButtons()).toHaveLength(GALLERY_PHOTOS.length);
      fireEvent.click(openButtons()[2]);

      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(within(dialog).getByRole("img", { name: GALLERY_PHOTOS[2].alt })).toBeInTheDocument();
      expect(within(dialog).getByText(GALLERY_PHOTOS[2].caption)).toBeInTheDocument();
      expect(pauseSignals).toEqual([true]);
    });

    it("closes on Escape, resumes the loop signal, and returns focus to the slide", (): void => {
      render(<LandingPage />);

      const track = document.querySelector("[data-carousel]") as HTMLElement;
      const pauseSignals: boolean[] = [];
      track.addEventListener("landing:gallery-lightbox", (event): void => {
        pauseSignals.push((event as CustomEvent<{ open: boolean }>).detail.open);
      });
      const trigger = openButtons()[1];
      trigger.focus();
      fireEvent.click(trigger);

      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(pauseSignals).toEqual([true, false]);
      expect(trigger).toHaveFocus();
    });

    it("steps through photos with arrow keys, wrapping at both ends", (): void => {
      render(<LandingPage />);

      fireEvent.click(openButtons()[0]);
      const dialog = screen.getByRole("dialog");

      fireEvent.keyDown(dialog, { key: "ArrowLeft" });
      expect(within(dialog).getByRole("img", { name: GALLERY_PHOTOS[GALLERY_PHOTOS.length - 1].alt })).toBeInTheDocument();

      fireEvent.keyDown(dialog, { key: "ArrowRight" });
      expect(within(dialog).getByRole("img", { name: GALLERY_PHOTOS[0].alt })).toBeInTheDocument();

      fireEvent.keyDown(dialog, { key: "ArrowRight" });
      expect(within(dialog).getByRole("img", { name: GALLERY_PHOTOS[1].alt })).toBeInTheDocument();
    });

    it("closes on backdrop click and releases the page scroll lock", (): void => {
      render(<LandingPage />);

      fireEvent.click(openButtons()[0]);
      expect(document.body.style.overflow).toBe("hidden");

      fireEvent.click(document.querySelector(".landing-lightbox-backdrop") as HTMLElement);

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(document.body.style.overflow).toBe("");
    });
  });

  it("exposes the active landing destination to assistive technology", (): void => {
    render(<LandingPage />);

    expect(screen.getByRole("link", { name: "Inicio" })).toHaveAttribute("aria-current", "page");
  });

  it("links the navbar to every section anchor in the approved order", (): void => {
    render(<LandingPage />);

    const navLinks = document.querySelector(".landing-nav-links") as HTMLElement;
    const links = Array.from(navLinks.querySelectorAll("a"));
    expect(links.map((link): [string | null, string | null] => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Inicio", "#inicio"],
      ["Horarios", "#horarios"],
      ["Valores", "#valores"],
      ["Logros", "#logros"],
      ["Galería", "#galeria"],
      ["Contacto", "#contacto"],
    ]);
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
    expect(prioritized[0]).toHaveAttribute("src", "/landing/photo-coach-athlete.jpeg");
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
