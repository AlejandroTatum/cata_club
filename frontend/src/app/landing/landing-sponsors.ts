export interface Sponsor {
  /** Display name used for the logo's alt text. */
  name: string;
  /** Public URL to the sponsor's logo asset. */
  logoSrc: string;
  /** Optional link to the sponsor's site. */
  href?: string;
}

/**
 * Real sponsor data goes here once the club provides it. Until then the strip
 * renders six visibly empty placeholder slots so the page does not invent
 * partners it does not have.
 */
export const SPONSORS: Sponsor[] = [];

/** Number of dashed placeholder slots shown while `SPONSORS` is empty. */
export const SPONSOR_PLACEHOLDER_COUNT = 6;
