"use client";

/**
 * «Cómo pagar» — the club's transfer data, where a family registers a payment
 * (#1535, FAM-04). The data is for signed-in users only: it is fetched from the
 * authenticated `GET /api/club/payment-info` route and is never in the bundle.
 * A visitor without a session sees a short notice to sign in instead. With no
 * usable config the block renders nothing, and each optional field (QR, cash
 * place and hours) renders only when configured.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Copy } from "lucide-react";
import { ErrorState, LoadingState, buttonClasses, cn } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { ICON } from "@/lib/icon-size";
import { toUserMessage } from "@/lib/error-message";
import type { ClubPaymentInfo } from "@/lib/club-payment-info";
import { fetchClubPaymentInfo } from "@/services/api";

type CopyState = "idle" | "copied" | "failed";

function Row({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="min-w-0">
      <dt className="text-2xs font-bold uppercase text-ink-3-strong">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-bold text-ink">{children}</dd>
    </div>
  );
}

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "expired" }
  | { status: "ready"; info: ClubPaymentInfo | null };

const CARD = "card flex flex-col gap-3 p-[18px]";

export default function HowToPay({ className }: { className?: string }): React.ReactElement | null {
  const { session, isLoading: authLoading } = useAuth();
  const signedIn = session !== null;
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [copyState, setCopyState] = useState<CopyState>("idle");

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    setLoad({ status: "loading" });
    fetchClubPaymentInfo().then(
      (info) => {
        if (!cancelled) setLoad({ status: "ready", info });
      },
      (error: unknown) => {
        if (cancelled) return;
        // A genuinely expired session shows the sign-in notice, not an error.
        // This block only ever reports locally: it never triggers app-wide logout.
        if ((error as { status?: number } | null)?.status === 401) setLoad({ status: "expired" });
        else setLoad({ status: "error", message: toUserMessage(error, "No se pudieron cargar los datos de pago.") });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [signedIn, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (authLoading) return null;
  if (!signedIn || load.status === "expired") {
    return (
      <section data-testid="how-to-pay-signin" aria-labelledby="how-to-pay-title" className={cn(CARD, className)}>
        <h2 id="how-to-pay-title" className="font-display text-lg uppercase leading-tight tracking-flat text-ink">
          Cómo pagar
        </h2>
        <p className="text-sm text-ink-2">Los datos para transferencia se muestran al iniciar sesión.</p>
        <div>
          <Link href="/login?next=/ayuda" className={buttonClasses("secondary", "md", "min-h-[44px] min-w-[44px]")}>
            Iniciar sesión
          </Link>
        </div>
      </section>
    );
  }
  if (load.status === "loading") return <LoadingState label="Cargando los datos de pago…" className={className} />;
  if (load.status === "error") {
    return <ErrorState className={className} title="No se pudieron cargar los datos de pago" message={load.message} onRetry={retry} />;
  }
  const info = load.info;
  if (!info) return null;

  async function copyNumber(): Promise<void> {
    try {
      await navigator.clipboard.writeText(info!.accountNumber);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <section data-testid="how-to-pay" aria-labelledby="how-to-pay-title" className={cn(CARD, className)}>
      <h2 id="how-to-pay-title" className="font-display text-lg uppercase leading-tight tracking-flat text-ink">
        Cómo pagar
      </h2>
      <p className="text-sm text-ink-2">
        Haga la transferencia a esta cuenta y después registre el pago con el comprobante.
      </p>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Row label="Titular">{info.holder}</Row>
        {info.holderId && <Row label="Identificación">C.I.: {info.holderId}</Row>}
        <Row label="Banco">{info.bank}</Row>
        {info.accountType && <Row label="Tipo de cuenta">{info.accountType}</Row>}
        <Row label="Número de cuenta">
          <span className="tabular-nums">{info.accountNumber}</span>
        </Row>
        {info.cashPlace && <Row label="Efectivo: lugar">{info.cashPlace}</Row>}
        {info.cashHours && <Row label="Efectivo: horario">{info.cashHours}</Row>}
      </dl>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void copyNumber()}
          className={buttonClasses("secondary", "md", "min-h-[44px] min-w-[44px]")}
        >
          <Copy size={ICON.sm} strokeWidth={2} aria-hidden="true" />
          Copiar número
        </button>
        <span role="status" className="text-sm text-ink-2">
          {copyState === "copied" && "Número de cuenta copiado"}
          {copyState === "failed" && "No se pudo copiar. Selecciónelo y cópielo a mano."}
        </span>
      </div>
      {info.qrImageSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={info.qrImageSrc} alt="Código QR para transferir al club" className="h-40 w-40 rounded-ctl border border-line" />
      )}
    </section>
  );
}
