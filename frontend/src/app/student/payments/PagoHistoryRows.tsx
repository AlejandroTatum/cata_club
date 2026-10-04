"use client";

/** Payment history rows (table at md+, cards below) for /student/payments. */

import Link from "next/link";
import type { PagoPersona, CoberturaBonificada } from "@/services/api";
import { Badge, Button, cn, type BadgeTone } from "@/components/ui";
import { formatDate, formatDateRange } from "@/lib/format-utils";
import { formatPagoMonto, describePagoEstado, describePagoDescuento, pagoFaltaComprobante, TIPO_PAGO_LABEL } from "./payments-utils";
import { ChevronDown, Download, Loader2, Paperclip, RefreshCw } from "lucide-react";
import { ICON } from "@/lib/icon-size";

// ---------------------------------------------------------------------------
// One payment in the history — issue #513: ported to the table+accordion
// pattern `/payments` (the admin validation queue) already uses, via the
// SAME `ResponsiveList`/`Table*`/`Badge` primitives, instead of the flat
// `<ul>` of cards this screen had on its own. Nothing about a payment's
// DATA changes here — amount, discount, voucher, and rejection reason are
// still exactly what `payments-utils.ts` derives; only where each one lives
// (row vs. accordion) does.
// ---------------------------------------------------------------------------

/** The row facts every rendering (table row, mobile card) reads the same way. */
interface PagoRowFields {
  amount: string;
  estado: { label: string; tone: BadgeTone };
  faltaComprobante: boolean;
  method: string;
  period: string;
  /** When the payment was registered — kept on the row itself (a `Método`
   *  sub-line, same two-line shape `TableNameCell` uses elsewhere), not
   *  folded into the accordion: every payment has one, so hiding it behind
   *  detail would have forced a toggle onto rows with nothing else to show. */
  registeredOn: string;
}

function buildPagoRowFields(pago: PagoPersona): PagoRowFields {
  return {
    registeredOn: formatDate(pago.fechaRegistro),
    amount: formatPagoMonto(pago.monto),
    estado: describePagoEstado(pago.estadoPago),
    faltaComprobante: pagoFaltaComprobante(pago),
    method: TIPO_PAGO_LABEL[pago.tipoPago],
    period: formatDateRange(pago.fechaInicio, pago.fechaFin),
  };
}

/**
 * Whether a payment has anything to say behind the accordion at all — the
 * discount, either comprobante, a rejection reason, or the no-voucher
 * exception. Most payments have none of these, and a row with nothing to
 * expand gets no toggle rather than an empty disclosure.
 */
function pagoHasDetail(pago: PagoPersona): boolean {
  // Voucher, official receipt and rejection reason are surfaced on the row
  // itself (see `PagoEvidenceLinks` / `PagoRejection`); the accordion keeps
  // only what explains the row's numbers.
  return describePagoDescuento(pago) != null || Boolean(pago.motivoExcepcionSinComprobante);
}

/**
 * The secondary facts a payment can have to explain itself — discount,
 * either comprobante, and a rejection reason — behind the per-row
 * accordion now (issue #513, Propuesta A), instead of always inline. The
 * data itself is untouched: same three fields `describePagoDescuento`
 * always derived, same two comprobante links, same rejection paragraph.
 */
