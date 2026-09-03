/**
 * Divergence guard between the landing and the assistant — issue #768.
 *
 * The assistant now carries the club's own facts — where it trains, how to
 * reach it, what it says it stands for — because a visitor asking "¿dónde
 * queda?" was previously told the bot had no such information while the
 * landing had been answering it for months.
 *
 * Feeding those facts to the model made a second copy of them, and a second
 * copy nobody checks is exactly the defect #768 exists to close. This file
 * renders the landing and reads the exact bytes the model is sent, and asserts
 * the facts below appear in BOTH. Neither side reads the other's source.
 *
 * The list is spelled out here rather than imported, for the same reason
 * `site-navigation-parity.test.tsx` spells out its own: a guard that reads the
 * constant the code reads can only ever agree with it.
 *
 * What this file deliberately does NOT cover: the landing's schedule section.
 * It renders whatever `/api/schedules` returns at runtime — live club data,
 * not copy — so there is no offline rendering of it to compare against. The
 * static training times are guarded on the `/ayuda` side instead
 * (`app/ayuda/__tests__/knowledge-parity.test.tsx`).
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import LandingPage from "@/app/landing/LandingPage";
// Only the stub/teardown pair, not the mock registrations: this file keeps
// its own `next/image` double below (it also mocks `next/link`,
// `AuthContext` and more), so it must not import `landing-render-mocks`.
import { resetLandingTestEnvironment, stubLandingGlobals } from "./landing-test-doubles";

interface MockLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  children: React.ReactNode;
  href: string;
}

interface MockImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  fill?: boolean;
  priority?: boolean;
}

vi.mock("next/navigation", (): { usePathname: () => string } => ({
  usePathname: (): string => "/",
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

const PROMPT_SNAPSHOT = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "backend",
  "app",
  "servicios_negocio",
  "prompt_sistema.txt",
);

/**
 * Facts a visitor plans a trip or a phone call around, and the ones the club
 * chose to say about itself. If the landing and the assistant ever disagree
 * about one of these, one of them is sending someone to the wrong place.
 */
const CLUB_FACTS: readonly string[] = [
  // Where it is.
  "Av. Manuel Agustín Aguirre",
  "Barrio Perpetuo Socorro",
  "Coliseo Ciudad de Loja",
  "XQVW+J63",
  // How to reach it.
  "0994219619",
  "0990288152",
  "@cataclub_tenis_de_mesa",
  // What it says it is.
  "Promover el tenis de mesa mediante formación deportiva de calidad",
  "Ser un club líder y referente provincial y nacional",
  "Respeto",
  "Disciplina",
  "Esfuerzo",
  "Compañerismo",
];

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

describe("club facts parity — the landing vs the system prompt (issue #768)", (): void => {
  beforeEach((): void => {
    stubLandingGlobals();
  });

  afterEach((): void => {
    resetLandingTestEnvironment();
  });

  it("can see both rendered representations at all", (): void => {
    const landing = render(<LandingPage />).container;
    expect(normalise(landing.textContent ?? "").length).toBeGreaterThan(1000);
    expect(readFileSync(PROMPT_SNAPSHOT, "utf8").length).toBeGreaterThan(2000);
  });

  it("tells a visitor and the assistant the same thing about the club", (): void => {
    const landing = normalise(render(<LandingPage />).container.textContent ?? "");
    const prompt = normalise(readFileSync(PROMPT_SNAPSHOT, "utf8"));

    const missingFromLanding = CLUB_FACTS.filter((fact): boolean => !landing.includes(fact));
    const missingFromPrompt = CLUB_FACTS.filter((fact): boolean => !prompt.includes(fact));

    expect(missingFromLanding).toEqual([]);
    expect(missingFromPrompt).toEqual([]);
  });
});
