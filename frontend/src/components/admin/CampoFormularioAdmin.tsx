/**
 * One labeled `date`/`number`/`textarea` field of an admin write form —
 * issue #400 (Sonar duplication follow-up). `RegularizarDeudaForm` (fecha
 * inicio, fecha fin, monto — all required), `PagoCorreccionSection` (los
 * seis campos corregibles de `corregir_pago`, todos opcionales — "vacío =
 * sin cambio") and `SuspenderReactivarForm` (el motivo obligatorio)
 * repeated the exact same `<label><input/textarea .../></label>` shape,
 * styling and all, differing only in which attributes each particular
 * field needed. `type="textarea"` used to be its own component
 * (`MotivoObligatorioField`) — folded in here once it became clear it was
 * just this same field with a different tag: same wrapping `<label>`, same
 * `labelClassName` default, same input styling.
 */

interface CampoFormularioAdminProps {
  label: string;
  type: "number" | "date" | "textarea";
  value: string;
  onChange: (value: string) => void;
  /** `RegularizarDeudaForm`'s three fields and every `type="textarea"`
   *  motivo are required; `PagoCorreccionSection`'s six correctable fields
   *  are NOT (an empty one means "sin cambio" — see `PagoCorreccionSection`'s
   *  own `buildInput`). Defaults to optional. */
  required?: boolean;
  /** Only `type="date"` cares — `RegularizarDeudaForm`'s "Fecha inicio" caps
   *  at today (`clubIsoDate()`); no other field needs a max. */
  dateMax?: string;
  /** Only `type="number"` cares — each numeric field has its own step/min
   *  (`mesesComprados` is a whole number; every money field has centavos). */
  numberStep?: string;
  numberMin?: string;
  numberInputMode?: "decimal" | "numeric";
  /** Only `type="textarea"` cares — every motivo field has its own example text. */
  placeholder?: string;
  /** `"mt-2 block text-2xs text-ink-3"` when this field stacks under other
   *  fields in the same form; `"block text-2xs text-ink-3"` (no top margin)
   *  when it is the first/only field. */
  labelClassName?: string;
}

export default function CampoFormularioAdmin({
  label,
  type,
  value,
  onChange,
  required = false,
  dateMax,
  numberStep = "0.01",
  numberMin = "0",
  numberInputMode = "decimal",
  placeholder,
  labelClassName = "block text-2xs text-ink-3",
}: CampoFormularioAdminProps): React.ReactElement {
  const inputClassName = "mt-0.5 w-full rounded-md border border-line bg-bg px-2 py-1 text-xs text-ink";

  return (
    <label className={labelClassName}>
      <span>{label}{required && <span aria-hidden="true" className="ml-1 text-state-bad">*</span>}</span>
      {type === "textarea" ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          maxLength={255}
          placeholder={placeholder}
          className={inputClassName}
          {...(required ? { required: true } : {})}
        />
      ) : (
        <input
          type={type}
          {...(type === "number" ? { inputMode: numberInputMode, min: numberMin, step: numberStep } : {})}
          {...(type === "date" && dateMax ? { max: dateMax } : {})}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClassName}
          {...(required ? { required: true } : {})}
        />
      )}
    </label>
  );
}
