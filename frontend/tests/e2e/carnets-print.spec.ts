/**
 * The admin's batch carnets on A4 (#1670), proved in a real print layout.
 *
 * The unit tests read the CSS the owner's numbers live in; only a browser can
 * say whether ten carnets really land as nine 85,6 × 54 mm cards on a first A4
 * sheet and one on a second, with nothing clipped inside a card. Print media is
 * emulated and the page rendered to a PDF, which is what the print dialog does.
 */

import { expect, test, type Page, type Route } from "@playwright/test";

import { E2E_BASE_URL } from "./e2e-target";

const MOCK_SESSION = {
  user: { id: "1", name: "Admin Demo", email: "admin@cataclub.com", role: "admin" as const, representanteId: null },
  roles: ["ADMINISTRADOR"],
  loggedInAt: "2026-10-05T00:00:00.000Z",
};

const PX_PER_MM = 96 / 25.4;
const CARD_WIDTH_PX = 54 * PX_PER_MM;
const CARD_HEIGHT_PX = 85.6 * PX_PER_MM;
const COUNT = 10;

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

function carnet(id: number) {
  return {
    profile: {
      personaId: String(id),
      nombres: id === 3 ? "Maria de los Angeles" : `Jugador${id}`,
      apellidos: id === 3 ? "Fernandez Villacreses" : "Prueba",
      cedula: `11500000${String(id).padStart(2, "0")}`,
      fechaNacimiento: "2012-01-01",
      recentSessions: [],
      representante: null,
      representanteId: null,
      // Every other player has no photo: those print the silhouette.
      fotoUrl: null,
      membership: {
        id: id * 10,
        estado: "ACTIVA",
        personaId: id,
        montoAplicado: "85.00",
        categoria: "Mensual Adulto",
        modalidad: "MENSUAL",
        fechaActivacion: "2026-10-04",
        esGratuidadFamiliar: false,
        cubiertoHasta: "2026-12-31",
        motivoSuspension: null,
      },
    },
    coverageEnd: "2026-12-31",
    asignaciones: ["LUNES", "MIERCOLES", "VIERNES"].map((dia, index) => ({
      id: id * 100 + index,
      personaId: id,
      personaNombreCompleto: `Jugador${id}`,
      edad: 14,
      horarioId: index + 1,
      horarioDia: dia,
      horarioHoraInicio: "17:00:00",
      horarioHoraFin: "18:00:00",
      fechaAsignacion: "2026-07-01T09:00:00Z",
    })),
  };
}

async function mockAdmin(page: Page): Promise<void> {
  await page.context().addCookies([
    { name: "access_token", value: "mock-header.mock-payload.mock-signature", url: E2E_BASE_URL },
  ]);
  await page.route("**/api/**", (route: Route) => fulfillJson(route, []));
  await page.route("**/api/auth/session", (route: Route) => fulfillJson(route, MOCK_SESSION));
  await page.route("**/api/ranking/notificaciones/mias*", (route: Route) =>
    fulfillJson(route, { items: [], total: 0, skip: 0, limit: 20 }),
  );
  await page.route("**/api/dashboard", (route: Route) => fulfillJson(route, {}));
  await page.route("**/api/carnets*", (route: Route) =>
    fulfillJson(route, {
      carnets: Array.from({ length: COUNT }, (_, index) => carnet(index + 1)),
      missing: [],
    }),
  );
}

test.describe("Carnets por lote — A4", () => {
  test("ten carnets print as nine 85,6 × 54 mm cards on sheet one and one on sheet two", async ({ page }) => {
    await mockAdmin(page);
    await page.goto(`/members/carnets?ids=${Array.from({ length: COUNT }, (_, i) => i + 1).join(",")}`);
    await expect(page.getByTestId("carnet-batch")).toBeVisible({ timeout: 20_000 });
    await page.emulateMedia({ media: "print" });

    const cards = page.getByTestId("carnet-sheet-card");
    await expect(cards).toHaveCount(COUNT);

    const boxes = await cards.evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y + window.scrollY,
          width: rect.width,
          height: rect.height,
          // Content that did not fit would be cut by the card's own clip.
          clipped: node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1,
        };
      }),
    );

    for (const box of boxes) {
      expect(box.width).toBeCloseTo(CARD_WIDTH_PX, 0);
      expect(box.height).toBeCloseTo(CARD_HEIGHT_PX, 0);
      expect(box.clipped).toBe(false);
    }

    // Three across, one row's cards share a top edge, the pitch is card + 6 mm gap.
    const pitchX = (54 + 6) * PX_PER_MM;
    expect(boxes[1].x - boxes[0].x).toBeCloseTo(pitchX, 0);
    expect(boxes[2].x - boxes[1].x).toBeCloseTo(pitchX, 0);
    expect(boxes[1].y).toBeCloseTo(boxes[0].y, 0);
    expect(boxes[3].y - boxes[0].y).toBeCloseTo((85.6 + 6) * PX_PER_MM, 0);
    // Nine to a sheet: the tenth is the first card of the second one.
    const sheets = page.getByTestId("carnet-sheet");
    await expect(sheets).toHaveCount(2);
    await expect(sheets.nth(0).getByTestId("carnet-sheet-card")).toHaveCount(9);
    await expect(sheets.nth(1).getByTestId("carnet-sheet-card")).toHaveCount(1);

    // The silhouette prints for a player without a photo.
    await expect(page.getByTestId("carnet-photo-silhouette")).toHaveCount(COUNT);

    // Only the sheet is visible on paper: the shell and the controls are not.
    await expect(page.getByRole("button", { name: /imprimir 10 carnets/i })).toBeHidden();

    // What the print dialog would produce: A4, two pages.
    const pdf = (await page.pdf({ preferCSSPageSize: true })).toString("latin1");
    expect(pdf.match(/\/Type\s*\/Page[^s]/g)).toHaveLength(2);
    const mediaBox = pdf.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
    expect(mediaBox).not.toBeNull();
    expect(Number(mediaBox![1])).toBeCloseTo(595.28, 0);
    expect(Number(mediaBox![2])).toBeCloseTo(841.89, 0);
  });
});
