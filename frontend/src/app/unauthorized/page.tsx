/**
 * /unauthorized — the "your account has no role yet" screen.
 *
 * Reached by an AUTHENTICATED user whose backend `roles` (ADMINISTRADOR,
 * ENTRENADOR, REPRESENTANTE, ALUMNO) are empty or entirely unrecognized —
 * see `mapBackendRoleToUserRole` in src/lib/server/auth.ts, which maps that
 * case to the `"unsupported"` UserRole instead of silently falling back.
 *
 * Gated the same way every other role-restricted page is gated — via
 * ProtectedRoute with allowedRoles={["unsupported"]} — rather than a special
 * case. That single, central mechanism (canAccess + getDefaultRoute in
 * src/lib/auth-utils.ts) is what prevents both directions of the failure mode
 * this page exists for:
 *   - An "unsupported" user hitting any real protected page gets redirected
 *     here (getDefaultRoute("unsupported") === "/unauthorized").
 *   - A user with a real role who navigates here gets sent to THEIR default.
 *   - An unauthenticated visitor gets sent to /login, same as any other
 *     protected page — no loop, since this page terminates the chain.
 *
 * ## No chrome, on purpose
 *
 * `resolveShellKind("/unauthorized")` returns "standalone", and the note on
 * `docs/ux/prototipos/26-sin-rol.html` says why: an account with no role has
 * nowhere to navigate, and offering it an empty menu is worse than offering
 * nothing. The usability evaluation scores this screen as the MODEL for error
 * recovery — it says what happened AND what to do — so it carries the pattern
 * the rest of the product copies: what happened → what to do → one action.
 *
 * Because there is no sidebar, there is also no "Ayuda y soporte" entry to
 * open the assistant from. That is the one case the prototype keeps a local
 * trigger for: "Contactar al club" opens the assistant that `HelpChatDock`
 * mounts in the root layout — the same panel the floating launcher opens.
 */

"use client";

import Image from "next/image";
import { LogOut, MessageCircle } from "lucide-react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { openHelpChat, useHelpChatOpen } from "@/components/chatbot/help-chat-store";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui";

function UnauthorizedContent(): React.ReactElement {
  const { logout } = useAuth();
  const chatOpen = useHelpChatOpen();

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div className="flex w-full max-w-[440px] flex-col items-center gap-3.5 rounded-[18px] border border-line bg-paper px-8 py-10 text-center shadow-[0_4px_24px_rgba(0,0,0,0.05)]">
        <span className="relative block h-16 w-16 shrink-0 overflow-hidden rounded-full bg-coal">
          <Image
            src="/brand/cata-club-logo.jpeg"
            alt="Cata Club"
            fill
            sizes="64px"
            className="object-cover"
            priority
          />
        </span>

        <h1 className="m-0 text-balance text-[20px] font-bold tracking-[-0.02em] text-ink">
          Tu cuenta todavía no tiene rol
        </h1>

        {/* What happened, then what to do — in that order, in one paragraph. */}
        <p className="m-0 text-sm leading-relaxed text-ink-3">
          El club todavía no te asignó un rol. Escríbenos por el chat de ayuda o espera
          el correo de confirmación — apenas te lo asignen, entras directo.
        </p>

        <div className="mt-1.5 flex flex-wrap justify-center gap-2.5">
          {/* Coal, not red: red is the primary CTA and the destructive colour,
              and "contactar al club" is neither. */}
          <Button variant="dark" onClick={(): void => openHelpChat()} aria-expanded={chatOpen}>
            <MessageCircle size={15} strokeWidth={2} aria-hidden="true" />
            Contactar al club
          </Button>
          <Button variant="secondary" onClick={(): void => void logout()}>
            <LogOut size={15} strokeWidth={2} aria-hidden="true" />
            Cerrar sesión
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function UnauthorizedPage(): React.ReactElement {
  return (
    <ProtectedRoute allowedRoles={["unsupported"]}>
      <UnauthorizedContent />
    </ProtectedRoute>
  );
}
