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
 * - Neutral Ecuadorian Spanish, usted. The student portal is not tuteo and it
 *   is certainly not voseo.
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

import { fetchStudentPortal, fetchPagosDePersona, fetchCoberturasDePersona, fetchBeneficio, subirVoucherPago, registrarPago } from "@/services/api";
import type { StudentPortalSummary, PagoPersona, MembershipSummary, BeneficioAsignado, CoberturaBonificada } from "@/services/api";
import { BackLink, Badge, Button, EmptyState, ErrorState, FilterPanel, FilterPill, LoadingState, ResponsiveList, TableHeaderCell, buttonClasses, cn } from "@/components/ui";

import { describePaymentSituation, firstNameOf, isMinor } from "../student-utils";
import ManagedStudentPicker, { useManagedProfiles, withSelectedStudent } from "../ManagedStudentPicker";
import { getEmptyStateMessage, countPagosByStatus, PAGO_FILTER_LABELS, voucherFileError, type PagoStatusFilter } from "./payments-utils";
import { CreditCard } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { toUserMessage } from "@/lib/error-message";

import { MembershipCard } from "./MembershipAside";
import { HowToPay } from "./HowToPay";
import { BeneficioNote, PaymentOrBenefitForm } from "./PaymentForms";
import { VoucherUploadPreview } from "./VoucherUploadPreview";
import { PagoTableRow, PagoCard, CoberturaTableRow, CoberturaCard } from "./PagoHistoryRows";

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
  const { managedProfiles, selectedId, setSelectedId, selectedProfile } = useManagedProfiles(
    data,
    hasAlumnoRole,
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

  /**
   * The two states whose next step IS the procedure behind "Ver ayuda", where
   * the disclosure is therefore open on mount (see `HowToPay`).
   *
   * "No tiene ningún pago aprobado" and "su cobertura venció" are the only
   * ones `describePaymentSituation` gives an urgent CTA AND a procedure to
   * follow: the reader has something to do and the screen owes them the how.
   * `ending-soon` is urgent too but still covered — renewing early is not the
   * same as catching up — so it keeps the collapsed default, as do the two
   * states that describe a situation rather than an action (`minor-blocked`,
   * `gratuitous`) and the healthy `covered` one.
   *
   * Read only from a RESOLVED history: while `pagos` is still empty every
   * profile looks like "never paid", which would seed the panel open for a
   * family that is up to date. `HowToPay` is mounted no earlier than the
   * settled state below for the same reason.
   */
  const howToPayOpensByDefault =
    pagosState.status === "ready" &&
    (situation.kind === "expired" || situation.kind === "never-paid");

  /**
   * The history has stopped loading — `ready` or `error` — which is the first
   * moment the reader's situation is a fact rather than a default.
   *
   * `HowToPay` mounts here and not before, so its open/closed initial state is
   * seeded from that fact. On an ERROR the panel still renders (collapsed): the
   * help describes the form above it, which is unaffected by the history, and
   * removing it would answer a failed lookup with a missing paragraph. What a
   * failed lookup may not do is OPEN the disclosure, which is why
   * `howToPayOpensByDefault` additionally requires `ready`.
   */
  const pagosSettled = pagosState.status !== "loading";

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
    !blockedAsMinor && selectedProfile?.membership != null && !isGratuitous && !hasPendingPago;

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
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    // Issue #482: `accept` alone lets a reader pick a `.txt` via "All Files".
    // Issue #1226: the BFF's own 5 MB limit only rejects once the upload is
    // already in flight. Both are caught here before the preview/confirm
    // step below.
    const error = voucherFileError(file);
    if (error) {
      setUploadError(error);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setUploadError(null);
    setPreviewFile(file);
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
        title="No se encontraron estudiantes asociados a esta cuenta"
        description="Inscríbase como jugador o agregue un hijo o dependiente para registrar pagos."
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

      {/* One column, not a rail.
       *
       * The rail existed to hold "Cómo se registra un pago", and that block is
       * behind "Ver ayuda" now (D11c — see the note above `HowToPay`). With it
       * gone there is no second column: the membership summary, the filters
       * and the history are one reading order, top to bottom, and it is the
       * same order a phone already got. A 340px column kept for its own sake
       * would be the "rail does not close vertical emptiness" mistake
       * `PAGE_RAIL`'s own doc comment warns about.
       *
       * The disclosure sits directly under the card whose form it explains,
       * not at the top of the page: the question it answers is the one the
       * reader has while looking at "Registrar un pago". */}
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
        ) : (
          <p className="text-sm text-ink-2">
            El club crea la membresía al registrar el primer pago. Acérquese a administración para
            activarla y después podrá renovarla desde aquí.
          </p>
        )}
      </MembershipCard>

      {/* Mounted once the history has settled — see `pagosSettled`. */}
      {pagosSettled && (
        <HowToPay
          studentName={studentName}
          blocked={blockedAsMinor}
          gratuitous={isGratuitous}
          hasMembership={selectedProfile.membership != null}
          monthlyPrice={selectedProfile.membership?.montoAplicado ?? null}
          openByDefault={howToPayOpensByDefault}
        />
      )}

      {/* Selection is coal plus the ball dot — `FilterPill` owns that rule.
          The chips used to sit loose on the canvas here too; the portal
          filters through the same panel the admin screens do. */}
      <FilterPanel
        label="Filtros de pagos"
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

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,application/pdf"
        className="hidden"
        data-testid="pago-voucher-input"
        onChange={handleFileChange}
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
          <LoadingState label="Cargando sus pagos…" />
        </div>
      )}
      {pagosState.status === "error" && (
        <ErrorState message={pagosState.message} onRetry={() => setReloadToken((n) => n + 1)} />
      )}
      {pagosState.status === "ready" && (
        // `flex-1` when — and only when — the list is empty (D11b).
        //
        // Everything above this is a fixed summary; the history is the only
        // block whose height is a function of the family's real record, so it
        // is the one that may claim the height `AppShell`'s `<main>` already
        // reserved. But claiming it unconditionally was measured and rejected:
        // with one payment on file the card stretched to the foot of the
        // window and drew a 200px empty frame under a single row, which is the
        // same emptiness the redesign is closing, moved inside a border and
        // made MORE visible than the canvas it replaced.
        //
        // Empty is the case where stretching earns its keep, because
        // `EmptyState`'s `fill` centres the statement in the box instead of
        // pinning it to the top — the shape `/members` already uses for its
        // own no-results state. It is also the case D11b says to design for
        // first: a socio nuevo has no payments at all.
        <section
          className={cn("flex flex-col", filteredPagos.length === 0 && "flex-1")}
          aria-labelledby="pagos-title"
        >
          <div className="mb-3 flex items-center gap-3">
            <h2 id="pagos-title" className="flex-1 text-sm font-bold text-ink">
              Historial de pagos
            </h2>
            {filteredPagos.length > 0 && (
              <span className="text-xs font-semibold tabular-nums text-ink-3">
                {filteredPagos.length}
              </span>
            )}
          </div>
          {filteredPagos.length === 0 ? (
            <div className="card flex flex-1 flex-col overflow-hidden">
              <EmptyState
                surface="inset"
                fill
                icon={<CreditCard size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
                title={getEmptyStateMessage(filter)}
                description={
                  filter !== "TODOS"
                    ? "Pruebe con otro estado para ver el resto de su historial."
                    : blockedAsMinor
                      ? // "Cuando registre un pago" is an instruction this
                        // reader cannot follow — the club registers it.
                        "Cuando el club registre un pago suyo aparecerá aquí, con el período que cubre."
                      : "Cuando registre un pago aparecerá aquí, junto con el resultado de su validación."
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
            </div>
          ) : (
            // Issue #513: the same `ResponsiveList`/`Table*`/`Badge`
            // primitives `/payments` (the admin validation queue) already
            // uses — same `breakpoint`/`order`, so this history keeps
            // whichever DOM-first order that screen already settled on
            // (see `ResponsiveList`'s own doc comment on why that order is
            // not a no-op). `ResponsiveList` supplies its own `card`
            // surface, which is why the title bar above sits outside one.
            <ResponsiveList
              breakpoint="md"
              order="tableFirst"
              tableTestId="student-payments-table"
              cardsTestId="student-payments-cards"
              items={filteredPagos}
              // `pago.id` and `cobertura.id` are different tables' sequences:
              // the kind prefix keeps the React key unique across the merge.
              getKey={(item) =>
                item.kind === "pago" ? `pago-${item.pago.id}` : `cobertura-${item.cobertura.id}`
              }
              columns={[
                <TableHeaderCell key="estado" type="badge">Estado</TableHeaderCell>,
                <TableHeaderCell key="monto" type="number">Monto</TableHeaderCell>,
                <TableHeaderCell key="periodo" type="text">Período</TableHeaderCell>,
                <TableHeaderCell key="metodo" type="text">Método</TableHeaderCell>,
                <TableHeaderCell key="accion" type="action">
                  <span className="sr-only">Acción</span>
                </TableHeaderCell>,
              ]}
              renderRow={(item) =>
                item.kind === "pago" ? (
                  <PagoTableRow
                    pago={item.pago}
                    isOpen={openPagoDetailIds.has(item.pago.id)}
                    onToggleDetail={() => togglePagoDetail(item.pago.id)}
                    onUploadFile={handleSelectFile}
                    uploadingId={uploadingId}
                    registerHref={registerHref}
                  />
                ) : (
                  <CoberturaTableRow cobertura={item.cobertura} />
                )
              }
              renderCard={(item) =>
                item.kind === "pago" ? (
                  <PagoCard
                    pago={item.pago}
                    isOpen={openPagoDetailIds.has(item.pago.id)}
                    onToggleDetail={() => togglePagoDetail(item.pago.id)}
                    onUploadFile={handleSelectFile}
                    uploadingId={uploadingId}
                    registerHref={registerHref}
                  />
                ) : (
                  <CoberturaCard cobertura={item.cobertura} />
                )
              }
            />
          )}
        </section>
      )}

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
          ? "Consulte su membresía, vea cómo se paga y siga el historial de sus pagos."
          : hasAlumnoRole
            ? "Registre un pago, siga su validación y consulte lo que ya pagó."
            : "Registre el pago de un dependiente, siga su validación y consulte lo que ya pagó."
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
          <LoadingState label="Cargando sus pagos…" />
        </div>
      )}
      {state.status === "error" && (
        <ErrorState message={state.message} onRetry={() => setReloadToken((n) => n + 1)} />
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
