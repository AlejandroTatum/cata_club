"use client";

import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import { CLUB_POSITION } from "./club-location";

L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

export default function MapCanvas(): React.ReactElement {
  return (
    <MapContainer className="landing-map" center={CLUB_POSITION} zoom={17} scrollWheelZoom={false} aria-label="Mapa de ubicación de Cata Club">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Marker position={CLUB_POSITION}><Popup>Cata Club · Tenis de Mesa</Popup></Marker>
    </MapContainer>
  );
}
