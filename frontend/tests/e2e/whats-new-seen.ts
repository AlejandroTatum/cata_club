/**
 * Browser storage that already carries the "what's-new seen" mark.
 *
 * The welcome dialog opens on the first authenticated screen of every fresh
 * browser, which is every Playwright context. `playwright.config.ts` seeds
 * this into the default `use`, so every project (chromium, mobile-chromium,
 * e2e-live — the nightly contrast sweep included) starts as a returning user
 * and the dialog never covers the screen under test. It reads the version from
 * the app's own constant, so a release that bumps it needs no edit here.
 *
 * `whats-new.spec.ts` is the one spec that opts out
 * (`test.use({ storageState: EMPTY_STORAGE_STATE })`) to prove first-visit.
 */

import { WHATS_NEW_STORAGE_KEY, WHATS_NEW_VERSION } from "../../src/lib/whats-new/content";
import { E2E_BASE_URL } from "./e2e-target";

export const WHATS_NEW_SEEN_STORAGE_STATE = {
  cookies: [],
  origins: [
    {
      origin: new URL(E2E_BASE_URL).origin,
      localStorage: [{ name: WHATS_NEW_STORAGE_KEY, value: WHATS_NEW_VERSION }],
    },
  ],
};

export const EMPTY_STORAGE_STATE = { cookies: [], origins: [] };
