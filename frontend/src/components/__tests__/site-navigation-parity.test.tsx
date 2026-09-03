/**
 * Divergence guard for the site's public navigation — issue #771.
 *
 * The site carried TWO navigations under the same logo, as two literals in two
 * files: the landing's own navbar (`app/landing/LandingPage.tsx`) and
 * `INSTITUTIONAL_LINKS` in `components/Header.tsx`. They drifted into different
 * section sets, so a visitor going from `/` to `/terminos` watched the whole
 * menu change — the site contradicting itself about which sections it has.
 *
 * This file renders BOTH navigations and compares them against each other and
 * against the approved list. Extracting a shared definition removes the
 * literal-vs-literal drift, but it does not remove every way the two can still
 * disagree, and this file covers what is left:
 *
 *  - a hand-written anchor added beside the shared ones in either navbar,
 *    which is why every assertion reads the RENDERED DOM and never the shared
 *    constant;
 *  - the href FORM, which is deliberately different on each side and is the
 *    one thing that must not be "unified" (see the href test below);
 *  - a landing section renamed or removed while the link survives, checked by
 *    resolving every nav target against the landing's own rendered document.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import Header from "@/components/Header";
import LandingPage from "@/app/landing/LandingPage";
// Only the stub/teardown pair, not the mock registrations: this file keeps
// its own `next/image` double below (it also mocks `next/link`,
// `AuthContext` and more), so it must not import `landing-render-mocks`.
import { resetLandingTestEnvironment, stubLandingGlobals } from "@/app/landing/__tests__/landing-test-doubles";

interface MockLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  children: React.ReactNode;
  href: string;
}

interface MockImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  fill?: boolean;
  priority?: boolean;
}

// ---------------------------------------------------------------------------
// Mocks — the minimum both trees need to mount under jsdom.
// ---------------------------------------------------------------------------

const mockPathname = vi.fn<() => string>();

vi.mock("next/navigation", (): { usePathname: () => string } => ({
  usePathname: (): string => mockPathname(),
}));

vi.mock("next/link", (): { __esModule: boolean; default: (props: MockLinkProps) => React.ReactElement } => ({
  __esModule: true,
  default: ({ children, href, ...props }: MockLinkProps): React.ReactElement => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", (): { __esModule: boolean; default: (props: MockImageProps) => React.ReactElement } => ({
  __esModule: true,
  default: ({ fill: _fill, priority: _priority, sizes: _sizes, alt, ...rest }: MockImageProps): React.ReactElement => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt ?? ""} {...rest} />
  ),
}));

vi.mock("@/app/landing/LandingMap", (): { default: () => React.ReactElement } => ({
  default: (): React.ReactElement => <div aria-label="Mapa de ubicación de Cata Club" />,
}));

vi.mock("@/app/landing/LandingMotion", (): { default: () => null } => ({
  default: (): null => null,
}));

vi.mock("@/contexts/AuthContext", (): { useAuth: () => unknown } => ({
  useAuth: (): unknown => ({
    isAuthenticated: false,
    session: null,
    logout: vi.fn(),
    isLoading: false,
  }),
}));

vi.mock("@/lib/useNotificaciones", (): { useNotificaciones: () => unknown } => ({
  useNotificaciones: (): unknown => ({ notificaciones: [], loadError: null, markRead: vi.fn() }),
}));

/**
 * The order and wording a new visitor meets first, spelled out here rather than
 * imported: a guard that reads the same constant the code reads can only ever
 * agree with it.
 */
const APPROVED_NAV: ReadonlyArray<{ label: string; section: string }> = [
  { label: "Inicio", section: "inicio" },
  { label: "Horarios", section: "horarios" },
  { label: "Valores", section: "valores" },
  { label: "Logros", section: "logros" },
  { label: "Galería", section: "galeria" },
  { label: "Contacto", section: "contacto" },
];

/** The landing's own navbar: the six anchors inside `.landing-nav-links`. */
function landingNavAnchors(root: HTMLElement): HTMLAnchorElement[] {
  const list = root.querySelector<HTMLElement>(".landing-nav-links");
  if (!list) throw new Error("landing navbar not found");
  return Array.from(list.querySelectorAll("a"));
}

