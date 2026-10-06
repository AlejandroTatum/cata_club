"use client";

import { createContext, useContext, useEffect, useState } from "react";

export interface SponsorItem {
  /** Numeric id from the backend — the stable identity used for React keys. */
  id: number;
  /** Display name used for the logo's alt text. */
  name: string;
  /** Public URL to the sponsor's logo asset. */
  logoSrc: string;
}

/**
 * One record of the public backend payload at GET /api/sponsors.
 *
 * Wire contract is camelCase: the backend's ResponseBase alias_generator
 * serializes the snake_case DTO fields as camelCase (logo_url -> logoUrl —
 * asserted by backend/tests/test_sponsors.py), and the admin client in
 * src/services/api.ts already consumes `logoUrl`.
 */
export interface PublicSponsorPayload {
  id?: unknown;
  nombre?: unknown;
  logoUrl?: unknown;
}

/**
 * Maps one public backend record into the landing's sponsor shape, dropping
 * records that carry no usable name or logo URL so malformed rows can never
 * render a blank tile or a broken image.
 */
export function mapSponsor(payload: PublicSponsorPayload): SponsorItem | null {
  if (
    typeof payload?.id !== "number"
    || typeof payload?.nombre !== "string"
    || typeof payload?.logoUrl !== "string"
  ) return null;
  const name = payload.nombre.trim();
  const logoSrc = payload.logoUrl.trim();
  if (!name || !logoSrc) return null;
  return { id: payload.id, name, logoSrc };
}

/**
 * Widest viewport one marquee copy pre-fills with real logos. Past it the
 * `min-width: 100vw` in landing.css still keeps the loop continuous — it just
 * parks the leftover width at the seam instead of between the logos.
 */
const MAX_VIEWPORT_PX = 3840;

/**
 * Widest a tile plus its gap can get: `.landing-sponsors-item` is
 * clamp(300px, 30vw, 416px) and the gap is 18px (landing.css). Narrower
 * viewports shrink the tile, but they shrink the viewport faster, so this is
 * the worst case for "how many tiles does it take to cross the screen".
 */
const MAX_TILE_SPAN_PX = 416 + 18;

/** Tiles one copy needs to outrun the widest viewport on its own. */
const TILES_PER_COPY = Math.ceil(MAX_VIEWPORT_PX / MAX_TILE_SPAN_PX);

/**
 * How many times one copy repeats the roster. The count falls as sponsors are
 * added — one sponsor repeats nine times, nine sponsors repeat once — so the
 * strip is always about as long as the screen it has to cover, never longer
 * because the club signed more sponsors.
 */
export function repetitionsFor(sponsors: number): number {
  return sponsors > 0 ? Math.ceil(TILES_PER_COPY / sponsors) : 1;
}

/** One logo tile. If the image cannot load, the sponsor's name takes its place, centered. */
function SponsorLogo({ sponsor }: { sponsor: SponsorItem }): React.ReactElement {
  const [failed, setFailed] = useState(false);
  return (
    <span className="landing-sponsor">
      {failed
        ? <span className="landing-sponsor-name">{sponsor.name}</span>
        // eslint-disable-next-line @next/next/no-img-element -- external Cloudinary URL, not a local/static asset (same pattern as AppShell's avatar / /profile's IdentityPanel)
        : <img src={sponsor.logoSrc} alt={sponsor.name} width={312} height={120} onError={(): void => setFailed(true)} />}
    </span>
  );
}

export type SponsorsState =
  | { kind: "loading" }
  | { kind: "ready"; sponsors: SponsorItem[] }
  | { kind: "empty" }
  | { kind: "error" };

/** Fetches the public roster once. */
function useSponsorsFetch(enabled: boolean): SponsorsState {
  const [state, setState] = useState<SponsorsState>({ kind: "loading" });

  useEffect((): (() => void) | void => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/api/sponsors", { cache: "no-store" })
      .then((response): Promise<unknown> => {
        if (!response.ok) throw new Error(`sponsors ${response.status}`);
        return response.json();
      })
      .then((payload: unknown): void => {
        if (cancelled) return;
        const sponsors = Array.isArray(payload)
          ? payload.map(mapSponsor).filter((sponsor): sponsor is SponsorItem => sponsor !== null)
          : [];
        setState(sponsors.length > 0 ? { kind: "ready", sponsors } : { kind: "empty" });
      })
      .catch((): void => {
        if (!cancelled) setState({ kind: "error" });
      });
    return (): void => { cancelled = true; };
  }, [enabled]);

  return state;
}

