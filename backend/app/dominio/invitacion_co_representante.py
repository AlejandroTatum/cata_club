"""Invitación del segundo guardián de un menor (issue #1666).

Cuando el correo invitado no tiene cuenta, la invitación la crea: un
`Usuario` con rol REPRESENTANTE, correo SIN verificar y una contraseña que
nadie conoce. El enlace del correo es el de fijar contraseña de siempre
(`RecuperacionOutbox`, token `reset_password`): lleva el claim `prp` con el
propósito de abajo -- el mismo mecanismo que la invitación de un entrenador
(`invitacion_entrenador.py`), no un tipo de token nuevo. Fijar la contraseña
con ese enlace prueba el control del correo y ACEPTA la invitación.

"Invitación pendiente" no es una columna de la cuenta: se deriva de que
existe una `CoRepresentanteInvitacion` sin aceptar ni cancelar para ella."""

PROPOSITO_INVITACION_CO_REPRESENTANTE = "invitacion_co_representante"
