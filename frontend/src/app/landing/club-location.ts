/**
 * The club's location, in one place.
 *
 * Three things used to carry this coordinate independently: the map's centre,
 * the marker dropped on it, and the "Cómo llegar" link handed to OpenStreetMap.
 * Three copies of a number are three chances for two of them to disagree, and
 * a marker that disagrees with its viewport sends a visitor to the wrong block
 * without anything looking broken. They all read from here now.
 *
 * NOTE (#641): this pair is the club's own access point — the coordinate the
 * repository's location asset, `public/landing/location-map-reference.png`,
 * already marks. Re-orienting the map around the Plaza de la Independencia is
 * still open: no product source in this repository records a coordinate for
 * that plaza, and the issue forbids assuming one. The value below is therefore
 * unchanged and deliberately not a guess.
 */
export const CLUB_POSITION: [number, number] = [-4.0056095, -79.2046238];

/**
 * Zoom for the external link only. Leaflet's own zoom belongs to the embedded
 * map and stays there — the two surfaces have never shared it, and this
 * module's contract is the coordinate, not the framing.
 */
const OPENSTREETMAP_LINK_ZOOM = 18;

/**
 * The "Cómo llegar" destination: a marker (`mlat`/`mlon`) plus the `#map` hash
 * that moves the viewport onto it. Both halves are built from `CLUB_POSITION`
 * so they cannot drift apart.
 */
export function clubOpenStreetMapUrl(): string {
  const [latitude, longitude] = CLUB_POSITION;
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=${OPENSTREETMAP_LINK_ZOOM}/${latitude}/${longitude}`;
}
