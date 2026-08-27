/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLUB_PLUS_CODE, clubOpenStreetMapUrl } from "@/app/landing/club-location";
import { landingConfig, toWhatsAppLink, yearsSinceFounding } from "@/app/landing/landing-config";
import { GALLERY_PHOTOS } from "@/app/landing/landing-gallery";
import { HERO_PHOTOS } from "@/app/landing/landing-hero-photos";
import { barGeometry, deriveDayRange } from "@/app/landing/schedule-timeline";
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

const publicSchedulePayload = [
  { category: "Formativo", blocks: [{ days: ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES"], startTime: "15:00", endTime: "16:00" }] },
  { category: "Infantil", blocks: [{ days: ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES"], startTime: "16:00", endTime: "17:00" }] },
  { category: "Juvenil", blocks: [{ days: ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES"], startTime: "17:00", endTime: "18:00" }] },
  { category: "Competitivo", blocks: [{ days: ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES"], startTime: "18:00", endTime: "20:00" }, { days: ["SABADO"], startTime: "18:00", endTime: "20:00" }] },
  { category: "Adultos", blocks: [{ days: ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES"], startTime: "08:00", endTime: "09:15" }, { days: ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES"], startTime: "20:00", endTime: "21:15" }] },
  { category: "Juego Libre", blocks: [{ days: ["SABADO"], startTime: "15:00", endTime: "18:00" }] },
];

describe("LandingPage", (): void => {
  let reducedMotion = true;
  let matchMediaCalls: MockedMediaQueryList[] = [];

  beforeEach((): void => {
    reducedMotion = true;
    matchMediaCalls = [];
    motionMount.mockClear();
    // The sponsor strip is now data-driven: it calls public GET /api/sponsors on mount.
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL): Promise<{ ok: boolean; json: () => Promise<unknown> }> => {
          const url = String(input);
          return Promise.resolve({ ok: true, json: async (): Promise<unknown> => url.includes("/api/schedules") ? publicSchedulePayload : [] });
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

      it("renders client-pending values from the centralized config", async (): Promise<void> => {
    render(<LandingPage />);

    await waitFor((): void => { expect(screen.getByText(landingConfig.schedules[0].slots[0].hours)).toBeInTheDocument(); });
    expect(screen.getByText(landingConfig.contact.hours)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cata Club Loja" })).toHaveAttribute("href", landingConfig.contact.facebook);
    expect(screen.getByRole("link", { name: "@cataclub_tenis_de_mesa" })).toHaveAttribute("href", landingConfig.contact.instagram);
  });

  it("renders the arrival inset and the Mission/Vision approved editorial photos", (): void => {
    render(<LandingPage />);

    const arrival = screen.getByRole("img", { name: /entrada de cata club/i });
    expect(arrival).toHaveAttribute("src", "/landing/photo-arrival.png");
    expect(arrival).toHaveAttribute("width", "1600");
    expect(arrival).toHaveAttribute("height", "1200");
    expect(arrival).toHaveAttribute("loading", "lazy");
    expect(screen.getByText("Así se ve al llegar")).toBeInTheDocument();

    const mission = screen.getByRole("img", { name: /el club reúne a su comunidad en un entrenamiento/i });
    expect(mission).toHaveAttribute("src", "/landing/photo-community.jpeg");
    const vision = screen.getByRole("img", { name: /el equipo de cata club posa en conjunto/i });
    expect(vision).toHaveAttribute("src", "/landing/photo-squad.jpeg");
  });

  it("alternates Mission and Vision editorial blocks: photo left/text right, then text left/photo right", (): void => {
    render(<LandingPage />);
    const articles = screen.getByRole("heading", { name: "Nuestra Misión" }).parentElement
      ? [
          screen.getByRole("heading", { name: "Nuestra Misión" }).closest(".landing-editorial-item"),
          screen.getByRole("heading", { name: "Nuestra Visión" }).closest(".landing-editorial-item"),
        ]
      : [];
    const [missionItem, visionItem] = articles as HTMLElement[];
    expect(missionItem).not.toBeNull();
    expect(visionItem).not.toBeNull();

    const missionChildren = Array.from(missionItem.children);
    const visionChildren = Array.from(visionItem.children);
    // Mission leads with the photo (left), then the copy; Vision is inverted.
    expect(missionChildren[0]?.classList.contains("landing-editorial-media")).toBe(true);
    expect(missionChildren[1]?.classList.contains("landing-editorial-copy")).toBe(true);
    expect(visionChildren[0]?.classList.contains("landing-editorial-copy")).toBe(true);
    expect(visionChildren[1]?.classList.contains("landing-editorial-media")).toBe(true);
  });

  it("shows an honest empty sponsor message when public GET /api/sponsors returns none", async (): Promise<void> => {
    render(<LandingPage />);

    const sponsors = screen.getByRole("region", { name: "Patrocinadores del club" });
    expect(within(sponsors).getByText("Patrocinadores")).toBeInTheDocument();
    expect(await within(sponsors).findByText(/aún no hay patrocinadores/i)).toBeInTheDocument();
    expect(within(sponsors).queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders every category as a tab in the schedule tablist", async (): Promise<void> => {
    render(<LandingPage />);

    const scheduleSection = screen.getByRole("heading", { name: "Elija una categoría" }).closest("section");
    expect(scheduleSection).not.toBeNull();
    await waitFor((): void => { expect(within(scheduleSection as HTMLElement).getByRole("tablist", { name: "Categorías" })).toBeInTheDocument(); });
    const tablist = within(scheduleSection as HTMLElement).getByRole("tablist", { name: "Categorías" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(landingConfig.schedules.length);

    landingConfig.schedules.forEach((schedule, index): void => {
      expect(tabs[index]).toHaveTextContent(schedule.category);
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
  it("shows every slot of a multi-slot category in the detail panel", async (): Promise<void> => {
    render(<LandingPage />);

    const scheduleSection = screen.getByRole("heading", { name: "Elija una categoría" }).closest("section");
    await waitFor((): void => { expect(within(scheduleSection as HTMLElement).getByRole("tablist", { name: "Categorías" })).toBeInTheDocument(); });
    const tablist = within(scheduleSection as HTMLElement).getByRole("tablist", { name: "Categorías" });
    const panel = screen.getByRole("tabpanel");

    fireEvent.click(within(tablist).getByRole("tab", { name: /adultos/i }));
    expect(within(panel).getByText(/08:00 – 09:15/)).toBeInTheDocument();
    expect(within(panel).getByText(/20:00 – 21:15/)).toBeInTheDocument();

    fireEvent.click(within(tablist).getByRole("tab", { name: /competitivo/i }));
    expect(within(panel).getByText(/Lunes, Martes, Miércoles, Jueves y Viernes y Sábado/)).toBeInTheDocument();
        expect(panel.querySelectorAll(".landing-day-bar")).toHaveLength(2);
  });

  it("orders the main content Hero → Ticker → Stats → Horarios → rest", async (): Promise<void> => {
    const { container } = render(<LandingPage />);
    const main = container.querySelector("main");
    await waitFor((): void => { expect(container.querySelector(".landing-sched")).toBeInTheDocument(); });
    expect(main).not.toBeNull();
    const sections = Array.from(main?.querySelectorAll("section, header") ?? []);
    expect(sections[0]?.getAttribute("id")).toBe("inicio");
    // The moving black ticker and the stats block ("Desde 2013" / "Desde el
    // 10 de octubre") come BEFORE Horarios; the schedule is the third
    // content block.
    expect(sections[1]?.classList.contains("landing-credentials-ticker")).toBe(true);
    expect(sections[2]?.classList.contains("landing-stats")).toBe(true);
    expect(sections[3]?.querySelector(".landing-sched")).not.toBeNull();
  });

  /**
   * The day timeline is data-driven: one row per distinct day group in the
   * published data, with every slot rendered exactly once as a bar on the
   * shared scale. Adding or reordering categories or slots must change the
   * picture without touching the component — no hardcoded two-lane layout
   * or legend copy survives. Expectations derive from the same API payload
   * the fetch stub feeds the page, so they track the real data, not any
   * hardcoded lane structure.
   */
  it("derives timeline rows and bars from the published schedules on the shared scale", async (): Promise<void> => {
    render(<LandingPage />);
    const scheduleSection = screen.getByRole("heading", { name: "Elija una categoría" }).closest("section");
    await waitFor((): void => { expect(within(scheduleSection as HTMLElement).getByRole("tablist", { name: "Categorías" })).toBeInTheDocument(); });

    // Mapped the same way the page maps the fetched payload.
    const schedules = mapPublicSchedules(publicSchedulePayload);
    const range = deriveDayRange(schedules);
    fireEvent.click(within(scheduleSection as HTMLElement).getByRole("tab", { name: /competitivo/i }));
        const selected = schedules.find((schedule): boolean => schedule.category === "Competitivo");
        const expectedGroups = ["week", "sat"];

    // One row per distinct day group actually present in the data.
    const rows = Array.from(scheduleSection?.querySelectorAll("[data-day-row]") ?? []);
    expect(rows.map((row): string | null => row.getAttribute("data-day-row"))).toEqual(expectedGroups);

    // Row labels come from the data's day strings — never hardcoded copy.
    rows.forEach((row): void => {
      const on = row.getAttribute("data-day-row") ?? "";
      const expectedLabel = on === "week" ? "LUN–VIE" : "SÁB";
      expect(row.querySelector("b")?.textContent).toBe(expectedLabel);
    });

        const allSlots = (selected?.slots ?? []).map((slot): { category: string; hours: string; days: string; on: string } => ({
          category: selected?.category ?? "", hours: slot.hours, days: slot.days, on: slot.on,
        }));
    const bars = Array.from(scheduleSection?.querySelectorAll(".landing-day-bar") ?? []);
    expect(bars).toHaveLength(allSlots.length);

    const titles = new Set(bars.map((bar): string | null => bar.getAttribute("title")));
    allSlots.forEach((slot): void => {
      const geometry = barGeometry(slot.hours, range);
      const bar = bars.find((candidate): boolean =>
        candidate.getAttribute("title") === `${slot.category} · ${slot.hours} · ${slot.days}`,
      );
      expect(bar).not.toBeUndefined();
      const style = bar?.getAttribute("style") ?? "";
      expect(Number(style.match(/left:\s*([\d.]+)%/)?.[1])).toBeCloseTo(geometry.left, 3);
      expect(Number(style.match(/width:\s*calc\(([\d.]+)%/)?.[1])).toBeCloseTo(geometry.width, 3);
      expect(bar?.closest("[data-day-lane]")?.getAttribute("data-day-lane")).toBe(slot.on);
    });
    expect(titles.size).toBe(selected?.slots.length);

    // No hardcoded two-lane legend or decorative ball remains.
    expect(scheduleSection?.querySelector(".landing-day-legend")).toBeNull();
    expect(scheduleSection?.querySelector("[data-schedule-ball]")).toBeNull();
    expect(scheduleSection).not.toHaveTextContent(/Dos bloques por día/);
  });

  describe("schedule selector — master-detail", (): void => {
    const getSchedule = async (): Promise<{ tablist: HTMLElement; tabs: HTMLElement[]; panel: HTMLElement }> => {
      const section = screen.getByRole("heading", { name: "Elija una categoría" }).closest("section") as HTMLElement;
      await waitFor((): void => { expect(within(section).getByRole("tablist", { name: "Categorías" })).toBeInTheDocument(); });
      const tablist = within(section).getByRole("tablist", { name: "Categorías" });
      const tabs = within(tablist).getAllByRole("tab");
      const panel = screen.getByRole("tabpanel");
      return { tablist, tabs, panel };
    };

    it("selects a category on click and points the panel at it", async (): Promise<void> => {
      render(<LandingPage />);
      const { tablist, tabs, panel } = await getSchedule();

      fireEvent.click(within(tablist).getByRole("tab", { name: /juvenil/i }));

      expect(tabs[2]).toHaveAttribute("aria-selected", "true");
      expect(within(panel).getByRole("heading", { level: 3 })).toHaveTextContent("Juvenil");
      expect(within(panel).getByText(/17:00 – 18:00/)).toBeInTheDocument();
    });

    it("moves selection and focus with ArrowDown and ArrowUp", async (): Promise<void> => {
      render(<LandingPage />);
      const { tablist, tabs } = await getSchedule();

      fireEvent.keyDown(tablist, { key: "ArrowDown" });
      expect(tabs[1]).toHaveAttribute("aria-selected", "true");
      expect(tabs[1]).toHaveFocus();

      fireEvent.keyDown(tablist, { key: "ArrowUp" });
      expect(tabs[0]).toHaveAttribute("aria-selected", "true");
      expect(tabs[0]).toHaveFocus();
    });

    it("wires each tab to the single panel and labels it with the selected tab", async (): Promise<void> => {
      render(<LandingPage />);
      const { tabs, panel } = await getSchedule();

      expect(panel).toHaveAttribute("id", "schedule-panel");
      tabs.forEach((tab, index): void => {
        expect(tab).toHaveAttribute("id", `schedule-tab-${index}`);
        expect(tab).toHaveAttribute("aria-controls", "schedule-panel");
      });
      expect(panel).toHaveAttribute("aria-labelledby", "schedule-tab-0");

      fireEvent.click(tabs[2]);
      expect(panel).toHaveAttribute("aria-labelledby", "schedule-tab-2");
    });

    it("keeps only the selected tab in the tab order via roving tabIndex", async (): Promise<void> => {
      render(<LandingPage />);
      const { tabs } = await getSchedule();

      expect(tabs[0]).toHaveAttribute("tabindex", "0");
      tabs.slice(1).forEach((tab): void => {
        expect(tab).toHaveAttribute("tabindex", "-1");
      });

      fireEvent.click(tabs[3]);
      expect(tabs[3]).toHaveAttribute("tabindex", "0");
      expect(tabs[0]).toHaveAttribute("tabindex", "-1");
    });

    it("declares the schedule tablist as vertical", async (): Promise<void> => {
      render(<LandingPage />);
      const { tablist } = await getSchedule();
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

  it("keeps a single decorative serve ball inside the hero", (): void => {
    render(<LandingPage />);

    const hero = document.querySelector(".landing-hero") as HTMLElement;
    const ball = hero.querySelector("[data-serve-ball]");

    expect(document.querySelectorAll("[data-serve-ball]")).toHaveLength(1);
    expect(ball).not.toBeNull();
    expect(ball).toHaveAttribute("aria-hidden", "true");
    expect(ball?.parentElement).toBe(hero);
  });

  /**
   * The paddle that produces the serve (issue #640).
   *
   * Two things are asserted together because either one alone would pass while
   * the feature was broken. The paddle has to EXIST in the markup the server
   * sends, since that markup is the whole composition whenever the motion layer
   * never loads — the static state is not a degraded mode here, it is the hit
   * frozen at the moment of contact. And it has to be the club's own paddle:
   * the shape and the crest that `Motto` already renders (issue #642), not a
   * second, generic mark drawn only for the hero.
   *
   * It is also asserted to be a direct child of the hero, exactly like the ball,
   * because that shared positioning context is what lets one pair of CSS
   * anchors keep the two on the same vertical axis.
   */
  it("stands the club's crested paddle under the hero's serve ball", (): void => {
    render(<LandingPage />);

    const hero = document.querySelector(".landing-hero") as HTMLElement;
    const paddle = hero.querySelector("[data-serve-paddle]") as HTMLElement;

    expect(document.querySelectorAll("[data-serve-paddle]")).toHaveLength(1);
    expect(paddle).not.toBeNull();
    expect(paddle).toHaveAttribute("aria-hidden", "true");
    expect(paddle.parentElement).toBe(hero);

    // The same shape class the Motto paddle uses, so the two cannot diverge.
    expect(paddle.classList.contains("landing-paddle")).toBe(true);

    const crest = paddle.querySelector(".landing-paddle-crest") as HTMLImageElement;
    expect(crest).not.toBeNull();
    expect(crest.getAttribute("src")).toBe("/brand/cata-club-logo-avatar.png");
    // Decorative: the hero already names the club in text above it.
    expect(crest.getAttribute("alt")).toBe("");
  });

  it("ships the paddle in the server markup, so the still composition needs no JS", (): void => {
    const html = renderToStaticMarkup(<LandingPage />);

    expect(html).toContain("data-serve-paddle");
    expect(html).toContain("data-serve-ball");
    expect(html).toContain("landing-paddle-crest");
    expect(motionMount).not.toHaveBeenCalled();
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

  it("renders the transparent brand crest in the navbar logo so the light card shows", (): void => {
    render(<LandingPage />);
    const logoImg = document.querySelector("a.landing-logo img");
    expect(logoImg).not.toBeNull();
    expect(logoImg).toHaveAttribute("src", "/brand/cata-club-logo-avatar.png");
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
    expect(crest).toHaveAttribute("src", "/brand/cata-club-logo-avatar.png");
    expect(crest?.getAttribute("alt")).toBe("");

    // Decorative only: the club name must not be duplicated for screen
    // readers inside the motto, and the CTA's accessible name stays exactly
    // "Inscríbete ya" — no extra noise leaked into the accessible tree.
    expect(within(motto).queryByText(/cata club/i)).toBeNull();
    expect(within(motto).getByRole("link", { name: "Inscríbete ya" })).toHaveAttribute("data-motto-cta", "true");
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
   * The gallery is presentation-only ("sin interacción con el usuario"):
   * slides are decorative figures, not controls. There is no lightbox, no
   * open affordance, and no pause/resume channel — clicking or keyboarding
   * a slide must do nothing, and the markup carries no interaction state.
   */
  it("ships the gallery as a non-interactive strip with no open affordance", (): void => {
    render(<LandingPage />);

    const gallery = document.querySelector(".landing-gallery");
    const track = document.querySelector(".landing-carousel");
    expect(track).not.toBeNull();
    expect(track).toHaveAttribute("data-carousel");
    expect(track?.className).not.toContain("is-enhanced");

    // Slides are plain figures: no buttons, no lightbox, no drag handle.
    expect(gallery?.querySelectorAll(".landing-slide")).toHaveLength(GALLERY_PHOTOS.length);
    expect(gallery?.querySelectorAll("button")).toHaveLength(0);
    expect(gallery?.querySelector(".landing-lightbox")).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ignores clicks on slides: nothing opens and the page never locks scrolling", (): void => {
    render(<LandingPage />);

    const slide = document.querySelector(".landing-slide") as HTMLElement;
    fireEvent.click(slide);
    fireEvent.keyDown(slide, { key: "Enter" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.querySelector(".landing-lightbox")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it("exposes the strip as a labelled group, not as a set of buttons", (): void => {
    render(<LandingPage />);

    const track = document.querySelector("[data-carousel]");
    expect(track).toHaveAttribute("role", "group");
    expect(track).toHaveAttribute("aria-label", "Galería de fotos del club");
    expect(within(track as HTMLElement).queryAllByRole("button")).toHaveLength(0);
  });

  describe("gallery motion contract", (): void => {
    it("renders the strip with the markup the autonomous loop needs", (): void => {
      render(<LandingPage />);

      const track = document.querySelector(".landing-carousel");
      const slides = Array.from(track?.querySelectorAll(".landing-slide") ?? []);
      expect(slides).toHaveLength(GALLERY_PHOTOS.length);
      // Images stay draggable=false so nothing can mis-interpret a pointer press.
      slides.forEach((slide): void => {
        expect(slide.querySelector("img")).toHaveAttribute("draggable", "false");
      });
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

  it("renders the rally guide, ball, impact, counter, and four motion hooks", (): void => {
        render(<LandingPage />);
        const rally = document.querySelector("[data-rally]");
        expect(rally).toHaveAttribute("aria-hidden", "true");
        expect(rally?.querySelector("[data-rally-guide]")).toBeInTheDocument();
        expect(rally?.querySelector("[data-rally-ball]")).toBeInTheDocument();
        expect(rally?.querySelector("[data-rally-impact]")).toBeInTheDocument();
        expect(rally?.querySelector("[data-rally-counter]")).toHaveTextContent("0");
        expect(document.querySelectorAll("[data-value]")).toHaveLength(4);
        expect(document.querySelectorAll(".landing-value[data-reveal]")).toHaveLength(0);
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
