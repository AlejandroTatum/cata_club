/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Gallery, { wrapTime } from "../Gallery";
import { GALLERY_EMPTY_EVENT } from "../landing-gallery";

const PHOTOS = [
  { id: 1, titulo: "En juego", descripcion: "Una jugada frente al público de la sala.", imagenUrl: "https://res.cloudinary.com/club/en-juego.jpg" },
  { id: 2, titulo: "La final", descripcion: "El punto decisivo del torneo regional.", imagenUrl: "https://res.cloudinary.com/club/la-final.jpg" },
  { id: 3, titulo: "Entrenamiento", descripcion: "El grupo de la tarde en plena práctica.", imagenUrl: "https://res.cloudinary.com/club/entrenamiento.jpg" },
];

const TILE_PX = 300;
const GAP_PX = 18;
const COPY_PX = 3000;
const DURATION_MS = 28000;

function stubFetch(payload: unknown, ok = true): void {
  vi.stubGlobal("fetch", vi.fn((): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> =>
    Promise.resolve({ ok, status: ok ? 200 : 503, json: async (): Promise<unknown> => payload })));
}

function stubMotion(reduced: boolean): void {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)" ? reduced : !reduced,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
}

/** jsdom has no layout: give the tiles and the copy the widths the stylesheet would. */
function stubLayout(): void {
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement): number {
      if (this.classList.contains("landing-sponsors-item")) return TILE_PX;
      if (this.classList.contains("landing-sponsors-copy")) return COPY_PX;
      return 0;
    },
  });
  const realComputedStyle = window.getComputedStyle.bind(window);
  vi.stubGlobal("getComputedStyle", (element: Element, pseudo?: string | null): CSSStyleDeclaration => {
    const style = realComputedStyle(element, pseudo);
    return new Proxy(style, { get: (target, key): unknown => key === "columnGap" ? `${GAP_PX}px` : Reflect.get(target, key) instanceof Function ? (Reflect.get(target, key) as Function).bind(target) : Reflect.get(target, key) });
  });
}

/** The one running keyframe animation of the strip, as the Web Animations API reports it. */
function stubAnimation(currentTime: number): { currentTime: number } {
  const animation = { currentTime, effect: { getComputedTiming: (): { duration: number } => ({ duration: DURATION_MS }) } };
  Object.defineProperty(HTMLElement.prototype, "getAnimations", { configurable: true, value: (): unknown[] => [animation] });
  return animation;
}

/** Runs every animation frame at once, far past the step's duration. */
function stubInstantFrames(): void {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback): number => {
    callback(performance.now() + 10_000);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
}

async function renderReady(payload: unknown = PHOTOS): Promise<void> {
  stubFetch(payload);
  render(<Gallery />);
  await screen.findAllByRole("img");
}