function PagoDetailPanel({ pago }: { pago: PagoPersona }): React.ReactElement {
  // `null` en la enorme mayoría de los pagos, y entonces no se dibuja nada.
  const descuento = describePagoDescuento(pago);

  return (
    <div className="flex flex-col gap-2">
      {/* Por qué el monto de la fila es el que es.
       *
       * Hallazgo de QA humana (17/08/2026): «a la hora de pagar no se me
       * muestra el apartado de descuentos». El club ya aplicaba descuentos y
       * el backend ya los congelaba en el pago — lo que faltaba era el lado
       * del socio, que veía un monto final sin explicación. Un monto solo es
       * lo que genera el reclamo. */}
      {descuento && (
        <div data-testid="pago-descuento" className="rounded-ctl bg-sunken px-3.5 py-2.5">
          <p className="text-2xs font-bold uppercase text-ink-3-strong">
            Descuento aplicado por el club
          </p>
          <dl className="mt-1.5 flex flex-wrap gap-x-6 gap-y-field">
            <div className="flex items-baseline gap-1.5">
              <dt className="text-xs text-ink-3-strong">Precio de lista</dt>
              {/* Tachado: es el precio que este pago YA no tuvo. */}
              <dd className="text-xs font-semibold tabular-nums text-ink-3-strong line-through">
                {descuento.precioLista}
              </dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="text-xs text-ink-3-strong">Descuento</dt>
              <dd className="text-xs font-semibold tabular-nums text-ink-2">
                {/* U+2212 (signo menos), no un guión: es un número negativo,
                    y en tabular-nums alinea con las cifras de al lado. */}
                {descuento.porcentaje
                  ? `−${descuento.descuento} (${descuento.porcentaje})`
                  : `−${descuento.descuento}`}
              </dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="text-xs text-ink-3-strong">Monto final</dt>
              <dd className="text-xs font-bold tabular-nums text-ink">{descuento.montoFinal}</dd>
            </div>
          </dl>
        </div>
      )}

      {/* Issue #459: cuando el club aprobó esta transferencia sin
          comprobante, es una excepción auditada (verificación directa en
          la cuenta del club), no un dato interno silencioso — el socio
          tiene derecho a ver por qué se activó su membresía sin que él
          hubiera subido nada. Mismo tratamiento visual que el bloque de
          descuento (bg-sunken): es información, no un problema que el
          socio deba resolver. */}
      {pago.motivoExcepcionSinComprobante && (
        <div className="rounded-ctl bg-sunken px-3.5 py-2.5">
          <p className="text-2xs font-bold uppercase text-ink-3-strong">
            Aprobado sin comprobante (excepción)
          </p>
          <p className="mt-0.5 text-sm text-ink-2">{pago.motivoExcepcionSinComprobante}</p>
        </div>
      )}
    </div>
  );
}

/**
 * The accordion trigger for one row's detail — same accessibility contract
 * `components/ui/Accordion.tsx` already establishes for this product (a
 * real `<button>`, `aria-expanded`, `aria-controls`, a chevron that rotates
 * rather than carrying the state alone): a keyboard user gets a focusable,
 * announced toggle, not a `<div onClick>`.
 *
 * Not `<Accordion>` itself — that component's shape is a labelled FAQ
 * group (`role="group"` wrapping question/answer pairs), built for
 * `/ayuda`'s static list and not for a `<tr>`/`<li>` whose panel must be a
 * second table row. This reuses its INTERACTION pattern, not its markup.
 */
function PagoDetailToggle({
  panelId,
  isOpen,
  onToggle,
}: {
  panelId: string;
  isOpen: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-expanded={isOpen}
      aria-controls={panelId}
      onClick={onToggle}
      className="inline-flex h-8 items-center gap-1 rounded-ctl px-2 text-xs font-semibold text-ink-2 hover:bg-sunken"
    >
      Detalle
      <ChevronDown
        size={ICON.sm}
        strokeWidth={2}
        aria-hidden="true"
        className={cn("flex-none transition-transform duration-200", isOpen && "rotate-180")}
      />
    </button>
  );
}

const ACTION_BASE =
  "inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-ctl px-3 text-xs font-semibold";
const ACTION_PRIMARY = cn(ACTION_BASE, "bg-coal text-white hover:bg-ink");
const ACTION_SECONDARY = cn(ACTION_BASE, "border border-line-2 bg-paper text-ink hover:bg-sunken");
const ACTION_DISABLED = cn(
  ACTION_BASE,
  "cursor-not-allowed border border-dashed border-line-2 bg-sunken text-ink-3-strong",
);

