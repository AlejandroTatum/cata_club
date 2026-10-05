/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { CLUB_PLUS_CODE, clubOpenStreetMapUrl } from "@/app/landing/club-location";
import { deriveContactHours, landingConfig, toWhatsAppLink, yearsSinceFounding } from "@/app/landing/landing-config";
import { HERO_PHOTOS } from "@/app/landing/landing-hero-photos";
import { mapPublicSchedules } from "@/app/landing/schedule-data";
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
const { motionMount } = vi.hoisted((): { motionMount: Mock<() => void> } => ({
  motionMount: vi.fn(),
}));

vi.mock("@/app/landing/LandingMotion", (): { default: () => null } => ({
  default: (): null => {
    motionMount();
    return null;
  },
}));

interface MockedMediaQueryList extends MediaQueryList {
  addEventListener: Mock;
  removeEventListener: Mock;
}

/**
 * The published catalog exactly as `GET /api/schedules` hands it over — the
 * only source the page has for schedules (issue #789). `ages` is the optional
 * orientation label the backend added in #913; `Juego Libre` deliberately
 * publishes none, because a category without an age label is a legitimate
 * state and the page must render it without inventing one.
 */
const publicSchedulePayload = [
  { category: "Formativo", ages: "5 a 10 años", blocks: [{ days: ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES"], startTime: "15:00", endTime: "16:00" }] },
  { category: "Infantil", ages: "8 a 12 años", blocks: [{ days: ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES"], startTime: "16:00", endTime: "17:00" }] },
  { category: "Juvenil", ages: "Mayores de 12 años", blocks: [{ days: ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES"], startTime: "17:00", endTime: "18:00" }] },
  { category: "Competitivo", ages: "Selección", blocks: [{ days: ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES"], startTime: "18:00", endTime: "20:00" }, { days: ["SABADO"], startTime: "18:00", endTime: "20:00" }] },
  { category: "Adultos", ages: "Mayores de 18 años", blocks: [{ days: ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES"], startTime: "08:00", endTime: "09:15" }, { days: ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES"], startTime: "20:00", endTime: "21:15" }] },
  { category: "Juego Libre", ages: null, blocks: [{ days: ["SABADO"], startTime: "15:00", endTime: "18:00" }] },
];

/**
 * What the page itself derives from that payload. Every expectation below is
 * read from here rather than from a second list written out by hand: the
 * point of #789 is that there is exactly one statement of the club's
 * schedules, and a test carrying its own copy would quietly reintroduce it.
 */
const PUBLISHED = mapPublicSchedules(publicSchedulePayload);

function scheduleFetchCalls(): unknown[] {
  return vi.mocked(globalThis.fetch).mock.calls.filter(([input]): boolean =>
    String(input).includes("/api/schedules"));
}

/** The contact sheet's `Horario` row — label and value, whatever it says. */
function contactHoursRow(): HTMLElement {
  const sheet = document.querySelector(".landing-contact") as HTMLElement;
  return within(sheet).getByText("Horario").closest(".landing-contact-row") as HTMLElement;
}

/** The gallery section — the one the public navbar's "Galería" anchor names. */
function gallerySection(): HTMLElement {
  return document.querySelector("#galeria") as HTMLElement;
}

/**
 * What GET /api/galeria answers for the current test. `[]` is the gallery's
 * real initial state — the club publishes entries from /galeria — and every
 * test below starts from it unless it deliberately publishes photos.
 */
let galleryPayload: unknown = [];

/** Publishes the payload GET /api/galeria answers with. */
function publishGallery(payload: unknown): void {
  galleryPayload = payload;
}

describe("LandingPage", (): void => {
  let reducedMotion = true;
  let matchMediaCalls: MockedMediaQueryList[] = [];

  beforeEach((): void => {
    reducedMotion = true;
    matchMediaCalls = [];
    galleryPayload = [];
    motionMount.mockClear();
    // The sponsor strip is now data-driven: it calls public GET /api/sponsors on mount.
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL): Promise<{ ok: boolean; json: () => Promise<unknown> }> => {
          const url = String(input);
          return Promise.resolve({ ok: true, json: async (): Promise<unknown> => url.includes("/api/schedules") ? publicSchedulePayload : url.includes("/api/galeria") ? galleryPayload : [] });
        }));
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
    vi.useRealTimers();
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
      "Elige una categoría",
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

      it("renders client-pending values from the centralized config", async (): Promise<void> => {
    render(<LandingPage />);

    await waitFor((): void => { expect(screen.getByRole("list", { name: "Categorías" })).toBeInTheDocument(); });
    expect(within(contactHoursRow()).getByText(deriveContactHours(PUBLISHED))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cata Club Loja" })).toHaveAttribute("href", landingConfig.contact.facebook);
    expect(screen.getByRole("link", { name: "@cataclub_tenis_de_mesa" })).toHaveAttribute("href", landingConfig.contact.instagram);
  });

  /**
   * Issue #789. The club edits its schedules in the app; the section and the
   * contact card are two views of that same published catalog. Before this,
   * the card advertised a range derived at build time from a hand-written
   * list nobody could edit, so the club could publish a new evening block and
   * the card would keep promising the old closing time forever.
   */
  describe("the published catalog is the page's only schedule source (issue #789)", (): void => {
    it("derives the contact card's opening hours from the schedules it just fetched", async (): Promise<void> => {
      render(<LandingPage />);

      await waitFor((): void => {
        expect(within(contactHoursRow()).getByText(deriveContactHours(PUBLISHED))).toBeInTheDocument();
      });
      // Not a coincidence of the fixture: the range spans the earliest start
      // and the latest end of everything the API published, Saturday included.
      expect(contactHoursRow()).toHaveTextContent("Lun – Sáb · 08:00 – 21:15");
      // A settled row states hours; it is not a live region announcing them.
      expect(within(contactHoursRow()).queryByRole("status")).not.toBeInTheDocument();
    });

    it("asks the API for the catalog exactly once for the whole page", async (): Promise<void> => {
      render(<LandingPage />);

      await waitFor((): void => {
        expect(within(contactHoursRow()).getByText(deriveContactHours(PUBLISHED))).toBeInTheDocument();
      });
      // Two fetches would be two answers, and two chances to disagree — the
      // divergence this issue closes. One request feeds both views.
      expect(scheduleFetchCalls()).toHaveLength(1);
    });

    it("moves the contact hours when the club publishes a different catalog", async (): Promise<void> => {
      vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL): Promise<{ ok: boolean; json: () => Promise<unknown> }> => {
        const url = String(input);
        return Promise.resolve({
          ok: true,
          json: async (): Promise<unknown> => url.includes("/api/schedules")
            ? [{ category: "Nocturno", ages: null, blocks: [{ days: ["LUNES", "MIERCOLES"], startTime: "19:00", endTime: "22:30" }] }]
            : [],
        });
      }));

      render(<LandingPage />);

      await waitFor((): void => {
        expect(contactHoursRow()).toHaveTextContent("Lun – Vie · 19:00 – 22:30");
      });
      expect(contactHoursRow()).not.toHaveTextContent("08:00");
    });

    it("shows the audience label only for the categories that publish one", async (): Promise<void> => {
      render(<LandingPage />);

      const section = screen.getByRole("heading", { name: "Elige una categoría" }).closest("section") as HTMLElement;
      await waitFor((): void => { expect(within(section).getByRole("list", { name: "Categorías" })).toBeInTheDocument(); });
      const cardOf = (name: string): HTMLElement => within(section).getByRole("heading", { level: 3, name }).closest("li") as HTMLElement;

      expect(within(cardOf("Formativo")).getByText("5 a 10 años")).toBeInTheDocument();

      // `ages: null` is a legitimate state: the fact disappears, and nothing
      // is invented to fill it.
      expect(cardOf("Juego Libre").querySelector(".landing-schedule-ages")).not.toBeInTheDocument();
    });

    it("says the club has published nothing yet, in both views, when the catalog is empty", async (): Promise<void> => {
      vi.stubGlobal("fetch", vi.fn((): Promise<{ ok: boolean; json: () => Promise<unknown> }> =>
        Promise.resolve({ ok: true, json: async (): Promise<unknown> => [] })));

      render(<LandingPage />);

      await waitFor((): void => {
        expect(contactHoursRow()).toHaveTextContent("Aún no hay horarios publicados.");
      });
      const section = screen.getByRole("heading", { name: "Elige una categoría" }).closest("section") as HTMLElement;
      expect(within(section).getByRole("status")).toHaveTextContent("Aún no hay horarios publicados.");
      // The row keeps its label and becomes a live region, so the visitor is
      // told what happened instead of reading a range nobody published.
      expect(within(contactHoursRow()).getByRole("status")).toHaveTextContent(/Aún no hay horarios|No se pudieron/);
      expect(contactHoursRow()).toHaveTextContent("Horario");
      expect(within(section).queryByRole("list", { name: "Categorías" })).not.toBeInTheDocument();
    });

    it("says the hours could not be loaded, in both views, when the BFF degrades to 503", async (): Promise<void> => {
      vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL): Promise<{ ok: boolean; status?: number; json: () => Promise<unknown> }> => {
        const url = String(input);
        if (url.includes("/api/schedules")) {
          return Promise.resolve({ ok: false, status: 503, json: async (): Promise<unknown> => ({ message: "No se pudieron cargar los horarios." }) });
        }
        return Promise.resolve({ ok: true, json: async (): Promise<unknown> => [] });
      }));

      render(<LandingPage />);

      await waitFor((): void => {
        expect(contactHoursRow()).toHaveTextContent("No se pudieron cargar los horarios.");
      });
      const section = screen.getByRole("heading", { name: "Elige una categoría" }).closest("section") as HTMLElement;
      expect(within(section).getByRole("status")).toHaveTextContent("No se pudieron cargar los horarios.");
      expect(within(contactHoursRow()).getByRole("status")).toHaveTextContent(/Aún no hay horarios|No se pudieron/);
    });

    it("invents no hours when the catalog arrives malformed", async (): Promise<void> => {
      vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL): Promise<{ ok: boolean; json: () => Promise<unknown> }> => {
        const url = String(input);
        return Promise.resolve({
          ok: true,
          json: async (): Promise<unknown> => url.includes("/api/schedules")
            ? [{ category: "Roto", blocks: [{ days: ["UNKNOWN"], startTime: "x", endTime: "y" }] }]
            : [],
        });
      }));

      render(<LandingPage />);

      await waitFor((): void => {
        expect(contactHoursRow()).toHaveTextContent("Aún no hay horarios publicados.");
      });
      // Nothing survived mapping, so nothing is stated: no range, no leftover
      // category name from a list that no longer exists.
      expect(contactHoursRow()).not.toHaveTextContent(/\d{1,2}:\d{2}/);
      expect(screen.queryByRole("list", { name: "Categorías" })).not.toBeInTheDocument();
    });
  });

  it("renders the arrival photo beside the map, ahead of the contact sheet", (): void => {
    render(<LandingPage />);

    const arrival = screen.getByRole("img", { name: /entrada de cata club/i });
    expect(arrival).toHaveAttribute("src", "/landing/photo-arrival.jpeg");
    expect(arrival).toHaveAttribute("width", "1600");
    expect(arrival).toHaveAttribute("height", "1200");
    expect(arrival).toHaveAttribute("loading", "lazy");
    expect(screen.getByText("Así se ve al llegar")).toBeInTheDocument();
    const visit = arrival.closest(".landing-visit");
    expect(visit?.firstElementChild).toBe(arrival.closest(".landing-arrival"));
    expect(visit?.querySelector(".landing-map-stage")).not.toBeNull();
    expect(visit?.nextElementSibling).toBe(document.querySelector(".landing-contact"));
  });

  it("renders Mission and Vision as two typographic pillars, each with its own photo (v2 redesign)", (): void => {
    render(<LandingPage />);

    const missionItem = screen.getByRole("heading", { name: "Nuestra Misión" }).closest(".landing-pillar");
    const visionItem = screen.getByRole("heading", { name: "Nuestra Visión" }).closest(".landing-pillar");
    expect(missionItem).not.toBeNull();
    expect(visionItem).not.toBeNull();

    const section = document.querySelector("#nosotros") as HTMLElement;
    const photos = within(section).getAllByRole("img");
    expect(photos).toHaveLength(2);
    photos.forEach((photo): void => { expect(photo).toHaveClass("landing-pillar-photo"); });
    expect(within(missionItem as HTMLElement).getByRole("img")).toHaveAttribute("src", "/landing/mission-focus.jpeg");
    expect(within(visionItem as HTMLElement).getByRole("img")).toHaveAttribute("src", "/landing/vision-coaching.jpeg");

    expect(within(missionItem as HTMLElement).getByText(
      "Promover el tenis de mesa mediante formación deportiva de calidad.",
    )).toHaveClass("landing-lead");
    expect(within(missionItem as HTMLElement).getByText(
      "Fomentamos el desarrollo integral de niños, jóvenes y adultos con valores, disciplina y excelencia competitiva.",
    )).toBeInTheDocument();
    expect(within(visionItem as HTMLElement).getByText(
      "Ser un club líder y referente deportivo a nivel provincial y nacional.",
    )).toHaveClass("landing-lead");
    expect(within(visionItem as HTMLElement).getByText(
      "Preparamos deportistas altamente competitivos que integren de manera permanente las selecciones del país.",
    )).toBeInTheDocument();
  });

  it("shows an honest empty sponsor message when public GET /api/sponsors returns none", async (): Promise<void> => {
    render(<LandingPage />);

    const sponsors = screen.getByRole("region", { name: "Patrocinadores del club" });
    expect(within(sponsors).getByText("Patrocinadores")).toBeInTheDocument();
    expect(await within(sponsors).findByText("Pronto anunciaremos a nuestros patrocinadores")).toBeInTheDocument();
    expect(within(sponsors).queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders one card per published category, plus the help card", async (): Promise<void> => {
    render(<LandingPage />);

    const scheduleSection = screen.getByRole("heading", { name: "Elige una categoría" }).closest("section") as HTMLElement;
    await waitFor((): void => { expect(within(scheduleSection).getByRole("list", { name: "Categorías" })).toBeInTheDocument(); });
    const cards = within(within(scheduleSection).getByRole("list", { name: "Categorías" })).getAllByRole("listitem")
      .filter((item): boolean => item.classList.contains("landing-schedule-tile"));
    expect(cards).toHaveLength(PUBLISHED.length + 1);

    PUBLISHED.forEach((schedule): void => {
      const card = within(scheduleSection).getByRole("heading", { level: 3, name: schedule.category }).closest("li") as HTMLElement;
      // Every published slot is on the card, hours straight from the payload.
      schedule.slots.forEach((slot): void => { expect(card).toHaveTextContent(slot.hours); });
    });
  });

  it("orders the main content Hero → Ticker → Nosotros → Valores → Stats → Galería → Horarios → Mensualidad → Pasos → Preguntas → CTA → Visítenos", async (): Promise<void> => {
    // The gallery only has a place in the order once it has photos (VIS-03).
    publishGallery([
      { id: 1, titulo: "En juego", descripcion: "Una jugada frente al público de la sala.", imagenUrl: "https://res.cloudinary.com/club/en-juego.jpg" },
    ]);
    const { container } = render(<LandingPage />);
    const main = container.querySelector("main");
    await waitFor((): void => { expect(container.querySelector(".landing-schedule-grid")).toBeInTheDocument(); });
    await waitFor((): void => { expect(container.querySelector("#galeria-track")).toBeInTheDocument(); });
    expect(main).not.toBeNull();
    const sections = Array.from(main?.children ?? []);
    expect(sections[0]?.getAttribute("id")).toBe("inicio");
    // Proposal C: who we are (Nosotros, Valores), the proof (Stats, Galería),
    // then training, the join CTA and the visit — see `.local-preview/plan-C.md`.
    expect(sections[1]?.classList.contains("landing-credentials-ticker")).toBe(true);
    expect(sections.slice(2).map((section): string => section.id || (section.classList.contains("landing-motto") ? "motto" : "stats"))).toEqual([
      "nosotros",
      "valores",
      "stats",
      "galeria",
      "horarios",
      "mensualidad",
      "como-empezar",
      "preguntas",
      "motto",
      "contacto",
    ]);
    expect(sections[6]?.querySelector(".landing-schedule-grid")).not.toBeNull();
  });

  it("points the hero's primary action at the live enrollment wizard", (): void => {
    render(<LandingPage />);

    const hero = document.querySelector(".landing-hero");
    expect(hero).not.toBeNull();
    const heroPrimary = within(hero as HTMLElement).getByRole("link", { name: /inscríbete/i });
    expect(heroPrimary).toHaveAttribute("href", "/student/enroll");
    expect(within(hero as HTMLElement).getByRole("link", { name: "Ver horarios" })).toHaveAttribute("href", "#horarios");
  });

  /**
   * The hero used to open with its own brand mark ("Tenis de Mesa · Cata
   * Club"), directly under a navbar that already carries the club's lockup.
   * Two lockups a hundred pixels apart is not emphasis, it is a duplicate — so
   * the hero drops its copy and the navbar keeps the single one.
   *
   * Both halves are asserted together on purpose: "the hero has no brand" is
   * only correct while the page still names the club somewhere, and these two
   * facts live in two different components that different changes touch.
   */
  it("names the club once, in the navbar, and never repeats it in the hero", (): void => {
    render(<LandingPage />);

    const hero = document.querySelector(".landing-hero") as HTMLElement;
    expect(hero.querySelector(".landing-hero-brand")).toBeNull();
    expect(hero.textContent).not.toMatch(/tenis de mesa/i);

    expect(screen.getByRole("link", { name: /cata club, inicio/i })).toBeInTheDocument();
  });

  it("keeps the hero composition: headline, description, CTAs, note", (): void => {
    render(<LandingPage />);

    const copy = document.querySelector(".landing-hero-copy") as HTMLElement;
    // Order is the hierarchy. With the brand gone the headline leads, and
    // nothing else moved: a reshuffle here would read as a different hero.
    expect(Array.from(copy.children).map((child): string => child.className)).toEqual([
      "landing-display",
      "",
      "landing-hero-actions",
      "landing-hero-note",
    ]);
    expect(copy.children[0].tagName).toBe("H1");
  });

  it("keeps the hero carousel's crossing ball", (): void => {
    render(<LandingPage />);

    const hero = document.querySelector(".landing-hero") as HTMLElement;

    expect(document.querySelectorAll("[data-frame-ball]")).toHaveLength(1);
    expect(hero.querySelector("[data-frame-ball]")).not.toBeNull();
  });

  it("states the founding year in the hero note as 'Desde 2013', not 'Fundado en 2013'", (): void => {
    render(<LandingPage />);

    const hero = document.querySelector(".landing-hero") as HTMLElement;
    const note = hero.querySelector(".landing-hero-note");
    expect(note).toHaveTextContent("Club deportivo formativo · Desde 2013");
  });

  it("never renders the retired 'Fundado' wording anywhere on the landing", (): void => {
    const { container } = render(<LandingPage />);

    expect(container).not.toHaveTextContent(/fundad/i);
  });

  // Progressive enhancement like the gallery: never assert GSAP internals.
  describe("phone links", (): void => {
    it("LAN-15: offers a tel: link for every contact number next to the WhatsApp ones", (): void => {
      render(<LandingPage />);
      expect(document.querySelector('a[href="tel:+593994219619"]')).not.toBeNull();
      expect(document.querySelector('a[href="tel:+593990288152"]')).not.toBeNull();
    });
  });

  describe("hero photo carousel", (): void => {
    it("renders its slides from HERO_PHOTOS behind previous/next navigation", (): void => {
      render(<LandingPage />);

      const hero = document.querySelector(".landing-hero") as HTMLElement;
      const prev = within(hero).getByRole("button", { name: "Foto anterior" });
      const next = within(hero).getByRole("button", { name: "Foto siguiente" });
      expect(prev).toBeInTheDocument();
      expect(next).toBeInTheDocument();
      expect(within(hero).queryByRole("tablist")).not.toBeInTheDocument();
      expect(within(hero).queryByRole("tab")).not.toBeInTheDocument();

      // Slides are released as a visitor reaches them (issue #1281, see
      // HeroCarousel), so the set is complete only once the ladder's last
      // rung fires — a press on "next" is that rung.
      fireEvent.click(next);

      const slides = Array.from(hero.querySelectorAll(".landing-hero-slide"));
      expect(slides).toHaveLength(HERO_PHOTOS.length);
      HERO_PHOTOS.forEach((photo, index): void => {
        expect(slides[index]).toHaveAttribute("src", photo.src);
        expect(slides[index]).toHaveAttribute("alt", photo.alt);
      });
      expect(slides[0]).toHaveStyle({ objectPosition: HERO_PHOTOS[0].objectPosition });
    });

    // Round 3 of human review on PR #870: the arrows must not touch the
    // photo at all, so they moved out of the frame entirely and became its
    // siblings inside a carousel wrapper that reserves real column space
    // for each one — the now-empty bar container from round 1 stays retired.
    it("places the navigation buttons beside the photo frame, never inside it", (): void => {
      render(<LandingPage />);

      const hero = document.querySelector(".landing-hero") as HTMLElement;
      const frame = hero.querySelector(".landing-hero-frame") as HTMLElement;
      const prev = within(hero).getByRole("button", { name: "Foto anterior" });
      const next = within(hero).getByRole("button", { name: "Foto siguiente" });

      expect(frame.contains(prev)).toBe(false);
      expect(frame.contains(next)).toBe(false);
      expect(prev.parentElement).toBe(frame.parentElement);
      expect(next.parentElement).toBe(frame.parentElement);
      expect(hero.querySelector(".landing-hero-screen-bar")).not.toBeInTheDocument();
      expect(hero.querySelector(".landing-hero-screen-dots")).not.toBeInTheDocument();
    });

    it("only exposes the active slide to assistive tech", (): void => {
      vi.useFakeTimers();
      render(<LandingPage />);

      const hero = document.querySelector(".landing-hero") as HTMLElement;
      const slides = (): HTMLElement[] => Array.from(hero.querySelectorAll(".landing-hero-slide"));

      // jsdom has no `requestIdleCallback`, so the carousel's own fallback is
      // the idle rung: advancing it releases the second slide without moving
      // the active one.
      act((): void => { vi.advanceTimersByTime(2_000); });
      expect(slides()[0]).not.toHaveAttribute("aria-hidden");
      expect(slides()[1]).toHaveAttribute("aria-hidden", "true");

      fireEvent.click(within(hero).getByRole("button", { name: "Foto siguiente" }));

      const released = slides();
      expect(released).toHaveLength(HERO_PHOTOS.length);
      expect(released[0]).toHaveAttribute("aria-hidden", "true");
      expect(released[1]).not.toHaveAttribute("aria-hidden");
      expect(released[2]).toHaveAttribute("aria-hidden", "true");
    });

    it("advances to the next slide on click, without GSAP", (): void => {
      render(<LandingPage />);

      const hero = document.querySelector(".landing-hero") as HTMLElement;
      const next = within(hero).getByRole("button", { name: "Foto siguiente" });

      fireEvent.click(next);

      // Re-queried after the click on purpose: the press is also the carousel's
      // last release rung, so the slides it mounts are new nodes (issue #1281).
      const slides = Array.from(hero.querySelectorAll(".landing-hero-slide"));
      expect(slides[1]).toHaveAttribute("data-active", "true");
      expect(slides[1]).not.toHaveAttribute("aria-hidden");
      expect(slides[0]).toHaveAttribute("data-active", "false");
      expect(slides[0]).toHaveAttribute("aria-hidden", "true");
    });

    it("wraps around in both directions", (): void => {
      render(<LandingPage />);

      const hero = document.querySelector(".landing-hero") as HTMLElement;
      const prev = within(hero).getByRole("button", { name: "Foto anterior" });
      const next = within(hero).getByRole("button", { name: "Foto siguiente" });
      const slides = (): HTMLElement[] => Array.from(hero.querySelectorAll(".landing-hero-slide"));

      fireEvent.click(prev);
      expect(slides()[HERO_PHOTOS.length - 1]).toHaveAttribute("data-active", "true");

      fireEvent.click(next);
      expect(slides()[0]).toHaveAttribute("data-active", "true");
    });

    it("activates from the keyboard: focusing and pressing a navigation button moves the slide", (): void => {
      render(<LandingPage />);

      const hero = document.querySelector(".landing-hero") as HTMLElement;
      const next = within(hero).getByRole("button", { name: "Foto siguiente" });

      next.focus();
      expect(next).toHaveFocus();
      fireEvent.click(next);

      const slides = Array.from(hero.querySelectorAll(".landing-hero-slide"));
      expect(slides[1]).toHaveAttribute("data-active", "true");
    });

    it("counts the slide position next to the arrows, and updates it on a press", (): void => {
      render(<LandingPage />);

      const hero = document.querySelector(".landing-hero") as HTMLElement;
      const next = within(hero).getByRole("button", { name: "Foto siguiente" });
      const counter = hero.querySelector(".landing-hero-counter") as HTMLElement;

      expect(counter).toHaveAttribute("aria-live", "polite");
      expect(counter).toHaveTextContent(`01 / ${String(HERO_PHOTOS.length).padStart(2, "0")}`);
      expect(counter).toHaveTextContent(`Foto 1 de ${HERO_PHOTOS.length}`);

      fireEvent.click(next);

      expect(counter).toHaveTextContent(`02 / ${String(HERO_PHOTOS.length).padStart(2, "0")}`);
      expect(counter).toHaveTextContent(`Foto 2 de ${HERO_PHOTOS.length}`);
    });
  });

  it("never routes an enrollment CTA through the /register demo placeholder", (): void => {
    render(<LandingPage />);

    const enrollLinks = screen.getAllByRole("link", { name: /inscr/i });
    expect(enrollLinks.length).toBeGreaterThanOrEqual(3);
    enrollLinks.forEach((link): void => {
      // The two entry points of LAN-14 add a `?type=` the wizard preselects from.
      expect(link.getAttribute("href")?.split("?")[0]).toBe("/student/enroll");
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

  it("renders the transparent brand crest in the navbar logo so the light card shows", (): void => {
    render(<LandingPage />);
    const logoImg = document.querySelector("a.landing-logo img");
    expect(logoImg).not.toBeNull();
    expect(logoImg).toHaveAttribute("src", "/brand/cata-club-crest-256.png");
    expect(logoImg?.getAttribute("alt")).toBe("");
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
    expect(mottoCta).toHaveTextContent("Inscríbete ya");
  });

  it("embeds the official crest inside the motto paddle as pure decoration", (): void => {
    render(<LandingPage />);

    const motto = document.querySelector(".landing-motto") as HTMLElement;
    const paddle = motto.querySelector("[data-motto-paddle]") as HTMLElement;
    expect(paddle).toHaveAttribute("aria-hidden", "true");

    // Same crest asset the navbar already renders — no new generic icon.
    const crest = paddle.querySelector("img");
    expect(crest).not.toBeNull();
    expect(crest).toHaveAttribute("src", "/brand/cata-club-crest-256.png");
    expect(crest?.getAttribute("alt")).toBe("");

    // Decorative only: the club name must not be duplicated for screen
    // readers inside the motto, and the CTA's accessible name stays exactly
    // "Inscríbase ya" — no extra noise leaked into the accessible tree.
    expect(within(motto).queryByText(/cata club/i)).toBeNull();
    expect(within(motto).getByRole("link", { name: "Inscríbete ya" })).toHaveAttribute("data-motto-cta", "true");
  });

  it("turns every WhatsApp contact number into a wa.me link", (): void => {
    render(<LandingPage />);

    landingConfig.contact.whatsapp.forEach((number): void => {
      expect(within(document.querySelector(".landing-contact") as HTMLElement).getByRole("link", { name: `Administración · ${number}` })).toHaveAttribute("href", toWhatsAppLink(number));
    });
  });

  it("gives the WhatsApp row its own action, and the address row the directions", (): void => {
    render(<LandingPage />);

    const contact = document.querySelector(".landing-contact") as HTMLElement;
    const whatsappCta = within(contact).getByRole("link", { name: /escríbenos por whatsapp/i });
    expect(whatsappCta).toHaveAttribute("href", toWhatsAppLink(landingConfig.contact.whatsapp[0]));
    expect(whatsappCta.closest(".landing-contact-row")).toHaveTextContent("WhatsApp");

    const directions = within(contact).getByRole("link", { name: /cómo llegar/i });
    expect(directions.closest(".landing-contact-row")).toHaveTextContent("Dirección");
  });

  it("points the directions link at the shared club coordinate", (): void => {
    render(<LandingPage />);

    const contact = document.querySelector(".landing-contact");
    const directions = within(contact as HTMLElement).getByRole("link", { name: /cómo llegar/i });

    expect(directions).toHaveAttribute("href", clubOpenStreetMapUrl());
  });

  /**
   * The Coliseo is the landmark the product owner gives, and #641 resolved to
   * the club being beside it (#647). It has to survive in the two places a
   * visitor actually reads a direction — the address line and the arrival
   * photo's alt text — so a sighted visitor and a screen-reader one are handed
   * the same reference, not one each.
   */
  it("keeps the Coliseo as the landmark in the copy and the arrival alt", (): void => {
    render(<LandingPage />);

    const location = document.querySelector(".landing-location");
    expect(location).not.toBeNull();
    expect(location?.textContent ?? "").toMatch(/junto al Coliseo Ciudad de Loja/i);

    const alts = Array.from((location as HTMLElement).querySelectorAll("img")).map(
      (image): string => image.getAttribute("alt") ?? "",
    );
    expect(alts.length).toBeGreaterThan(0);
    expect(alts.some((alt): boolean => /coliseo/i.test(alt))).toBe(true);
  });

  /**
   * The street the club sits on carries no number, so the landmark is the only
   * thing narrowing the address down — and a landmark is not an address. The
   * Plus Code is, and it has to reach the page as text a visitor can copy into
   * a maps app, not stay buried in the coordinate the map is centred on.
   */
  it("shows the club's Plus Code alongside the street address", (): void => {
    render(<LandingPage />);

    const location = document.querySelector(".landing-location");
    expect(location?.textContent ?? "").toContain(CLUB_PLUS_CODE);
  });

  /**
   * Orienting a visitor from the Plaza de la Independencia is not the same
   * claim as sitting inside it. The club does not, so no phrase may put it
   * there — in the visible copy or in an alt a screen reader announces.
   */
  it("never claims the club sits inside the Plaza de la Independencia", (): void => {
    render(<LandingPage />);

    const location = document.querySelector(".landing-location") as HTMLElement;
    const alts = Array.from(location.querySelectorAll("img")).map(
      (image): string => image.getAttribute("alt") ?? "",
    );
    const claims = /\b(en|dentro de|interior de|adentro de)\s+la\s+plaza\b/i;

    [location.textContent ?? "", ...alts].forEach((copy): void => {
      expect(copy).not.toMatch(claims);
    });
  });

  /**
   * The gallery is data-driven (issue #1372): it renders only what
   * GET /api/galeria returns, and it starts empty — the club publishes its
   * photos from /galeria. The default fetch stub answers with an empty list,
   * which is the section's real initial state.
   */
  // Issue #1622: the menu always lists every section, so an empty gallery keeps
  // its section (and id) with a brief empty state instead of vanishing.
  it("keeps the gallery section, its nav entries and a brief empty state while the club has published nothing", async (): Promise<void> => {
    render(<LandingPage />);

    expect(await within(gallerySection()).findByText("Pronto vas a ver aquí fotos del club")).toBeInTheDocument();
    expect(within(gallerySection()).getByRole("heading", { name: "Galería" })).toBeInTheDocument();
    // Navbar and footer both keep pointing at the section.
    expect(document.querySelectorAll("a[href='#galeria']").length).toBe(2);
  });

  it("keeps the sponsors section, its id, nav entries and a brief empty state while there are none", async (): Promise<void> => {
    render(<LandingPage />);

    const sponsors = document.querySelector("#patrocinadores") as HTMLElement;
    expect(sponsors).not.toBeNull();
    expect(await within(sponsors).findByText("Pronto anunciaremos a nuestros patrocinadores")).toBeInTheDocument();
    expect(document.querySelectorAll("a[href='#patrocinadores']").length).toBe(2);
  });

  it("keeps the gallery's nav entries once there are photos to show", async (): Promise<void> => {
    publishGallery([
      { id: 1, titulo: "En juego", descripcion: "Una jugada frente al público de la sala.", imagenUrl: "https://res.cloudinary.com/club/en-juego.jpg" },
    ]);

    render(<LandingPage />);

    await within(gallerySection()).findAllByRole("img");
    expect(document.querySelectorAll("a[href='#galeria']").length).toBe(2);
  });

  it("announces the published photos once, through a screen-reader-only status", async (): Promise<void> => {
    publishGallery([
      { id: 1, titulo: "En juego", descripcion: "Una jugada frente al público de la sala.", imagenUrl: "https://res.cloudinary.com/club/en-juego.jpg" },
    ]);

    render(<LandingPage />);

    const status = await within(gallerySection()).findByText(/Galería: En juego\./);
    expect(status).toHaveClass("sr-only");
  });

  it("reports a failed gallery fetch honestly instead of inventing photos", async (): Promise<void> => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL): Promise<{ ok: boolean; status?: number; json: () => Promise<unknown> }> => {
      const url = String(input);
      if (url.includes("/api/galeria")) {
        return Promise.resolve({ ok: false, status: 503, json: async (): Promise<unknown> => ({ message: "No se pudo cargar la galería." }) });
      }
      return Promise.resolve({ ok: true, json: async (): Promise<unknown> => url.includes("/api/schedules") ? publicSchedulePayload : [] });
    }));

    render(<LandingPage />);

    expect(await within(gallerySection()).findByRole("status")).toHaveTextContent(
      "No se pudieron cargar las fotos de la galería.",
    );
    expect(within(gallerySection()).queryByRole("img")).not.toBeInTheDocument();
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
      ["Valores", "#valores"],
      ["Galería", "#galeria"],
      ["Horarios", "#horarios"],
      ["Mensualidad", "#mensualidad"],
      ["Cómo empezar", "#como-empezar"],
      ["Preguntas", "#preguntas"],
      ["Contacto", "#contacto"],
      ["Patrocinadores", "#patrocinadores"],
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
    expect(prioritized[0]).toHaveAttribute("src", HERO_PHOTOS[0].src);
  });

  /**
   * Published gallery photos sit below the fold and must not compete with the
   * hero for bandwidth, or the LCP image lands behind images nobody has
   * scrolled to.
   */
  it("defers every published gallery photo so it cannot delay the hero", async (): Promise<void> => {
    publishGallery([
      { id: 1, titulo: "En juego", descripcion: "Una jugada frente al público de la sala.", imagenUrl: "https://res.cloudinary.com/club/en-juego.jpg" },
      { id: 2, titulo: "La final", descripcion: "El punto decisivo del torneo regional.", imagenUrl: "https://res.cloudinary.com/club/la-final.jpg" },
    ]);

    render(<LandingPage />);

    const galleryImages = await within(gallerySection()).findAllByRole("img");
    expect(galleryImages.length).toBeGreaterThan(0);
    galleryImages.forEach((image): void => {
      expect(image).toHaveAttribute("loading", "lazy");
    });
  });

  /**
   * The icon chips are gone on purpose. A 40x40 tinted square holding a generic
   * glyph is the visual signature of a bought template, and it was repeated six
   * times. Rank is now carried by an index and a scale jump alone.
   */
  it("ranks the mission/vision pillars by index and typography rather than icon chips", (): void => {
    render(<LandingPage />);

    const blocks = Array.from(document.querySelectorAll(".landing-pillar"));
    expect(blocks).toHaveLength(2);
    expect(document.querySelectorAll(".landing-pillar svg")).toHaveLength(0);
    expect(blocks.map((block): string | null => block.querySelector(".landing-index")?.textContent ?? null))
      .toEqual(["01", "02"]);
  });

  it("numbers each value on a black tile instead of giving it an icon", (): void => {
    render(<LandingPage />);

    const tiles = Array.from(document.querySelectorAll(".landing-tablero-tile"));
    expect(tiles).toHaveLength(4);
    expect(document.querySelectorAll(".landing-tablero-tile svg")).toHaveLength(0);
    expect(tiles.map((tile): string | null => tile.textContent)).toEqual(["01", "02", "03", "04"]);
    tiles.forEach((tile): void => {
      expect(tile).toHaveAttribute("aria-hidden", "true");
    });
  });

  it("keeps each value's heading and description together in its own article", (): void => {
    render(<LandingPage />);

    const values = Array.from(document.querySelectorAll(".landing-tablero-item"));
    expect(values).toHaveLength(4);
    values.forEach((value): void => {
      expect(value.querySelector("h3")?.textContent).toBeTruthy();
      expect(value.querySelector("p")?.textContent).toBeTruthy();
      expect(value.hasAttribute("data-reveal")).toBe(true);
    });
  });

  it("renders the values tablero without any rally, ball, or dimming hooks", (): void => {
    render(<LandingPage />);

    expect(document.querySelector("[data-rally]")).toBeNull();
    expect(document.querySelectorAll("[data-value]")).toHaveLength(0);
  });

  /**
   * Issue #1372 retired the Logros section and every affordance that pointed
   * at it. A dead anchor is worse than no section: nothing rendered anywhere
   * on the page may still target `#logros`.
   */
  it("retires Logros without leaving a dead anchor behind", (): void => {
    render(<LandingPage />);

    expect(document.getElementById("logros")).toBeNull();
    expect(document.querySelector(".landing-wins")).toBeNull();
    expect(document.querySelector(".landing-tablero-cue")).toBeNull();
    const deadLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href='#logros']"));
    expect(deadLinks.map((link): string | null => link.textContent)).toEqual([]);
  });

      it("gives every footer service link its own destination", (): void => {
    render(<LandingPage />);

    const services = screen.getByRole("navigation", { name: "Servicios" });
    const hrefs = Array.from(services.querySelectorAll("a")).map((link): string | null => link.getAttribute("href"));
    expect(hrefs.length).toBeGreaterThan(0);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("links the footer to Mensualidad, Cómo empezar and Preguntas", (): void => {
    render(<LandingPage />);

    const footer = document.querySelector(".landing-footer") as HTMLElement;
    for (const [name, href] of [["Mensualidad", "#mensualidad"], ["Cómo empezar", "#como-empezar"], ["Preguntas", "#preguntas"]]) {
      expect(within(footer).getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });

  it("derives the footer copyright year instead of hardcoding it", (): void => {
    render(<LandingPage />);

    expect(screen.getByText(new RegExp(`© ${new Date().getFullYear()}`))).toBeInTheDocument();
  });

  /**
   * Lock — issue #710. PR #692 took the five crest consumers off
   * `/_next/image` so issue #681's poisonable, process-lifetime cache key
   * could never be created; the footer lockup uses a different asset and was
   * missed, still resolving to
   * `/_next/image?url=%2Flanding%2Fcata-club-logo.jpeg&w=64|128&q=75`.
   *
   * This checks the asset and the box only. It deliberately does NOT try to
   * assert the absence of an `/_next/image` URL: under vitest, `next/image`
   * renders the plain path whether or not `unoptimized` is set, so such an
   * assertion could never go red and would be a lock that proves nothing.
   * The optimizer request itself is asserted where it actually happens,
   * against a real server, in `tests/e2e/landing-footer-lockup.spec.ts`.
   */
  it("serves the footer lockup off the image optimizer, pre-sized", (): void => {
    render(<LandingPage />);

    const lockup = document.querySelector(".landing-footer-brand img");
    expect(lockup).not.toBeNull();
    expect(lockup).toHaveAttribute("src", "/brand/cata-club-logo-176.jpeg");
    // The club is already named in the `<b>` beside it.
    expect(lockup?.getAttribute("alt")).toBe("");
    // The rendered box must not move: CSS pins the height at 52px and takes
    // the width from these attributes, not from the file's own dimensions.
    expect(lockup).toHaveAttribute("width", "58");
    expect(lockup).toHaveAttribute("height", "58");
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
  describe("legal links (#1615)", (): void => {
    it("lists only «Términos y condiciones» in the footer", (): void => {
      render(<LandingPage />);

      const legal = screen.getByRole("navigation", { name: "Información legal" });
      const links = within(legal).getAllByRole("link");
      expect(links.map((link) => link.textContent)).toEqual(["Términos y condiciones"]);
      expect(links[0]).toHaveAttribute("href", "/terminos");
    });
  });

  describe("progressive motion enhancement", (): void => {
    it("keeps the motion runtime out of the synchronous server render", (): void => {
      render(<LandingPage />);

      expect(motionMount).not.toHaveBeenCalled();
      // The content that must not wait on GSAP/Lenis is already there.
      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
      expect(screen.getAllByRole("link", { name: /inscr/i }).length).toBeGreaterThan(0);
      // The gallery's static section (and its honest empty state) renders
      // without the motion runtime — it owes GSAP nothing.
      expect(screen.getByRole("heading", { name: "Galería" })).toBeInTheDocument();
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
        expect(screen.getByRole("heading", { name: "Misión y Visión" })).toBeInTheDocument();
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
      /*
       * This assertion used to read `landingConfig.contact.hours`: a range
       * computed at module load from a schedule list compiled into the
       * bundle. Issue #789 deleted that list — the club's schedules live in
       * the app and reach this page through `GET /api/schedules`, and that
       * fetch is an effect, which server rendering never runs.
       *
       * So the assertion changes, deliberately, to the thing that must still
       * hold for a visitor whose JavaScript never runs: the `Horario` row is
       * server-rendered, labelled, and honest about what it is waiting for.
       * Weakening it to "the row exists" would let a blank value ship; asking
       * for a range would be asking the server to state hours it has not
       * fetched. The label and the status sit adjacent in the markup, so
       * neither can be satisfied without the other.
       */
      // The label leads with its decorative channel icon: one aria-hidden span
      // holding exactly one svg, and nothing else between it and the text.
      expect(html).toMatch(/<dt><span class="landing-contact-icon" aria-hidden="true"><svg[^>]*>(?:(?!<\/svg>).)*<\/svg><\/span>Horario<\/dt><dd role="status">Cargando horarios…<\/dd>/);
      expect(html).not.toMatch(/Horario<\/dt><dd[^>]*>\s*<\/dd>/);
      /*
       * The gallery's entries live behind GET /api/galeria, and that fetch is
       * an effect — server rendering never runs it. The static output carries
       * the section and its loading status, names no photograph it has not
       * fetched, and invents none (issue #1372: the gallery starts empty).
       */
      expect(html).toContain("Galería");
      expect(html).toContain("Cargando la galería…");
      expect(html).not.toContain("landing-gallery-card");
      expect(html).not.toContain("cloudinary");
      expect(motionMount).not.toHaveBeenCalled();
    });
  });
});
