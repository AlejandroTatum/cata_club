"""
Enumeraciones del modelo de dominio - Cata Club.
Corresponden a las clases <<enumeration>> del diagrama de clases.
"""
import enum


class TipoRol(str, enum.Enum):
    ALUMNO = "ALUMNO"
    ENTRENADOR = "ENTRENADOR"
    ADMINISTRADOR = "ADMINISTRADOR"
    REPRESENTANTE = "REPRESENTANTE"


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
    Constantes con nombre para las 5 categorías originales del club -- una
    conveniencia tipada para el código Python (tests, scripts de seed), NO
    la fuente de verdad ni un gate de validación (M1). Esa fuente es la
    tabla `categoria_horario` (`app.dominio.modelos.CategoriaHorario`), que
    ya admite códigos que no están acá: la API valida y deriva
    `hora_inicio`/`hora_fin`/días permitidos consultando esa tabla, nunca
    comparando contra este enum.
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
    # Issue #284: tipo de los pagos de regularización de deuda. No es un
    # pago que registre el cliente: es una operación de bookkeeping del
    # administrador (ver `PagoServicio.regularizar_deuda`), que entra
    # APROBADO directo y con auditoría obligatoria (quién/cuándo/motivo).
    REGULARIZACION = "REGULARIZACION"


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


class TipoNotificacion(str, enum.Enum):
    """Notificación in-app (no email/push)."""
    MIEMBRESIA_VENCIMIENTO_PROXIMO = "MIEMBRESIA_VENCIMIENTO_PROXIMO"
    PAGO_APROBADO = "PAGO_APROBADO"
    PAGO_RECHAZADO = "PAGO_RECHAZADO"
    NUEVA_INSCRIPCION = "NUEVA_INSCRIPCION"
    # INS-2 (docs/product/decisiones-de-negocio-2026-08-11.md §1): avisa al
    # representante ANTERIOR de un dependiente, después del hecho, cuando otro
    # representante lo vincula a su propia cuenta escribiendo su cédula.
    VINCULACION_REPRESENTANTE = "VINCULACION_REPRESENTANTE"
    # Issue #285 (aviso de mora): tres tipos SEPARADOS a propósito, para que
    # la clave de dedup existente `(tipo, persona_id, entidad_relacionada_id)`
    # distinga el primer aviso (día 1), el segundo y último (día 8) y el
    # resumen diario del administrador. Un solo tipo para día 1 y día 8
    # colisionaría sobre el mismo pago y el segundo aviso nunca se enviaría.
    MIEMBRESIA_MORA_DIA_1 = "MIEMBRESIA_MORA_DIA_1"
    MIEMBRESIA_MORA_DIA_8 = "MIEMBRESIA_MORA_DIA_8"
    RESUMEN_MORA_ADMIN = "RESUMEN_MORA_ADMIN"