/**
 * The documents a payment can carry, as an action group that is ALWAYS drawn:
 * the OFFICIAL receipt the club generates on approval (`comprobanteOficialUrl`,
 * issue #400 criterio 8) and the proof the member uploaded (`voucherUrl`).
 * When the receipt is not available yet the slot stays, disabled, and says why
 * — a family looking for "mi recibo" sees where it will appear.
 */
function PagoEvidenceLinks({ pago }: { pago: PagoPersona }): React.ReactElement | null {
  const receipt = pago.comprobanteOficialUrl ? (
    <a
      href={pago.comprobanteOficialUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Descargar comprobante oficial"
      className={ACTION_PRIMARY}
    >
      <Download size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
      Recibo oficial
    </a>
  ) : pago.estadoPago === "APROBADO" ? (
    <button type="button" disabled className={ACTION_DISABLED}>
      <Download size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
      Recibo en preparación
    </button>
  ) : pago.estadoPago === "PENDIENTE_VALIDACION" ? (
    <button type="button" disabled className={ACTION_DISABLED}>
      <Download size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
      Disponible al aprobarse
    </button>
  ) : null;

  if (!receipt && !pago.voucherUrl) return null;
  return (
    <>
      {receipt}
      {pago.voucherUrl && (
        <a
          href={pago.voucherUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Ver el comprobante"
          className={ACTION_SECONDARY}
        >
          <Paperclip size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
          Ver comprobante
        </a>
      )}
    </>
  );
}

/** The club's reason for rejecting a payment, inline on its row. */
function PagoRejection({ pago }: { pago: PagoPersona }): React.ReactElement | null {
  if (pago.estadoPago !== "RECHAZADO" || !pago.motivoRechazo) return null;
  return (
    <p className="mt-1.5 rounded-ctl bg-state-bad-bg px-2.5 py-1.5 text-xs text-ink-2">
      <span className="font-bold text-state-bad">Motivo del rechazo:</span> {pago.motivoRechazo}
    </p>
  );
}

/** The upload button or the "Registrar un pago nuevo" link — the row's one
 *  primary action, never both (a rejected payment cannot upload, and only a
 *  rejected payment gets the link). Stays visible on the row itself, unlike
 *  the read-only facts `PagoDetailPanel` holds: it is something to DO, not
 *  something to explain. */
function PagoActionSlot({
  pago,
  fields,
  onUploadFile,
  uploadingId,
  registerHref,
}: {
  pago: PagoPersona;
  fields: PagoRowFields;
  onUploadFile: (pagoId: number) => void;
  uploadingId: number | null;
  registerHref: string | null;
}): React.ReactElement | null {
  // "Puede subir su comprobante" termina siendo EXACTAMENTE el mismo caso que
  // "Falta el comprobante" marca: TRANSFERENCIA, PENDIENTE_VALIDACION, sin
  // voucherUrl. EFECTIVO nunca tiene comprobante bancario que subir (#452),
  // y un pago ya resuelto (APROBADO/RECHAZADO) no admite adjuntar nada más
  // -- RECHAZADO en particular responde 400 "pendiente de validación" si se
  // lo intenta (#461, confirmado en vivo).
  const canUpload = fields.faltaComprobante;

  if (canUpload) {
    return (
      <Button size="sm" onClick={() => onUploadFile(pago.id)} disabled={uploadingId === pago.id}>
        {uploadingId === pago.id ? (
          <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
        ) : (
          <RefreshCw size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
        )}
        {/* Issue #459: mismo botón, pero el texto ahora distingue la
            primera subida de un reintento — ver el comentario original en
            el historial de este archivo para el porqué. */}
        {uploadingId === pago.id ? "Subiendo…" : "Reintentar subir comprobante"}
      </Button>
    );
  }

  // Issue #461: un pago RECHAZADO es una decisión ya tomada por el club --
  // no admite adjuntar nada más (el backend responde 400 si se lo intenta,
  // confirmado en vivo). Esta es la única salida real que la fila ofrece en
  // su lugar.
  if (pago.estadoPago === "RECHAZADO" && registerHref) {
    return (
      <Link
        href={registerHref}
        className="inline-flex text-xs font-semibold text-ink underline decoration-line-2 decoration-2 underline-offset-4 hover:decoration-ink"
      >
        Registrar un pago nuevo
      </Link>
    );
  }

  return null;
}

/**
 * One payment as a rich row: status chip and covered period on the left, the
 * amount in the middle, and the action group on the right (receipt, proof,
 * upload/retry, detail). Stacks into one column below `md`: facts, then
 * actions, then (open) detail.
 */
export function PagoRow({
  pago,
  isOpen,
  onToggleDetail,
  onUploadFile,
  uploadingId,
  registerHref,
}: {
  pago: PagoPersona;
  isOpen: boolean;
  onToggleDetail: () => void;
  onUploadFile: (pagoId: number) => void;
  uploadingId: number | null;
  registerHref: string | null;
}): React.ReactElement {
  const fields = buildPagoRowFields(pago);
  const hasDetail = pagoHasDetail(pago);
  const panelId = `pago-detail-${pago.id}`;

  return (
    <li className="flex flex-col gap-3 px-5 py-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={fields.estado.tone}>{fields.estado.label}</Badge>
            {/* The payment a failed voucher upload left behind — kept, marked
                (decisiones §7), not reverted. */}
            {fields.faltaComprobante && <Badge tone="bad">Falta el comprobante</Badge>}
          </div>
          <p className="mt-1.5 text-base font-bold tabular-nums text-ink">{fields.period}</p>
          <p className="mt-0.5 text-xs text-ink-3-strong">
            {fields.method} · Registrado el{" "}
            <span className="tabular-nums">{fields.registeredOn}</span>
          </p>
          <PagoRejection pago={pago} />
        </div>
        <p className="flex-none text-xl font-extrabold tabular-nums text-ink md:w-24 md:text-right">
          {fields.amount}
        </p>
        <div className="flex flex-col gap-1.5 md:w-48 md:flex-none">
          <PagoEvidenceLinks pago={pago} />
          <PagoActionSlot
            pago={pago}
            fields={fields}
            onUploadFile={onUploadFile}
            uploadingId={uploadingId}
            registerHref={registerHref}
          />
          {hasDetail && (
            <PagoDetailToggle panelId={panelId} isOpen={isOpen} onToggle={onToggleDetail} />
          )}
        </div>
      </div>
      {hasDetail && (
        <div id={panelId} hidden={!isOpen}>
          <PagoDetailPanel pago={pago} />
        </div>
      )}
    </li>
  );
}

/**
 * The cobertura row's fixed facts (issue #1369, slice 3). The amount cell is
 * `—` on purpose: a coverage never charged anything (#400), and a printed
 * "$0,00" would describe a charge of zero that never happened. The status
 * badge is the fact the backend can prove — it was otorgada — with no
 * client-side date math about whether it is still current.
 */
function buildCoberturaRowFields(cobertura: CoberturaBonificada): {
  badge: string;
  period: string;
  concept: string;
  grantedOn: string;
} {
  return {
    badge: "Otorgada",
    period: formatDateRange(cobertura.fechaInicio, cobertura.fechaFin),
    concept: "Cobertura bonificada — 100%",
    grantedOn: formatDate(cobertura.fechaInicio),
  };
}

export function CoberturaRow({ cobertura }: { cobertura: CoberturaBonificada }): React.ReactElement {
  const fields = buildCoberturaRowFields(cobertura);
  return (
    <li className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:gap-5">
      <div className="min-w-0 flex-1">
        <Badge tone="ok">{fields.badge}</Badge>
        <p className="mt-1.5 text-base font-bold tabular-nums text-ink">{fields.period}</p>
        <p className="mt-0.5 text-xs text-ink-3-strong">
          {fields.concept} · Otorgada el <span className="tabular-nums">{fields.grantedOn}</span>
        </p>
      </div>
      <p className="flex-none text-xl font-extrabold text-ink md:w-24 md:text-right">—</p>
      <div className="hidden md:block md:w-48 md:flex-none" />
    </li>
  );
}
