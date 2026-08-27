"use client";

import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import { CLUB_POSITION } from "./club-location";

/**
 * The default marker art, served from our own origin — see issue #709.
 *
 * Leaflet's stock defaults point at `unpkg.com`, so every anonymous visitor's
 * browser used to fetch the pin from a CDN we do not control. Two problems,
 * and availability is the worse one: on a network that blocks unpkg the map
 * still renders while the marker silently disappears, which turns "the club
 * is here" into a map of Loja with nothing on it. The privacy cost is the
 * second: the visitor's IP travelled to a third party for 4.5KB of PNG that
 * already ships inside the `leaflet` package we depend on.
 *
 * These three files are byte-identical copies of
 * `node_modules/leaflet/dist/images/*` (leaflet 1.9.4), checked into
 * `public/leaflet/` next to the rest of the static art. Keep them in sync if
 * the leaflet major ever moves; the shapes have not changed since 1.x.
 */
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "/leaflet/marker-icon-2x.png",
  iconUrl: "/leaflet/marker-icon.png",
  shadowUrl: "/leaflet/marker-shadow.png",
});

export default function MapCanvas(): React.ReactElement {
  return (
    <MapContainer className="landing-map" center={CLUB_POSITION} zoom={17} scrollWheelZoom={false} aria-label="Mapa de ubicación de Cata Club">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Marker position={CLUB_POSITION}><Popup>Cata Club · Tenis de Mesa</Popup></Marker>
    </MapContainer>
  );
}
