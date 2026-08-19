/**
 * One labeled `date`/`number` field of an admin write form — issue #400
 * (Sonar duplication follow-up). `RegularizarDeudaForm` (fecha inicio, fecha
 * fin, monto — all required) and `PagoCorreccionSection` (los seis campos
 * corregibles de `corregir_pago`, todos opcionales — "vacío = sin cambio")
 * repeated the exact same `<label><input .../></label>` shape, styling and
 * all, differing only in which attributes each particular field needed.
 * Extracted once so both keep using it instead of each carrying its own
 * near-identical copy.
 */

interface CampoFormularioAdminProps {
  label: string;
  type: "number" | "date";
  value: string;
  onChange: (value: string) => void;
  /** `RegularizarDeudaForm`'s three fields are required; `PagoCorreccionSection`'s
   *  six correctable fields are NOT (an empty one means "sin cambio" — see
   *  `PagoCorreccionSection`'s own `buildInput`). Defaults to optional. */
  required?: boolean;
  /** Only `type="date"` cares — `RegularizarDeudaForm`'s "Fecha inicio" caps
   *  at today (`clubIsoDate()`); no other field needs a max. */
  dateMax?: string;
  /** Only `type="number"` cares — each numeric field has its own step/min
   *  (`mesesComprados` is a whole number; every money field has centavos). */
  numberStep?: string;
  numberMin?: string;
  numberInputMode?: "decimal" | "numeric";
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
  labelClassName = "block text-2xs text-ink-3",
}: CampoFormularioAdminProps): React.ReactElement {
  return (
    <label className={labelClassName}>
      {label}
      <input
        type={type}
        {...(type === "number" ? { inputMode: numberInputMode, min: numberMin, step: numberStep } : {})}
        {...(type === "date" && dateMax ? { max: dateMax } : {})}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded-md border border-line bg-bg px-2 py-1 text-xs text-ink"
        {...(required ? { required: true } : {})}
      />
    </label>
  );
}
