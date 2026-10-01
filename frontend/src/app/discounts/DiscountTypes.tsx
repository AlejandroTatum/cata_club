import { Percent, DollarSign } from "lucide-react";
import { ICON } from "@/lib/icon-size";

const TYPES = [
  {
    key: "porcentaje",
    icon: Percent,
    title: "Porcentaje",
    what: "Resta una parte del monto del pago. Útil para becas y convenios.",
    example: { base: "$ 40.00", rule: "− 50 %", result: "$ 20.00" },
  },
  {
    key: "monto",
    icon: DollarSign,
    title: "Monto fijo",
    what: "Resta una cantidad en dólares, sin importar el valor del pago.",
    example: { base: "$ 40.00", rule: "− $ 10.00", result: "$ 30.00" },
  },
];

/** Explainer of what each type of discount does, with a worked example.
 *  `rail` stacks the types in the side column (empty catalog); `main` sits
 *  under a short catalog, side by side, and grows with the column so the page
 *  reaches the viewport bottom with content instead of dead canvas. */
export default function DiscountTypes({
  placement = "rail",
}: {
  placement?: "rail" | "main";
}): React.ReactElement {
  return (
    <section
      data-testid="discounts-types"
      aria-labelledby="discounts-types-title"
      className="card flex min-w-0 flex-col gap-section p-[18px]"
    >
      <h2
        id="discounts-types-title"
        className="font-display text-lg uppercase leading-tight tracking-flat text-ink"
      >
        Tipos de descuento
      </h2>
      <ul className={placement === "main" ? "grid flex-1 gap-page sm:grid-cols-2" : "grid gap-section"}>
        {TYPES.map(({ key, icon: Icon, title, what, example }) => (
          <li
            key={key}
            className="flex min-w-0 flex-col gap-section rounded-card border border-line bg-sunken p-[18px]"
          >
            <span className="flex h-ctl w-10 items-center justify-center rounded-ctl bg-paper text-ink-2">
              <Icon size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />
            </span>
            <h3 className="text-sm font-bold text-ink">{title}</h3>
            <p className="text-sm text-ink-2">{what}</p>
            <p className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3 text-xs tabular-nums text-ink-3">
              <span>Ejemplo: {example.base}</span>
              <span>{example.rule}</span>
              <strong className="text-ink">{example.result}</strong>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
