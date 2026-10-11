/**
 * ThemeScript — applies the saved (or OS) theme before the first paint.
 *
 * Rendered in `<head>` by the root layout with the request's CSP nonce, which
 * is the only way an inline script runs under `script-src 'nonce-…'
 * 'strict-dynamic'`. No `unsafe-eval`, no CSP change: see `middleware.ts`.
 * `suppressHydrationWarning` because browsers hide a script's `nonce`
 * attribute from the DOM after parsing, so React sees it differ from the
 * server markup.
 */

import { THEME_INIT_SCRIPT } from "@/lib/theme";

interface ThemeScriptProps {
  nonce?: string;
}

export default function ThemeScript({ nonce }: ThemeScriptProps): React.ReactElement {
  return (
    <script
      nonce={nonce}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
    />
  );
}
