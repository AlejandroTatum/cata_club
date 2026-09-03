/**
 * The floating launcher, and the rule that keeps it from becoming the FAB the
 * product already removed once.
 *
 * The old one was `fixed bottom-5 right-5 h-14 w-14`, mounted unconditionally,
 * and it covered the trainer's sticky attendance commit bar at 390px and the
 * landing's WhatsApp block. The new one yields: it measures what is under its
 * corner and either climbs above it or withdraws. `resolveClearance` is that
 * rule, and it is tested directly — jsdom has no layout, so the DOM probing
 * around it (`elementsFromPoint` over a real `sticky` bar) is verified in the
 * browser at 390×844 and 1440×900 instead.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import HelpChatDock, { resolveClearance } from "../HelpChatDock";
import { closeHelpChat, openHelpChat, resetHelpChatForTests } from "../help-chat-store";
import { createAuthenticatedAuth, createUnauthenticatedAuth } from "@/components/__tests__/test-utils";
import tailwindConfig from "../../../../tailwind.config";

vi.mock("next/image", () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} />,
}));

const mockUseAuth = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

const mockPathname = vi.fn<() => string | null>();
vi.mock("next/navigation", (): { usePathname: () => string | null } => ({
  usePathname: (): string | null => mockPathname(),
}));

beforeEach(() => {
  resetHelpChatForTests();
  mockUseAuth.mockReset();
  mockUseAuth.mockReturnValue(createUnauthenticatedAuth(false));
  mockPathname.mockReset();
  // The landing: public chrome, no rail, so the float is the whole affordance.
  mockPathname.mockReturnValue("/");
  vi.spyOn(global, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ reply: "Entrenamos de lunes a sábado." }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  resetHelpChatForTests();
});

describe("HelpChatDock — the launcher", () => {
  it("floats on every surface, named after the assistant it opens", () => {
    render(<HelpChatDock />);

    const launcher = screen.getByRole("button", { name: /abrir cata-bot/i });
    expect(launcher.className).toMatch(/\bfixed\b/);
    expect(launcher.className).toMatch(/\bbottom-4\b/);
    expect(launcher.className).toMatch(/\bright-2\b/);
    // 44px on a phone is the touch-target floor; the old FAB was 56px, which
    // is what made it impossible to fit beside anything.
    expect(launcher.className).toMatch(/\bh-11\b/);
    // #873 — coal, never white: the launcher must read on every light page
    // it can rest on, and a white disc on `paper`/`canvas` did not.
    expect(launcher.className).toContain("bg-coal");
    expect(launcher.className).not.toContain("bg-white");
  });

  it("serves the light crest, since the disc under it stays coal (#994)", () => {
    render(<HelpChatDock />);

    // The dark navy silhouette in `cata-club-crest-256.png` disappears on the
    // coal disc (#873 keeps it from going white). `-light.png` is the same
    // crop recolored fully white so it reads there — swap the crest, not the
    // disc's color.
    const crest = screen.getByRole("button", { name: /abrir cata-bot/i }).querySelector("img");
    expect(crest).toHaveAttribute("src", "/brand/cata-club-crest-256-light.png");
  });

  it("shows CATA-BOT's face big enough to read, without widening the phone corner", () => {
    /*
     * The complaint was that the assistant was hard to SEE. The 44px phone disc
     * cannot grow — it is exactly what lets the launcher sit beside the
     * landing's WhatsApp CTA — so on a phone the face grows inside it instead,
     * and from `lg` up, where the corner is empty, the whole disc grows.
     */
    const { container } = render(<HelpChatDock />);

    const launcher = screen.getByRole("button", { name: /abrir cata-bot/i });
    // The phone footprint is unchanged: same disc, same inset.
    expect(launcher.className).toMatch(/\bh-11\b/);
    expect(launcher.className).toMatch(/\bright-2\b/);
    // From `lg` up the disc is no longer the old 52px.
    expect(launcher.className).not.toMatch(/lg:h-\[52px\]/);
    expect(launcher.className).toMatch(/lg:h-\[76px\]/);
    expect(launcher.className).toMatch(/lg:w-\[76px\]/);

    const glyph = container.querySelector("span.rounded-full");
    expect(glyph).not.toBeNull();
    // 40px inside the 44px disc on a phone, 64px inside the 76px disc from
    // `lg` up — the face, not the padding, is what carries the disc.
    expect(glyph?.className).toMatch(/\bh-10\b/);
    expect(glyph?.className).toMatch(/\bw-10\b/);
    expect(glyph?.className).toMatch(/\blg:h-16\b/);
    expect(glyph?.className).toMatch(/\blg:w-16\b/);
  });

  it("carries a focus indicator that survives a light page", () => {
    render(<HelpChatDock />);
    const launcher = screen.getByRole("button", { name: /abrir cata-bot/i });

    // Never `outline-ball`: #FFD600 is 1.42:1 on white, half of what 2.4.11
    // asks. The two-tone ring keeps a white band and a coal band, so one of
    // them always contrasts against whatever is underneath.
    //
    // The two hexes used to be asserted on the className, because that is
    // where they were written. #32 moved them into `tailwind.config.ts`, so
    // the class names the token and the token is checked against the theme —
    // which is strictly more than the old assertion did: a `focus-duo-float`
    // that stopped carrying both bands would have passed the old test as long
    // as somebody left the hexes in the string.
    expect(launcher.className).not.toMatch(/outline-ball/);
    expect(launcher.className).toContain("focus-visible:shadow-focus-duo-float");

    const ring = (tailwindConfig.theme as { extend: { boxShadow: Record<string, string> } }).extend
      .boxShadow["focus-duo-float"];
    expect(ring).toContain("#FFFFFF");
    expect(ring).toContain("#131316");
    // And it restates the resting shadow, or the launcher loses it on focus.
    expect(ring).toContain("rgba(19, 19, 22, 0.30)");
  });

  it("opens the panel, and steps aside while it is open", () => {
    render(<HelpChatDock />);
    const launcher = screen.getByRole("button", { name: /abrir cata-bot/i });
    expect(launcher).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(launcher);

    expect(screen.getByRole("dialog", { name: /cata-bot/i })).toBeInTheDocument();
    expect(launcher).toHaveAttribute("aria-expanded", "true");
    // The panel has its own close control and shares the same corner — a
    // launcher left on top of it would be the only thing it ever covered.
    expect(launcher).toHaveAttribute("tabindex", "-1");
    expect(launcher.className).toContain("opacity-0");
  });

  it("closes on Escape and hands focus back to the launcher", () => {
    render(<HelpChatDock />);
    const launcher = screen.getByRole("button", { name: /abrir cata-bot/i });

    fireEvent.click(launcher);
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: /cata-bot/i })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(launcher);
  });

  it("mounts exactly one panel however the assistant was reached", () => {
    render(<HelpChatDock />);

    // The sidebar row, the landing block and the wizard header all go through
    // this same event.
    act((): void => openHelpChat());
    expect(screen.getAllByRole("dialog", { name: /cata-bot/i })).toHaveLength(1);

    act((): void => closeHelpChat());
    expect(screen.queryByRole("dialog", { name: /cata-bot/i })).not.toBeInTheDocument();
  });

  it("carries the draft a remote trigger sent with it", () => {
    render(<HelpChatDock />);

    act((): void => openHelpChat("Luis Lopez suma 3 ausencias este mes."));

    expect(screen.getByLabelText(/mensaje para cata-bot/i)).toHaveValue(
      "Luis Lopez suma 3 ausencias este mes.",
    );
  });

  it("keeps the quick replies role-scoped now that one panel serves every role", () => {
    mockUseAuth.mockReturnValue(createAuthenticatedAuth("trainer", "Carlos Mendez"));
    render(<HelpChatDock />);

    act((): void => openHelpChat());

    expect(screen.getByRole("button", { name: "¿Cómo tomo asistencia?" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "¿Cómo valido un pago?" })).not.toBeInTheDocument();
  });

  it("offers a logged-out visitor the questions the FAQ answers without a role", () => {
    render(<HelpChatDock />);

    act((): void => openHelpChat());

    expect(screen.getByRole("button", { name: "¿Cómo inicio sesión?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "¿Cuáles son los horarios?" })).toBeInTheDocument();
  });
});

/**
 * #59. The float and `ui/Table`'s action lane are anchored to the SAME right
 * edge, so from `lg` up — where the disc is 76x76 at a 20px inset — the corner
 * it rests in is the corner the action lane and the pager end in. Measured on
 * /members: the disc sits at (1344,804) at 1440x900 and (1184,624) at 1280x720,
 * and the "Editar" centres (x 1365 and x 1207) and the "Página siguiente"
 * centres (1345,839 and 1185,659) all fall inside it.
 *
 * The geometry is asserted in the browser, in `tests/e2e/launcher-occlusion`,
 * because that is where rects exist. What is asserted here is the RULE that
 * produces it: the float steps down exactly where the rail already carries
 * "Ayuda y soporte", and nowhere else.
 */
describe("HelpChatDock — where the rail already carries the assistant", () => {
  const RAIL_ROUTES = ["/members", "/dashboard", "/payments", "/discounts", "/trainer/attendance", "/ayuda"];
  const RAILLESS_ROUTES = ["/", "/login", "/reset-password", "/student/enroll", "/unauthorized"];

  it.each(RAIL_ROUTES)("steps down from lg up on %s", (route) => {
    mockPathname.mockReturnValue(route);
    render(<HelpChatDock />);

    // `lg:hidden`, not `opacity-0`: above `lg` on these routes the launcher is
    // not withdrawing until the corner frees up, it is not there at all.
    expect(screen.getByRole("button", { name: /abrir cata-bot/i }).className).toContain("lg:hidden");
  });

  it.each(RAILLESS_ROUTES)("keeps floating at every width on %s", (route) => {
    mockPathname.mockReturnValue(route);
    render(<HelpChatDock />);

    expect(screen.getByRole("button", { name: /abrir cata-bot/i }).className).not.toContain("lg:hidden");
  });

  it("still floats below lg on a rail route, where the rail is a drawer", () => {
    mockPathname.mockReturnValue("/members");
    render(<HelpChatDock />);

    // One media query does both: the phone disc is unconditional, and the
    // classes that grow it are the same ones that now remove it.
    const launcher = screen.getByRole("button", { name: /abrir cata-bot/i });
    expect(launcher.className).toMatch(/\bfixed\b/);
    expect(launcher.className).toMatch(/\bh-11\b/);
    expect(launcher.className).not.toContain("hidden lg:");
  });

  it("survives a route with no pathname rather than vanishing from it", () => {
    // Next's error boundaries render outside the router, and the root layout
    // mounts the dock on them too.
    mockPathname.mockReturnValue(null);
    render(<HelpChatDock />);

    expect(screen.getByRole("button", { name: /abrir cata-bot/i }).className).not.toContain("lg:hidden");
  });

  it("returns focus to the trigger that opened the panel, not always to itself", () => {
    mockPathname.mockReturnValue("/members");
    render(
      <>
        <button type="button" data-testid="rail-row" onClick={(): void => openHelpChat()}>
          Ayuda y soporte
        </button>
        <HelpChatDock />
      </>,
    );

    // Above `lg` on /members the launcher is the trigger that is NOT on screen,
    // so handing focus back to it would drop the caret on an invisible button.
    const railRow = screen.getByTestId("rail-row");
    railRow.focus();
    fireEvent.click(railRow);
    expect(screen.getByRole("dialog", { name: /cata-bot/i })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(document.activeElement).toBe(railRow);
  });
});

/**
 * #89. The launcher sat ON the admin phone tab bar at 390×844 — `transform:
 * none` at 300ms, 800ms, 1500ms and 3000ms, corrected only by a scroll of 1px.
 *
 * Measured in Chromium on /members, the corner was lost twice over, and the
 * two failures are independent:
 *
 *   · The measurement was queued on `requestAnimationFrame`, and a page that
 *     has not painted yet produces no frames. Instrumented, the launcher's
 *     first callback was requested at 77ms and ran at 2055ms. Worse, the
 *     coalescing guard read "a frame is pending" as "a measurement is
 *     pending", so the three `MutationObserver` firings inside that window —
 *     one of them the tab bar's own arrival, at 115ms — were dropped rather
 *     than deferred.
 *   · The resting rect was reconstructed as "where the launcher is drawn, plus
 *     the lift already applied". The lift is a `transform` on a 200ms
 *     transition, so for those 200ms the drawn rect is NOT the lift below the
 *     rest position — at the first frame it is still exactly at rest. The
 *     reconstruction then placed the rest rect 58px BELOW the viewport floor,
 *     found nothing there, concluded the corner was free and dropped the
 *     launcher back onto the tab bar. That is the `transform: none` at 3000ms.
 *
 * jsdom has no layout, so both are staged: a stylesheet gives the launcher the
 * inset its Tailwind classes carry, and every rect under test is stated.
 */
describe("HelpChatDock — #89, measuring the corner without a frame to lean on", () => {
  /** 390×844, the viewport the defect was measured at. */
  const VIEWPORT_HEIGHT = 844;
  /** `fixed inset-x-0 bottom-0 h-[62px]`, so it tops out here. */
  const TAB_BAR_TOP = 782;
  /** `bottom-4` (16px) under a 44px disc: the launcher rests at 784..828. */
  const REST_TOP = 784;
  const REST_BOTTOM = 828;
  /** 828 − 782 + 12px of breathing room. */
  const EXPECTED_LIFT = "translateY(-58px)";

  const rects = new Map<Element, DOMRect>();

  const stateRect = (element: Element, top: number, bottom: number, left = 338, right = 382): void => {
    rects.set(element, {
      top,
      bottom,
      left,
      right,
      width: right - left,
      height: bottom - top,
      x: left,
      y: top,
      toJSON: () => ({}),
    } as DOMRect);
  };

  const flush = async (): Promise<void> => {
    await act(async (): Promise<void> => {
      // Long enough to drain jsdom's own ~16ms `requestAnimationFrame` too,
      // so a test that reaches its point on the old code still does.
      await new Promise((resolve): unknown => setTimeout(resolve, 25));
      await new Promise((resolve): unknown => setTimeout(resolve, 25));
    });
  };

  /** The shell's tab bar, landing after the launcher — as it does on load. */
  const landTabBar = (): HTMLElement => {
    const tabBar = document.createElement("nav");
    tabBar.setAttribute("aria-label", "Navegación principal (móvil)");
    tabBar.style.position = "fixed";
    stateRect(tabBar, TAB_BAR_TOP, VIEWPORT_HEIGHT, 0, 390);
    document.body.appendChild(tabBar);
    return tabBar;
  };

  beforeEach(() => {
    rects.clear();
    mockPathname.mockReturnValue("/members");
    document.head.insertAdjacentHTML(
      "beforeend",
      '<style id="dock-clearance-fixture">.fixed { position: fixed } .bottom-4 { bottom: 16px }</style>',
    );
    Object.defineProperty(window, "innerHeight", { value: VIEWPORT_HEIGHT, configurable: true });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ): DOMRect {
      return rects.get(this) ?? ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 } as DOMRect);
    });
    // jsdom has no hit testing: the tab bar owns every point inside its band.
    document.elementsFromPoint = (_x: number, y: number): Element[] =>
      [...document.querySelectorAll("nav[aria-label]")].filter((node): boolean => {
        const rect = rects.get(node);
        return rect !== undefined && y >= rect.top && y <= rect.bottom;
      });
  });

  afterEach(() => {
    document.getElementById("dock-clearance-fixture")?.remove();
    delete (document as Partial<Document>).elementsFromPoint;
  });

  it("climbs over furniture that lands after it, with no frame ever painted", async () => {
    // The stall, staged: the browser accepts the request and never calls back.
    // Anything that queues the measurement behind a frame fails here, which is
    // the whole point — `requestAnimationFrame` is a paint scheduler, and this
    // measurement must not wait on a paint that may be two seconds away.
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);

    const { container } = render(<HelpChatDock />);
    const launcher = screen.getByRole("button", { name: /abrir cata-bot/i });
    stateRect(launcher, REST_TOP, REST_BOTTOM);
    expect(container).toBeTruthy();

    landTabBar();
    await flush();

    expect(launcher.style.transform).toBe(EXPECTED_LIFT);
  });

  it("stays up when it re-measures before its own transition has moved it", async () => {
    render(<HelpChatDock />);
    const launcher = screen.getByRole("button", { name: /abrir cata-bot/i });
    stateRect(launcher, REST_TOP, REST_BOTTOM);

    landTabBar();
    await flush();
    expect(launcher.style.transform).toBe(EXPECTED_LIFT);

    // React has committed `translateY(-58px)`, the 200ms transition has not
    // moved a pixel yet, so the launcher is still DRAWN at rest — and a scroll
    // arrives. The rest rect must not be re-derived from where it is drawn.
    fireEvent.scroll(window);
    await flush();

    expect(launcher.style.transform).toBe(EXPECTED_LIFT);
  });

  it("comes back down when the furniture leaves", async () => {
    render(<HelpChatDock />);
    const launcher = screen.getByRole("button", { name: /abrir cata-bot/i });
    stateRect(launcher, REST_TOP, REST_BOTTOM);

    const tabBar = landTabBar();
    await flush();
    expect(launcher.style.transform).toBe(EXPECTED_LIFT);

    tabBar.remove();
    await flush();

    expect(launcher.style.transform).toBe("");
  });
});

describe("resolveClearance", () => {
  it("rests in the corner when nothing owns it", () => {
    expect(resolveClearance(0)).toEqual({ lift: 0, withdrawn: false });
    expect(resolveClearance(-8)).toEqual({ lift: 0, withdrawn: false });
  });

  it("climbs over a strip along the bottom edge", () => {
    // Measured: the admin phone tab bar tops out at y=782 of 844 and the
    // launcher rests with its bottom at y=828, so clearing it costs 58.
    expect(resolveClearance(58)).toEqual({ lift: 58, withdrawn: false });
  });

  it("withdraws instead of hovering over a surface that owns the whole bottom", () => {
    // Measured: the trainer's attendance commit bar is 165px tall at 390×844
    // and tops out at y=679, which costs 161. Climbing over it would park the
    // launcher in the middle of the roster the trainer is working through —
    // exactly the occlusion this replaced.
    expect(resolveClearance(161)).toEqual({ lift: 0, withdrawn: true });
  });

  it("draws the line at one tab bar's worth of yielding", () => {
    expect(resolveClearance(96).withdrawn).toBe(false);
    expect(resolveClearance(97).withdrawn).toBe(true);
  });
});
