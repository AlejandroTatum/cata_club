/**
 * ProtectedRoute — Client-side RBAC guard component.
 *
 * Wraps pages or sections that require authentication and/or specific roles.
 * Shows a loading state during initial session hydration, then redirects:
 *  - Unauthenticated → redirectTo (default: /login)
 *  - Wrong role → user's default route based on their actual role
 *
 * ⚠️ Limitation: This is a client-side guard. It prevents casual access but
 * does NOT replace server-side authorization. A determined user could
 * manipulate client state. Full protection requires Next.js Middleware
 * or backend session validation.
 */

"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { canAccess, getDefaultRoute } from "@/lib/auth-utils";
import type { UserRole } from "@/types/domain";
import ErrorState from "@/components/ui/ErrorState";

interface ProtectedRouteProps {
  /** Content to render when authorized. */
  children: ReactNode;
  /** List of roles allowed to view this content. */
  allowedRoles: UserRole[];
  /** Where to redirect unauthenticated users (default: /login). */
  redirectTo?: string;
}

export default function ProtectedRoute({
  children,
  allowedRoles,
  redirectTo = "/login",
}: ProtectedRouteProps) {
  const { isAuthenticated, session, isLoading, hydrationOutage, retryHydration, sessionExpired } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    // DSH-6: an outage on the initial session check is not a verdict on
    // whether the user is logged in -- redirecting here is exactly the bug
    // (a network blip reads as "not authenticated" and silently bounces the
    // admin to /login). Stay put and let the render below show the retry
    // prompt instead.
    if (hydrationOutage) return;

    if (!isAuthenticated) {
      // Issue #353: an involuntary session loss (refresh-and-retry failed
      // mid-request) names itself in the redirect so /login can say WHY —
      // an ordinary unauthenticated visit or an explicit logout() carries no
      // such reason and stays silent, exactly as before.
      router.replace(sessionExpired ? `${redirectTo}?motivo=sesion-expirada` : redirectTo);
      return;
    }

    if (session && !canAccess(session.user.role, allowedRoles)) {
      router.replace(getDefaultRoute(session.user.role));
    }
  }, [isLoading, hydrationOutage, isAuthenticated, sessionExpired, session, allowedRoles, redirectTo, router]);

  // --- Loading state ---
  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-sm text-white/65">Cargando sesión…</p>
      </div>
    );
  }

  // --- Hydration outage: say so, offer a retry, do NOT redirect ---
  if (hydrationOutage) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center px-4">
        <ErrorState
          title="No se pudo verificar su sesión"
          message="Hubo un problema de conexión. Vuelva a intentarlo."
          onRetry={retryHydration}
        />
      </div>
    );
  }

  // --- Unauthenticated or wrong role: render nothing while redirect fires ---
  if (!isAuthenticated) {
    return null;
  }

  if (session && !canAccess(session.user.role, allowedRoles)) {
    return null;
  }

  // --- Authorized ---
  return <>{children}</>;
}
