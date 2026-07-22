"""
Enumeraciones del modelo de dominio - Cata Club.
Corresponden a las clases <<enumeration>> del diagrama de clases.
"""
import enum


class TipoRol(str, enum.Enum):
    ALUMNO = "ALUMNO"
    ENTRENADOR = "ENTRENADOR"
    ADMINISTRADOR = "ADMINISTRADOR"
    # "Representante" NO se agrega aquí a propósito: sigue siendo un hecho
    # relacional (Persona.representante_id), no un rol -- ver justificación
    # en persona_servicio.py y en el análisis de diseño ya acordado.


class TipoManoDominante(str, enum.Enum):
    """E01-RF008: dato técnico del alumno."""
    DIESTRO = "DIESTRO"
    ZURDO = "ZURDO"


class EstadoMembresia(str, enum.Enum):
    """
    Corrección de modelado: se retiró PENDIENTE_PAGO. Ese valor mezclaba el ciclo
    de vida de Pago (que ya tiene su propio EstadoPago) dentro del estado de
    Membresia -- dos objetos distintos no deben compartir una sola máquina de
    estados. INACTIVA es el estado inicial real de una Membresia (creada, pero
    aún sin ningún pago aprobado); no es sinónimo de "pago pendiente".
    """
    INACTIVA = "INACTIVA"
    ACTIVA = "ACTIVA"
    VENCIDA = "VENCIDA"


class DiaSemana(str, enum.Enum):
    """
    Horarios obligatoriamente incluyen el día de la semana (Lunes a Domingo).
    El Lunes-Domingo completa la semana civil real; no se trunca a Sábado.
    """
    LUNES = "LUNES"
    MARTES = "MARTES"
    MIERCOLES = "MIERCOLES"
    JUEVES = "JUEVES"
    VIERNES = "VIERNES"
    SABADO = "SABADO"
    DOMINGO = "DOMINGO"


class Categoria(str, enum.Enum):
    """
    Categoría de horario de entrenamiento (edad/audiencia), fija y no editable
    por administración -- 5 valores hardcodeados según la spec de negocio.
    No debe confundirse con `CategoriaRanking` (nivel 1-11 del ranking
    mensual): son dos conceptos de dominio distintos que hoy compartían por
    error `NivelRanking`/`Ranking.nivel_ranking_id` -- esta es la separación.
    """
    FORMATIVO = "FORMATIVO"
    INFANTIL = "INFANTIL"
    JUVENIL = "JUVENIL"
    COMPETITIVO = "COMPETITIVO"
    ADULTOS = "ADULTOS"


class TipoModalidad(str, enum.Enum):
    PERSONALIZADA = "PERSONALIZADA"
    MENSUAL = "MENSUAL"


class EstadoPago(str, enum.Enum):
    APROBADO = "APROBADO"
    PENDIENTE_VALIDACION = "PENDIENTE_VALIDACION"
    RECHAZADO = "RECHAZADO"


class TipoPago(str, enum.Enum):
    EFECTIVO = "EFECTIVO"
    TRANSFERENCIA = "TRANSFERENCIA"


class EstadoAsistencia(str, enum.Enum):
    PRESENTE = "PRESENTE"
    AUSENTE = "AUSENTE"
    ATRASADO = "ATRASADO"
    JUSTIFICADO = "JUSTIFICADO"


class TipoEscuela(str, enum.Enum):
    PARTICULAR = "PARTICULAR"
    FISCAL = "FISCAL"
    FISCOMISIONAL = "FISCOMISIONAL"
    MUNICIPAL = "MUNICIPAL"


class NivelTecnicoAlumno(str, enum.Enum):
    NIVEL_1 = "NIVEL 1"
    NIVEL_2 = "NIVEL 2"
    NIVEL_3 = "NIVEL 3"
    NIVEL_4 = "NIVEL 4"
    NIVEL_5 = "NIVEL 5"
    NIVEL_6 = "NIVEL 6"
    NIVEL_7 = "NIVEL 7"
    NIVEL_8 = "NIVEL 8"
    NIVEL_9 = "NIVEL 9"
    NIVEL_10 = "NIVEL 10"


class EstadoSolicitudExtra(str, enum.Enum):
    """Estado de una solicitud de clase adicional dentro de una membresía
    PERSONALIZADA. Es un objeto propio, no reutiliza EstadoPago ni EstadoMembresia."""
    PENDIENTE = "PENDIENTE"
    APROBADA = "APROBADA"
    RECHAZADA = "RECHAZADA"


class TipoSangre(str, enum.Enum):
    A_POSITIVO = "A_POSITIVO"
    A_NEGATIVO = "A_NEGATIVO"
    B_POSITIVO = "B_POSITIVO"
    B_NEGATIVO = "B_NEGATIVO"
    AB_POSITIVO = "AB_POSITIVO"
    AB_NEGATIVO = "AB_NEGATIVO"
    O_POSITIVO = "O_POSITIVO"
    O_NEGATIVO = "O_NEGATIVO"
    DESCONOCIDO = "DESCONOCIDO"


# ---------------------------------------------------------------------------
# Ranking (E03) — módulo agregado en la integración con el frontend.
# ---------------------------------------------------------------------------
class EstadoJustificativoRanking(str, enum.Enum):
    """Estado de un justificativo de inasistencia al ranking mensual
    (E03-RF006a/b). Objeto propio, no reutiliza EstadoSolicitudExtra: son
    procesos de negocio distintos aunque el shape se parezca."""
    PENDIENTE = "PENDIENTE"
    APROBADO = "APROBADO"
    RECHAZADO = "RECHAZADO"


class TipoNotificacion(str, enum.Enum):
    """Notificación in-app (no email/push). Cubre los avisos que exige E03:
    aviso previo a eliminación (RF007), sugerencias de ascenso/descenso
    (RF009), y resultado de evaluación de un justificativo (RF006b)."""
    RANKING_ELIMINACION_PROXIMA = "RANKING_ELIMINACION_PROXIMA"
    RANKING_ASCENSO_SUGERIDO = "RANKING_ASCENSO_SUGERIDO"
    RANKING_DESCENSO_SUGERIDO = "RANKING_DESCENSO_SUGERIDO"
    RANKING_REINGRESO_APROBADO = "RANKING_REINGRESO_APROBADO"
    JUSTIFICATIVO_APROBADO = "JUSTIFICATIVO_APROBADO"
    JUSTIFICATIVO_RECHAZADO = "JUSTIFICATIVO_RECHAZADO"
