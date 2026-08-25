"use client";

import { useEffect, useState } from "react";

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

type SponsorsState =
  | { kind: "loading" }
  | { kind: "ready"; sponsors: SponsorItem[] }
  | { kind: "empty" }
  | { kind: "error" };

/**
 * Data-driven sponsor marquee backed entirely by the public GET /api/sponsors
 * route (which proxies the backend's /sponsors/). No static sponsor list
 * competes with the API: while loading the strip stays quiet, and empty or
 * error responses surface an honest one-line status instead of invented
 * placeholder slots.
 */
export default function Sponsors(): React.ReactElement {
  const [state, setState] = useState<SponsorsState>({ kind: "loading" });

  useEffect((): (() => void) => {
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
  }, []);

  let accessibleStatus: string;
  if (state.kind === "ready") {
    accessibleStatus = `Auspiciantes: ${state.sponsors.map((sponsor): string => sponsor.name).join(", ")}.`;
  } else if (state.kind === "empty") {
    accessibleStatus = "Aún no hay auspiciantes cargados.";
  } else if (state.kind === "error") {
    accessibleStatus = "No se pudieron cargar los auspiciantes.";
  } else {
    accessibleStatus = "Cargando auspiciantes…";
  }

  const renderCopy = (duplicate: boolean): React.ReactElement[] => state.kind === "ready"
    ? state.sponsors.map((sponsor): React.ReactElement => (
        <span className="landing-sponsors-item" key={`${sponsor.id}-${duplicate ? "duplicate" : "primary"}`}>
          <span className="landing-sponsor">
            {/* eslint-disable-next-line @next/next/no-img-element -- external Cloudinary URL, not a local/static asset (same pattern as AppShell's avatar / /profile's IdentityPanel) */}
            <img src={sponsor.logoSrc} alt={sponsor.name} width={156} height={60} />
          </span>
        </span>
      ))
    : [];

  return (
    <section className="landing-sponsors" aria-label="Auspiciantes del club">
      <p className="landing-sponsors-head">Nos acompañan</p>
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
