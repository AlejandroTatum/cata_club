import type { Page, Route } from "@playwright/test";

/** The club's transfer data as `GET /api/club/payment-info` answers a signed-in user. */
export const MOCK_CLUB_PAYMENT_INFO = {
  holder: "Titular Prueba",
  accountType: "Cuenta de Ahorros",
  accountNumber: "1234567890",
  bank: "Banco Prueba",
  holderId: "0102030405",
};

/**
 * Mocks `GET /api/club/payment-info` for any spec whose screen renders «Cómo
 * pagar» (`/student/payments`, `/student/add-dependent`, `/ayuda`). Unmocked,
 * the call escapes to the real BFF and a 401 there used to bounce the app to
 * /login mid-navigation. Call it from every guardian/student portal mock.
 */
export async function mockClubPaymentInfo(page: Page): Promise<void> {
  await page.route("**/api/club/payment-info", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "private, no-store" },
      body: JSON.stringify(MOCK_CLUB_PAYMENT_INFO),
    }),
  );
}
