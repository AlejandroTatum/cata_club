"use client";

import { useState } from "react";

/**
 * Profile photo with an initials fallback (FAM-14). The Cloudinary URL can be
 * dead or blocked; without `onError` the browser paints a broken-image icon
 * with the alt text. The failure is remembered per URL, so a new upload (a new
 * URL) gets a fresh try.
 */
export default function AvatarPhoto({
  fotoUrl,
  initials,
  className,
}: {
  fotoUrl: string | null | undefined;
  initials: string;
  className?: string;
}): React.ReactElement {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!fotoUrl || failedUrl === fotoUrl) {
    return <span aria-hidden="true">{initials}</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- external Cloudinary URL, not a local/static asset (same pattern as /profile's IdentityPanel)
    <img
      src={fotoUrl}
      alt="Foto de perfil"
      className={className}
      onError={() => setFailedUrl(fotoUrl)}
    />
  );
}
