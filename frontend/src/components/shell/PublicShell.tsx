/**
 * The plain page a visitor without a session gets (VIS-05).
 *
 * `AppShell` is the management chrome — the sidebar, the panel title, the
 * account area — and a public screen that renders it for an anonymous visitor
 * shows them a menu with nothing in it. Screens that are reachable both ways
 * (`/ayuda`) render this one when there is no session. The public bar above
 * it is `Header`'s, not drawn here; the root layout's wrapper already sets the
 * width and padding, so this only draws the landmark and the page's own head.
 */
import type { ReactElement, ReactNode } from "react";
import { PageHeader } from "@/components/ui";

export interface PublicShellProps {
  title: string;
  subtitle?: string;
  /** The page's back control, drawn first like `AppShell` draws it. */
  back?: ReactNode;
  children: ReactNode;
}

export default function PublicShell({ title, subtitle, back, children }: PublicShellProps): ReactElement {
  return (
    <main className="grid gap-page">
      {back}
      <PageHeader title={title} subtitle={subtitle} />
      {children}
    </main>
  );
}
