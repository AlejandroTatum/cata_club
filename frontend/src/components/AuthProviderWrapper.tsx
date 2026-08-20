/**
 * AuthProviderWrapper — Client boundary for AuthContext.
 *
 * The root layout.tsx is a Server Component (for metadata), so the
 * client-only AuthProvider must be wrapped in its own "use client"
 * boundary and then imported into the layout.
 */

"use client";

import { AuthProvider } from "@/contexts/AuthContext";
import ConnectivityBanner from "@/components/ConnectivityBanner";

export default function AuthProviderWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      {/* Issue #454 — needs to be INSIDE AuthProvider (reads useAuth()) and
          ABOVE every route, since it is not tied to any one shell. */}
      <ConnectivityBanner />
      {children}
    </AuthProvider>
  );
}
