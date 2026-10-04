/**
 * The Cuota card: a calm status headline with ONE coloured badge, the two
 * figures a family checks side by side, and the content-sized action.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import CuotaCard from "@/app/student/CuotaCard";
import type { PaymentSituation } from "@/app/student/student-utils";

function situation(overrides: Partial<PaymentSituation>): PaymentSituation {
  return {
    kind: "expired",
    figure: { value: 3, unit: "días vencida" },
    headline: "La cobertura de Martín venció",
    detail: "El último pago aprobado cubrió hasta el 26/09/2026.",
    priceNote: null,
    canRegister: true,
    urgent: true,
    ...overrides,
  };
}

const ACTION = { href: "/student/payments?registrar=1", label: "Registrar un pago" };

function renderCard(s: PaymentSituation, extra: Partial<React.ComponentProps<typeof CuotaCard>> = {}) {
  return render(
    <CuotaCard
      situation={s}
      coverageEnd="2026-09-26"
      monthlyPrice="40.00"
      action={ACTION}
      viewPagosHref="/student/payments"
      {...extra}
    />,
  );
}

describe("CuotaCard", () => {
  it("states an expired cuota with a single Vencida badge and no red banner", () => {
    renderCard(situation({}));
    const card = screen.getByTestId("student-cuota-card");
    expect(within(card).getAllByText("Vencida")).toHaveLength(1);
    const verdict = within(card).getByTestId("cuota-verdict");
    expect(verdict).toHaveAttribute("data-urgent", "true");
    expect(verdict.className).not.toMatch(/bg-state-bad-bg/);
    // The badge is the only tinted element: no banner band behind the headline.
    expect(card.querySelectorAll(".bg-state-bad-bg")).toHaveLength(1);
  });

  it("puts 'Cubierta hasta' and 'A pagar' side by side as plain tabular figures", () => {
    renderCard(situation({}));
    const figures = screen.getByTestId("cuota-figures");
    // Side by side, in the row's own wide column, not stacked under the verdict.
    expect(figures.className).toMatch(/\bgrid-cols-2\b/);
    expect(figures.parentElement?.className).toMatch(/md:grid-cols-\[/);
    expect(within(figures).getByText("Cubierta hasta")).toBeInTheDocument();
    expect(within(figures).getByText("26/09/2026")).toHaveClass("tabular-nums");
    expect(within(figures).getByText("A pagar")).toBeInTheDocument();
    expect(within(figures).getByText("$40,00")).toHaveClass("tabular-nums");
    expect(figures.querySelector("code, .font-mono")).toBeNull();
  });

  it("does not repeat the coverage date in a sentence when the figure already states it", () => {
    renderCard(situation({}));
    expect(screen.queryByText(/El último pago aprobado cubrió hasta/)).toBeNull();
  });

  it("keeps the explanatory detail for states that have no date to show", () => {
    renderCard(
      situation({ kind: "never-paid", figure: null, headline: "Martín no tiene ningún pago aprobado", detail: "Registre el primer pago para activar la cobertura." }),
      { coverageEnd: null },
    );
    expect(screen.getByText("Registre el primer pago para activar la cobertura.")).toBeInTheDocument();
    expect(screen.getByText("Sin pagos")).toBeInTheDocument();
  });

  it("reads Al día with an ok badge, and still offers the content-sized action", () => {
    renderCard(situation({ kind: "covered", urgent: false, figure: { value: 40, unit: "días de cobertura" }, headline: "Está al día con el club" }), {
      coverageEnd: "2026-11-30",
    });
    const card = screen.getByTestId("student-cuota-card");
    expect(within(card).getByText("Al día")).toBeInTheDocument();
    const cta = within(card).getByRole("link", { name: /Registrar un pago/ });
    expect(cta.className).not.toMatch(/\bw-full\b/);
    // Same row as the verdict, not a second line under it.
    expect(cta.parentElement).toBe(screen.getByTestId("cuota-verdict").parentElement);
  });

  it("counts the days in the badge when the coverage is about to lapse", () => {
    renderCard(situation({ kind: "ending-soon", figure: { value: 4, unit: "días de cobertura" }, headline: "A Martín le quedan 4 días de cobertura" }), {
      coverageEnd: "2026-10-03",
    });
    expect(screen.getByText("Vence en 4 días")).toBeInTheDocument();
  });

  it("drops the price for a gratuitous membership", () => {
    renderCard(situation({ kind: "gratuitous", urgent: false, figure: null, headline: "No paga", detail: "Gratuidad familiar." }), {
      coverageEnd: null,
    });
    expect(screen.queryByText("A pagar")).toBeNull();
    expect(screen.queryByTestId("cuota-figures")).toBeNull();
  });

  it("keeps a link to the payment history in the header", () => {
    renderCard(situation({}));
    expect(screen.getByRole("link", { name: "Ver pagos" })).toHaveAttribute("href", "/student/payments");
  });

  // FAM-27: the card is «Mensualidad» and says how much, until when and what is next.
  describe("Mensualidad (FAM-27)", () => {
    const TODAY = new Date(2026, 9, 22); // 22/10/2026

    it("is titled «Mensualidad», not «Cuota»", () => {
      renderCard(situation({}));
      const card = screen.getByTestId("student-cuota-card");
      expect(within(card).getByRole("heading", { name: "Mensualidad" })).toBeInTheDocument();
      expect(within(card).queryByRole("heading", { name: "Cuota" })).toBeNull();
    });

    it("spells out the days left, the date, the amount and what happens after paying", () => {
      renderCard(
        situation({ kind: "covered", urgent: false, figure: { value: 12, unit: "días de cobertura" }, headline: "Está al día con el club" }),
        { coverageEnd: "2026-11-03", monthlyPrice: "25.00", today: TODAY },
      );
      expect(screen.getByTestId("cuota-next-step")).toHaveTextContent(
        "Vence en 12 días (03/11/2026). Pague $25,00 y suba el comprobante; el club lo revisa y le avisamos aquí.",
      );
    });

    it("keeps the primary button neutral while more than 7 days remain", () => {
      renderCard(
        situation({ kind: "covered", urgent: false, figure: { value: 8, unit: "días de cobertura" } }),
        { coverageEnd: "2026-10-30", today: TODAY },
      );
      const cta = screen.getByRole("link", { name: /Registrar un pago/ });
      expect(cta.className).not.toMatch(/bg-cata-red/);
    });

    it("turns the primary button red at 7 days or fewer", () => {
      renderCard(
        situation({ kind: "ending-soon", figure: { value: 7, unit: "días de cobertura" } }),
        { coverageEnd: "2026-10-29", today: TODAY },
      );
      expect(screen.getByRole("link", { name: /Registrar un pago/ }).className).toMatch(/bg-cata-red/);
    });

    it("stays red and says how long ago it expired", () => {
      renderCard(situation({}), { coverageEnd: "2026-10-19", monthlyPrice: "25.00", today: TODAY });
      expect(screen.getByRole("link", { name: /Registrar un pago/ }).className).toMatch(/bg-cata-red/);
      expect(screen.getByTestId("cuota-next-step")).toHaveTextContent(
        "Venció hace 3 días (19/10/2026). Pague $25,00 y suba el comprobante",
      );
    });

    it("has no next-step line when there is no date or nothing to pay", () => {
      renderCard(situation({ kind: "never-paid", figure: null }), { coverageEnd: null, today: TODAY });
      expect(screen.queryByTestId("cuota-next-step")).toBeNull();
    });
  });
});
