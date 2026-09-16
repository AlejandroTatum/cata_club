"""Supresión de datos personales (issue #1062).

Procedimiento admin-revisado que hace a una persona NO identificable
manteniendo intacto su historial contable. Las decisiones D1-D9 del dueño
(2026-09-15, ver `odd/tasks/issue-1062-data-erasure.md`) son política
aprobada; este servicio las ejecuta:

  - D2: una persona con representados vigentes NO se suprime; la
    representación debe transferirse primero por el flujo autorizado
    (`RelacionRepresentacionServicio`).
  - D3: los pagos PENDIENTE_VALIDACION no impiden aceptar la petición, pero
    su tratamiento debe quedar documentado en `SolicitudSupresionDatos
    .notas` antes de ejecutar. Nunca se cancela deuda ni se borran pagos.
  - D8: nada se ejecuta antes de que venza el plazo de gracia de 30 días
    desde `fecha_solicitud`.
  - D9: BORRA identidad de `Persona`, foto (DB + Cloudinary), contenido de
    `FichaMedica`, `Sesion`, y comunicaciones pendientes con el correo;
    CONSERVA la fila `Persona` (anonimizada) con pagos, membresías,
    asistencias, `ConsentimientoLegal` y `ConsultaFichaEmergencia`.

Semántica transaccional, deliberada y honesta:

  - Cloudinary se destruye ANTES de cualquier mutación de la base. Si un
    destroy falla (timeout, circuito abierto), la ejecución se ABORTA sin
    tocar un solo byte de la base: nunca queda una persona anonimizada en la
    base con sus fotos y comprobantes vivos en el proveedor. Reintentar es
    seguro porque `destroy` de un recurso inexistente no es error.
  - Todas las mutaciones de la base corren en UNA transacción (un solo
    `commit` al final, issue #831): o la persona sale suprimida completa, o
    no sale suprimida en absoluto.
  - `detalle_ejecucion` asienta el resumen incluyendo residuals honestos
    (recursos legados de URL pública que Cloudinary no puede destruir por
    public_id): no se reportan como eliminados (D5).
"""
from datetime import date, datetime, timedelta, timezone
from typing import List
from urllib.parse import urlparse

from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import Session

from app.dominio.enums import EstadoPago
from app.dominio.excepciones import (
    EntidadNoEncontrada,
    OperacionInvalida,
)
from app.dominio.modelos import (
    ComprobantePago,
    ConsentimientoLegal,
    ConsultaFichaEmergencia,
    EnrollmentNotificacionOutbox,
    FichaMedica,
    Enfermedades,
    Pago,
    Persona,
    RecuperacionOutbox,
    Sesion,
    SolicitudSupresionDatos,
    Usuario,
    VerificacionCorreoOutbox,
)
from app.infraestructura.cloudinary_cliente import (
    _descomponer_valor_foto_perfil,
    eliminar_recurso_privado,
)
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.infraestructura.repositorios.supresion_datos_repositorio import (
    SolicitudSupresionDatosRepositorio,
)
from app.soporte_transversal.configuracion import settings

# D8: plazo de gracia para retractarse antes de la ejecución.
DIAS_GRACIA = 30

# Estados del ciclo de la solicitud (D2 en `modelos.SolicitudSupresionDatos`).
ESTADO_RECIBIDA = "RECIBIDA"
ESTADO_APROBADA = "APROBADA"
ESTADO_EJECUTADA = "EJECUTADA"
ESTADO_RECHAZADA = "RECHAZADA"

# Valores centinela del scrub. `cedula` es NOT NULL + UNIQUE + CHECK de forma
# en la base (`^(0[1-9]|1[0-9]|2[0-4]|30)[0-9]{8}$`), así que NULL no es
# opción: el centinela `30` + id a 8 dígitos cumple la forma, es único por
# persona (determinístico: la misma persona siempre cae al mismo valor) y se
# escribe por UPDATE masivo de Core a propósito, fuera del alcance de los
# `@validates` del ORM (que exigirían una cédula REAL con verificador).
# `fecha_nacimiento` también es NOT NULL: fecha fija sin valor identificativo.
_PREFIJO_CEDULA_SUPRIMIDA = "30"
_FECHA_NACIMIENTO_SUPRIMIDA = date(1900, 1, 1)
_NOMBRES_SUPRIDOS = "ANONIMIZADO"


def _cedula_sentinela(persona_id: int) -> str:
    return f"{_PREFIJO_CEDULA_SUPRIMIDA}{persona_id:08d}"


def _correo_sentinela(persona_id: int) -> str:
    return f"suprimido.{persona_id}@sin-datos.invalid"


