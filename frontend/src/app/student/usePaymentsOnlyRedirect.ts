/**
 * Keeps a blocked profile on Payments (#1768, S6).
 *
 * Every portal page that is about ONE profile calls this with the profile it
 * resolved. The restriction is per profile: a guardian whose other children are
 * up to date keeps every page for them, and reaches the blocked child's
 * Payments through the family strip.
 */

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { isPaymentsOnlyProfile } from "@/lib/payment-block";
import type { StudentProfileSummary } from "@/services/api";
import { withSelectedStudent } from "./ManagedStudentPicker";

/**
 * @returns true while the profile is being sent to Payments — the caller draws
 *   nothing of its own page meanwhile, so the restricted content never flashes.
 */
export function usePaymentsOnlyRedirect(profile: StudentProfileSummary | null): boolean {
  const router = useRouter();
  const { session } = useAuth();
  const restricted = isPaymentsOnlyProfile(session?.user.role, profile);
  const personaId = profile?.personaId ?? "";

  useEffect(() => {
    if (restricted) router.replace(withSelectedStudent("/student/payments", personaId));
  }, [restricted, personaId, router]);

  return restricted;
}
