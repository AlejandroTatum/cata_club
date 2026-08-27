/** @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLUB_POSITION } from "@/app/landing/club-location";
import MapCanvas from "@/app/landing/MapCanvas";

/**
 * Leaflet reaches for DOM geometry jsdom does not implement, and this suite is
 * not about Leaflet: it is about which coordinate MapCanvas hands it. Both
 * modules are reduced to prop recorders so the centre and the marker can be
 * read straight off the render.
 */
/**
 * `mergeOptions` runs once, at module-import time, so its argument is captured
 * on the hoisted recorder rather than reset per test — see the marker-art
 * assertions below (issue #709).
 */
const { iconDefaults } = vi.hoisted((): { iconDefaults: { options: Record<string, string> } } => ({
  iconDefaults: { options: {} },
}));

vi.mock("leaflet", (): { default: { Icon: { Default: { mergeOptions: (o: Record<string, string>) => void } } } } => ({
  default: {
    Icon: {
      Default: {
        mergeOptions: (options: Record<string, string>): void => {
          iconDefaults.options = options;
        },
      },
    },
  },
}));

const { recorded } = vi.hoisted((): { recorded: { center: unknown; position: unknown } } => ({
  recorded: { center: undefined, position: undefined },
}));

vi.mock("react-leaflet", (): Record<string, unknown> => ({
  MapContainer: ({ center, children }: { center: unknown; children?: React.ReactNode }): React.ReactElement => {
    recorded.center = center;
    return <div>{children}</div>;
  },
  Marker: ({ position, children }: { position: unknown; children?: React.ReactNode }): React.ReactElement => {
    recorded.position = position;
    return <div>{children}</div>;
  },
  Popup: ({ children }: { children?: React.ReactNode }): React.ReactElement => <div>{children}</div>,
  TileLayer: (): React.ReactElement => <div />,
}));

beforeEach((): void => {
  recorded.center = undefined;
  recorded.position = undefined;
});

afterEach((): void => {
  cleanup();
});

describe("MapCanvas", (): void => {
  /**
   * Identity, not equality. Two separately typed literals holding the same
   * numbers would satisfy `toEqual` while still being two coordinates that a
   * later edit can move apart — which is the whole failure this is here to
   * prevent. Only the shared constant itself passes.
   */
  it("centres the map and drops the marker on the shared club coordinate", (): void => {
    render(<MapCanvas />);

    expect(recorded.center).toBe(CLUB_POSITION);
    expect(recorded.position).toBe(CLUB_POSITION);
  });

  /**
   * Lock — issue #709. Leaflet's stock defaults point the pin at
   * `unpkg.com`; measured on `main` @ `97ae590` the landing fetched
   * `marker-icon.png` and `marker-shadow.png` from there on every visit. On a
   * network that blocks the CDN the tiles still draw and only the pin goes
   * missing, so the failure is silent: a map of Loja with nothing marked on
   * it. Every URL leaflet is handed must therefore be same-origin.
   */
  it("serves the marker art from our own origin, never a CDN", (): void => {
    render(<MapCanvas />);

    expect(iconDefaults.options).toEqual({
      iconRetinaUrl: "/leaflet/marker-icon-2x.png",
      iconUrl: "/leaflet/marker-icon.png",
      shadowUrl: "/leaflet/marker-shadow.png",
    });
    for (const url of Object.values(iconDefaults.options)) {
      expect(url.startsWith("/")).toBe(true);
    }
  });
});