class SupresionDatosServicio:
    def __init__(self, db: Session):
        self.db = db
        self.repo = SolicitudSupresionDatosRepositorio(db)
        self.personas = PersonaRepositorio(db)

    # --- Ciclo de la solicitud ---------------------------------------------

    def crear(self, persona_id: int, motivo: str, admin_persona_id: int) -> SolicitudSupresionDatos:
        """Registra la petición (D1: la carga el admin, nunca la persona)."""
        if not motivo or not motivo.strip():
            raise OperacionInvalida("El motivo de la supresión es obligatorio.")
        if self.personas.obtener_por_id(persona_id) is None:
            raise EntidadNoEncontrada(f"Persona con id {persona_id} no encontrada")
        if self.repo.hay_solicitud_activa(persona_id):
            raise OperacionInvalida(
                "La persona ya tiene una solicitud de supresión abierta."
            )
        solicitud = SolicitudSupresionDatos(
            persona_id=persona_id,
            solicitada_por_persona_id=admin_persona_id,
            motivo=motivo.strip(),
            estado=ESTADO_RECIBIDA,
        )
        self.repo.crear(solicitud)
        self.db.commit()
        return solicitud

    def aprobar(self, solicitud_id: int, admin_persona_id: int) -> SolicitudSupresionDatos:
        solicitud = self._obtener(solicitud_id)
        if solicitud.estado != ESTADO_RECIBIDA:
            raise OperacionInvalida(
                "Solo una solicitud RECIBIDA puede aprobarse."
            )
        solicitud.estado = ESTADO_APROBADA
        solicitud.fecha_aprobacion = datetime.now(timezone.utc)
        solicitud.aprobada_por_persona_id = admin_persona_id
        self.repo.guardar(solicitud)
        self.db.commit()
        return solicitud

    def rechazar(self, solicitud_id: int, razon: str, admin_persona_id: int) -> SolicitudSupresionDatos:
        solicitud = self._obtener(solicitud_id)
        if solicitud.estado != ESTADO_RECIBIDA:
            raise OperacionInvalida("Solo una solicitud RECIBIDA puede rechazarse.")
        if not razon or not razon.strip():
            raise OperacionInvalida("La razón del rechazo es obligatoria.")
        solicitud.estado = ESTADO_RECHAZADA
        solicitud.aprobada_por_persona_id = admin_persona_id
        solicitud.fecha_aprobacion = datetime.now(timezone.utc)
        solicitud.razon_rechazo = razon.strip()
        self.repo.guardar(solicitud)
        self.db.commit()
        return solicitud

    def listar(self):
        return self.repo.listar()

    def obtener_detalle(self, solicitud_id: int):
        return self._obtener(solicitud_id)

    # --- Ejecución ----------------------------------------------------------

    def ejecutar(self, solicitud_id: int, admin_persona_id: int) -> SolicitudSupresionDatos:
        solicitud = self._obtener(solicitud_id)

        if solicitud.estado != ESTADO_APROBADA:
            raise OperacionInvalida(
                "Solo una solicitud APROBADA puede ejecutarse."
            )

        # D8: el plazo de gracia corre desde la fecha de solicitud.
        vence_gracia = solicitud.fecha_solicitud + timedelta(days=DIAS_GRACIA)
        if datetime.now(timezone.utc) < vence_gracia:
            raise OperacionInvalida(
                "Aún no vence el plazo de gracia de 30 días desde la solicitud; "
                "la supresión no puede ejecutarse todavía."
            )

        persona = self.personas.obtener_por_id(solicitud.persona_id)
        if persona is None:
            raise EntidadNoEncontrada(
                f"Persona con id {solicitud.persona_id} no encontrada"
            )

        # D2: representados vigentes bloquean la ejecución.
        if self.personas.contar_representados(persona.id) > 0:
            raise OperacionInvalida(
                "La persona todavía representa a al menos un menor. Transfiera "
                "la representación por el flujo autorizado antes de ejecutar "
                "la supresión."
            )

        # D3: pagos pendientes exigen tratamiento documentado en `notas`.
        pendientes = self._contar_pagos_pendientes(persona.id)
        if pendientes > 0 and not (solicitud.notas and solicitud.notas.strip()):
            raise OperacionInvalida(
                "La persona tiene pagos pendientes de validación. Resuélvalos o "
                "documente su tratamiento en las notas de la solicitud antes de "
                "ejecutar la supresión."
            )

        # D5: Cloudinary primero. Un fallo aquí aborta TODO antes de tocar la
        # base (ver la semántica transaccional del docstring del módulo).
        objetivos, residuos = self._objetivos_cloudinary(persona)
        for public_id, carpeta, resource_type, tipo, descripcion in objetivos:
            eliminar_recurso_privado(
                public_id,
                carpeta=carpeta,
                resource_type=resource_type,
                tipo=tipo,
                descripcion=descripcion,
            )

        # A partir de acá: UNA transacción de base, sin red.
        resumen = self._suprimir_en_base(persona, residuos)

        solicitud.estado = ESTADO_EJECUTADA
        solicitud.fecha_ejecucion = datetime.now(timezone.utc)
        solicitud.detalle_ejecucion = resumen
        self.repo.guardar(solicitud)
        self.db.commit()
        return solicitud

    # --- Internos -----------------------------------------------------------

    def _obtener(self, solicitud_id: int) -> SolicitudSupresionDatos:
        solicitud = self.repo.obtener_por_id(solicitud_id)
        if solicitud is None:
            raise EntidadNoEncontrada(
                f"Solicitud de supresión con id {solicitud_id} no encontrada"
            )
        return solicitud

    def _contar_pagos_pendientes(self, persona_id: int) -> int:
        return len(
            self.db.execute(
                select(Pago.id)
                .where(
                    Pago.persona_id == persona_id,
                    Pago.estado_pago == EstadoPago.PENDIENTE_VALIDACION,
                )
            )
            .scalars()
            .all()
        )

    @staticmethod
    def _es_url_legada(valor: str) -> bool:
        return urlparse(valor).scheme in ("http", "https")

    def _objetivos_cloudinary(self, persona: Persona):
        """Recolecta los recursos Cloudinary a destruir ANTES de mutar la base.

        Devuelve `(objetivos, residuos)`: los objetivos se destruyen con
        `eliminar_recurso_privado`; los residuos son recursos legados (URL
        pública completa de antes del fix "voucher no enumerable") que no se
        pueden destruir por public_id -- se reportan en el asiento de
        auditoría en vez de fingir que se borraron (D5)."""
        # Cada objetivo: (public_id, carpeta, resource_type, tipo, descripcion).
        objetivos: List[tuple] = []
        residuos: List[str] = []

        # Foto de perfil. `foto_url` guarda `public_id` (quizá compuesto con
        # `|version`); una URL http(s) completa es una fila legada.
        if persona.foto_url:
            public_id, _version = _descomponer_valor_foto_perfil(persona.foto_url)
            if self._es_url_legada(public_id):
                residuos.append("foto de perfil (URL pública legada)")
            else:
                objetivos.append(
                    (
                        public_id,
                        settings.cloudinary_carpeta_fotos_perfil,
                        "image",
                        "authenticated",
                        "foto de perfil",
                    )
                )

        pagos = (
            self.db.execute(select(Pago).where(Pago.persona_id == persona.id))
            .scalars()
            .all()
        )

        for pago in pagos:
            # Voucher de transferencia adjuntado por el cliente.
            if pago.voucher_url:
                if self._es_url_legada(pago.voucher_url):
                    residuos.append(f"voucher legado del pago {pago.id}")
                else:
                    es_pdf = (pago.voucher_formato or "").lower() == "pdf"
                    objetivos.append(
                        (
                            pago.voucher_url,
                            settings.cloudinary_carpeta_vouchers,
                            "raw" if es_pdf else "image",
                            "authenticated",
                            f"voucher del pago {pago.id}",
                        )
                    )

            # Comprobante PDF oficial generado por el sistema.
            comprobante = (
                self.db.execute(
                    select(ComprobantePago).where(ComprobantePago.pago_id == pago.id)
                )
                .scalars()
                .first()
            )
            if comprobante is not None:
                if self._es_url_legada(comprobante.archivo_url):
                    residuos.append(f"comprobante legado del pago {pago.id}")
                else:
                    objetivos.append(
                        (
                            comprobante.archivo_url,
                            settings.cloudinary_carpeta_comprobantes,
                            "raw",
                            "authenticated",
                            f"comprobante del pago {pago.id}",
                        )
                    )

        return objetivos, residuos

    def _suprimir_en_base(self, persona: Persona, residuos: List[str]) -> str:
        """Todas las mutaciones de la supresión, en la transacción del caso de
        uso. El `commit()` lo hace `ejecutar` (issue #831)."""

        # Capturar ids ANTES de borrar: los outboxes de recuperación y
        # verificación apuntan a `usuario.id`.
        usuario = (
            self.db.execute(select(Usuario).where(Usuario.persona_id == persona.id))
            .scalars()
            .first()
        )
        usuario_id = usuario.id if usuario is not None else None

        # (d) Scrub de identidad de Persona. UPDATE de Core a propósito: los
        # `@validates` del ORM exigirían cédula REAL y nombres normalizados.
        self.db.execute(
            update(Persona)
            .where(Persona.id == persona.id)
            .values(
                nombres=_NOMBRES_SUPRIDOS,
                apellidos=_NOMBRES_SUPRIDOS,
                cedula=_cedula_sentinela(persona.id),
                fecha_nacimiento=_FECHA_NACIMIENTO_SUPRIMIDA,
                foto_url=None,
                telefono=None,
                telefono_contacto=None,
                representante_id=None,
            )
        )
        # La sesión tiene la fila vieja en el identity map: expirar para que
        # cualquier lectura posterior (tests, serialización) vea el scrub.
        self.db.expire(persona)

        # (f) Ficha médica: contenido fuera COMPLETO (D9), tipo de sangre
        # incluido; la fila queda vacía, no ausente, porque el historial
        # contable y la auditoría de emergencias siguen enlazados a ella.
        ficha = (
            self.db.execute(select(FichaMedica).where(FichaMedica.persona_id == persona.id))
            .scalars()
            .first()
        )
        if ficha is not None:
            self.db.execute(
                delete(Enfermedades).where(Enfermedades.ficha_medica_id == ficha.id)
            )
            ficha.alergias = None
            ficha.contacto_emergencia = None
            ficha.telefono_emergencia = None
            # D9: el contenido médico se borra COMPLETO -- tipo de sangre
            # incluido (columna nullable desde m1062supresion).
            ficha.tipo_sangre = None

        # (h) Comunicaciones pendientes que llevan el correo/nombre de la
        # persona. `ENVIANDO` también: la fila fue reclamada pero no
        # entregada, y enviarla después de la supresión es exactamente la
        # fuga que D5 cierra.
        self.db.execute(
            delete(EnrollmentNotificacionOutbox).where(
                EnrollmentNotificacionOutbox.alumno_persona_id == persona.id,
                EnrollmentNotificacionOutbox.status.in_(("PENDIENTE", "ENVIANDO")),
            )
        )
        if usuario_id is not None:
            self.db.execute(
                delete(RecuperacionOutbox).where(
                    RecuperacionOutbox.usuario_id == usuario_id,
                    RecuperacionOutbox.status.in_(("PENDIENTE", "ENVIANDO")),
                )
            )
            self.db.execute(
                delete(VerificacionCorreoOutbox).where(
                    VerificacionCorreoOutbox.usuario_id == usuario_id,
                    VerificacionCorreoOutbox.status.in_(("PENDIENTE", "ENVIANDO")),
                )
            )

        # (e) Cuenta: borrada, salvo que `ConsentimientoLegal` la retenga.
        # Ese registro (D9: versión + fecha de cada aceptación) tiene FK
        # RESTRICT y `cuenta_id` NOT NULL hacia `usuario`: si existe, la
        # cuenta se NEUTRALIZA en vez de borrarse -- correo centinela,
        # contraseña inutilizable, cuenta desactivada y sesiones destruidas.
        # En ambos caminos la persona deja de ser identificable por la cuenta.
        destino_cuenta = "sin cuenta"
        if usuario is not None:
            tiene_consentimientos = (
                self.db.execute(
                    select(ConsentimientoLegal.id).where(
                        ConsentimientoLegal.cuenta_id == usuario.id
                    ).limit(1)
                ).scalar()
                is not None
            )
            self.db.execute(delete(Sesion).where(Sesion.usuario_id == usuario.id))
            if tiene_consentimientos:
                usuario.correo = _correo_sentinela(persona.id)
                # Prefijo "!" imposible de producir por el hasher real: la
                # cuenta deja de poder autenticar sin importar el algoritmo.
                usuario.contrasenia = "!suprimida-no-login"
                usuario.activo = False
                usuario.correo_verificado = False
                usuario.revocar_sesiones()
                destino_cuenta = "cuenta neutralizada (conservada por consentimientos legales)"
            else:
                self.db.delete(usuario)
                destino_cuenta = "cuenta eliminada"

        # (i) Conservados por diseño (D9), se listan para el asiento:
        # ConsentimientoLegal y ConsultaFichaEmergencia quedan como están,
        # enlazados a la persona anonimizada. No se tocan.
        condiciones = [ConsentimientoLegal.representado_persona_id == persona.id]
        if usuario_id is not None:
            condiciones.append(ConsentimientoLegal.cuenta_id == usuario_id)
        consentimientos = self.db.execute(
            select(ConsentimientoLegal.id).where(or_(*condiciones))
        ).scalars().all()
        consultas = self.db.execute(
            select(ConsultaFichaEmergencia.id).where(
                (ConsultaFichaEmergencia.alumno_persona_id == persona.id)
                | (ConsultaFichaEmergencia.consultante_persona_id == persona.id)
            )
        ).scalars().all()

        partes = [
            "identidad de persona anonimizada (nombres, apellidos, cedula, "
            "fecha_nacimiento, telefonos, foto, representante)",
            destino_cuenta,
            f"contenido de ficha medica eliminado ({'con' if ficha is not None else 'sin'} fila)",
            f"{len(consentimientos)} consentimientos legales conservados",
            f"{len(consultas)} consultas a ficha de emergencia conservadas",
        ]
        if residuos:
            partes.append("residuos no destruibles por public_id: " + "; ".join(residuos))
        return "; ".join(partes)[:2000]
