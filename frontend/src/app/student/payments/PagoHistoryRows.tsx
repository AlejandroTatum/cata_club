"use client";

/** Payment history rows (table at md+, cards below) for /student/payments. */

import Link from "next/link";
import type { PagoPersona, CoberturaBonificada } from "@/services/api";
import { Badge, Button, ResponsiveList, TableCell, TableRow, cn, type BadgeTone } from "@/components/ui";
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

const EVIDENCE_LINK =
  "inline-flex h-8 items-center gap-1.5 rounded-ctl border border-line-2 bg-paper px-2.5 text-xs font-semibold text-ink hover:bg-sunken";

/**
 * The two documents a payment can carry, as direct row actions: the OFFICIAL
 * receipt the club generates on approval (`comprobanteOficialUrl`, issue #400
 * criterio 8) and the proof the member uploaded (`voucherUrl`). They used to
 * hide inside the expandable detail; a family looking for "mi recibo" should
 * not have to open anything.
 */
function PagoEvidenceLinks({ pago }: { pago: PagoPersona }): React.ReactElement | null {
  if (!pago.comprobanteOficialUrl && !pago.voucherUrl) return null;
  return (
    <>
      {pago.comprobanteOficialUrl && (
        <a
          href={pago.comprobanteOficialUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Descargar comprobante oficial"
          className={EVIDENCE_LINK}
        >
          <Download size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
          Recibo
        </a>
      )}
      {pago.voucherUrl && (
        <a
          href={pago.voucherUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Ver el comprobante"
          className={EVIDENCE_LINK}
        >
          <Paperclip size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
          Mi comprobante
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

const PAGO_TABLE_COLUMN_COUNT = 5;

/**
 * The desktop table row — `renderRow` returns the COMPLETE row markup, same
 * contract `ResponsiveList`'s own doc comment describes for `/members`'
 * `AccountRow`: a summary `<TableRow>` plus, when this payment has detail to
 * show, a second `<TableRow>` holding the accordion panel, spanning every
 * column. Collapsed by default (`isOpen` starts `false` in `PaymentsContent`)
 * — the accordion the issue asks for, "cerrado por defecto por fila".
 */
export function PagoTableRow({
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
  const panelId = `pago-detail-desktop-${pago.id}`;

  return (
    <>
      <TableRow>
        <TableCell type="badge">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={fields.estado.tone}>{fields.estado.label}</Badge>
            {/* Distinct from an ordinary "awaiting validation" row: this is
                the payment a failed voucher upload left behind. The owner's
                call (decisiones §7) keeps it, marked, instead of reverting
                it. */}
            {fields.faltaComprobante && <Badge tone="bad">Falta el comprobante</Badge>}
          </div>
          <PagoRejection pago={pago} />
        </TableCell>
        <TableCell type="number">{fields.amount}</TableCell>
        <TableCell type="text">{fields.period}</TableCell>
        <TableCell type="text">
          <span className="block">{fields.method}</span>
          <span className="mt-px block text-2xs tracking-flat text-ink-3">
            Registrado el <span className="tabular-nums">{fields.registeredOn}</span>
          </span>
        </TableCell>
        <TableCell type="action">
          <div className="flex flex-wrap items-center justify-end gap-1.5">
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
        </TableCell>
      </TableRow>
      {hasDetail && (
        <TableRow hidden={!isOpen}>
          <TableCell colSpan={PAGO_TABLE_COLUMN_COUNT} id={panelId} className="bg-sunken">
            <PagoDetailPanel pago={pago} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/** The mobile card — same facts as `PagoTableRow`, same accordion contract,
 *  in a `<li>` instead of a table row pair. */
export function PagoCard({
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
  const panelId = `pago-detail-mobile-${pago.id}`;

  // Stacked, not side-by-side: the card only renders below `md`
  // (`ResponsiveList`), where a metadata-plus-actions flex row repeats the
  // exact failure `DataRow`'s basis-0 comment documents (issue #660) — with
  // `flex-1` the info block's hypothetical size is 0, so the wide
  // "Registrar un pago nuevo" link plus "Detalle" claimed the row and the
  // rejection metadata squeezed into a ~50px column (issue #666's report).
  // One column: facts, then actions, then (open) detail. The desktop table
  // row keeps the side-by-side action cell — it has the width for it.
  return (
    <li className="flex flex-col gap-3 p-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-base font-bold tabular-nums text-ink">{fields.amount}</span>
          <Badge tone={fields.estado.tone}>{fields.estado.label}</Badge>
          {fields.faltaComprobante && <Badge tone="bad">Falta el comprobante</Badge>}
        </div>
        <p className="mt-1 text-xs text-ink-3-strong">
          {fields.method} · Registrado el{" "}
          <span className="tabular-nums">{fields.registeredOn}</span> · Cubre{" "}
          <span className="tabular-nums">{fields.period}</span>
        </p>
        <PagoRejection pago={pago} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
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

export function CoberturaTableRow({ cobertura }: { cobertura: CoberturaBonificada }): React.ReactElement {
  const fields = buildCoberturaRowFields(cobertura);
  return (
    <TableRow>
      <TableCell type="badge">
        <Badge tone="ok">{fields.badge}</Badge>
      </TableCell>
      <TableCell type="number">—</TableCell>
      <TableCell type="text">{fields.period}</TableCell>
      <TableCell type="text">
        <span className="block">{fields.concept}</span>
        <span className="mt-px block text-2xs tracking-flat text-ink-3">
          Otorgada el <span className="tabular-nums">{fields.grantedOn}</span>
        </span>
      </TableCell>
      <TableCell type="action" />
    </TableRow>
  );
}

/** The mobile card — same facts as `CoberturaTableRow`, same one-column
 *  order `PagoCard` settled on. */
export function CoberturaCard({ cobertura }: { cobertura: CoberturaBonificada }): React.ReactElement {
  const fields = buildCoberturaRowFields(cobertura);
  return (
    <li className="flex flex-col gap-3 p-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-base font-bold tabular-nums text-ink">—</span>
          <Badge tone="ok">{fields.badge}</Badge>
        </div>
        <p className="mt-1 text-xs text-ink-3-strong">
          {fields.concept} · Otorgada el{" "}
          <span className="tabular-nums">{fields.grantedOn}</span> · Cubre{" "}
          <span className="tabular-nums">{fields.period}</span>
        </p>
      </div>
    </li>
  );
}

/**
 * Placeholder rows under an empty history: they show the shape the list will
 * take (status chip, period, amount) so the empty box reads as "not yet"
 * instead of a void. Decorative only — hidden from assistive tech.
 */
export function GhostPagoRows({ count = 3 }: { count?: number }): React.ReactElement {
  return (
    <ul aria-hidden="true" data-testid="pago-ghost-rows" className="flex flex-col divide-y divide-line border-t border-line">
      {Array.from({ length: count }, (_, i) => (
        <li
          key={i}
          className="flex items-center gap-4 px-4 py-3.5"
          style={{ opacity: 1 - i * 0.28 }}
        >
          <span className="h-5 w-20 flex-none rounded-full bg-line" />
          <span className="h-3 w-16 flex-none rounded-full bg-line" />
          <span className="h-3 min-w-0 flex-1 rounded-full bg-line/70" />
          <span className="hidden h-3 w-24 flex-none rounded-full bg-line/70 sm:block" />
        </li>
      ))}
    </ul>
  );
}