const SponsorsContext = createContext<SponsorsState | null>(null);

/**
 * Fetches GET /api/sponsors once and shares it with every `Sponsors` strip
 * below it, so the page can show the roster in several places for one request.
 */
export function SponsorsProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const state = useSponsorsFetch(true);
  return <SponsorsContext.Provider value={state}>{children}</SponsorsContext.Provider>;
}

/**
 * Data-driven sponsor marquee backed entirely by the public GET /api/sponsors
 * route (which proxies the backend's /sponsors/). No static sponsor list
 * competes with the API: while loading the strip stays quiet, and empty or
 * error responses surface an honest one-line status instead of invented
 * placeholder slots. Inside a `SponsorsProvider` it reads the shared roster;
 * on its own it fetches. The `highlight` strip (under the hero) carries its own
 * id and accessible name and renders nothing until there are sponsors; the
 * default strip keeps `#patrocinadores`, the target of the nav and footer links.
 */
export default function Sponsors({ highlight = false }: { highlight?: boolean }): React.ReactElement | null {
  const shared = useContext(SponsorsContext);
  const own = useSponsorsFetch(shared === null);
  const state = shared ?? own;

  if (highlight && state.kind !== "ready") return null;

  let accessibleStatus: string;
  if (state.kind === "ready") {
    accessibleStatus = `Patrocinadores: ${state.sponsors.map((sponsor): string => sponsor.name).join(", ")}.`;
  } else if (state.kind === "empty") {
    accessibleStatus = "Pronto anunciaremos a nuestros patrocinadores";
  } else if (state.kind === "error") {
    accessibleStatus = "No se pudieron cargar los patrocinadores.";
  } else {
    accessibleStatus = "Cargando patrocinadores…";
  }

  // One copy is the roster repeated until it spans the screen. Only the first
  // pass is exposed: the rest are decoration, and the duplicate copy is already
  // hidden wholesale by its container, so the roster is announced once.
  const renderCopy = (duplicate: boolean): React.ReactElement[] => state.kind === "ready"
    ? Array.from({ length: repetitionsFor(state.sponsors.length) }, (_, pass): React.ReactElement[] =>
        state.sponsors.map((sponsor): React.ReactElement => (
          <span
            className="landing-sponsors-item"
            key={`${sponsor.id}-${duplicate ? "duplicate" : "primary"}-${pass}`}
            aria-hidden={pass > 0 || undefined}
          >
            <SponsorLogo sponsor={sponsor} />
          </span>
        ))
      ).flat()
    : [];

  return (
    <section
      className={highlight ? "landing-sponsors landing-sponsors-highlight" : "landing-sponsors"}
      id={highlight ? "patrocinadores-destacados" : "patrocinadores"}
      aria-label={highlight ? "Patrocinadores destacados del club" : "Patrocinadores del club"}
    >
      <p className="landing-sponsors-head">Patrocinadores</p>
      {/* The empty/error paragraphs below are themselves the accessible status;
          only loading/ready states need a screen-reader-only copy. */}
      {state.kind === "loading" || state.kind === "ready" ? <p className="sr-only">{accessibleStatus}</p> : null}
      {state.kind === "loading" ? null : state.kind === "ready" ? (
        <div className="landing-sponsors-viewport">
          <div className="landing-sponsors-track" data-sponsors-track>
            <span className="landing-sponsors-copy">{renderCopy(false)}</span>
            <span className="landing-sponsors-copy" aria-hidden="true">{renderCopy(true)}</span>
          </div>
        </div>
      ) : (
        <p className="landing-sponsors-status">
          {accessibleStatus}
        </p>
      )}
    </section>
  );
}
