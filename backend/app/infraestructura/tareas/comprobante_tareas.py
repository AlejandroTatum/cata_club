"""
Tarea Celery: Generación + subida del comprobante PDF de un Pago aprobado.

Flujo:
    1. Lee el Pago + Persona + Membresia + TipoMembresia desde la BD.
    2. Genera el PDF en memoria (ReportLab) -> bytes.
    3. Sube los bytes a Cloudinary (raw, .pdf, `type="authenticated"`).
    4. Persiste un `ComprobantePago` con el `public_id` en la BD (pago_id
       unique) -- NO la URL: la URL de entrega se firma fresca en cada
       lectura autorizada (ver `cloudinary_cliente.resolver_url_entrega`).

El servicio `PagoServicio.validar_pago` dispara `.delay(pago_id)` apenas se
commitea la aprobación del pago, así el endpoint responde rápido y la latencia
de ReportLab + Cloudinary corre en el worker.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.infraestructura.db import SessionLocal
from app.infraestructura.tareas.celery_app import celery_app
from app.infraestructura.generador_pdf import generar_comprobante_pago_pdf
from app.infraestructura.cloudinary_cliente import subir_pdf_membresia
from app.dominio.modelos import Pago, ComprobantePago
from app.dominio.enums import EstadoPago
from app.dominio.nombre_propio import nombre_completo
from app.dominio.excepciones import EntidadNoEncontrada


logger = logging.getLogger("cataclub.tareas.comprobante")

# Un pago APROBADO sin comprobante más viejo que este umbral se considera
# "perdido" (el disparo original falló o el worker murió) y se re-despacha.
# Más nuevo que esto se deja en paz: el disparo original puede seguir en vuelo
# (la propia tarea reintenta con backoff hasta 5 veces).
UMBRAL_RECONCILIACION_MINUTOS = 10


@celery_app.task(
    name="app.infraestructura.tareas.comprobante_tareas.generar_comprobante_pdf_tarea",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    max_retries=5,
    retry_jitter=True,
)
def generar_comprobante_pdf_tarea(self, pago_id: int) -> dict:
    """
    Genera y sube el comprobante PDF de un pago aprobado.

    Es idempotente respecto a ComprobantePago: si el pago ya tiene un
    comprobante adjunto, la tarea NO regenera (preserva la URL histórica).
    Si en cambio se requiere regenerar, hay otro endpoint explícito para eso.
    
    Returns:
        dict con pago_id, comprobante_url y estadoPago original.
    """
    with SessionLocal() as db:
        pago = db.get(Pago, pago_id)
        if not pago:
            raise EntidadNoEncontrada(f"Pago con id {pago_id} no encontrado")

        if pago.comprobante:
            logger.info(
                "Pago %s ya tiene comprobante (%s). Reutilizando.",
                pago_id, pago.comprobante.archivo_url,
            )
            return {"pago_id": pago_id, "comprobante_url": pago.comprobante.archivo_url}

        if pago.estado_pago != EstadoPago.APROBADO:
            raise RuntimeError(
                f"El pago {pago_id} no está APROBADO (estado={pago.estado_pago}); "
                "no se genera comprobante."
            )

        persona = pago.persona
        membresia = pago.membresia
        tipo = membresia.tipo_membresia

        pdf_bytes = generar_comprobante_pago_pdf(
            pago_id=pago.id,
            persona_nombre=nombre_completo(persona.nombres, persona.apellidos),
            persona_cedula=persona.cedula,
            persona_telefono=persona.telefono,
            membresia_id=membresia.id,
            membresia_categoria=tipo.categoria,
            monto=pago.monto,
            monto_aplicado=membresia.monto_aplicado,
            estado_pago=pago.estado_pago.value,
            tipo_pago=pago.tipo_pago.value,
            fecha_inicio=pago.fecha_inicio,
            fecha_fin=pago.fecha_fin,
            fecha_aprobacion=pago.fecha_validacion,
            motivo_rechazo=pago.motivo_rechazo,
        )

        public_id = f"comprobante-{pago.id:08d}"
        subir_pdf_membresia(pdf_bytes, public_id)

        # Se persiste el public_id, NO la URL que devuelve el SDK: el PDF se
        # sube como `type="authenticated"` (hallazgo de privacidad "voucher
        # no enumerable", mismo criterio que el voucher de transferencia en
        # `PagoServicio.adjuntar_voucher`) -- la URL de entrega se firma
        # fresca en cada lectura autorizada, nunca se persiste firmada.
        comprobante = ComprobantePago(
            pago_id=pago.id,
            archivo_url=public_id,
            formato_archivo="pdf",
        )
        db.add(comprobante)
        try:
            db.commit()
        except IntegrityError:
            # Carrera: otro disparo (ej. reconciliación + disparo original
            # solapados) ya insertó y commiteó el comprobante de este pago
            # entre nuestra lectura y este commit. No es un fallo real -- el
            # ganador ya dejó el trabajo hecho -- así que no se propaga (eso
            # desperdiciaría un reintento de Celery): se relee la fila ya
            # commiteada y se devuelve su URL.
            db.rollback()
            ganador = db.execute(
                select(ComprobantePago).where(ComprobantePago.pago_id == pago.id)
            ).scalar_one()
            logger.warning(
                "Carrera de inserción de comprobante para pago %s; "
                "se reutiliza la URL del ganador.", pago_id,
            )
            return {"pago_id": pago_id, "comprobante_url": ganador.archivo_url}

        db.refresh(comprobante)
        logger.info("Comprobante creado para pago %s -> %s", pago_id, public_id)
    return {"pago_id": pago_id, "comprobante_url": public_id}


@celery_app.task(
    name="app.infraestructura.tareas.comprobante_tareas.reconciliar_comprobantes_faltantes",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    max_retries=3,
    retry_jitter=True,
)
def reconciliar_comprobantes_faltantes(self) -> dict:
    """
    Reconciliación periódica (Celery Beat): re-despacha la generación del
    comprobante PDF para pagos APROBADOS que siguen SIN comprobante pasado
    el umbral (auditoría, hallazgo 5: si Redis falla justo después del commit
    de la aprobación, el disparo original se pierde en silencio).

    El "outbox" es el propio estado commiteado en la aprobación: un Pago
    APROBADO (con `fecha_validacion`) sin fila en `comprobante_pago` ES la
    constancia de que falta el comprobante -- no hace falta tabla nueva. Se
    exige `fecha_validacion IS NOT NULL` para no barrer datos sembrados a
    mano que nunca pasaron por `validar_pago`.

    Es seguro re-despachar: `generar_comprobante_pdf_tarea` no regenera si el
    comprobante ya existe, y el public_id determinístico en Cloudinary
    sobrescribe en vez de duplicar (ver su docstring).
    """
    limite = datetime.now(timezone.utc) - timedelta(minutes=UMBRAL_RECONCILIACION_MINUTOS)

    with SessionLocal() as db:
        stmt = (
            select(Pago.id)
            .outerjoin(ComprobantePago, ComprobantePago.pago_id == Pago.id)
            .where(
                Pago.estado_pago == EstadoPago.APROBADO,
                Pago.fecha_validacion.is_not(None),
                Pago.fecha_validacion < limite,
                ComprobantePago.id.is_(None),
            )
            .order_by(Pago.id)
        )
        pago_ids = list(db.scalars(stmt).all())

    for pago_id in pago_ids:
        generar_comprobante_pdf_tarea.delay(pago_id)
        logger.warning(
            "Reconciliación: pago %s aprobado sin comprobante; generación re-despachada.",
            pago_id,
        )

    if not pago_ids:
        logger.info("Reconciliación de comprobantes: nada pendiente.")

    return {"total_redespachados": len(pago_ids), "pago_ids": pago_ids}
