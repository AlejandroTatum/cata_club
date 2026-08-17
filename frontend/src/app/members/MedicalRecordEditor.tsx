"use client";

import { useState, useEffect } from "react";
import { Loader2, Save, CheckCircle2, Stethoscope, Pencil, X } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { fetchFichaMedica, actualizarFichaMedica } from "@/services/api";
import { useToast } from "@/contexts/ToastContext";
import { Badge, Button, DataBox, ErrorState, LoadingState } from "@/components/ui";
import type { FichaMedicaEditable, TipoSangre } from "@/types/domain";
import { toUserMessage, isNotFound } from "@/lib/error-message";

const TIPOS_SANGRE: TipoSangre[] = [
  "A_POSITIVO",
  "A_NEGATIVO",
  "B_POSITIVO",
  "B_NEGATIVO",
  "AB_POSITIVO",
  "AB_NEGATIVO",
  "O_POSITIVO",
  "O_NEGATIVO",
  "DESCONOCIDO",
];

/**
 * El único lugar donde el enum del backend se vuelve texto legible.
 *
 * La fila de lectura y la opción del select nombran el mismo dato, así que si
 * cada una lo formatea por su cuenta la pantalla se contradice sola al pasar
 * de reposo a edición ("O POSITIVO" arriba, "O_POSITIVO" abajo).
 */
function etiquetaTipoSangre(tipo: TipoSangre): string {
  return tipo.replace("_", " ");
}

/**
 * La fila etiqueta-valor del modo lectura.
 *
 * Es la misma forma que `/profile` ya usa para su propio reposo (su
 * `DetailRow`): etiqueta gris y angosta a la izquierda, valor a la derecha
 * dentro de un `DataBox`. No se importa de allá porque es local a esa página;
 * lo que se copia es la forma, no el componente, para que las dos únicas
 * pantallas lectura-edición del producto se lean igual.
 *
 * La raya (`—`) no es decorativa: un campo médico opcional que quedó vacío
 * tiene que decir "acá no hay nada" en vez de dejar un hueco que se confunde
 * con un dato que no cargó.
 */
/**
 * La ficha guardada, traducida a los cinco valores que llevan los inputs.
 *
 * Vive fuera del componente porque es la ÚNICA traducción, y la usan dos
 * caminos que no se ven entre sí: la carga inicial y «Cancelar». Escrita
 * adentro de cada uno, el día que aparezca un sexto campo uno de los dos se
 * queda atrás — y el que se quedaría atrás es el de cancelar, que nadie mira
 * hasta que descarta un cambio y el valor viejo no vuelve.
 */
function camposDe(ficha: FichaMedicaEditable): {
  tipoSangre: TipoSangre;
  enfermedades: string;
  alergias: string;
  contactoEmergencia: string;
  telefonoEmergencia: string;
} {
  return {
    tipoSangre: ficha.tipoSangre,
    enfermedades: ficha.enfermedades.map((e) => e.nombreEnfermedad).join(", "),
    alergias: ficha.alergias ?? "",
    contactoEmergencia: ficha.contactoEmergencia ?? "",
    telefonoEmergencia: ficha.telefonoEmergencia ?? "",
  };
}

function FilaLectura({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-field border-b border-line py-2 last:border-b-0">
      <span className="w-[110px] flex-none text-xs text-ink-3 sm:w-[150px]">{label}</span>
      <span className="flex min-w-[9rem] flex-1 flex-wrap items-center gap-x-2 gap-y-field text-sm font-semibold text-ink">
        <DataBox>{value || "—"}</DataBox>
      </span>
    </div>
  );
}

interface MedicalRecordEditorProps {
  personaId: number;
  /**
   * The student this record belongs to. Rendered INSIDE the heading of a
   * header band that stays pinned (`sticky top-0`) while the fields below
   * scroll — this is medical data, and on a narrow screen the identity above
   * this editor (owned by the caller, e.g. `StudentEditPanel`) scrolls out of
   * view long before the form does. Optional so a caller with no name in
   * scope still renders; the heading then names the section alone.
   */
  studentName?: string;
}

