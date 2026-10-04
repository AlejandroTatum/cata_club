/**
 * /student/payments — the family-facing payment screen.
 *
 * One of the two things a student or a parent actually opens this portal to do
 * ("hay que hacer pago y ver asistencias"). It arrived from upstream visually
 * unmigrated — raw `cata-*` classes, ISO dates printed straight from the API,
 * `$35.00` amounts, a red "selected" filter chip and Argentine voseo in its
 * copy ("Adjuntá", "tenés", "Consultá") — and this pass puts it on the same
 * system as the rest of the product:
 *
 * - `Badge`, `FilterPill`, `Button`, `EmptyState`, `ErrorState`,
 *   `LoadingState`, and the `card` / `h-ctl` / `h-drow` / `rounded-card`
 *   tokens, instead of eight bespoke pill and card shapes.
 * - `formatCurrency` / `formatDate` / `formatDateRange` from
 *   `src/lib/format-utils.ts` — this screen was the second currency grammar
 *   and the third date grammar in the product.
 * - Neutral Ecuadorian Spanish in «tú» (S6). Never voseo.
 * - Selection is coal plus the yellow ball dot (`FilterPill`), never red. Red
 *   is the primary CTA and destructive intent only, so a red "Aprobados" chip
 *   read as an alarm about approved payments.
 *
 * ## Two facts this screen deliberately does NOT show
 *
 * - **"Vigente hasta" from `MembershipSummary.fechaFin`.** That field is
 *   declared on the client type but `MembershipView` in
 *   src/lib/server/student-adapter.ts never populates it — it stays
 *   `undefined` for every real payload, and the old status bar's "Vigente
 *   hasta: {fechaFin}" therefore rendered nothing at all while its `isExpired`
 *   branch silently never fired. The coverage date the card shows and the
 *   renewal/benefit forms start from is `MembershipSummary.cubiertoHasta`
 *   (issue #1328) — the backend's own combined anchor across an APPROVED
 *   `Pago` and a `CoberturaBonificada` (`PagoServicio._fecha_fin_maxima_
 *   combinada`), so a benefit applied through `ApplyBenefitForm` shows up
 *   here too. `student-adapter.ts` normalizes an absent field to `null`, so
 *   there is no real payload where it is `undefined` and no payments-derived
 *   fallback to read instead.
 * - **An amount due.** There is no debt concept in the backend: a Membresia
 *   carries a `montoAplicado` (the plan's price), not a balance. The card
 *   reports the monthly price it can prove and lets the reader enter what they
 *   are paying.
 */

"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { usePersistentPreference } from "@/lib/persistent-preference";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { useAuth } from "@/contexts/AuthContext";
import { isActivationComplete, type ActivationSession } from "@/lib/activation-reasons";

import { fetchStudentPortal, fetchPagosDePersona, fetchCoberturasDePersona, fetchBeneficio, subirVoucherPago, registrarPago } from "@/services/api";
import type { StudentPortalSummary, PagoPersona, MembershipSummary, BeneficioAsignado, CoberturaBonificada } from "@/services/api";
import { BackLink, Badge, Button, EmptyState, FilterPanel, FilterPill, InfoPanel, LoadingState, PAGE_RAIL, StatCard, buttonClasses, cn } from "@/components/ui";

import { describePaymentSituation, firstNameOf, hasOwnMembership, isMinor } from "../student-utils";
import ManagedStudentPicker, { useManagedProfiles, withSelectedStudent } from "../ManagedStudentPicker";
import { getEmptyStateMessage, countPagosByStatus, formatPagoMonto, PAGO_FILTER_LABELS, prepareVoucher, type PagoStatusFilter } from "./payments-utils";
import { formatDate } from "@/lib/format-utils";
import { CreditCard } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { toUserMessage } from "@/lib/error-message";

import HowToPay from "@/components/payments/HowToPay";
import { MembershipCard } from "./MembershipAside";
import { BeneficioNote, PaymentOrBenefitForm } from "./PaymentForms";
import { VoucherUploadPreview } from "./VoucherUploadPreview";
import { PagoRow, CoberturaRow } from "./PagoHistoryRows";
import StudentErrorState from "../StudentErrorState";
import { useLatestPick } from "@/lib/useLatestPick";
import { WHATSAPP_CONTACTO } from "@/lib/error-message";

// ---------------------------------------------------------------------------
// Load state
// ---------------------------------------------------------------------------

type PortalLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: StudentPortalSummary };

type PagosLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; pagos: PagoPersona[]; coberturas: CoberturaBonificada[] };

/**
 * One merged row of the payment history (issue #1369, slice 3): a real
 * `Pago`, or a 100%-coverage activation — applying the benefit never creates
 * a `Pago`, so without the second kind the covered month was invisible in
 * the very history it belongs to.
 */
type HistorialItem =
  | { kind: "pago"; pago: PagoPersona }
  | { kind: "cobertura"; cobertura: CoberturaBonificada };

/** Stat figure that steps down on small screens so a long date never clips. */
function StatValue({ children }: { children: React.ReactNode }): React.ReactElement {
  return <span className="text-lg sm:text-xl xl:text-2xl">{children}</span>;
}

const FILTERS: PagoStatusFilter[] = ["TODOS", "PENDIENTE_VALIDACION", "APROBADO", "RECHAZADO"];

function isPagoStatusFilter(value: string): value is PagoStatusFilter {
  return (FILTERS as string[]).includes(value);
}

/** Shared empty list, so "not loaded yet" is a stable reference for the memos below. */
const NO_PAGOS: PagoPersona[] = [];

// ---------------------------------------------------------------------------
// Main content
// ---------------------------------------------------------------------------

function PaymentsContent({
  data,
  hasAlumnoRole,
  accountPersonaId,
  /** True when the reader arrived from the home band's "Registrar un pago". */
  wantsRegisterForm,
  onRegistered,
}: {
  data: StudentPortalSummary;
  hasAlumnoRole: boolean;
  /** The persona behind the SESSION — not the profile being viewed. */
  accountPersonaId: string;
  wantsRegisterForm: boolean;
  onRegistered: () => void;
}): React.ReactElement {
  const { session } = useAuth();
  // FAM-01: ANY own membership (INACTIVA, waiting on its first payment,
  // included) makes her a profile she can pay for. She keeps the single role
  // REPRESENTANTE after "Unirme como jugador", so the role alone would leave
  // her out of the selector and show only her children's forms.
  const { managedProfiles, selectedId, setSelectedId, selectedProfile } = useManagedProfiles(
    data,
    hasAlumnoRole || hasOwnMembership(data),
    accountPersonaId,
  );

  const [reloadToken, setReloadToken] = useState(0);
  /**
   * A family checking "¿me aprobaron el pago?" comes back to the same filter
   * every time. Remembering it is the whole difference between one glance and
   * three taps.
   */
  const [filter, setFilter] = usePersistentPreference<PagoStatusFilter>(
    "student-payments-filter",
    "TODOS",
    isPagoStatusFilter,
  );
  const [pagosState, setPagosState] = useState<PagosLoadState>({ status: "loading" });
  /**
   * Which payments' accordion detail is open — issue #513: closed by
   * default per row, so a fresh visit shows every row collapsed. Keyed by
   * `Pago.id`, shared between the desktop table and mobile card renderings
   * of the SAME row (`ResponsiveList` mounts both at once; they are the
   * same logical row, so opening one opens the other, even though only one
   * is visible at a time).
   */
  const [openPagoDetailIds, setOpenPagoDetailIds] = useState<ReadonlySet<number>>(new Set());
  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingUploadPagoId, setPendingUploadPagoId] = useState<number | null>(null);
  /** Issue #463 — the file staged by the OS picker, awaiting an explicit
   *  "Confirmar y subir" before `subirVoucherPago` ever runs. */
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const latestPick = useLatestPick();
  /** Object URL for `previewFile`'s thumbnail — only set for an image, and
   *  always revoked, either when a new file replaces it or on unmount. */
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!previewFile || !previewFile.type.startsWith("image/")) {
      setPreviewObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(previewFile);
    setPreviewObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [previewFile]);

  const selectedPersonaId = selectedProfile?.personaId ?? null;

  /**
   * A minor cannot register a payment on their OWN account — but their
   * representative can, from theirs, and the backend agrees: `registrarPago`
   * authorizes "the owner, their representative, or an ADMINISTRADOR" at the
   * service layer.
   *
   * The gate used to read `isMinor(selectedProfile)` alone, which locked a
   * guardian out of paying for their own child — the single most common thing
   * a representante account exists to do — and told them to ask the minor's
   * representative, i.e. themselves.
   */
  const viewingOwnProfile = selectedPersonaId !== null && selectedPersonaId === accountPersonaId;
  const blockedAsMinor = viewingOwnProfile && isMinor(selectedProfile?.fechaNacimiento);

  useEffect(() => {
    if (!selectedPersonaId) return;
    let cancelled = false;
    setPagosState({ status: "loading" });
    // Slice 3: both halves of the same financial history, fetched together —
    // a 100% activation lives in `cobertura_bonificada`, never in `pago`.
    Promise.all([
      fetchPagosDePersona(selectedPersonaId),
      fetchCoberturasDePersona(selectedPersonaId).catch(() => []),
    ])
      .then(([pagos, coberturas]) => {
        if (!cancelled) setPagosState({ status: "ready", pagos, coberturas });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPagosState({
          status: "error",
          message:
            toUserMessage(error, "No se pudo cargar el historial de pagos."),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPersonaId, reloadToken]);

  /**
   * The active benefit, read BEFORE the reader pays (issue #400, slice 06).
   *
   * A failure here is swallowed to `null` rather than surfaced as a blocking
   * error: this is an enrichment of the payment screen, not its core job —
   * the reader can still register a normal payment even if this particular
   * read fails, exactly the same reasoning `resolveCoverageEnd` gets from an
   * empty `pagos` array rather than an error state.
   */
  const [beneficio, setBeneficio] = useState<BeneficioAsignado | null>(null);
  useEffect(() => {
    if (!selectedPersonaId) {
      setBeneficio(null);
      return;
    }
    let cancelled = false;
    fetchBeneficio(Number(selectedPersonaId))
      .then((activo) => {
        if (!cancelled) setBeneficio(activo);
      })
      .catch(() => {
        if (!cancelled) setBeneficio(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPersonaId, reloadToken]);

  const beneficioPorcentaje =
    beneficio?.descuento.porcentaje != null ? Number(beneficio.descuento.porcentaje) : null;
  const beneficioMonto =
    beneficio?.descuento.monto != null ? Number(beneficio.descuento.monto) : null;
  /**
   * A 100% PERCENTAGE benefit swaps the payment form for `ApplyBenefitForm`
   * (no monto, no tipoPago, no voucher — a 100% benefit never creates a
   * `Pago`). A fixed-amount (`monto`) benefit that happens to cover the
   * period exactly is still resolved by `registrarPago`'s normal path on the
   * backend (`CoberturaBonificadaResponseDTO`'s own docstring: "100%" is a
   * property of the PAIR, not the assignment alone) — this client-side gate
   * only recognizes the simple, always-100% case: a percentage discount of
   * exactly 100.
   */
  const isFullBenefit = beneficioPorcentaje != null && Number.isFinite(beneficioPorcentaje) && beneficioPorcentaje === 100;

  // Memoised so the empty-list branch does not hand a fresh array to the three
  // derivations below on every render.
  const pagos = useMemo(
    () => (pagosState.status === "ready" ? pagosState.pagos : NO_PAGOS),
    [pagosState],
  );
  const coberturas = useMemo(
    () => (pagosState.status === "ready" ? pagosState.coberturas : []),
    [pagosState],
  );
  // Issue #1328: `MembershipSummary.cubiertoHasta` (the backend's own
  // combined anchor over an APPROVED `Pago` AND a `CoberturaBonificada`) is
  // the only reading, so a benefit applied through `ApplyBenefitForm` shows
  // up here immediately. `student-adapter.ts` normalizes an absent field to
  // `null`, so there is no real payload where it is `undefined`.
  const coverageEnd = selectedProfile?.membership?.cubiertoHasta ?? null;
  const counts = useMemo(() => countPagosByStatus(pagos), [pagos]);
  /**
   * The merged history (issue #1369, slice 3): pagos AND 100%-coverage
   * activations, newest-first by their own date (`fechaRegistro` vs
   * `fechaInicio` — the activation day). The status filters are PAYMENT
   * statuses, so a cobertura row (which has no payment status) shows only
   * under "TODOS" — filtering by APROBADO must not silently claim rows the
   * backend never gave that status.
   */
  const filteredPagos = useMemo(() => {
    const items: HistorialItem[] = [
      ...pagos.map((pago) => ({ kind: "pago", pago }) as const),
      ...coberturas.map((cobertura) => ({ kind: "cobertura", cobertura }) as const),
    ];
    const visible =
      filter === "TODOS"
        ? items
        : items.filter((item) => item.kind === "pago" && item.pago.estadoPago === filter);
    const itemDate = (item: HistorialItem) =>
      item.kind === "pago" ? item.pago.fechaRegistro : item.cobertura.fechaInicio;
    return [...visible].sort(
      (a, b) => new Date(itemDate(b)).getTime() - new Date(itemDate(a)).getTime(),
    );
  }, [pagos, coberturas, filter]);
  const lastPago = useMemo(
    () =>
      pagos.reduce<PagoPersona | null>(
        (latest, pago) =>
          !latest || new Date(pago.fechaRegistro) > new Date(latest.fechaRegistro) ? pago : latest,
        null,
      ),
    [pagos],
  );
  const hasPendingPago = pagos.some((pago) => pago.estadoPago === "PENDIENTE_VALIDACION");

  /**
   * The dependent's given name, or `null` when the reader IS the student.
   *
   * Everything on this screen that used to say "su" says this instead when it
   * is somebody else's money and somebody else's coverage.
   */
  const studentName = viewingOwnProfile ? null : firstNameOf(selectedProfile?.nombres ?? "");

  /**
   * The same reading the home screen's band shows, from the same function.
   *
   * This screen only borrows two things from it — the sentence a blocked minor
   * gets, and nothing else — because the `MembershipCard` right below already
   * carries the coverage date and the price in the shape this screen owns.
   * What matters is that the two screens can no longer disagree about who a
   * minor should turn to.
   */
  const situation = describePaymentSituation({
    studentName: studentName ?? firstNameOf(selectedProfile?.nombres ?? ""),
    viewingOwnProfile,
    blockedAsMinor,
    representanteName: selectedProfile?.representante
      ? `${selectedProfile.representante.nombres} ${selectedProfile.representante.apellidos}`.trim()
      : null,
    hasMembership: selectedProfile?.membership != null,
    planName: selectedProfile?.membership?.categoria ?? null,
    monthlyPrice: selectedProfile?.membership?.montoAplicado ?? null,
    coverageEnd,
    pendingCount: pagos.filter((pago) => pago.estadoPago === "PENDIENTE_VALIDACION").length,
    esGratuidadFamiliar: selectedProfile?.membership?.esGratuidadFamiliar ?? false,
    suspended: selectedProfile?.membership?.estado === "SUSPENDIDA",
    motivoSuspension: selectedProfile?.membership?.motivoSuspension ?? null,
  });

  /**
   * Issue #400 (slice 4c-b): the amount-driven renewal form below
   * (`RenewPaymentForm`) asks for a monto and derives months from it —
   * there is no honest monto to ask a gratuitous member for, since the
   * charge is $0 regardless of `membership.montoAplicado` (the real
   * tariff, which this slice stopped zeroing). Rather than redesign the
   * form around a months-only input, this reader gets the same "blocked,
   * with an explanation" treatment `blockedAsMinor` already gets below.
   */
  const isGratuitous = selectedProfile?.membership?.esGratuidadFamiliar ?? false;

  // FAM-12 «c»: a guardian whose account is activated may pay a minor
  // dependent's first payment online (same gate as the add-dependent wizard:
  // the membership endpoints stay closed to an account pending activation).
  const canPayFirstOnline =
    !viewingOwnProfile &&
    !blockedAsMinor &&
    selectedProfile?.membership == null &&
    studentName !== null &&
    (session ? isActivationComplete(session as ActivationSession) : false);

  /**
   * FAM-03: the backend refuses a payment on a suspended membership
   * («reactívela antes de registrar un pago»), an instruction only the club can
   * follow. The form is replaced by a statement of that, so the family does not
   * fill in every step to learn it at «Confirmar».
   */
  const isSuspended = selectedProfile?.membership?.estado === "SUSPENDIDA";

  /**
   * Whether the form above is actually reachable for this reader — the only
   * condition under which the empty history may offer "Registrar un pago" as
   * its way out (D11). It restates the four gates `RenewPaymentForm` already
   * applies, in the order it applies them: a minor on their own account never
   * registers, a persona with no `Membresia` has nothing to renew, a
   * gratuitous membership has nothing to pay, and a pending payment blocks a
   * second one until the club rules on it.
   */
  const canRegisterHere =
    !blockedAsMinor &&
    selectedProfile?.membership != null &&
    !isGratuitous &&
    !isSuspended &&
    !hasPendingPago;

  /**
   * Issue #461: the same door D11's empty-state action already opens,
   * offered again from a REJECTED payment's own row — the one real next
   * step once that row stops offering "Subir comprobante". `null` under the
   * same gates `canRegisterHere` already applies: a rejected row is not the
   * place to promise a form the reader cannot actually reach.
   */
  const registerHref =
    canRegisterHere && selectedProfile
      ? withSelectedStudent("/student/payments?registrar=1", selectedProfile.personaId)
      : null;

  function handleSelectFile(pagoId: number): void {
    setUploadError(null);
    setPendingUploadPagoId(pagoId);
    fileInputRef.current?.click();
  }

  function togglePagoDetail(pagoId: number): void {
    setOpenPagoDetailIds((prev) => {
      const next = new Set(prev);
      if (next.has(pagoId)) next.delete(pagoId);
      else next.add(pagoId);
      return next;
    });
  }

  /**
   * Issue #463: picking a file from the OS picker used to fire the real
   * `POST .../voucher` in the same tick as the selection (confirmed live
   * with `browser_network_requests` — no intermediate state existed at all,
   * so a wrong file or a change of mind could only be reacted to AFTER the
   * upload had already happened). This now only stages the file for
   * `VoucherUploadPreview` below; the request fires from
   * `handleConfirmUpload`, never from here.
   */
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (!file) return;
    // Issue #482: `accept` alone lets a reader pick a `.txt` via "All Files".
    // Issue #1226: the BFF's own 5 MB limit only rejects once the upload is
    // already in flight. Both are caught here before the preview/confirm
    // step below.
    // FAM-26: a photo over 5 MB is shrunk before it is staged.
    // Nothing older may be confirmed while the new pick is still being shrunk.
    setPreviewFile(null);
    const prepared = await latestPick.run(prepareVoucher(file));
    if (!prepared) return;
    if ("error" in prepared) {
      setUploadError(prepared.error);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setUploadError(null);
    setPreviewFile(prepared.file);
  }

  async function handleConfirmUpload(): Promise<void> {
    if (!previewFile || !pendingUploadPagoId) return;
    const file = previewFile;
    const pagoId = pendingUploadPagoId;
    setUploadingId(pagoId);
    setUploadError(null);
    try {
      await subirVoucherPago(pagoId, file);
      setReloadToken((n) => n + 1);
    } catch (err) {
      // Inline, not `alert()`: a browser dialog cannot be styled, cannot be
      // read by the surrounding context, and blocks the page it interrupts.
      setUploadError(toUserMessage(err, "No se pudo subir el comprobante."));
    } finally {
      setUploadingId(null);
      setPendingUploadPagoId(null);
      setPreviewFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleCancelUpload(): void {
    latestPick.cancel();
    setPendingUploadPagoId(null);
    setPreviewFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleRegistered(): void {
    setReloadToken((n) => n + 1);
    onRegistered();
  }

  if (selectedProfile === null) {
    return (
      <EmptyState
        icon={<CreditCard size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
        title="No se encontraron jugadores asociados a esta cuenta"
        description="Inscríbete como jugador o agrega un hijo o dependiente para registrar pagos."
        // Issue #460 (Escenario 2): the description already promised "agregue
        // un hijo o dependiente", but the only action here used to be "Ir a mi
        // cuenta" — a dead end for a representative whose child is already
        // registered under someone else. `/student/add-dependent` is where
        // entering that child's real cédula surfaces the existing
        // "Vincular a mi cuenta" button (`DuplicateIdentityHelp`'s
        // `representative` audience) — same pattern `medical-record/page.tsx`'s
        // own empty state already uses for this account state.
        action={
          <Link href="/student/add-dependent" className={buttonClasses("secondary", "sm")}>
            Agregar hijo o dependiente
          </Link>
        }
      />
    );
  }

  return (
    // Full content width, like `/student` and like every admin screen. The
    // 760px cap left the right half of the column empty at 1440; the width now
    // buys a rail that says HOW a payment is made, which is the thing this
    // screen was missing rather than a thing it was too narrow for.
    <>
      <ManagedStudentPicker
        id="student-select-payments"
        profiles={managedProfiles}
        value={selectedId}
        onChange={(id) => {
          setSelectedId(id);
          setFilter("TODOS");
        }}
      />

      {/* Rail layout: history on the left, the account's state and the action
          on the right. The aside comes FIRST in the DOM (phone reading order:
          status, pay, then history) and is placed in column 2 from `lg` up. */}
      <div className={cn(PAGE_RAIL, "lg:items-stretch")}>
        <aside
          data-dash-col
          aria-label="Membresía y registro de pagos"
          className="flex min-w-0 flex-col gap-page max-lg:contents lg:col-start-2 lg:row-start-1 lg:self-start"
        >
      <MembershipCard
        membership={selectedProfile.membership}
        coverageEnd={coverageEnd}
        studentName={studentName}
        approvedCount={counts.APROBADO}
      >
        {/* Issue #400 (slice 06): shown BEFORE any payment control, blocked
            or not — a reader who cannot pay from here (a minor on their own
            account) can still see whether they have a benefit waiting. */}
        {selectedProfile.membership && !isGratuitous && <BeneficioNote beneficio={beneficio} />}
        {blockedAsMinor ? (
          <p className="text-sm text-ink-2">
            {/* The old copy sent EVERY minor to "su representante" — including
                the ones whose `representanteId` is null, who were being pointed
                at a person the backend does not have. `describePaymentSituation`
                resolves that from the payload. */}
            {situation.detail}
          </p>
        ) : isSuspended ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-ink-2">
              {situation.headline} Escribe al club para reactivarla.
            </p>
            <a
              href={WHATSAPP_CONTACTO}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClasses("secondary", "sm")}
            >
              Escribir por WhatsApp
            </a>
          </div>
        ) : isGratuitous ? (
          // Issue #400 (slice 4c-b): `situation.detail` already carries the
          // gratuity explanation (`describePaymentSituation`'s "gratuitous"
          // kind) — same source `blockedAsMinor` reads above, so the two
          // blocked states read from one place and cannot disagree.
          <p className="text-sm text-ink-2">{situation.detail}</p>
        ) : selectedProfile.membership ? (
          <PaymentOrBenefitForm
            membership={selectedProfile.membership}
            personaId={selectedProfile.personaId}
            coverageEnd={coverageEnd}
            hasPendingPago={hasPendingPago}
            autoOpen={wantsRegisterForm && pagosState.status === "ready"}
            studentName={studentName}
            isFullBenefit={isFullBenefit}
            beneficioPorcentaje={beneficioPorcentaje}
            beneficioMonto={beneficioMonto}
            onRegistered={handleRegistered}
          />
        ) : canPayFirstOnline ? (
          // FAM-12 «c»: the FIRST payment of a dependent can be made online —
          // it creates the membership and the club activates it when it
          // approves the payment. After that the normal renewal form applies.
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-ink-2">
              {studentName} todavía no tiene una membresía. Con el primer pago se crea; el club
              lo revisa y la activa. Después podrás renovarla desde aquí.
            </p>
            <Link
              href={`/student/add-dependent?pagar=${selectedProfile.personaId}`}
              className={buttonClasses("primary", "md")}
            >
              Registrar el primer pago de {studentName}
            </Link>
          </div>
        ) : (
          <p className="text-sm text-ink-2">
            El club crea la membresía al registrar el primer pago. Acércate al club para
            activarla y después podrás renovarla desde aquí.
          </p>
        )}
      </MembershipCard>

      <HowToPay className="max-lg:order-2" />

      <InfoPanel title="Cómo pagar y validar" as="div" className="max-lg:order-2">
        <ol className="flex list-decimal flex-col gap-2 pl-4">
          <li>Registra el pago con el valor y el medio que usaste (efectivo o transferencia).</li>
          <li>Si fue transferencia, sube la foto o el PDF del comprobante.</li>
          <li>El club lo revisa: queda «Por validar» hasta que lo apruebe o rechace.</li>
          <li>Al aprobarse, la cobertura de la membresía se extiende.</li>
        </ol>
      </InfoPanel>

        </aside>

        <div data-dash-col className="flex min-w-0 flex-col gap-page max-lg:order-1 lg:col-start-1 lg:row-start-1">
      {pagosState.status === "ready" && (
        <div className="grid grid-cols-2 gap-section xl:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <StatCard
            label="Pagado hasta"
            value={<StatValue>{coverageEnd ? formatDate(coverageEnd) : "—"}</StatValue>}
            hint={coverageEnd ? "fin de la cobertura aprobada" : "sin pagos aprobados"}
          />
          <StatCard label="Pagos aprobados" value={<StatValue>{counts.APROBADO}</StatValue>} hint="en tu historial" />
          <StatCard
            label="Por validar"
            value={<StatValue>{counts.PENDIENTE_VALIDACION}</StatValue>}
            hint="esperando al club"
            
          />
          <StatCard
            label="Último pago"
            value={<StatValue>{lastPago ? formatPagoMonto(lastPago.monto) : "—"}</StatValue>}
            hint={lastPago ? `registrado el ${formatDate(lastPago.fechaRegistro)}` : "aún no hay pagos"}
          />
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,application/pdf"
        className="hidden"
        data-testid="pago-voucher-input"
        onChange={(e) => void handleFileChange(e)}
      />

      {/* Issue #463: the confirm/cancel step between picking a file and
          actually uploading it — see `handleFileChange`'s comment for why
          this exists. */}
      {previewFile && (
        <VoucherUploadPreview
          file={previewFile}
          previewUrl={previewObjectUrl}
          uploading={uploadingId !== null}
          onConfirm={() => void handleConfirmUpload()}
          onCancel={handleCancelUpload}
        />
      )}

      {uploadError && (
        <p role="alert" className="text-sm font-semibold text-state-bad">
          {uploadError}
        </p>
      )}

      {pagosState.status === "loading" && (
        <div className="card">
          <LoadingState label="Cargando tus pagos…" />
        </div>
      )}
      {pagosState.status === "error" && (
        <StudentErrorState message={pagosState.message} onRetry={() => setReloadToken((n) => n + 1)} />
      )}
      {pagosState.status === "ready" && (
        // One card: title, count and the status pills on top, rows below. It
        // claims the column's remaining height (the grid row is as tall as the
        // rail), and short lists are topped up with ghost rows so both columns
        // end together instead of leaving a void under the last payment.
        <section className="card flex flex-1 flex-col overflow-hidden lg:min-h-[calc(100dvh-27rem)]" aria-labelledby="pagos-title">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-field px-5 py-4">
            <h2 id="pagos-title" className="font-display text-lg uppercase leading-tight tracking-flat text-ink">
              Historial de pagos
            </h2>
            {filteredPagos.length > 0 && (
              <span className="text-xs font-semibold tabular-nums text-ink-3-strong">
                {filteredPagos.length}
              </span>
            )}
            <FilterPanel
              bare
              label="Filtros de pagos"
              className="sm:ml-auto"
              chips={
                <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar pagos por estado">
                  {FILTERS.map((option) => (
                    <FilterPill
                      key={option}
                      label={PAGO_FILTER_LABELS[option]}
                      count={counts[option]}
                      active={filter === option}
                      onClick={() => setFilter(option)}
                    />
                  ))}
                </div>
              }
            />
          </div>
          {filteredPagos.length === 0 ? (
            <>
              <EmptyState
                surface="inset"
                fill
                icon={<CreditCard size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
                title={getEmptyStateMessage(filter)}
                description={
                  filter !== "TODOS"
                    ? "Prueba con otro estado para ver el resto de tu historial."
                    : blockedAsMinor
                      ? // "Cuando registre un pago" is an instruction this
                        // reader cannot follow — the club registers it.
                        "Cuando el club registre un pago tuyo aparecerá aquí, con el período que cubre."
                      : "Cuando registres un pago aparecerá aquí, junto con el resultado de su validación."
                }
                // D11's third part. The action used to appear ONLY when a filter
                // was on, which is backwards: a filtered empty list is the
                // recoverable case, and the family with no payments at all — the
                // socio nuevo D11b says to design for FIRST — was the one left
                // with nothing to do. `?registrar=1` is the same door the home
                // screen's band already opens, so this adds a way in, not a
                // behaviour.
                action={
                  filter !== "TODOS" ? (
                    <Button size="sm" onClick={() => setFilter("TODOS")}>
                      Ver todos los pagos
                    </Button>
                  ) : canRegisterHere ? (
                    <Link
                      href={withSelectedStudent(
                        "/student/payments?registrar=1",
                        selectedProfile.personaId,
                      )}
                      className={buttonClasses("secondary", "sm")}
                    >
                      {/* Issue #400 slice 06: a 100% benefit has nothing to
                          "registrar" — this door leads to `ApplyBenefitForm`,
                          not `RenewPaymentForm`, so it says so. */}
                      {isFullBenefit ? "Aplicar mi beneficio" : "Registrar un pago"}
                    </Link>
                  ) : undefined
                }
              />
            </>
          ) : (
            <>
              <ul
                data-testid="student-payments-table"
                className="flex flex-col divide-y divide-line border-t border-line"
              >
                {filteredPagos.map((item) =>
                  item.kind === "pago" ? (
                    <PagoRow
                      key={`pago-${item.pago.id}`}
                      pago={item.pago}
                      isOpen={openPagoDetailIds.has(item.pago.id)}
                      onToggleDetail={() => togglePagoDetail(item.pago.id)}
                      onUploadFile={handleSelectFile}
                      uploadingId={uploadingId}
                      registerHref={registerHref}
                    />
                  ) : (
                    <CoberturaRow key={`cobertura-${item.cobertura.id}`} cobertura={item.cobertura} />
                  ),
                )}
              </ul>
            </>
          )}
        </section>
      )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

function PaymentsPageContent(): React.ReactElement {
  const { session } = useAuth();
  const personaId = session?.user.id ?? "";
  const hasAlumnoRole = session?.user.role === "estudiante";
  // `?registrar=1` is the home band's CTA saying "this reader came here to
  // pay" — the form opens itself instead of asking for a third click.
  const wantsRegisterForm = useSearchParams().get("registrar") === "1";

  const [state, setState] = useState<PortalLoadState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!personaId) return;
    let cancelled = false;
    setState({ status: "loading" });
    fetchStudentPortal(personaId)
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: toUserMessage(error, "No se pudo cargar la información."),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [personaId, reloadToken]);

  /**
   * True when this ACCOUNT cannot register a payment anywhere on the screen:
   * its own profile is a minor and it manages nobody else. The row-level gate
   * still lives in `PaymentsContent` (it depends on which profile is
   * selected); this is only the page's own promise to its reader.
   */
  // FAM-01: a representative's own membership (even INACTIVA) is a payment she can register.
  const ownMembership = state.status === "ready" && hasOwnMembership(state.data);
  const accountCannotRegister =
    state.status === "ready" &&
    state.data.representados.length === 0 &&
    isMinor(state.data.self?.fechaNacimiento);

  return (
    <AppShell
      // "Pagos", not "Mis pagos": the codebase's own rule is that a nav label
      // IS the destination's page title (see `lib/destinations.ts`), and the
      // sidebar row has always said "Pagos". "Mis" was also a lie to the
      // reader this screen most often serves — a representante paying for a
      // dependent, who has no membership of her own.
      title="Pagos"
      // A minor with no dependants of their own cannot register anything from
      // here — the gate below is deliberate and stays. Telling them to
      // "registre un pago" in the page's own subtitle was an instruction the
      // screen then refused to let them follow.
      subtitle={
        accountCannotRegister
          ? "Consulta tu membresía, mira cómo se paga y sigue el historial de tus pagos."
          : hasAlumnoRole || ownMembership
            ? "Registra un pago, sigue su validación y consulta lo que ya pagaste."
            : "Registra el pago de un dependiente, sigue su validación y consulta lo que ya pagó."
      }
      // Issue #1396: through the shell's `back` slot, so the control precedes
      // the title in document order — `PageHeader` is drawn above `<main>`,
      // so a back control among the children lands after the title by
      // construction. The finding that put a named way back on this screen
      // (issue #316 hallazgo #70) stands; only its placement moves.
      back={<BackLink href="/student" />}
    >

      {state.status === "loading" && (
        <div className="card">
          <LoadingState label="Cargando tus pagos…" />
        </div>
      )}
      {state.status === "error" && (
        <StudentErrorState message={state.message} onRetry={() => setReloadToken((n) => n + 1)} />
      )}
      {state.status === "ready" && (
        <PaymentsContent
          data={state.data}
          hasAlumnoRole={hasAlumnoRole}
          accountPersonaId={personaId}
          wantsRegisterForm={wantsRegisterForm}
          onRegistered={() => setReloadToken((n) => n + 1)}
        />
      )}
    </AppShell>
  );
}

export default function StudentPaymentsPage(): React.ReactElement {
  return (
    <ProtectedRoute allowedRoles={["representante", "estudiante", "unsupported"]}>
      {/* `useSearchParams` needs a boundary to fall back to during prerender
          — the same wrapper `/reset-password` uses for the same reason. */}
      <Suspense>
        <PaymentsPageContent />
      </Suspense>
    </ProtectedRoute>
  );
}
