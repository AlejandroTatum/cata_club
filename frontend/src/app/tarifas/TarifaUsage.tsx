import { CreditCard, Repeat, UserPlus } from "lucide-react";
import { ICON } from "@/lib/icon-size";

const USES = [
  {
    key: "inscripcion",
    icon: UserPlus,
    title: "Inscripción",
    what: "La membresía nueva toma el precio vigente de la tarifa elegida.",
    note: "Un precio editado hoy rige para las inscripciones de mañana.",
  },
  {
    key: "pagos",
    icon: CreditCard,
    title: "Pagos",
    what: "Cada pago registrado se calcula con el precio actual de la tarifa.",
    note: "Los pagos ya registrados conservan el valor con el que se cobraron.",
  },
  {
    key: "cambio",
    icon: Repeat,
    title: "Cambio de plan",
    what: "El alumno que cambia de tarifa pasa a pagar el precio de la nueva.",
    note: "El cambio se refleja desde el siguiente pago, sin tocar el historial.",
  },
];

/** Main-column block under the tariff cards: where each price is used. It
 *  grows with the column so the page reaches the viewport bottom with content,
 *  not with a stretched empty card. */
export default function TarifaUsage(): React.ReactElement {
  return (
    <section
      data-testid="tarifas-usage"
      aria-labelledby="tarifas-usage-title"
      className="card flex min-w-0 flex-col gap-section p-[18px]"
    >
      <div className="grid gap-1">
        <h2
          id="tarifas-usage-title"
          className="font-display text-lg uppercase leading-tight tracking-flat text-ink"
        >
          Dónde se usan las tarifas
        </h2>
        <p className="text-sm text-ink-3">
          El precio de cada tarifa interviene en tres momentos del ciclo de una membresía.
        </p>
      </div>
      <ul className="grid flex-1 gap-page sm:grid-cols-3">
        {USES.map(({ key, icon: Icon, title, what, note }) => (
          <li
            key={key}
            className="flex min-w-0 flex-col gap-section rounded-card border border-line bg-sunken p-[18px]"
          >
            <span className="flex h-ctl w-10 items-center justify-center rounded-ctl bg-paper text-ink-2">
              <Icon size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />
            </span>
            <h3 className="text-sm font-bold text-ink">{title}</h3>
            <p className="text-sm text-ink-2">{what}</p>
            <p className="mt-auto border-t border-line pt-3 text-xs text-ink-3">{note}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