describe("Gallery", (): void => {
  beforeEach((): void => {
    stubMotion(false);
    stubLayout();
    // jsdom does not implement element scrolling.
    Object.defineProperty(HTMLElement.prototype, "scrollBy", { configurable: true, writable: true, value: vi.fn() });
  });
  afterEach((): void => {
    cleanup();
    vi.unstubAllGlobals();
    delete (HTMLElement.prototype as { getAnimations?: unknown }).getAnimations;
    delete (HTMLElement.prototype as { offsetWidth?: unknown }).offsetWidth;
    delete (HTMLElement.prototype as { scrollBy?: unknown }).scrollBy;
  });

  it("reuses the sponsors marquee: a CSS track of two identical copies, the second hidden from assistive technology", async (): Promise<void> => {
    await renderReady();
    const track = document.getElementById("galeria-track") as HTMLElement;
    expect(track).toHaveClass("landing-sponsors-track");
    const copies = track.querySelectorAll(":scope > .landing-sponsors-copy");
    expect(copies).toHaveLength(2);
    expect(copies[0]).not.toHaveAttribute("aria-hidden");
    expect(copies[1]).toHaveAttribute("aria-hidden", "true");
    // Exactly one pass speaks: one image per published photo.
    expect(screen.getAllByRole("img")).toHaveLength(PHOTOS.length);
    expect(screen.getAllByRole("figure")).toHaveLength(PHOTOS.length);
  });

  it("shows the strip without probing the photos first", async (): Promise<void> => {
    const probe = vi.fn();
    vi.stubGlobal("Image", class { constructor() { probe(); } });
    await renderReady();
    expect(probe).not.toHaveBeenCalled();
    expect(document.querySelector("[data-carousel]")).toBeNull();
  });

  it("gives every tile a fixed frame so a slow photo never collapses it", async (): Promise<void> => {
    await renderReady();
    screen.getAllByRole("figure").forEach((figure): void => {
      expect(figure.style.aspectRatio).toBe("4 / 3");
    });
  });

  it("offers Spanish-labelled previous/next buttons once there is something to browse", async (): Promise<void> => {
    await renderReady();
    const previous = screen.getByRole("button", { name: "Foto anterior" });
    const next = screen.getByRole("button", { name: "Foto siguiente" });
    expect(previous).toHaveAttribute("type", "button");
    expect(next).toHaveAttribute("aria-controls", "galeria-track");
    expect(screen.getByRole("group", { name: "Navegar por la galería" })).toContainElement(previous);
    // Real buttons: reachable and activatable from the keyboard.
    previous.focus();
    expect(document.activeElement).toBe(previous);
  });

  it("ships no arrows for a single photo", async (): Promise<void> => {
    await renderReady([PHOTOS[0]]);
    expect(screen.queryByRole("button", { name: "Foto siguiente" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Foto anterior" })).toBeNull();
  });

  it("advances the marquee clock by exactly one tile on next, and back on previous", async (): Promise<void> => {
    stubInstantFrames();
    const animation = stubAnimation(10_000);
    await renderReady();
    const tileShare = (DURATION_MS * (TILE_PX + GAP_PX)) / COPY_PX;

    fireEvent.click(screen.getByRole("button", { name: "Foto siguiente" }));
    expect(animation.currentTime).toBeCloseTo(10_000 + tileShare, 3);

    fireEvent.click(screen.getByRole("button", { name: "Foto anterior" }));
    expect(animation.currentTime).toBeCloseTo(10_000, 3);
  });

  it("wraps backwards across the loop seam instead of clamping at zero", async (): Promise<void> => {
    stubInstantFrames();
    const animation = stubAnimation(100);
    await renderReady();

    fireEvent.click(screen.getByRole("button", { name: "Foto anterior" }));
    expect(animation.currentTime).toBeGreaterThan(DURATION_MS / 2);
    expect(animation.currentTime).toBeLessThan(DURATION_MS);
    expect(wrapTime(-100, 1000)).toBe(900);
    expect(wrapTime(1100, 1000)).toBe(100);
  });

  it("browses with the arrow keys and announces the photo politely", async (): Promise<void> => {
    stubInstantFrames();
    const animation = stubAnimation(0);
    await renderReady();
    const viewport = screen.getByRole("group", { name: "Galería de fotos del club" });

    fireEvent.keyDown(viewport, { key: "ArrowRight" });
    expect(animation.currentTime).toBeGreaterThan(0);
    expect(screen.getByText("Foto 2 de 3: La final")).toHaveAttribute("aria-live", "polite");

    fireEvent.keyDown(viewport, { key: "ArrowLeft" });
    fireEvent.keyDown(viewport, { key: "ArrowLeft" });
    expect(screen.getByText("Foto 3 de 3: Entrenamiento")).toBeInTheDocument();
  });

  it("pins a tapped caption, pauses the marquee, and releases on an outside tap", async (): Promise<void> => {
    await renderReady();
    const track = document.getElementById("galeria-track") as HTMLElement;
    const [figure] = screen.getAllByRole("figure");

    fireEvent.click(figure);
    expect(figure).toHaveClass("is-open");
    expect(track.style.animationPlayState).toBe("paused");

    fireEvent.click(screen.getByRole("button", { name: "Foto siguiente" }));
    expect(figure).toHaveClass("is-open");

    fireEvent.click(document.body);
    expect(figure).not.toHaveClass("is-open");
    expect(track.style.animationPlayState).toBe("");
  });

  describe("with prefers-reduced-motion", (): void => {
    beforeEach((): void => stubMotion(true));

    it("leaves the keyframe to the stylesheet's reduced-motion rule and scrolls the row instead", async (): Promise<void> => {
      const animation = stubAnimation(500);
      await renderReady();
      const viewport = screen.getByRole("group", { name: "Galería de fotos del club" });
      const scrollBy = vi.fn();
      viewport.scrollBy = scrollBy;

      await waitFor((): void => expect(viewport.style.overflowX).toBe("auto"));
      fireEvent.click(screen.getByRole("button", { name: "Foto siguiente" }));
      expect(scrollBy).toHaveBeenCalledWith({ left: TILE_PX + GAP_PX, behavior: "auto" });
      fireEvent.click(screen.getByRole("button", { name: "Foto anterior" }));
      expect(scrollBy).toHaveBeenLastCalledWith({ left: -(TILE_PX + GAP_PX), behavior: "auto" });
      expect(animation.currentTime).toBe(500);
    });

    it("keeps the arrows visible and drops the decorative copy", async (): Promise<void> => {
      await renderReady();
      const nav = screen.getByRole("group", { name: "Navegar por la galería" });
      await waitFor((): void => expect(nav.style.display).toBe("flex"));
      const copies = document.querySelectorAll<HTMLElement>("#galeria-track > .landing-sponsors-copy");
      expect(copies[1].style.display).toBe("none");
    });
  });

  it("renders nothing and announces the empty gallery when the club published no photo", async (): Promise<void> => {
    const onEmpty = vi.fn();
    document.addEventListener(GALLERY_EMPTY_EVENT, onEmpty);
    stubFetch([]);
    const { container } = render(<Gallery />);
    await waitFor((): void => expect(onEmpty).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    document.removeEventListener(GALLERY_EMPTY_EVENT, onEmpty);
  });

  it("reports a failed fetch honestly", async (): Promise<void> => {
    stubFetch({}, false);
    render(<Gallery />);
    const section = document.getElementById("galeria") as HTMLElement;
    expect(await within(section).findByRole("status")).toHaveTextContent("No se pudieron cargar las fotos de la galería.");
    await act(async (): Promise<void> => {});
  });
});
