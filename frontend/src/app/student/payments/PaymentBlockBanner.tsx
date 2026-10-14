/**
 * The banner of a profile blocked for non-payment (#1768). It leads the
 * Payments screen: this is the one place a blocked member is allowed to be,
 * and the sentence says why and what to do, with the payment form right below.
 */

import { Lock } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { paymentBlockBanner } from "@/lib/payment-block";

interface PaymentBlockBannerProps {
  /** End of the coverage that lapsed; `null` when the backend sent none. */
  cubiertoHasta: string | null;
  /** The dependent's given name when a guardian is reading; `null` on the reader's own account. */
  studentName: string | null;
}

export default function PaymentBlockBanner({
  cubiertoHasta,
  studentName,
}: PaymentBlockBannerProps): React.ReactElement {
  return (
    <div
      role="status"
      data-testid="payment-block-banner"
      className="flex items-start gap-2.5 rounded-ctl border border-state-warn/30 bg-state-warn-bg px-4 py-3 text-sm font-semibold text-state-warn"
    >
      <Lock size={ICON.sm} strokeWidth={2} aria-hidden="true" className="mt-0.5 flex-none" />
      <p>{paymentBlockBanner(cubiertoHasta, studentName)}</p>
    </div>
  );
}
