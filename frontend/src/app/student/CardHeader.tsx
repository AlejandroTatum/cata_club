/**
 * The header of the portal's list cards ("Esta semana", "Días sin clase"): an
 * uppercase display title with a muted one-line subtitle beside it. One piece,
 * so the cards stacked in the rail cannot drift apart in padding or type.
 */
export default function CardHeader({ title, subtitle }: { title: string; subtitle: string }): React.ReactElement {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-field px-5 pb-3.5 pt-[18px]">
      <h2 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">{title}</h2>
      <p className="text-xs text-ink-3-strong">{subtitle}</p>
    </div>
  );
}
