/**
 * The wizard's one navigation row, at the foot of the step content (REG-21):
 * `Atrás | Stepper | Siguiente`.
 *
 * On desktop it is a single row. Below `md` the stepper takes its own row and
 * the two buttons sit under it, so neither is squeezed by the pills.
 *
 * "Siguiente" is never disabled and is the form's submit control: pressing it
 * (or Enter inside a field) validates the whole step and either advances or
 * prints every message inline. The final step has no "Siguiente"; its own
 * submit button lives with the review.
 */

import type { ReactElement, ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui";
import { ICON } from "@/lib/icon-size";

interface EnrollNavProps {
  isFirst: boolean;
  isLast: boolean;
  submitting: boolean;
  onBack: () => void;
  /** The named `Stepper`, already configured by the page. */
  stepper: ReactNode;
}

export default function EnrollNav(props: EnrollNavProps): ReactElement {
  return (
    <div
      data-testid="enroll-nav"
      data-enroll-nav
      className="mt-page flex flex-wrap items-center justify-between gap-x-page gap-y-section md:flex-nowrap"
    >
      <div className="min-w-24">
        {!props.isFirst && (
          <Button
            variant="tertiary"
            onClick={props.onBack}
            disabled={props.submitting}
          >
            <ChevronLeft size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
            Atrás
          </Button>
        )}
      </div>

      <div className="order-first w-full md:order-none md:w-auto">
        {props.stepper}
      </div>

      <div className="flex min-w-24 justify-end">
        {!props.isLast && (
          <Button
            type="submit"
            variant="primary"
            data-enroll-next
            disabled={props.submitting}
          >
            Siguiente
            <ChevronRight size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}
