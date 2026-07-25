"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchStudentPortal,
  fetchPagosDePersona,
  subirVoucherPago,
  registrarPago,
} from "@/services/api";
import type {
  StudentPortalSummary,
  StudentProfileSummary,
  PagoPersona,
  MembershipSummary,
  RegistrarPagoInput,
} from "@/services/api";
import { isRepresentative, isMinor } from "../student-utils";
import {
  filterPagosByStatus,
  sortPagosByDate,
  formatPagoMonto,
  getEmptyStateMessage,
  TIPO_PAGO_LABEL,
  type PagoStatusFilter,
  PAGO_FILTER_LABELS,
} from "./payments-utils";
import {
  CreditCard,
  AlertTriangle,
  ChevronDown,
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  Upload,
  Paperclip,
  Loader2,
  Plus,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";

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
  | { status: "ready"; pagos: PagoPersona[] };

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------

function LoadingCard(): React.ReactElement {
  return (
    <div className="card flex min-h-[40vh] items-center justify-center p-6 text-center">
      <p className="text-sm text-cata-text/50">Cargando pagos...</p>
    </div>
  );
}

function ErrorCard({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}): React.ReactElement {
  return (
    <div className="card p-6 text-center">
      <AlertTriangle
        size={28}
        strokeWidth={1.5}
        className="mx-auto mb-3 text-cata-red"
        aria-hidden="true"
      />
      <p className="mb-4 text-sm text-cata-text/65">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="btn-secondary mx-auto inline-flex items-center gap-2"
      >
        <RefreshCw size={14} strokeWidth={1.5} aria-hidden="true" />
        Reintentar
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Membership status bar (sticky)
// ---------------------------------------------------------------------------

function MembershipStatusBar({
  membership,
}: {
  membership: MembershipSummary | null;
}): React.ReactElement | null {
  if (!membership) return null;

  const hoyIso = new Date().toISOString().slice(0, 10);
  const isExpired =
    membership.estado === "VENCIDA" ||
    (membership.fechaFin !== null && membership.fechaFin < hoyIso);
  const isActive = membership.estado === "ACTIVA" && !isExpired;

  return (
    <div className="mb-6 flex items-center gap-3 rounded-xl border border-cata-border bg-cata-surface px-4 py-3">
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          isActive ? "bg-emerald-100" : isExpired ? "bg-red-100" : "bg-amber-100"
        }`}
      >
        <ShieldCheck
          size={16}
          strokeWidth={1.5}
          className={
            isActive
              ? "text-emerald-600"
              : isExpired
                ? "text-cata-red"
                : "text-amber-600"
          }
          aria-hidden="true"
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-cata-text">
          Membresía:{" "}
          <span className={isActive ? "text-emerald-600" : isExpired ? "text-cata-red" : "text-amber-600"}>
            {isExpired ? "Vencida" : isActive ? "Activa" : membership.estado}
          </span>
        </p>
        {membership.fechaFin && (
          <p className="text-xs text-cata-text/55">
            {isExpired ? "Venció" : "Vigente hasta"}: {membership.fechaFin}
          </p>
        )}
      </div>
      {membership.categoria && (
        <span className="hidden shrink-0 rounded-full bg-cata-bg px-2.5 py-0.5 text-xs font-medium text-cata-text/65 sm:inline-block">
          {membership.categoria}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter chips
// ---------------------------------------------------------------------------

function FilterChips({
  active,
  onChange,
  counts,
}: {
  active: PagoStatusFilter;
  onChange: (f: PagoStatusFilter) => void;
  counts: Record<PagoStatusFilter, number>;
}): React.ReactElement {
  const filters: PagoStatusFilter[] = ["TODOS", "PENDIENTE_VALIDACION", "APROBADO", "RECHAZADO"];
  return (
    <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Filtrar por estado">
      {filters.map((f) => (
        <button
          key={f}
          type="button"
          role="tab"
          aria-selected={active === f}
          onClick={() => onChange(f)}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            active === f
              ? "bg-cata-red text-white"
              : "border border-cata-border bg-cata-surface text-cata-text/65 hover:border-cata-red/30 hover:text-cata-red"
          }`}
        >
          {PAGO_FILTER_LABELS[f]}
          <span
            className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
              active === f ? "bg-white/20" : "bg-cata-bg"
            }`}
          >
            {counts[f]}
          </span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pago status badge
// ---------------------------------------------------------------------------

function PagoEstadoBadge({
  estado,
}: {
  estado: PagoPersona["estadoPago"];
}): React.ReactElement {
  if (estado === "APROBADO") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        <CheckCircle2 size={10} strokeWidth={2} aria-hidden="true" /> Aprobado
      </span>
    );
  }
  if (estado === "RECHAZADO") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-cata-red">
        <XCircle size={10} strokeWidth={2} aria-hidden="true" /> Rechazado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-900/20 px-2 py-0.5 text-xs font-medium text-amber-400">
      <Clock size={10} strokeWidth={2} aria-hidden="true" /> Pendiente
    </span>
  );
}

// ---------------------------------------------------------------------------
// Renew payment form (inline, improved with proportional date calculation)
// ---------------------------------------------------------------------------

function RenewPaymentForm({
  membership,
  personaId,
  onRenewed,
  hasPendingPago = false,
}: {
  membership: MembershipSummary;
  personaId: string;
  onRenewed: () => void;
  hasPendingPago?: boolean;
}): React.ReactElement {
  const [showForm, setShowForm] = useState(false);
  const [monto, setMonto] = useState<string>(membership.montoAplicado ?? "");
  const [tipoPago, setTipoPago] = useState<"EFECTIVO" | "TRANSFERENCIA">("TRANSFERENCIA");
  const [fechaInicio, setFechaInicio] = useState<string>("");
  const [fechaFin, setFechaFin] = useState<string>("");
  const [voucherFile, setVoucherFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const monthlyPrice = parseFloat(String(membership.montoAplicado ?? "").replace(/[^0-9.]/g, "")) || 0;

  function calcFechaFin(baseDate: Date, amount: number): string {
    if (monthlyPrice <= 0 || amount <= 0) return "";
    const months = amount / monthlyPrice;
    const fin = new Date(baseDate);
    fin.setMonth(fin.getMonth() + months);
    return fin.toISOString().slice(0, 10);
  }

  function resolveFechaInicio(): Date {
    const hoy = new Date();
    const prevFin = membership.fechaFin ? new Date(membership.fechaFin + "T12:00:00") : null;
    return prevFin && prevFin.getTime() > hoy.getTime() ? prevFin : hoy;
  }

  function handleOpen(): void {
    setShowForm(true);
    setError(null);
    setVoucherFile(null);
    const base = resolveFechaInicio();
    setFechaInicio(base.toISOString().slice(0, 10));
    const amount = parseFloat(String(monto).replace(/[^0-9.]/g, "")) || 0;
    setFechaFin(amount > 0 ? calcFechaFin(base, amount) : "");
  }

  function handleMontoChange(value: string): void {
    setMonto(value);
    if (!fechaInicio) return;
    const amount = parseFloat(value.replace(/[^0-9.]/g, "")) || 0;
    setFechaFin(amount > 0 ? calcFechaFin(new Date(fechaInicio + "T12:00:00"), amount) : "");
  }

  async function handleSubmit(): Promise<void> {
    const montoNum = Number(monto);
    if (!montoNum || montoNum <= 0) {
      setError("El monto debe ser mayor a 0.");
      return;
    }
    if (monthlyPrice > 0 && montoNum % monthlyPrice !== 0) {
      setError(`El monto debe ser múltiplo de $${monthlyPrice}.`);
      return;
    }
    if (!fechaInicio || !fechaFin) {
      setError("Las fechas son obligatorias.");
      return;
    }
    if (fechaInicio >= fechaFin) {
      setError("La fecha de inicio debe ser anterior a la fecha de fin.");
      return;
    }
    if (tipoPago === "TRANSFERENCIA" && !voucherFile) {
      setError("El comprobante de transferencia es obligatorio.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const nuevoPago = await registrarPago({
        monto: montoNum,
        tipoPago,
        fechaInicio,
        fechaFin,
        personaId: Number(personaId),
        membresiaId: membership.id,
      } satisfies RegistrarPagoInput);

      if (voucherFile && nuevoPago?.id) {
        await subirVoucherPago(nuevoPago.id, voucherFile);
      }

      setShowForm(false);
      setVoucherFile(null);
      onRenewed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar el pago.");
    } finally {
      setLoading(false);
    }
  }

  if (hasPendingPago) {
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
        Ya tenés un pago pendiente de validación. Esperá a que sea aprobado para registrar uno nuevo.
      </p>
    );
  }

  if (!showForm) {
    return (
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-cata-red px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-cata-red/85"
      >
        <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
        Registrar pago
      </button>
    );
  }

  const durationLabel = (() => {
    const amount = parseFloat(String(monto).replace(/[^0-9.]/g, "")) || 0;
    if (monthlyPrice <= 0 || amount <= 0) return null;
    const months = amount / monthlyPrice;
    return months === 1 ? "1 mes de vigencia" : `${months} meses de vigencia`;
  })();

  return (
    <div className="space-y-2.5 rounded-lg bg-cata-bg/60 p-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs font-medium text-cata-text/65">
          Monto
          <input
            type="number"
            step={monthlyPrice > 0 ? monthlyPrice : "0.01"}
            min="0"
            value={monto}
            onChange={(e) => handleMontoChange(e.target.value)}
            className="mt-0.5 w-full rounded-lg border border-cata-border bg-cata-surface px-2.5 py-1.5 text-xs text-cata-text"
            placeholder="0.00"
          />
        </label>
        <label className="text-xs font-medium text-cata-text/65">
          Método
          <select
            value={tipoPago}
            onChange={(e) => {
              const val = e.target.value as "EFECTIVO" | "TRANSFERENCIA";
              setTipoPago(val);
              if (val !== "TRANSFERENCIA") setVoucherFile(null);
            }}
            className="mt-0.5 w-full rounded-lg border border-cata-border bg-cata-surface px-2.5 py-1.5 text-xs text-cata-text"
          >
            <option value="TRANSFERENCIA">Transferencia</option>
            <option value="EFECTIVO">Efectivo</option>
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-lg border border-cata-border/50 bg-cata-surface/50 px-2.5 py-2">
        <div className="text-xs">
          <span className="text-cata-text/45">Inicio: </span>
          <span className="font-medium text-cata-text">{fechaInicio || "—"}</span>
        </div>
        <div className="text-xs">
          <span className="text-cata-text/45">Fin: </span>
          <span className="font-medium text-cata-text">{fechaFin || "—"}</span>
        </div>
      </div>
      {durationLabel && (
        <p className="text-[10px] text-cata-text/45">
          {durationLabel}
          {monthlyPrice > 0 && ` (precio mensual: $${monthlyPrice})`}
        </p>
      )}

      {tipoPago === "TRANSFERENCIA" && (
        <label className="block text-xs font-medium text-cata-text/65">
          Comprobante de pago
          <div className="mt-0.5 flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              onChange={(e) => setVoucherFile(e.target.files?.[0] ?? null)}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 rounded-lg border border-dashed border-cata-border bg-cata-surface px-2.5 py-1.5 text-xs text-cata-text/65 transition-colors hover:border-cata-red/30 hover:text-cata-text"
            >
              <Upload size={12} strokeWidth={1.5} aria-hidden="true" />
              {voucherFile ? voucherFile.name : "Seleccionar archivo"}
            </button>
            {voucherFile && (
              <button
                type="button"
                onClick={() => setVoucherFile(null)}
                className="text-[10px] text-cata-text/45 hover:text-cata-red"
              >
                Quitar
              </button>
            )}
          </div>
          <span className="mt-0.5 block text-[10px] text-cata-text/40">PDF, JPG o PNG — máx. 5 MB</span>
        </label>
      )}

      {error && <p className="text-xs text-cata-red">{error}</p>}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={loading || !monto || !fechaInicio || !fechaFin}
          className="inline-flex items-center gap-1 rounded-lg bg-cata-red px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cata-red/80 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <CreditCard size={12} strokeWidth={1.5} />
          )}
          Registrar pago
        </button>
        <button
          type="button"
          onClick={() => { setShowForm(false); setVoucherFile(null); }}
          className="rounded-lg border border-cata-border px-2.5 py-1.5 text-xs text-cata-text/65 transition-colors hover:bg-cata-surface"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payment timeline card
// ---------------------------------------------------------------------------

function PagoCard({
  pago,
  onUploadFile,
  uploadingId,
}: {
  pago: PagoPersona;
  onUploadFile: (pagoId: number) => void;
  uploadingId: number | null;
}): React.ReactElement {
  const fechaPago = new Date(pago.fechaRegistro).toLocaleDateString("es-EC", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div className="relative flex gap-4">
      {/* Timeline dot */}
      <div className="flex flex-col items-center">
        <div
          className={`mt-1 h-3 w-3 shrink-0 rounded-full ${
            pago.estadoPago === "APROBADO"
              ? "bg-emerald-500"
              : pago.estadoPago === "RECHAZADO"
                ? "bg-cata-red"
                : "bg-amber-400"
          }`}
        />
        <div className="mt-1 w-px flex-1 bg-cata-border" />
      </div>

      {/* Card content */}
      <div className="mb-4 min-w-0 flex-1 rounded-xl border border-cata-border bg-cata-surface p-4 transition-colors hover:border-cata-red/20">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-cata-text">
                {formatPagoMonto(pago.monto)}
              </p>
              <PagoEstadoBadge estado={pago.estadoPago} />
            </div>
            <p className="mt-1 text-xs text-cata-text/55">
              {fechaPago} · {TIPO_PAGO_LABEL[pago.tipoPago]} · Período:{" "}
              {pago.fechaInicio} – {pago.fechaFin}
            </p>
            {pago.voucherUrl && (
              <a
                href={pago.voucherUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 text-xs text-cata-red hover:underline"
              >
                <Paperclip size={10} strokeWidth={1.5} />
                Ver comprobante
              </a>
            )}
            {pago.estadoPago === "RECHAZADO" && pago.motivoRechazo && (
              <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                <p className="text-xs font-semibold text-cata-red">
                  Motivo de rechazo
                </p>
                <p className="text-xs text-cata-red/80">{pago.motivoRechazo}</p>
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!pago.voucherUrl && pago.estadoPago !== "APROBADO" && (
              <button
                type="button"
                onClick={() => onUploadFile(pago.id)}
                disabled={uploadingId === pago.id}
                className="inline-flex items-center gap-1 rounded-lg border border-cata-border px-2.5 py-1.5 text-xs font-medium text-cata-text transition-colors hover:border-cata-red/30 hover:text-cata-red disabled:opacity-50"
              >
                {uploadingId === pago.id ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Upload size={12} strokeWidth={1.5} />
                )}
                {uploadingId === pago.id ? "Subiendo..." : "Subir comprobante"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main content
// ---------------------------------------------------------------------------

function PaymentsContent({
  data,
  hasAlumnoRole,
  onRenewed,
}: {
  data: StudentPortalSummary;
  hasAlumnoRole: boolean;
  onRenewed: () => void;
}): React.ReactElement {
  const managedProfiles: StudentProfileSummary[] =
    hasAlumnoRole && data.self
      ? [data.self, ...data.representados]
      : data.representados;

  const [selectedId, setSelectedId] = useState<string>(
    managedProfiles[0]?.personaId ?? "",
  );
  const [reloadToken, setReloadToken] = useState(0);
  const [filter, setFilter] = useState<PagoStatusFilter>("TODOS");
  const [pagosState, setPagosState] = useState<PagosLoadState>({ status: "loading" });
  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingUploadPagoId, setPendingUploadPagoId] = useState<number | null>(null);

  const selectedProfile =
    managedProfiles.find((p) => p.personaId === selectedId) ?? managedProfiles[0] ?? null;

  const representative = isRepresentative(data.representados.length);
  const selectedIsMinor = isMinor(selectedProfile?.fechaNacimiento);

  const hasPendingPago =
    pagosState.status === "ready" &&
    pagosState.pagos.some((p) => p.estadoPago === "PENDIENTE_VALIDACION");

  useEffect(() => {
    if (!managedProfiles.some((p) => p.personaId === selectedId)) {
      setSelectedId(managedProfiles[0]?.personaId ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [managedProfiles.map((p) => p.personaId).join(",")]);

  // Fetch payments when selected profile changes
  const selectedPersonaId = selectedProfile?.personaId ?? null;
  useEffect(() => {
    if (!selectedPersonaId) return;
    let cancelled = false;
    setPagosState({ status: "loading" });
    fetchPagosDePersona(selectedPersonaId)
      .then((pagos) => {
        if (!cancelled) setPagosState({ status: "ready", pagos });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPagosState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "No se pudo cargar el historial de pagos.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPersonaId, reloadToken]);

  function handleSelectFile(pagoId: number): void {
    setPendingUploadPagoId(pagoId);
    fileInputRef.current?.click();
  }

  async function handleFileChange(
    e: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = e.target.files?.[0];
    if (!file || !pendingUploadPagoId) return;
    setUploadingId(pendingUploadPagoId);
    try {
      await subirVoucherPago(pendingUploadPagoId, file);
      setReloadToken((n) => n + 1);
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(err instanceof Error ? err.message : "No se pudo subir el comprobante.");
    } finally {
      setUploadingId(null);
      setPendingUploadPagoId(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleRenewed(): void {
    setReloadToken((n) => n + 1);
    onRenewed();
  }

  const filteredPagos =
    pagosState.status === "ready"
      ? sortPagosByDate(filterPagosByStatus(pagosState.pagos, filter))
      : [];

  const counts: Record<PagoStatusFilter, number> =
    pagosState.status === "ready"
      ? {
          TODOS: pagosState.pagos.length,
          PENDIENTE_VALIDACION: pagosState.pagos.filter(
            (p) => p.estadoPago === "PENDIENTE_VALIDACION",
          ).length,
          APROBADO: pagosState.pagos.filter((p) => p.estadoPago === "APROBADO")
            .length,
          RECHAZADO: pagosState.pagos.filter((p) => p.estadoPago === "RECHAZADO")
            .length,
        }
      : { TODOS: 0, PENDIENTE_VALIDACION: 0, APROBADO: 0, RECHAZADO: 0 };

  return (
    <>
      {/* Profile selector */}
      {representative && managedProfiles.length > 1 && (
        <div className="mb-5">
          <label
            htmlFor="student-select-payments"
            className="text-xs font-medium text-cata-text/45"
          >
            Seleccionar estudiante
          </label>
          <div className="relative mt-1 inline-block">
            <select
              id="student-select-payments"
              value={selectedId}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setFilter("TODOS");
              }}
              className="appearance-none rounded-xl border border-cata-border bg-cata-surface px-4 py-2 pr-10 text-sm font-medium text-cata-text shadow-sm transition-colors hover:border-cata-red/30 focus:border-cata-red/40 focus:outline-none focus:ring-2 focus:ring-cata-red/10"
            >
              {managedProfiles.map((profile) => (
                <option key={profile.personaId} value={profile.personaId}>
                  {profile.nombres} {profile.apellidos}
                </option>
              ))}
            </select>
            <ChevronDown
              size={14}
              strokeWidth={1.5}
              className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-cata-text/65"
              aria-hidden="true"
            />
          </div>
        </div>
      )}

      {selectedProfile === null ? (
        <div className="card p-6 text-center">
          <p className="text-sm text-cata-text/50">
            No se encontraron estudiantes asociados a esta cuenta.
          </p>
        </div>
      ) : (
        <>
          <MembershipStatusBar membership={selectedProfile.membership} />

          {/* Renewal form when membership is inactive or expired — hidden for minors */}
          {!selectedIsMinor && selectedProfile.membership &&
            (selectedProfile.membership.estado === "INACTIVA" ||
              selectedProfile.membership.estado === "VENCIDA") && (
              <div className="mb-6">
                <RenewPaymentForm
                  membership={selectedProfile.membership}
                  personaId={selectedProfile.personaId}
                  onRenewed={handleRenewed}
                  hasPendingPago={hasPendingPago}
                />
              </div>
            )}

          {selectedIsMinor && (
            <p className="mb-6 text-xs text-cata-text/55">
              Los menores de edad no pueden registrar pagos. Consultá con tu representante.
            </p>
          )}

          {/* Filter chips */}
          <FilterChips active={filter} onChange={setFilter} counts={counts} />

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            className="hidden"
            onChange={(e) => {
              void handleFileChange(e);
            }}
          />

          {/* Payment list */}
          {pagosState.status === "loading" && <LoadingCard />}
          {pagosState.status === "error" && (
            <ErrorCard
              message={pagosState.message}
              onRetry={() => setReloadToken((n) => n + 1)}
            />
          )}
          {pagosState.status === "ready" &&
            (filteredPagos.length === 0 ? (
              <div className="card p-8 text-center">
                <CreditCard
                  size={32}
                  strokeWidth={1.5}
                  className="mx-auto mb-3 text-cata-text/20"
                  aria-hidden="true"
                />
                <p className="text-sm text-cata-text/50">
                  {getEmptyStateMessage(filter)}
                </p>
              </div>
            ) : (
              <div className="space-y-0">
                {filteredPagos.map((pago) => (
                  <PagoCard
                    key={pago.id}
                    pago={pago}
                    onUploadFile={handleSelectFile}
                    uploadingId={uploadingId}
                  />
                ))}
              </div>
            ))}

          {/* Link back to dashboard */}
          <div className="mt-8">
            <Link
              href="/student"
              className="inline-flex items-center gap-2 text-sm text-cata-text/55 transition-colors hover:text-cata-red"
            >
              <ArrowRight size={14} strokeWidth={1.5} className="rotate-180" />
              Volver a Mi Cuenta
            </Link>
          </div>
        </>
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
          message:
            error instanceof Error
              ? error.message
              : "No se pudo cargar la información.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [personaId, reloadToken]);

  return (
    <AppShell eyebrow="Área de Estudiantes" title="Mis pagos">
      {state.status === "loading" && <LoadingCard />}
      {state.status === "error" && (
        <ErrorCard
          message={state.message}
          onRetry={() => setReloadToken((n) => n + 1)}
        />
      )}
      {state.status === "ready" && (
        <PaymentsContent
          data={state.data}
          hasAlumnoRole={hasAlumnoRole}
          onRenewed={() => setReloadToken((n) => n + 1)}
        />
      )}
    </AppShell>
  );
}

export default function StudentPaymentsPage(): React.ReactElement {
  return (
    <ProtectedRoute allowedRoles={["representante", "estudiante", "unsupported"]}>
      <PaymentsPageContent />
    </ProtectedRoute>
  );
}
