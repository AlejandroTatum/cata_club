# BORRADOR — Privacy text for the second guardian (#1666)

> **Status: BORRADOR for the club and its lawyer. Release is blocked until it is approved.**
> Nothing in this file is published: the text is not wired into `/terminos`, and the
> published document stays at version 2.3 until the club decides.

## What changed in the product

A minor can now have **two guardians**: the primary representative and, if the primary
decides, one more. Owner decisions (2026-10-05):

- The second guardian sees everything the primary sees, can pay and upload payment
  vouchers, and can edit general data. They can only **view** (not sign or edit) the medical
  record and the legal consents.
- The primary invites the second guardian by e-mail and can remove them; an administrator
  can also add or remove. Removal takes effect on the next request.
- Both guardians receive the child's notifications and e-mails.
- Every add, invitation, acceptance and removal is recorded (who, whom, when).

## Questions for the club / lawyer

1. Is sharing a minor's data, **including health data**, with a second adult chosen by the
   primary guardian covered by the existing consent, or does it need its own wording or a
   new consent from the primary?
2. Is the proposed duty of confidentiality for the second guardian enough, or should the
   invitee accept the terms and privacy notice in their own right? (Today they do: setting
   their password from the invitation link records acceptance of the terms and the privacy
   notice, like any new account.)
3. Should the second guardian be told **which** child they were added to in the invitation
   e-mail? Today the e-mail names the child by first name only.
4. Retention: the add/remove audit record is kept as evidence. Is that acceptable after an
   account-erasure request?

## Proposed text (Spanish, to be placed in the published document)

The same blocks live in `frontend/src/app/terminos/borrador-segundo-representante.ts`; a
test keeps both copies identical.

### 1. Capítulo III — «Menores y representantes» (añadir)

Un jugador menor de edad puede tener hasta dos representantes con cuenta propia en el sistema: el representante principal y, si el principal lo decide, un segundo representante. El representante principal invita al segundo por correo electrónico y puede quitarlo en cualquier momento; el administrador del club también puede agregarlo o quitarlo. El acceso del segundo representante termina en el momento en que se lo quita.

El segundo representante puede ver la información del jugador, recibir sus avisos, pagar su membresía, subir comprobantes y editar sus datos generales. No puede firmar ni editar la ficha médica ni los consentimientos legales del jugador: esas decisiones corresponden al representante principal, y el segundo representante solo puede verlas.

### 2. Capítulo VIII — «Quién puede ver sus datos» (reemplazar)

Reemplaza: «• Ficha médica: el administrador del club y el representante del jugador.»

• Ficha médica: el administrador del club y los representantes del jugador (el principal y, si lo hay, el segundo). El segundo representante solo la ve; no la firma ni la edita.

### 3. Capítulo VIII — «Quién puede ver sus datos» (reemplazar)

Reemplaza: «• Datos de cuenta y de jugadores: cada persona ve lo suyo y lo de los jugadores que representa.»

• Datos de cuenta y de jugadores: cada persona ve lo suyo y lo de los jugadores que representa, sea como representante principal o como segundo representante. Los dos representantes de un jugador reciben sus avisos y correos y ven su información, sus pagos y sus recibos.

### 4. Capítulo VIII — «Menores y representantes en materia de datos» (añadir)

Cuando el representante principal agrega a un segundo representante, los datos del jugador menor de edad, incluidos los de salud, quedan visibles para esa otra persona adulta. El representante principal debe hacerlo únicamente con una persona de su confianza y con derecho a conocer esos datos. El club registra quién agregó o quitó a un segundo representante, a quién y cuándo, y conserva ese registro para poder demostrarlo.

El segundo representante recibe el mismo deber de reserva que el representante principal: usa estos datos solo para el cuidado y la gestión de la participación del jugador en el club. Si usted no desea que otra persona vea los datos de su hijo o hija, no la invite; si ya lo hizo, puede quitarla desde su cuenta.

### 5. Capítulo VIII — «Sus derechos» y «Cuánto tiempo conservamos sus datos» (añadir)

Los derechos sobre los datos de un jugador menor de 15 años los ejerce su representante principal. El segundo representante puede pedir al club, por los canales de contacto, que se le explique cómo se tratan los datos que ve. Si el segundo representante pide eliminar su cuenta, se lo retira del jugador y se conserva el registro de su alta y su baja.

### 6. Consentimiento para el tratamiento de datos de salud — «Quién autoriza» (añadir)

Para los jugadores menores de 15 años autoriza su representante legal principal. El segundo representante, si lo hay, puede ver este consentimiento y la ficha médica, pero no los firma ni los retira.

## How to release once approved

1. Move each block into its chapter in `frontend/src/app/terminos/content.ts` / `health-chapter.ts`.
2. Bump `VERSION_LEGAL_VIGENTE` in `backend/app/servicios_negocio/consentimiento_legal_servicio.py`
   (every account is asked to re-accept the new version).
3. Delete `borrador-segundo-representante.ts` and its test, and this banner.
4. Do not enable the second-guardian invitation in production before step 1-2 are live.
