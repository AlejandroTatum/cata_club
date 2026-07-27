/**
 * The way out of an "already registered" error in the signup wizards.
 *
 * The backend answers a repeated cédula (or e-mail) with a plain sentence:
 * "Ya existe una persona con la cédula 1712345678". Correct, but from inside
 * a wizard it was terminal — no sign-in link, no password recovery, no hint
 * about who to ask. The user could only re-read the same sentence.
 *
 * The useful next step depends on who hit the wall, so the destinations are
 * chosen by `audience`:
 *  - `self-service` (public enrollment): the person is very likely enrolling
 *    a second time — send them to sign in or recover their password.
 *  - `representative` (adding a dependent): the dependent already exists,
 *    possibly under another guardian — send them to their portal and to the
 *    club, which is the only party that can reassign a person.
 *  - `admin` (creating an account for someone else): the person is already
 *    in the system — send the admin to the members list to find them and
 *    grant roles or credentials there.
 *
 * Deliberately says nothing the backend has not already said. It never
 * reveals the e-mail, name, or status of the existing account, so it adds no
 * account-enumeration surface beyond the message the user just received.
 */

import type { ReactElement } from "react";
import Link from "next/link";

export type DuplicateIdentityAudience = "self-service" | "representative" | "admin";

interface DuplicateIdentityHelpProps {
  audience: DuplicateIdentityAudience;
}

interface Guidance {
  hint: string;
  links: { href: string; label: string }[];
}

const GUIDANCE: Record<DuplicateIdentityAudience, Guidance> = {
  "self-service": {
    hint: "Si ya se inscribió antes, no necesita volver a hacerlo:",
    links: [
      { href: "/login", label: "Iniciar sesión" },
      { href: "/forgot-password", label: "Recuperar contraseña" },
    ],
  },
  representative: {
    hint: "Esa persona ya está registrada en el club. Revise sus dependientes; si no aparece ahí, el club puede vincularla a su cuenta.",
    links: [{ href: "/student", label: "Ver mis dependientes" }],
  },
  admin: {
    hint: "Esa persona ya está registrada. Búsquela en Miembros para asignarle roles o credenciales en vez de crearla de nuevo.",
    links: [{ href: "/members", label: "Ir a Miembros" }],
  },
};

export function DuplicateIdentityHelp({ audience }: DuplicateIdentityHelpProps): ReactElement {
  const { hint, links } = GUIDANCE[audience];
  return (
    <div className="space-y-1.5">
      <p>{hint}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {links.map((link) => (
          <Link key={link.href} href={link.href} className="font-semibold underline underline-offset-2">
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
