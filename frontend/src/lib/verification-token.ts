/**
 * Reads the token `POST /auth/verificar-correo` expects out of whatever the
 * person pasted (issue #1045) — the raw token, or the full link the email
 * carries (`/verificar-correo?token=xxx`).
 *
 * `/verificar-correo/page.tsx` only ever reads `token` off its own URL
 * (`useSearchParams`), because it IS that link. `/login/activacion` has no
 * URL to read: whatever arrives comes typed or pasted into a field, so it has
 * to accept either shape the person might have copied.
 */
export function extractVerificationToken(pegado: string): string {
  const valor = pegado.trim();
  if (!valor) return "";

  try {
    const token = new URL(valor).searchParams.get("token");
    if (token) return token;
  } catch {
    // No es una URL completa — se trata como el token pegado directamente.
  }

  return valor;
}
