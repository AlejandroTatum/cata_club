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
vi.mock("leaflet", (): { default: { Icon: { Default: { mergeOptions: () => void } } } } => ({
  default: { Icon: { Default: { mergeOptions: (): void => {} } } },
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
});