/**
 * The institutional header's desktop navbar. The brand lockup and the login
 * button are siblings of the list, so the `<ul>` holds the section links and
 * nothing else.
 */
function headerNavAnchors(root: HTMLElement): HTMLAnchorElement[] {
  const nav = within(root).getByRole("navigation");
  const list = nav.querySelector("ul");
  if (!list) throw new Error("institutional navbar not found");
  return Array.from(list.querySelectorAll("a"));
}

function labelsOf(anchors: HTMLAnchorElement[]): string[] {
  return anchors.map((anchor): string => anchor.textContent ?? "");
}

function hrefsOf(anchors: HTMLAnchorElement[]): string[] {
  return anchors.map((anchor): string => anchor.getAttribute("href") ?? "");
}

/** The landing section an href aims at, whichever form the href takes. */
function targetSectionOf(href: string): string {
  const hash = href.indexOf("#");
  return hash === -1 ? "" : href.slice(hash + 1);
}

describe("public navigation parity (issue #771)", (): void => {
  beforeEach((): void => {
    mockPathname.mockReturnValue("/terminos");
    stubLandingGlobals();
  });

  afterEach((): void => {
    resetLandingTestEnvironment();
  });

  it("names the same sections, in the same order, on the landing and off it", (): void => {
    const landing = render(<LandingPage />).container;
    const header = render(<Header />).container;

    const expectedLabels = APPROVED_NAV.map((entry): string => entry.label);
    const expectedSections = APPROVED_NAV.map((entry): string => entry.section);

    expect(labelsOf(landingNavAnchors(landing))).toEqual(expectedLabels);
    expect(labelsOf(headerNavAnchors(header))).toEqual(expectedLabels);

    expect(hrefsOf(landingNavAnchors(landing)).map(targetSectionOf)).toEqual(expectedSections);
    expect(hrefsOf(headerNavAnchors(header)).map(targetSectionOf)).toEqual(expectedSections);
  });

  it("keeps the mobile panel on the same list as the bar above it", (): void => {
    const header = render(<Header />).container;

    fireEvent.click(within(header).getByRole("button", { name: /Abrir menú/i }));

    const panel = header.querySelector<HTMLElement>("div.md\\:hidden");
    if (!panel) throw new Error("mobile panel not found");
    const sectionLinks = Array.from(panel.querySelectorAll("a")).filter(
      (anchor): boolean => (anchor.getAttribute("href") ?? "").includes("#"),
    );

    expect(labelsOf(sectionLinks)).toEqual(APPROVED_NAV.map((entry): string => entry.label));
    expect(hrefsOf(sectionLinks)).toEqual(hrefsOf(headerNavAnchors(header)));
  });

  it("scrolls in place on the landing and travels to the landing from anywhere else", (): void => {
    const landing = render(<LandingPage />).container;
    const header = render(<Header />).container;

    // On the landing the target is a section of the CURRENT document, so the
    // href stays a bare fragment: no route change, no remount, no lost scroll
    // position.
    expect(hrefsOf(landingNavAnchors(landing))).toEqual(
      APPROVED_NAV.map((entry): string => `#${entry.section}`),
    );

    // From `/terminos` the same fragment would name a section this page does
    // not have — a link to nothing. The href has to carry the landing's path
    // as well, so the click navigates there and then to the section.
    expect(hrefsOf(headerNavAnchors(header))).toEqual(
      APPROVED_NAV.map((entry): string => `/#${entry.section}`),
    );
  });

  it("points every link at a section the landing actually renders", (): void => {
    const landing = render(<LandingPage />).container;
    const header = render(<Header />).container;

    const targets = [
      ...hrefsOf(landingNavAnchors(landing)),
      ...hrefsOf(headerNavAnchors(header)),
    ].map(targetSectionOf);

    const missing = targets.filter((section): boolean => landing.querySelector(`#${section}`) === null);

    expect(missing).toEqual([]);
  });
});
