/**
 * The "Motivo (obligatorio)" textarea — issue #400 (Sonar duplication
 * follow-up). Every admin write flow that requires an audited reason
 * (regularizar deuda, suspender/reactivar una membresía, corregir un pago)
 * repeated this exact label + textarea + 255-char-cap shape, word for word,
 * three times across `RegularizarDeudaForm`, `SuspenderReactivarForm` and
 * `PagoCorreccionSection`. Extracted once so a fourth admin flow that needs
 * a mandatory motivo is a one-line usage, not a fourth copy.
 *
 * Only the placeholder (what kind of reason this particular flow expects)
 * and the wrapping `<label>`'s top margin (whether this is the form's only
 * field, or one more field stacked under others) ever differed between the
 * three call sites — both are still caller-controlled below.
 */

interface MotivoObligatorioFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /**
   * `"mt-2 block text-2xs text-ink-3"` when this field stacks under other
   * fields in the same form (`RegularizarDeudaForm`, `PagoCorreccionSection`);
   * `"block text-2xs text-ink-3"` (no top margin) when it is the form's only
   * field (`SuspenderReactivarForm`).
   */
  labelClassName?: string;
}

export default function MotivoObligatorioField({
  value,
  onChange,
  placeholder,
  labelClassName = "block text-2xs text-ink-3",
}: MotivoObligatorioFieldProps): React.ReactElement {
  return (
    <label className={labelClassName}>
      Motivo (obligatorio)
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        maxLength={255}
        placeholder={placeholder}
        className="mt-0.5 w-full rounded-md border border-line bg-bg px-2 py-1 text-xs text-ink"
        required
      />
    </label>
  );
}
