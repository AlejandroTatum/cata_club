/**
 * DashboardSection — the titled card every dashboard block sits in.
 *
 * The role dashboards each wrote their own card header (an `ActivityListHeader`
 * here, a hand-built `h2` there), so no two blocks shared a title size or a
 * place for the "ver todo" link. One header row, one body: the block says what
 * it is, offers one way into the module, and fills the rest of the card.
 *
 * `fill` makes the section stretch to the row it stands in, so two blocks side
 * by side end level instead of leaving one with dead air under it.
 */

import type { ReactElement, ReactNode } from "react";
import { ActivityListHeader, cn } from "@/components/ui";

export interface DashboardSectionProps {
  title: string;
  /** Usually a single small secondary link into the module. */
  action?: ReactNode;
  /** Stretch to the height of the grid row. */
  fill?: boolean;
  testId?: string;
  children: ReactNode;
}

export default function DashboardSection({
  title,
  action,
  fill = false,
  testId,
  children,
}: DashboardSectionProps): ReactElement {
  return (
    <section
      data-testid={testId}
      className={cn("card flex flex-col overflow-hidden", fill && "h-full")}
    >
      <ActivityListHeader title={title} action={action} />
      {children}
    </section>
  );
}
