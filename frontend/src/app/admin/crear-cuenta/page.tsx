/**
 * Legacy admin account-creation route.
 *
 * Admin account creation is retired. Keeping this redirect makes existing
 * bookmarks safe without exposing a second account-creation wizard, enrolling
 * anyone publicly, or replacing the administrator's auth cookies.
 */

import { redirect } from "next/navigation";

export default function CrearCuentaPage(): never {
  redirect("/members");
}
