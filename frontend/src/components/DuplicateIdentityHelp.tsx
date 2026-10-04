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
 *    a second time — send them to sign in or recover their password. REG-12:
 *    the hint names the one next step that account really has from the start —
 *    adding a dependent (`POST /personas/me/representados`), which needs a
 *    verified email and nothing else. It used to also offer "inscríbase como
 *    jugador", an action a representative does not have.
 *  - `representative` (adding a dependent): the dependent already exists,
 *    possibly under another guardian. The self-service link-by-cédula INS-2
 *    once offered here (docs/product/decisiones-de-negocio-2026-08-11.md §1)
 *    was retired by the product owner's 2026-09-11 decision (#1133, point 3):
 *    linking an existing person is now a desk-only action, so this sends the
 *    representante to administration instead of an in-wizard button.
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
import { WHATSAPP_CONTACTO } from "@/lib/error-message";

export type DuplicateIdentityAudience = "self-service" | "representative" | "admin";

interface DuplicateIdentityHelpProps {
  audience: DuplicateIdentityAudience;
}

interface Guidance {
  hint: string;
  /** Sentence offering the club WhatsApp, for people who may be returning former members. */
  contact?: { before: string; after: string };
  links: { href: string; label: string }[];
}

const GUIDANCE: Record<DuplicateIdentityAudience, Guidance> = {
  "self-service": {
    hint: "Si ya tienes cuenta, no necesitas volver a inscribirte: inicia sesión y, desde tu cuenta, agrega un jugador. Para eso solo necesitas haber verificado tu correo.",
    contact: {
      before: "Si ya fuiste socio del club, escríbenos por ",
      after: " para reactivar tu cuenta.",
    },
    links: [
      { href: "/login", label: "Iniciar sesión" },
      { href: "/forgot-password", label: "Recuperar contraseña" },
    ],
  },
  representative: {
    hint: "Esa persona ya está registrada en el club. Revisa tus jugadores; si no aparece ahí, la vinculación se realiza únicamente en persona: acércate a administración del club.",
    links: [{ href: "/student", label: "Ver mis jugadores" }],
  },
  admin: {
    hint: "Esa persona ya está registrada. Búsquela en Miembros para asignarle roles o credenciales en vez de crearla de nuevo.",
    links: [{ href: "/members", label: "Ir a Miembros" }],
  },
};

export function DuplicateIdentityHelp({ audience }: DuplicateIdentityHelpProps): ReactElement {
  const { hint, contact, links } = GUIDANCE[audience];
  return (
    <div className="space-y-1.5">
      <p>{hint}</p>
      {contact && (
        <p>
          {contact.before}
          <a
            href={WHATSAPP_CONTACTO}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold underline underline-offset-2"
          >
            WhatsApp
          </a>
          {contact.after}
        </p>
      )}
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
