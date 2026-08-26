/**
 * The club's location, in one place.
 *
 * Three things used to carry this coordinate independently: the map's centre,
 * the marker dropped on it, and the "Cómo llegar" link handed to OpenStreetMap.
 * Three copies of a number are three chances for two of them to disagree, and
 * a marker that disagrees with its viewport sends a visitor to the wrong block
 * without anything looking broken. They all read from here now.
 *
 * The pair below is the centre of the cell the product owner's Plus Code
 * resolves to — see `CLUB_PLUS_CODE`. It is not a surveyed point: eleven
 * significant digits resolve to roughly three metres square, which is well
 * inside what a map at this zoom can express, but it is the reason nothing
 * here claims more precision than the code carries.
 */
export const CLUB_POSITION: [number, number] = [-4.0059875, -79.2044531];

/**
 * The club's address as the product owner supplies it (#641), verbatim.
 *
 * It is a *short* Open Location Code: meaningless without a reference
 * locality, which is why the locality travels with it. Recovered against
 * Loja, Ecuador it is the full code `6772XQVW+J63`, and that recovery is what
 * `CLUB_POSITION` was derived from — the two are one fact, written twice for
 * two audiences, and must be changed together.
 *
 * This also settles the open question in #641. The code lands on the club's
 * own address, not on the Plaza de la Independencia, so the Coliseo Ciudad de
 * Loja stays as the landmark the visible copy leans on.
 */
export const CLUB_PLUS_CODE = "XQVW+J63, 110102 Loja";

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