export default function MedicalRecordEditor({ personaId, studentName }: MedicalRecordEditorProps): React.ReactElement {
  const { showSuccess, showError } = useToast();
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; ficha: FichaMedicaEditable; isNew: boolean }
  >({ status: "loading" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  /**
   * Reposo o edición. Lo decide la CARGA, no el usuario: una ficha que ya
   * existe abre en reposo, una que no existe abre en edición.
   *
   * El reclamo que esto contesta: «parece que hay que llenar eso siempre». La
   * ficha existente siempre se cargó — `fetchFichaMedica` está en el efecto de
   * abajo desde el primer día — pero se dibujaba con los mismos cinco inputs
   * llenos existiera o no, y cinco inputs llenos no dicen "esto ya está
   * guardado", dicen "esto es un formulario". Sobre datos médicos esa
   * diferencia importa: el que abre la pantalla tiene que poder LEER lo que
   * el club sabe de esa persona sin tocar nada.
   */
  const [editing, setEditing] = useState(false);

  // Load-bearing default, not cosmetic: the backend's PATCH upsert rejects
  // creating a first record without a blood type (400). `DESCONOCIDO` is a
  // valid TipoSangre, so pre-selecting it keeps that error unreachable from
  // the UI — see MedicalRecordEditor.test.tsx.
  const [tipoSangre, setTipoSangre] = useState<TipoSangre>("DESCONOCIDO");
  const [enfermedadesInput, setEnfermedadesInput] = useState("");
  const [alergias, setAlergias] = useState("");
  const [contactoEmergencia, setContactoEmergencia] = useState("");
  const [telefonoEmergencia, setTelefonoEmergencia] = useState("");

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    setSaveError(null);
    setSaveSuccess(false);

    fetchFichaMedica(personaId)
      .then((ficha) => {
        if (cancelled) return;
        const campos = camposDe(ficha);
        setTipoSangre(campos.tipoSangre);
        setEnfermedadesInput(campos.enfermedades);
        setAlergias(campos.alergias);
        setContactoEmergencia(campos.contactoEmergencia);
        setTelefonoEmergencia(campos.telefonoEmergencia);
        // Reposo. Este efecto también corre después de guardar (`reloadToken`),
        // así que es el mismo renglón el que cierra la edición y muestra lo
        // recién guardado: no hay un segundo camino que pueda olvidarse.
        setEditing(false);
        setState({ status: "ready", ficha, isNew: false });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // "No hay ficha todavía" is a 404, and that is the only thing that
        // reliably says so. This used to sniff the message for "not found" —
        // an ENGLISH substring, in a product that speaks Spanish, coming from
        // a sentence the backend was free to reword at any time. Now that the
        // translator refuses English text on principle, that check could not
        // have survived anyway; the status was always the real signal.
        if (isNotFound(error)) {
          // No medical record yet — allow creation of a new one. Arranca en
          // edición porque no hay nada que leer: un reposo vacío con un botón
          // «Editar» sería un paso de más para llegar al mismo formulario.
          setEditing(true);
          setState({ status: "ready", ficha: undefined as unknown as FichaMedicaEditable, isNew: true });
        } else {
          setState({ status: "error", message: toUserMessage(error, "No se pudo cargar la ficha médica.") });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [personaId, reloadToken]);

  function empezarEdicion(): void {
    setSaveError(null);
    setSaveSuccess(false);
    setEditing(true);
  }

  /**
   * Cancelar RESTAURA, no oculta.
   *
   * Sin este `camposDe`, salir de la edición dejaría los inputs con lo
   * tipeado: el reposo mostraría el valor guardado — que se lee de
   * `state.ficha` — pero el próximo «Editar» abriría el formulario sucio, con
   * un cambio que el usuario ya descartó y que un guardado posterior mandaría
   * igual. Es el modo silencioso de escribir un dato médico que nadie pidió.
   */
  function cancelarEdicion(): void {
    if (state.status === "ready" && !state.isNew) {
      const campos = camposDe(state.ficha);
      setTipoSangre(campos.tipoSangre);
      setEnfermedadesInput(campos.enfermedades);
      setAlergias(campos.alergias);
      setContactoEmergencia(campos.contactoEmergencia);
      setTelefonoEmergencia(campos.telefonoEmergencia);
    }
    setSaveError(null);
    setSaveSuccess(false);
    setEditing(false);
  }

  async function handleSave(): Promise<void> {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const enfermedades = enfermedadesInput
        .split(",")
        .map((e) => e.trim())
        .filter((e) => e.length > 0);

      await actualizarFichaMedica(personaId, {
        tipoSangre,
        enfermedades,
        // FIC-5: `|| undefined` used to mean "field omitted", which the
        // backend's partial PATCH reads as "leave the stored value alone" —
        // so clearing the field and saving reported success but never erased
        // it. `null` is the explicit "erase this" signal (see
        // FichaMedicaUpdatePayload's doc comment).
        alergias: alergias.trim() || null,
        contactoEmergencia: contactoEmergencia.trim() || null,
        telefonoEmergencia: telefonoEmergencia.trim() || null,
      });
      setSaveSuccess(true);
      setReloadToken((n) => n + 1);
      showSuccess("Ficha médica guardada correctamente.");
    } catch (error: unknown) {
      const message = toUserMessage(error, "No se pudo guardar la ficha médica.");
      setSaveError(message);
      showError(message);
    } finally {
      setSaving(false);
    }
  }

  if (state.status === "loading") {
    return <LoadingState className="mt-4" label="Cargando ficha médica…" />;
  }

  if (state.status === "error") {
    return (
      <ErrorState
        className="mt-4"
        title="No se pudo cargar la ficha médica"
        message={state.message}
        onRetry={() => setReloadToken((n) => n + 1)}
      />
    );
  }

  return (
    <div className="mt-3 rounded-2xl border border-line bg-paper">
      {/* `sticky top-0`, not a plain header: on a narrow screen this card's
          own fields can outgrow the viewport, and the student's identity —
          shown only once, above this editor, by the caller — scrolls out of
          view first. Pinning this band keeps whoever is editing from ever
          losing sight of whose medical data they're touching. `bg-paper`
          keeps it opaque so it actually covers the fields as they scroll
          under it, and `rounded-t-2xl` matches the card's own corners since
          the card no longer clips overflow (clipping would break the sticky
          positioning by making this its own scroll container instead of the
          real one further up the tree). */}
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-t-2xl border-b border-line bg-paper px-3 py-2.5 sm:px-4">
        <Stethoscope size={ICON.sm} strokeWidth={1.5} className="flex-none text-state-bad" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          {/* The owner's name belongs IN the title, not on a second line under
              it. Two lines said "Ficha médica" and then "Martín", which is one
              statement split in half — and on `/student/medical-record` the
              first half was already the page's own `<h1>`, so the card header
              repeated the page title verbatim and the name arrived as an
              orphan. One heading says the whole thing, and it is still the
              element the sticky band pins (D11c). */}
          <h3 className="truncate text-base font-extrabold text-ink">
            {studentName ? `Ficha médica de ${studentName}` : "Ficha médica"}
          </h3>
        </div>
        {state.isNew && <Badge tone="neutral">Nueva</Badge>}

        {/* Las acciones viven en la banda pegada (`sticky`), no al pie del
            formulario: es la única parte de la tarjeta que sigue en pantalla
            cuando los campos se van scrolleando, así que guardar queda siempre
            a mano y al lado del nombre de quien es la ficha. Al pie quedan los
            mensajes de resultado, que se leen DESPUÉS de apretar y por lo
            tanto no necesitan estar fijos. */}
        {editing ? (
          <div className="flex flex-none items-center gap-2">
            {/* «Cancelar» sólo cuando hay algo a lo que volver. Una ficha nueva
                no tiene estado anterior: el botón prometería descartar hacia
                un formulario vacío que es exactamente el que ya se ve. */}
            {!state.isNew && (
              <Button variant="tertiary" size="sm" onClick={cancelarEdicion} disabled={saving}>
                <X size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
                Cancelar
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={() => void handleSave()} disabled={saving}>
              {saving ? (
                <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
              ) : (
                <Save size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
              )}
              {saving ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        ) : (
          <Button variant="secondary" size="sm" onClick={empezarEdicion} className="flex-none">
            <Pencil size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
            Editar
          </Button>
        )}
      </header>

      <div className="p-3 sm:p-4">
      {!editing && state.status === "ready" && !state.isNew && (
        /* El reposo: filas etiqueta-valor, no la grilla de dos columnas de
         * abajo. Son dos formas distintas porque dicen dos cosas distintas —
         * una grilla de cajas invita a escribir, una lista de filas se lee de
         * arriba abajo — y `/profile` ya resolvió el mismo par así.
         *
         * Sin fecha. `FichaMedicaEditable` no trae ningún timestamp, así que
         * acá no se puede decir cuándo se cargó ni cuándo se actualizó el
         * dato, y una línea «actualizado el…» sería inventada. */
        <div>
          <FilaLectura label="Tipo de sangre" value={etiquetaTipoSangre(state.ficha.tipoSangre)} />
          <FilaLectura label="Alergias" value={state.ficha.alergias ?? ""} />
          <FilaLectura
            label="Enfermedades"
            value={state.ficha.enfermedades.map((e) => e.nombreEnfermedad).join(", ")}
          />
          <FilaLectura label="Contacto de emergencia" value={state.ficha.contactoEmergencia ?? ""} />
          <FilaLectura label="Teléfono de emergencia" value={state.ficha.telefonoEmergencia ?? ""} />
        </div>
      )}

      {editing && (
      <>
      {state.isNew && (
        <p className="mb-3 rounded-ctl border border-line bg-sunken px-3 py-2 text-xs text-ink-3-strong">
          Todavía no hay una ficha médica cargada para esta persona. Complete los datos y guárdelos.
        </p>
      )}
      {/* Two columns at every width above `sm`, never three. Esta grilla es
       * la de los CONTROLES — sólo se dibuja en edición; el reposo de arriba
       * usa filas, que es otra forma y otra decisión.
       *
       * Three across put all five controls into exactly TWO rows of 40px — a
       * strip of controls rather than a form — and it was the same two rows
       * whether the record was empty or full, because nothing here grows with
       * data. On `/student/medical-record`, drawn at the page's full measure,
       * that is a ~300px block under a 900px window: the worst dead-air
       * reading in the product (57%, D11b). El reposo no cambia esa medición
       * y no pretende hacerlo: es un encargo aparte.
       *
       * Two across is also the honest shape: the pairs mean something. Blood
       * type sits beside allergies (what the club needs to know before it acts),
       * the illness list gets the full width it needs for a comma-separated
       * value, and the two emergency-contact fields are adjacent because they
       * are one fact written in two boxes. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`tipo-sangre-${personaId}`} className="mb-1 block text-xs font-semibold text-ink-2">
            Tipo de sangre
          </label>
          <select
            id={`tipo-sangre-${personaId}`}
            value={tipoSangre}
            onChange={(e) => setTipoSangre(e.target.value as TipoSangre)}
            className="input-field w-full"
          >
            {TIPOS_SANGRE.map((t) => (
              <option key={t} value={t}>
                {etiquetaTipoSangre(t)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`alergias-${personaId}`} className="mb-1 block text-xs font-semibold text-ink-2">
            Alergias
          </label>
          <input
            id={`alergias-${personaId}`}
            type="text"
            value={alergias}
            onChange={(e) => setAlergias(e.target.value)}
            className="input-field w-full"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`enfermedades-${personaId}`} className="mb-1 block text-xs font-semibold text-ink-2">
            Enfermedades (separadas por coma)
          </label>
          <input
            id={`enfermedades-${personaId}`}
            type="text"
            value={enfermedadesInput}
            onChange={(e) => setEnfermedadesInput(e.target.value)}
            placeholder="Ej: Asma, Diabetes"
            className="input-field w-full"
          />
          <p className="mt-1 text-2xs tracking-flat text-ink-3">
            Al guardar se reemplaza la lista completa. Dejar vacío borra todas las enfermedades.
          </p>
        </div>
        <div>
          <label htmlFor={`contacto-${personaId}`} className="mb-1 block text-xs font-semibold text-ink-2">
            Contacto de emergencia
          </label>
          <input
            id={`contacto-${personaId}`}
            type="text"
            value={contactoEmergencia}
            onChange={(e) => setContactoEmergencia(e.target.value)}
            className="input-field w-full"
          />
        </div>
        <div>
          <label htmlFor={`telefono-${personaId}`} className="mb-1 block text-xs font-semibold text-ink-2">
            Teléfono de emergencia
          </label>
          <input
            id={`telefono-${personaId}`}
            type="text"
            value={telefonoEmergencia}
            onChange={(e) => setTelefonoEmergencia(e.target.value)}
            className="input-field w-full"
          />
        </div>
      </div>

      {/* El botón de guardar se fue al encabezado pegado; acá quedan sólo los
          mensajes de resultado. Dos botones «Guardar» — uno arriba y otro al
          pie — serían dos afordancias para el mismo acto, y la que se lee
          primero mandaría sobre la otra sin ningún motivo. */}
      {(saveError || saveSuccess) && (
        <div className="mt-4 flex items-center gap-3">
          {saveError && (
            <p className="text-sm text-state-bad" role="alert">
              {saveError}
            </p>
          )}
          {saveSuccess && (
            <p className="flex items-center gap-1 text-sm text-state-ok" role="status">
              <CheckCircle2 size={ICON.sm} strokeWidth={2} aria-hidden="true" />
              Ficha médica guardada.
            </p>
          )}
        </div>
      )}
      </>
      )}
      </div>
    </div>
  );
}
