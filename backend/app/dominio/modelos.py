"""
Capa de Dominio - Modelos ORM (SQLAlchemy 2.0)
Sistema Integral de Administración - Cata Club
Alineado al diagrama de clases (UML) del proyecto.

Correcciones aplicadas respecto al diagrama original:
- Rol <-> Usuario:            0..* / 0..*   (antes exigía 1..* de Usuario hacia Rol)
- Persona <-> Direccion:      0..1          (antes 1 obligatorio; permite compartir dirección o no tenerla)
- Pago <-> Membresia:         asociación simple (antes composición; un pago es un registro
                               histórico/contable y NO debe borrarse en cascada con la membresía)
- FichaMedica <-> Enfermedades: 0..*         (antes 1..* obligaba mínimo una enfermedad registrada)
- Se agrega FK directa Pago -> Persona (estaba en el código base pero faltaba en el diagrama)
"""
import logging
from datetime import datetime, date, time, timedelta, timezone
from decimal import Decimal
from typing import List, Optional

from sqlalchemy import (
    String, ForeignKey, Numeric, DateTime, Date, Time, Boolean, Integer, Table, Column,
    CheckConstraint, Index, UniqueConstraint, text, func,
    Enum as SAEnum,
)
from sqlalchemy.dialects.postgresql import ExcludeConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, validates

from app.dominio.enums import (
    TipoRol, EstadoMembresia, TipoModalidad, EstadoPago,
    TipoPago, EstadoAsistencia, TipoEscuela, NivelTecnicoAlumno, TipoSangre, DiaSemana,
    TipoNotificacion,
    TipoManoDominante,
    EfectoCoberturaCorreccion,
)

_log = logging.getLogger("cataclub.dominio.modelos")


def _ahora_utc() -> datetime:
    """Reemplaza datetime.utcnow() (deprecado desde Python 3.12)."""
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


_HORARIO_FK = "horario_entrenamiento.id"


# ---------------------------------------------------------------------------
# Tabla de asociación Usuario <-> Rol (muchos a muchos)
# ---------------------------------------------------------------------------
usuario_rol = Table(
    "usuario_rol", Base.metadata,
    Column("usuario_id", ForeignKey("usuario.id"), primary_key=True),
    Column("rol_id", ForeignKey("rol.id"), primary_key=True),
    Index("ix_usuario_rol_rol_id", "rol_id"),
)


# ---------------------------------------------------------------------------
# Geografía: Pais -> Provincia -> Canton
# ---------------------------------------------------------------------------
class Pais(Base):
    __tablename__ = "pais"
    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100))

    provincias: Mapped[List["Provincia"]] = relationship(back_populates="pais")


class Provincia(Base):
    __tablename__ = "provincia"
    __table_args__ = (
        Index("ix_provincia_pais_id", "pais_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100))
    pais_id: Mapped[int] = mapped_column(ForeignKey("pais.id"))

    pais: Mapped["Pais"] = relationship(back_populates="provincias")
    cantones: Mapped[List["Canton"]] = relationship(back_populates="provincia")


class Canton(Base):
    __tablename__ = "canton"
    __table_args__ = (
        Index("ix_canton_provincia_id", "provincia_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100))
    provincia_id: Mapped[int] = mapped_column(ForeignKey("provincia.id"))

    provincia: Mapped["Provincia"] = relationship(back_populates="cantones")
    direcciones: Mapped[List["Direccion"]] = relationship(back_populates="canton")


class Direccion(Base):
    __tablename__ = "direccion"
    __table_args__ = (
        Index("ix_direccion_canton_id", "canton_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    barrio: Mapped[str] = mapped_column(String(100))
    calle_principal: Mapped[str] = mapped_column(String(150))
    calle_secundaria: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    numero_casa: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    canton_id: Mapped[int] = mapped_column(ForeignKey("canton.id"))

    canton: Mapped["Canton"] = relationship(back_populates="direcciones")
    # 0..* Persona -> 1 Direccion (una dirección puede ser compartida; una persona puede no tener)
    personas: Mapped[List["Persona"]] = relationship(back_populates="direccion")


# ---------------------------------------------------------------------------
# Institución educativa
# ---------------------------------------------------------------------------
class Institucion(Base):
    __tablename__ = "institucion"
    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(150))
    tipo_escuela: Mapped[TipoEscuela] = mapped_column(SAEnum(TipoEscuela))

    personas: Mapped[List["Persona"]] = relationship(back_populates="institucion")


# ---------------------------------------------------------------------------
# Seguridad: Rol / Usuario
# ---------------------------------------------------------------------------
class Rol(Base):
    __tablename__ = "rol"
    id: Mapped[int] = mapped_column(primary_key=True)
    tipo_rol: Mapped[TipoRol] = mapped_column(SAEnum(TipoRol))
    descripcion: Mapped[str] = mapped_column(String(255))

    usuarios: Mapped[List["Usuario"]] = relationship(secondary=usuario_rol, back_populates="roles")


class Usuario(Base):
    __tablename__ = "usuario"
    id: Mapped[int] = mapped_column(primary_key=True)
    correo: Mapped[str] = mapped_column(String(100), unique=True)
    contrasenia: Mapped[str] = mapped_column(String(255))
    fecha_creacion: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_ahora_utc)
    # E01-RF003: versión monotónica de la contraseña. Cada vez que se
    # restablece o cambia la contraseña se incrementa, invalidando tokens de
    # recuperación emitidos antes de ese cambio (single-use por diseño).
    version_contrasenia: Mapped[int] = mapped_column(Integer, default=1)
    # E01-RF013: permite al Administrador suspender una cuenta sin borrar los
    # datos (Persona/historial). Antes solo existía DELETE (borrado duro).
    activo: Mapped[bool] = mapped_column(Boolean, default=True)
    # E01: versión monotónica de la SESIÓN. Dominio de invalidación separado
    # de `version_contrasenia` a propósito: "cerrar mis otras sesiones" y
    # "cambié mi contraseña" son eventos independientes, y reusar la misma
    # columna acoplaría uno con el otro sin que el usuario lo pida. Se
    # compara contra el claim `sver` de los tokens access/refresh (ver
    # `GestorAutenticacion.epoch_valido`). A diferencia de `version_contrasenia`
    # (solo default de Python), esta columna SÍ lleva `server_default`: un
    # INSERT crudo que salte el ORM no debe dejarla en NULL.
    version_sesion: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)

    persona_id: Mapped[int] = mapped_column(ForeignKey("persona.id"), unique=True)
    persona: Mapped["Persona"] = relationship(back_populates="usuario")
    # 0..* en ambos lados (un rol puede existir sin usuarios asignados todavía)
    roles: Mapped[List["Rol"]] = relationship(secondary=usuario_rol, back_populates="usuarios")

    def revocar_sesiones(self) -> None:
        """Invalida TODA sesión activa de este usuario bombeando el epoch
        (`version_sesion`): cualquier token access/refresh emitido antes de
        esta llamada deja de ser vigente (ver `GestorAutenticacion.sesion_vigente`).

        Criterio unificado (auditoría, issue #4): TODA operación que retira
        acceso -- restablecer contraseña, desactivar la cuenta, dar de baja a
        la persona, quitar un rol, cerrar las otras sesiones -- debe pasar por
        este método, el ÚNICO lugar del dominio que expresa "retirar acceso".
        Reactivar una cuenta NO retira acceso y por lo tanto no bombea."""
        self.version_sesion += 1


class Sesion(Base):
    """Registro OBSERVACIONAL de un login. No decide nada.

    La invalidación de sesiones es y sigue siendo `Usuario.version_sesion`, el
    epoch que viaja en el claim `sver` y que `GestorAutenticacion.epoch_valido`
    compara. Esta tabla no participa de esa decisión: existe para que el dueño
    de la cuenta pueda VER desde dónde entró, y nada más. Si un día se
    consultara para autorizar, habríamos movido un control de seguridad a una
    tabla que nació para llenar una pantalla.

    Por eso cada fila guarda el `version_sesion` vigente cuando se abrió: una
    fila cuyo epoch quedó por debajo del epoch actual del usuario está muerta,
    y eso se DERIVA del mecanismo autoritativo en lugar de duplicarlo.
    `revocar_sesiones()` no toca esta tabla justamente por eso.

    Sin IP: es dato personal, el club maneja cuentas de menores y de sus
    representantes, y ningún caso de uso la lee (ver
    `soporte_transversal/dispositivo.py`).

    Sin `ultimo_uso_en`: actualizarlo exigiría que el refresh sepa a QUÉ fila
    corresponde, y hoy el token no lleva identificador de sesión. Una columna
    que nunca se actualiza es una mentira con forma de dato.
    """

    __tablename__ = "sesion"
    __table_args__ = (
        # El acceso real es siempre "las sesiones de este usuario, la más
        # reciente primero" -- el índice cubre las dos mitades de esa consulta.
        Index("ix_sesion_usuario_iniciada", "usuario_id", "iniciada_en"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuario.id", ondelete="CASCADE"), nullable=False)
    # Etiqueta legible ya derivada del user-agent, nunca el user-agent crudo.
    dispositivo: Mapped[str] = mapped_column(String(80), nullable=False)
    iniciada_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_ahora_utc, nullable=False,
    )
    # El epoch bajo el que se abrió. Ver el docstring: se guarda para derivar
    # "muerta", no para decidirlo.
    version_sesion: Mapped[int] = mapped_column(Integer, nullable=False)

    usuario: Mapped["Usuario"] = relationship()


# ---------------------------------------------------------------------------
# Persona (entidad central, con relación reflexiva Representante/Representados)
# ---------------------------------------------------------------------------
class Persona(Base):
    __tablename__ = "persona"
    __table_args__ = (
        Index("ix_persona_representante_id", "representante_id"),
        Index("ix_persona_direccion_id", "direccion_id"),
        Index("ix_persona_institucion_id", "institucion_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    nombres: Mapped[str] = mapped_column(String(100))
    apellidos: Mapped[str] = mapped_column(String(100))
    cedula: Mapped[str] = mapped_column(String(10), unique=True)
    fecha_nacimiento: Mapped[date] = mapped_column(Date)
    foto_url: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    telefono: Mapped[str] = mapped_column(String(15))
    telefono_contacto: Mapped[Optional[str]] = mapped_column(String(15), nullable=True)

    # E04-RF014: el reporte "alumnos nuevos por periodo" necesita saber
    # cuándo se dio de alta cada Persona -- no existía ningún timestamp.
    fecha_registro: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_ahora_utc)

    # Baja LÓGICA: quien deja el club se DESACTIVA, nunca se borra. El
    # `DELETE /personas/{id}` anterior destruía junto con la fila el historial
    # de asistencias, los pagos y la ficha médica -- registros que un club que
    # cobra dinero está obligado a conservar. Es un plano distinto del de
    # `Usuario.activo` (E01-RF013): aquel gobierna el ACCESO al sistema, este
    # la PERTENENCIA al club. Un menor inscrito por su representante no tiene
    # `Usuario`, así que sin esta columna no había ninguna forma de sacarlo de
    # la nómina que no fuera borrarlo.
    activo: Mapped[bool] = mapped_column(Boolean, default=True)

    # --- Relación reflexiva: 1 adulto representa a 0..* personas ---
    representante_id: Mapped[Optional[int]] = mapped_column(ForeignKey("persona.id"), nullable=True)
    representante: Mapped[Optional["Persona"]] = relationship(
        "Persona", remote_side=[id], back_populates="representados"
    )
    representados: Mapped[List["Persona"]] = relationship("Persona", back_populates="representante")

    # --- FKs opcionales (0..1) ---
    direccion_id: Mapped[Optional[int]] = mapped_column(ForeignKey("direccion.id"), nullable=True)
    direccion: Mapped[Optional["Direccion"]] = relationship(back_populates="personas")

    institucion_id: Mapped[Optional[int]] = mapped_column(ForeignKey("institucion.id"), nullable=True)
    institucion: Mapped[Optional["Institucion"]] = relationship(back_populates="personas")

    # --- Relaciones 1 a 1 / 1 a 0..1 ---
    usuario: Mapped[Optional["Usuario"]] = relationship(back_populates="persona", uselist=False)
    antecedentes_club: Mapped[Optional["AntecedentesClub"]] = relationship(back_populates="persona", uselist=False)
    ficha_medica: Mapped[Optional["FichaMedica"]] = relationship(back_populates="persona", uselist=False)

    # --- Relaciones 1 a muchos ---
    # Como alumno:
    # `foreign_keys` explícito: `Asistencia` tiene DOS FKs a `persona.id`
    # (`persona_id` para el alumno, `registrado_por_id` para quién tomó la
    # lista, issue #263) -- sin esto, SQLAlchemy no puede elegir cuál usar
    # (mismo criterio que `Persona.pagos`, documentado justo abajo).
    asistencias: Mapped[List["Asistencia"]] = relationship(
        back_populates="persona", foreign_keys="Asistencia.persona_id",
    )
    # `foreign_keys` explícito: `Pago` ahora tiene TRES FKs a `persona.id`
    # (`persona_id`, `descuento_autorizado_por_persona_id` del issue #11 y
    # `regularizada_por_persona_id` del issue #284) -- sin esto, SQLAlchemy no
    # puede elegir cuál usar para esta relación y falla con
    # `AmbiguousForeignKeysError`.
    pagos: Mapped[List["Pago"]] = relationship(
        back_populates="persona", foreign_keys="Pago.persona_id",
    )
    membresias: Mapped[List["Membresia"]] = relationship(back_populates="persona")
    notificaciones: Mapped[List["Notificacion"]] = relationship(back_populates="persona")

    # Asignación directa a horarios
    alumno_horarios: Mapped[List["AlumnoHorario"]] = relationship(back_populates="persona")


class AntecedentesClub(Base):
    __tablename__ = "antecedentes_club"
    id: Mapped[int] = mapped_column(primary_key=True)
    nivel_tecnico_alumno: Mapped[NivelTecnicoAlumno] = mapped_column(SAEnum(NivelTecnicoAlumno))
    fecha_inicio_club: Mapped[date] = mapped_column(Date)
    # E01-RF008: dato técnico, opcional (no siempre se conoce al momento del
    # alta; se puede completar después).
    mano_dominante: Mapped[Optional[TipoManoDominante]] = mapped_column(
        SAEnum(TipoManoDominante), nullable=True
    )

    persona_id: Mapped[int] = mapped_column(ForeignKey("persona.id"), unique=True)
    persona: Mapped["Persona"] = relationship(back_populates="antecedentes_club")


# ---------------------------------------------------------------------------
# Membresías y Pagos
# ---------------------------------------------------------------------------
class TipoMembresia(Base):
    """El plan que la familia paga: categoría comercial, precio y modalidad.

    Sin franja horaria: la tenía como `String(80)` cargado a mano y se
    desincronizó del horario real del club (declaraba 20:00-21:00 para
    ADULTOS, que entrena hasta las 21:15). Las horas de un alumno salen de
    los `AlumnoHorario` que el club le asignó, cuya `categoria` deriva de
    `app.dominio.categoria_metadata` -- la eliminó `d1a5f8c30b72`.
    """
    __tablename__ = "tipo_membresia"
    id: Mapped[int] = mapped_column(primary_key=True)
    categoria: Mapped[str] = mapped_column(String(80))
    precio: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    modalidad: Mapped[TipoModalidad] = mapped_column(SAEnum(TipoModalidad))

    membresias: Mapped[List["Membresia"]] = relationship(back_populates="tipo_membresia")


class Membresia(Base):
    __tablename__ = "membresia"
    # Invariante de negocio EN LA BASE (auditoría hallazgo 7, issue #8): como
    # máximo una membresía OPERATIVA por persona. El chequeo de
    # `MembresiaServicio.crear_membresia` sigue siendo el camino primario de
    # error (UX); este índice único PARCIAL es la red de seguridad ante
    # escrituras concurrentes que lo burlen -- en particular dos
    # `validar_pago` simultáneos aprobando pagos de dos membresías INACTIVAS
    # de la misma persona. Parcial a propósito: el historial (VENCIDA,
    # INACTIVA) convive sin límite; el WHERE es el espejo exacto del chequeo
    # del servicio (`estado in (ACTIVA, SUSPENDIDA)`).
    #
    # Ensanchado por la migración de issue #400 (suspensión temporal) para
    # incluir SUSPENDIDA junto a ACTIVA -- creado originalmente solo con
    # ACTIVA por `c3d9f2b7a1e5`. SUSPENDIDA NO es un estado histórico como
    # VENCIDA/INACTIVA: la propia sección "API e invariantes" del issue #400
    # exige "como máximo una membresía operativa por persona", y una
    # membresía suspendida sigue siendo la membresía operativa de esa
    # persona (conserva plan, beneficio y cobertura) -- si el índice solo
    # protegiera ACTIVA, alguien podría suspenderse y de inmediato inscribir
    # una membresía nueva sin cancelar la anterior, duplicando el vínculo
    # persona-plan que este índice existe para impedir. La migración
    # `d2a7e5c91b34` había dejado esto deliberadamente sin tocar bajo la
    # premisa contraria ("una SUSPENDIDA convive con la ACTIVA de la misma
    # persona"); esa premisa quedó corregida acá porque no se sostiene contra
    # el propio texto del issue.
    __table_args__ = (
        Index(
            "uq_membresia_activa_por_persona",
            "persona_id",
            unique=True,
            postgresql_where=text("estado IN ('ACTIVA', 'SUSPENDIDA')"),
        ),
        Index("ix_membresia_persona_id", "persona_id"),
        Index("ix_membresia_tipo_membresia_id", "tipo_membresia_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    estado: Mapped[EstadoMembresia] = mapped_column(SAEnum(EstadoMembresia))
    monto_aplicado: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    fecha_activacion: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # E04-RF002: auditoría de por qué monto_aplicado quedó en 0 -- necesario
    # para que un reporte financiero no lo confunda con un error de cobro.
    es_gratuidad_familiar: Mapped[bool] = mapped_column(Boolean, default=False)

    persona_id: Mapped[int] = mapped_column(ForeignKey("persona.id"))
    persona: Mapped["Persona"] = relationship(back_populates="membresias")

    tipo_membresia_id: Mapped[int] = mapped_column(ForeignKey("tipo_membresia.id"))
    tipo_membresia: Mapped["TipoMembresia"] = relationship(back_populates="membresias")

    # Asociación simple (NO composición): el historial de pagos debe sobrevivir
    # aunque la membresía cambie de estado o se elimine.
    pagos: Mapped[List["Pago"]] = relationship(back_populates="membresia")


class HistorialEstadoMembresia(Base):
    """Huella auditable de cada transición de estado de una membresía (#400).

    Por qué existe: sin esto, suspender una membresía sería un cambio de
    estado sin autor y sin motivo. Es exactamente el defecto que #389
    documenta del otro lado del sistema, donde una asistencia corregida
    quedaba acreditada a quien no la escribió. Acá se registra quién, cuándo,
    desde qué estado y por qué -- y el original nunca se sobrescribe: cada
    transición es una fila nueva.

    `fecha_efectiva` (desde cuándo rige el estado nuevo) es distinta de
    `fecha_registro` (cuándo se escribió la fila). Separarlas permite
    registrar una suspensión con fecha efectiva pasada sin que la auditoría
    mienta sobre cuándo se decidió.
    """

    __tablename__ = "historial_estado_membresia"
    __table_args__ = (
        Index("ix_historial_estado_membresia_membresia_id", "membresia_id"),
        Index("ix_historial_estado_membresia_actor_persona_id", "actor_persona_id"),
        # Una transición de ACTIVA a ACTIVA no es una transición: es ruido que
        # ensucia la auditoría y hace que un conteo de suspensiones mienta.
        CheckConstraint(
            "estado_anterior <> estado_nuevo",
            name="ck_historial_estado_cambia",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    membresia_id: Mapped[int] = mapped_column(ForeignKey("membresia.id"))
    estado_anterior: Mapped[EstadoMembresia] = mapped_column(SAEnum(EstadoMembresia))
    estado_nuevo: Mapped[EstadoMembresia] = mapped_column(SAEnum(EstadoMembresia))
    fecha_efectiva: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    fecha_registro: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_ahora_utc
    )
    # Nullable a propósito: el vencimiento lo dispara el sistema, no una
    # persona. Que TODA transición administrativa lleve actor y motivo lo
    # exige el servicio, que es quien conoce la diferencia; la tabla no puede
    # distinguir un actor ausente legítimo de uno olvidado.
    actor_persona_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("persona.id"), nullable=True
    )
    motivo: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)


class Pago(Base):
    __tablename__ = "pago"
    # Invariante de negocio EN LA BASE (auditoría hallazgo 7, issue #8): un
    # solo pago PENDIENTE_VALIDACION por membresía. El chequeo de
    # `PagoServicio.registrar_pago` (`existe_pendiente_para_membresia`) sigue
    # siendo el camino primario de error; este índice único PARCIAL respalda
    # ante dos registros concurrentes que pasen los dos el chequeo. Parcial a
    # propósito: el historial APROBADO/RECHAZADO de la membresía no queda
    # limitado. Creado por la migración `c3d9f2b7a1e5`.
    __table_args__ = (
        Index(
            "uq_pago_pendiente_por_membresia",
            "membresia_id",
            unique=True,
            postgresql_where=text("estado_pago = 'PENDIENTE_VALIDACION'"),
        ),
        Index("ix_pago_persona_id", "persona_id"),
        Index("ix_pago_membresia_id", "membresia_id"),
        Index("ix_pago_descuento_id", "descuento_id"),
        Index("ix_pago_descuento_autorizado_por_persona_id", "descuento_autorizado_por_persona_id"),
        Index("ix_pago_regularizada_por_persona_id", "regularizada_por_persona_id"),
        Index("ix_pago_validado_por_persona_id", "validado_por_persona_id"),
        # Espejo en la base del invariante que
        # `PagoServicio._congelar_beneficio_activo` ya respeta: un descuento
        # congelado sin su valor sería un hecho
        # histórico incompleto. El servicio sigue siendo el camino primario de
        # error (mensaje claro); esto es la red de seguridad ante un INSERT que
        # lo esquive (mismo criterio que los CHECK de `Descuento` más abajo).
        CheckConstraint(
            "descuento_id IS NULL OR descuento_valor_aplicado IS NOT NULL",
            name="ck_pago_descuento_valor_congelado",
        ),
        # Snapshot de tarifa (issue #400): todo o nada. Un pago con tarifa
        # pero sin meses es un hecho histórico incompleto, y eso es PEOR que
        # no tener snapshot -- tiene forma de dato bueno y no lo es. Mismo
        # criterio que `ck_pago_descuento_valor_congelado` justo arriba.
        CheckConstraint(
            "(tarifa_mensual_aplicada IS NULL"
            " AND meses_comprados IS NULL"
            " AND monto_base IS NULL)"
            " OR (tarifa_mensual_aplicada IS NOT NULL"
            " AND meses_comprados IS NOT NULL"
            " AND monto_base IS NOT NULL)",
            name="ck_pago_snapshot_completo_o_ausente",
        ),
        CheckConstraint(
            "meses_comprados IS NULL OR meses_comprados > 0",
            name="ck_pago_meses_comprados_positivo",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # OJO: `monto` es el monto FINAL, ya descontado (`registrar_pago` hace
    # `pago.monto = monto_final`). El monto ANTES del descuento vive en
    # `monto_base`, más abajo.
    monto: Mapped[Decimal] = mapped_column(Numeric(10, 2))

    # --- Snapshot de tarifa congelado (issue #400) ---------------------------
    # Hoy el precio mensual solo vive en `membresia.monto_aplicado`, que es
    # mutable: editar la tarifa reescribe de hecho cuántos meses compró un
    # pago viejo, porque los meses se derivan dividiendo por ese valor
    # VIGENTE. Estas tres columnas congelan la cuenta en el pago, para que el
    # historial no dependa de un número que alguien puede cambiar mañana.
    #
    # NULLABLE a propósito, y no se rellenan hacia atrás: la tarifa que regía
    # cuando se cobró un pago histórico es justamente lo que nadie registró.
    # Inventarla sería la "corrección automática de plata ambigua" que #400
    # prohíbe; `scripts/inventario_anomalias_pagos.py` (A5) mide cuántas
    # filas quedan sin poder reconstruirse. Además, mientras dure la cadena
    # de #400 el código viejo sigue insertando pagos sin snapshot: NOT NULL
    # partiría la aplicación en el momento de aplicar la migración.
    tarifa_mensual_aplicada: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(10, 2), nullable=True
    )
    meses_comprados: Mapped[Optional[int]] = mapped_column(nullable=True)
    monto_base: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    motivo_rechazo: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    estado_pago: Mapped[EstadoPago] = mapped_column(SAEnum(EstadoPago))
    tipo_pago: Mapped[TipoPago] = mapped_column(SAEnum(TipoPago))
    fecha_registro: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_ahora_utc)
    fecha_validacion: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    fecha_inicio: Mapped[date] = mapped_column(Date)
    fecha_fin: Mapped[date] = mapped_column(Date)

    persona_id: Mapped[int] = mapped_column(ForeignKey("persona.id"))
    # `foreign_keys` explícito: ver el comentario en `Persona.pagos` -- misma
    # ambigüedad, mismo motivo.
    persona: Mapped["Persona"] = relationship(back_populates="pagos", foreign_keys=[persona_id])

    membresia_id: Mapped[int] = mapped_column(ForeignKey("membresia.id"))
    membresia: Mapped["Membresia"] = relationship(back_populates="pagos")

    # --- Voucher de transferencia (adjuntado por el cliente) ---
    # Distinto de ComprobantePago: ese es el PDF OFICIAL generado por el sistema
    # al aprobar un pago (tarea Celery). El voucher es la imagen/PDF que sube
    # el cliente como evidencia de la transferencia bancaria, mientras el pago
    # está PENDIENTE_VALIDACION. No constituye tabla nueva: son columnas en Pago.
    #
    # `voucher_url` NO es una URL (pese al nombre, que se conserva para no
    # migrar el esquema): desde el fix de privacidad "voucher no enumerable"
    # guarda el `public_id` de Cloudinary de un recurso `type="authenticated"`.
    # La URL de entrega se firma fresca en cada lectura autorizada -- ver
    # `PagoServicio.pago_a_response_dto` / `cloudinary_cliente.resolver_url_entrega`.
    # Filas creadas ANTES del fix siguen con la URL pública completa de un
    # recurso `type="upload"` (se detecta por el prefijo `http`); ver el
    # residual documentado en docs/archive/fixes/16-voucher-no-enumerable.md.
    voucher_url: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    voucher_formato: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    voucher_fecha_carga: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    comprobante: Mapped[Optional["ComprobantePago"]] = relationship(back_populates="pago", uselist=False)

    # --- Descuento aplicado a ESTE pago, congelado al momento de registrar
    # (issue #11, colapsado a columnas de Pago: el dueño confirmó que un pago
    # lleva UN solo descuento, así que `descuento_aplicado` como tabla aparte
    # no tenía cardinalidad que justificarla). Las cuatro columnas son
    # nullable: un pago puede no llevar descuento. El congelamiento es el
    # punto de todo esto -- `descuento_valor_aplicado`/`_porcentaje_aplicado`
    # copian el valor vigente en `Descuento` al aplicar, así que cambios
    # posteriores al catálogo jamás alteran pagos ya registrados.
    descuento_id: Mapped[Optional[int]] = mapped_column(ForeignKey("descuento.id"), nullable=True)
    descuento_valor_aplicado: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    # Porcentaje vigente al aplicar (NULL si el descuento era de monto fijo);
    # también congelado, para poder auditar "era el 50 % de entonces".
    descuento_porcentaje_aplicado: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2), nullable=True)
    # Auditoría de quién AUTORIZÓ el descuento. Desde el issue #400/3c ya NO es
    # `persona_id_solicitante` (quien registró este pago) -- es el admin que
    # CONCEDIÓ el beneficio en `AsignacionDescuento.asignado_por_persona_id`
    # (issue #398), congelado acá por `PagoServicio._congelar_beneficio_activo`.
    # Antes coincidían siempre por construcción (solo un admin podía elegir el
    # descuento Y registrar el pago); ahora un alumno puede autoservirse un
    # pago con un beneficio que otro admin le concedió hace tiempo, y esta
    # columna debe seguir nombrando a quien lo concedió, no a quien pagó.
    descuento_autorizado_por_persona_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("persona.id"), nullable=True,
    )

    # --- Regularización de deuda (issue #284) -----------------------------
    # Solo se setean en la operación de regularización del administrador
    # (`PagoServicio.regularizar_deuda`), nunca en un pago que registra el
    # cliente. `regularizada_por_persona_id` es QUIÉN (admin) la ejecutó;
    # `motivo_regularizacion` es POR QUÉ (obligatorio). El CUÁNDO es
    # `fecha_validacion`, que ya existe y se setea al crear la regularización.
    regularizada_por_persona_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("persona.id"), nullable=True,
    )
    motivo_regularizacion: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # --- Autoría de aprobación/rechazo (issue #458) ------------------------
    # Antes de esto, `PATCH /pagos/{id}/validar` no registraba QUIÉN aprobó o
    # rechazó un pago -- a diferencia de `descuento_autorizado_por_persona_id`
    # y `regularizada_por_persona_id` acá arriba, que sí nombran a su admin.
    # Un solo campo sirve para las dos operaciones (aprobar Y rechazar), mismo
    # criterio que `fecha_validacion` (que ya es el "cuándo" de ambas): la
    # columna no distingue el desenlace, `estado_pago` ya lo hace.
    #
    # NULLABLE a nivel de esquema a propósito: el fail-closed ("nunca guardar
    # sin autor") es una regla de `PagoServicio.validar_pago`, NO un NOT NULL
    # de columna -- un NOT NULL de esquema rompería la migración sobre pagos
    # ya validados antes de este fix (regularizados o históricos), que jamás
    # tuvieron este dato y no se reescriben retroactivamente (mismo criterio
    # que `tarifa_mensual_aplicada` más arriba).
    validado_por_persona_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("persona.id"), nullable=True,
    )

    # --- Excepción auditada: aprobar una transferencia sin comprobante
    # (issue #459) ------------------------------------------------------
    # Decisión de producto: una TRANSFERENCIA puede aprobarse sin voucher
    # cuando el admin verificó la cuenta bancaria directamente, pero SOLO
    # como excepción auditada -- nunca un camino silencioso. `PagoServicio.
    # validar_pago` exige este motivo (no vacío) exactamente en ese caso
    # (TRANSFERENCIA, sin `voucher_url`, se está APROBANDO); el resto del
    # tiempo queda `None`, incluyendo cuando el pago SÍ trae voucher (ese
    # camino no cambia) y cuando se RECHAZA sin voucher (rechazar nunca
    # activa nada, no hay riesgo que auditar). Un EFECTIVO sin comprobante
    # tampoco entra acá: para ese tipo de pago la ausencia de voucher es lo
    # normal, no una excepción (ver `pagoFaltaComprobante` en el frontend,
    # que ya scopea "falta comprobante" a TRANSFERENCIA únicamente -- issue
    # #452 documenta que el voucher nunca aplicó a EFECTIVO).
    #
    # NULLABLE a nivel de esquema, mismo criterio que `validado_por_persona_
    # id` arriba: el fail-closed es responsabilidad del servicio, no de un
    # NOT NULL que rompería sobre transferencias históricas ya aprobadas sin
    # voucher (antes de este fix, se aprobaban por autoatestación pura, sin
    # dejar ningún rastro del motivo).
    motivo_excepcion_sin_comprobante: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True,
    )


class CorreccionPago(Base):
    """Corrección financiera auditable de un `Pago` YA aprobado (issue #400,
    slice 5b).

    Por qué existe: los seis campos financieros congelados de `Pago`
    (`tarifa_mensual_aplicada`, `meses_comprados`, `monto_base`, `monto`,
    `fecha_inicio`, `fecha_fin`) a veces necesitan un ajuste administrativo
    después de aprobados -- un error de tipeo, un descuento mal aplicado, un
    período mal calculado. El contrato de #400 ("Corrección financiera") es
    explícito: "Toda corrección conserva: pago original; valores anteriores
    y nuevos; motivo obligatorio; administrador; fecha; efecto explícito
    sobre cobertura. No se permite borrar ni sobrescribir el rastro
    original." -- por eso esta es una fila NUEVA que referencia al `Pago`
    corregido (`pago_id`), nunca un UPDATE silencioso sin huella. El `Pago`
    original SÍ se muta (los seis campos pasan a valer lo nuevo, mismo
    criterio que `HistorialEstadoMembresia` muta `Membresia.estado`), pero
    conserva su `id` -- a diferencia de `regularizar_deuda`, que crea un
    `Pago` nuevo, `corregir_pago` nunca crea una fila `Pago` adicional.

    Mismo patrón que `HistorialEstadoMembresia`, con una diferencia
    deliberada: acá `actor_persona_id` es NOT NULL. En
    `HistorialEstadoMembresia` es nullable porque el vencimiento lo dispara
    el sistema; una corrección financiera SIEMPRE la ejecuta un
    administrador -- no existe un camino del sistema que corrija plata por
    su cuenta.

    Los seis pares `*_anterior`/`*_nuevo` se registran SIEMPRE, incluso para
    los campos que un `corregir_pago` puntual no tocó (anterior == nuevo en
    ese caso): la fila describe el estado COMPLETO del pago antes y después
    de la operación, no solo el delta -- ver
    `PagoServicio.corregir_pago`. Columnas explícitas tipadas (no JSON),
    igual convención que el resto del repo.

    `efecto_cobertura` es el efecto EXPLÍCITO que el texto del issue exige:
    `PagoServicio.corregir_pago` lo calcula comparando `fecha_fin` anterior
    contra la nueva y lo persiste acá -- nunca queda implícito ni se deriva
    después, a partir de comparar dos filas."""

    __tablename__ = "correccion_pago"
    __table_args__ = (
        Index("ix_correccion_pago_pago_id", "pago_id"),
        Index("ix_correccion_pago_actor_persona_id", "actor_persona_id"),
        # Red de seguridad EN LA BASE (mismo criterio que
        # `ck_historial_estado_cambia`): una "corrección" que no cambia
        # ningún valor no es una corrección, es ruido en la auditoría. El
        # camino primario de rechazo es `PagoServicio.corregir_pago`; este
        # CHECK es la red de seguridad ante un INSERT que lo esquive.
        # `IS DISTINCT FROM` compara NULL-safe -- necesario porque
        # `tarifa_mensual_aplicada`/`meses_comprados`/`monto_base` son
        # nullable (snapshot ausente en pagos históricos pre-#400, ver
        # `Pago.tarifa_mensual_aplicada`).
        CheckConstraint(
            "tarifa_mensual_aplicada_anterior IS DISTINCT FROM tarifa_mensual_aplicada_nuevo"
            " OR meses_comprados_anterior IS DISTINCT FROM meses_comprados_nuevo"
            " OR monto_base_anterior IS DISTINCT FROM monto_base_nuevo"
            " OR monto_anterior IS DISTINCT FROM monto_nuevo"
            " OR fecha_inicio_anterior IS DISTINCT FROM fecha_inicio_nuevo"
            " OR fecha_fin_anterior IS DISTINCT FROM fecha_fin_nuevo",
            name="ck_correccion_pago_algun_campo_cambia",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    pago_id: Mapped[int] = mapped_column(ForeignKey("pago.id"))

    # --- Los seis campos financieros congelados de `Pago`, anterior/nuevo --
    # Nullable exactamente donde `Pago` lo es (tarifa/meses/monto_base
    # pueden faltar en un snapshot histórico pre-#400); NOT NULL donde
    # `Pago` lo exige (monto, fecha_inicio, fecha_fin).
    tarifa_mensual_aplicada_anterior: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(10, 2), nullable=True
    )
    tarifa_mensual_aplicada_nuevo: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(10, 2), nullable=True
    )
    meses_comprados_anterior: Mapped[Optional[int]] = mapped_column(nullable=True)
    meses_comprados_nuevo: Mapped[Optional[int]] = mapped_column(nullable=True)
    monto_base_anterior: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    monto_base_nuevo: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    monto_anterior: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    monto_nuevo: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    fecha_inicio_anterior: Mapped[date] = mapped_column(Date)
    fecha_inicio_nuevo: Mapped[date] = mapped_column(Date)
    fecha_fin_anterior: Mapped[date] = mapped_column(Date)
    fecha_fin_nuevo: Mapped[date] = mapped_column(Date)

    efecto_cobertura: Mapped[EfectoCoberturaCorreccion] = mapped_column(
        SAEnum(EfectoCoberturaCorreccion)
    )
    motivo: Mapped[str] = mapped_column(String(255))
    # NOT NULL a propósito (a diferencia de `HistorialEstadoMembresia.
    # actor_persona_id`): ver docstring de la clase.
    actor_persona_id: Mapped[int] = mapped_column(ForeignKey("persona.id"))
    fecha_registro: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_ahora_utc)


class HistorialCambioPlanMembresia(Base):
    """Huella auditable de un cambio de tipo de membresía sobre una membresía
    YA existente (issue #400, criterio 1).

    Por qué existe: `crear_membresia` bloquea una segunda membresía activa o
    suspendida por persona (`MENSAJE_MEMBRESIA_ACTIVA_DUPLICADA`), así que
    cambiar de plan no puede resolverse dando de baja la membresía vieja y
    creando una nueva -- el club pidió una operación PROSPECTIVA sobre la
    MISMA membresía (`MembresiaServicio.cambiar_plan`): cambia
    `tipo_membresia_id` (y la tarifa que copia); la cobertura ya pagada
    (fechas de `Pago`/`CoberturaBonificada` ya aprobados) no se toca.

    No reutiliza `HistorialEstadoMembresia`: esa tabla audita transiciones de
    ESTADO (columnas `estado_anterior`/`estado_nuevo`, con un CHECK que exige
    que difieran) -- un cambio de plan no toca `Membresia.estado` en
    absoluto, así que forzarlo ahí exigiría inventar un par de estados
    iguales que el propio CHECK `ck_historial_estado_cambia` rechazaría, o
    mentir con un "estado antes/después" que no cambió. Mismo criterio de
    "una tabla por tipo de hecho auditado" que ya separa `CorreccionPago`
    (campos financieros de un `Pago`) de `HistorialEstadoMembresia` (estado
    de una `Membresia`) -- esta es la tercera: el TIPO DE PLAN de una
    `Membresia`.

    `actor_persona_id` NOT NULL (igual que `CorreccionPago`, a diferencia de
    `HistorialEstadoMembresia`): no existe ningún camino del sistema que
    cambie un plan por su cuenta, siempre lo decide un administrador."""

    __tablename__ = "historial_cambio_plan_membresia"
    __table_args__ = (
        Index("ix_historial_cambio_plan_membresia_membresia_id", "membresia_id"),
        Index("ix_historial_cambio_plan_membresia_actor_persona_id", "actor_persona_id"),
        # `test_indices_fk.py` exige cobertura de índice en TODA FK, no solo
        # en las de "quién"/"a qué fila madre" -- los dos punteros a
        # `tipo_membresia` también se consultarán filtrando por plan
        # (ej. "cuántos cambios de plan salieron/entraron a este tipo").
        Index("ix_historial_cambio_plan_membresia_tipo_membresia_id_anterior", "tipo_membresia_id_anterior"),
        Index("ix_historial_cambio_plan_membresia_tipo_membresia_id_nuevo", "tipo_membresia_id_nuevo"),
        # Red de seguridad EN LA BASE (mismo criterio que
        # `ck_historial_estado_cambia`/`ck_correccion_pago_algun_campo_
        # cambia`): un "cambio de plan" que deja el mismo tipo no es un
        # cambio, es ruido en la auditoría. El camino primario de rechazo es
        # `MembresiaServicio.cambiar_plan`; este CHECK es la red de
        # seguridad ante un INSERT que lo esquive.
        CheckConstraint(
            "tipo_membresia_id_anterior <> tipo_membresia_id_nuevo",
            name="ck_historial_cambio_plan_cambia",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    membresia_id: Mapped[int] = mapped_column(ForeignKey("membresia.id"))
    tipo_membresia_id_anterior: Mapped[int] = mapped_column(ForeignKey("tipo_membresia.id"))
    tipo_membresia_id_nuevo: Mapped[int] = mapped_column(ForeignKey("tipo_membresia.id"))
    actor_persona_id: Mapped[int] = mapped_column(ForeignKey("persona.id"))
    fecha_registro: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_ahora_utc)


# ---------------------------------------------------------------------------
# Descuento (issue #11, modelo firmado docs/product/concepto-alcance-modelo.md §4)
#
# Catálogo VIVO administrado por el club (CRUD del admin). Sin motor de
# reglas: el sistema no calcula elegibilidad, el admin decide. La aplicación
# a un pago concreto, con su valor congelado, vive en las columnas
# `descuento_*` de `Pago` de arriba -- no en una tabla de aplicaciones aparte.
# ---------------------------------------------------------------------------
class Descuento(Base):
    __tablename__ = "descuento"
    # Invariantes del catálogo EN LA BASE (mismo criterio que issue #8: el
    # chequeo del DTO/servicio es el camino primario de error, el CHECK es la
    # red de seguridad ante escrituras que lo burlen):
    #   - exactamente UNO de porcentaje/monto definido (XOR);
    #   - porcentaje en (0, 100]; monto fijo positivo.
    __table_args__ = (
        CheckConstraint(
            "(porcentaje IS NULL) <> (monto IS NULL)",
            name="ck_descuento_porcentaje_o_monto",
        ),
        CheckConstraint(
            "porcentaje IS NULL OR (porcentaje > 0 AND porcentaje <= 100)",
            name="ck_descuento_porcentaje_en_rango",
        ),
        CheckConstraint(
            "monto IS NULL OR monto > 0",
            name="ck_descuento_monto_positivo",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100), unique=True)
    porcentaje: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2), nullable=True)
    monto: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    # Baja SUAVE: un descuento que deja de ofrecerse se DESACTIVA, nunca se
    # borra -- los pagos que lo aplicaron lo referencian por FK y el club
    # conserva la historia (misma filosofía que `Persona.activo`).
    activo: Mapped[bool] = mapped_column(Boolean, default=True)


class AsignacionDescuento(Base):
    """Beneficio personal asignado por un administrador a una persona
    (issue #398): el descuento deja de ser una elección del pago y pasa a
    ser un hecho que el club concede, vigente hasta que alguien lo retire.

    Por qué pertenece a la PERSONA y no a la membresía: debe sobrevivir a
    renovaciones y cambios de plan -- lo mismo que ya decidió `Membresia`
    (ver su docstring de asociación con `Pago`), pero un nivel más arriba.

    Por qué "vigente" es `retirado_en IS NULL` y NO una columna `activo`
    booleana aparte: dos columnas contando el mismo hecho (un booleano y un
    timestamp) es la forma exacta en que un modelo miente -- se pueden
    escribir `activo=True, retirado_en=<fecha>` o `activo=False,
    retirado_en=NULL` y ninguna fila avisa que está mal. Con una sola
    columna, `retirado_en` ES el estado (NULL = vigente) Y el dato de
    auditoría (cuándo se retiró) al mismo tiempo. No puede desalinearse
    consigo misma.

    Invariantes en la base, mismo criterio que `uq_membresia_activa_por_
    persona` (auditoría hallazgo 7, issue #8): el chequeo del servicio que
    asigne el beneficio sigue siendo el camino primario de error (UX); el
    índice único parcial es la red de seguridad ante dos asignaciones
    concurrentes que lo burlen. Parcial a propósito -- el historial de
    beneficios retirados convive sin límite; el WHERE es el espejo exacto
    de "vigente".

    Retirar SIEMPRE anota actor y fecha (`ck_asignacion_retiro_completo`):
    un timestamp de retiro sin su actor, o un actor sin timestamp, sería un
    hecho histórico incompleto -- mismo criterio que `ck_pago_descuento_
    valor_congelado` en `Pago` más arriba. Esta tabla NUNCA toca `Pago`: el
    congelamiento del valor aplicado en cada pago es responsabilidad de
    `PagoServicio`, no de este modelo (issue #400 queda fuera de alcance
    acá a propósito).

    Creada por la migración `f3a9c8e2b615`.
    """

    __tablename__ = "asignacion_descuento"
    __table_args__ = (
        Index(
            "uq_asignacion_descuento_activa_por_persona",
            "persona_id",
            unique=True,
            postgresql_where=text("retirado_en IS NULL"),
        ),
        Index("ix_asignacion_descuento_persona_id", "persona_id"),
        Index("ix_asignacion_descuento_descuento_id", "descuento_id"),
        Index(
            "ix_asignacion_descuento_asignado_por_persona_id",
            "asignado_por_persona_id",
        ),
        Index(
            "ix_asignacion_descuento_retirado_por_persona_id",
            "retirado_por_persona_id",
        ),
        CheckConstraint(
            "(retirado_en IS NULL) = (retirado_por_persona_id IS NULL)",
            name="ck_asignacion_retiro_completo",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    persona_id: Mapped[int] = mapped_column(ForeignKey("persona.id"), nullable=False)
    descuento_id: Mapped[int] = mapped_column(ForeignKey("descuento.id"), nullable=False)

    # Toda asignación tiene un administrador detrás -- nunca nullable, a
    # diferencia de `HistorialEstadoMembresia.actor_persona_id` (que sí
    # admite transiciones disparadas por el sistema). Acá no existe una
    # asignación "automática": siempre la decide una persona.
    asignado_por_persona_id: Mapped[int] = mapped_column(
        ForeignKey("persona.id"), nullable=False
    )
    asignado_por: Mapped["Persona"] = relationship(
        foreign_keys=[asignado_por_persona_id]
    )
    asignado_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_ahora_utc
    )

    @property
    def asignado_por_nombre(self) -> str:
        """Nombre del admin que concedió el beneficio, expuesto como
        `asignado_por_nombre` en `AsignacionDescuentoResponseDTO` (issue
        #714). Mismo criterio que `Asistencia.registrado_por_nombre` y
        `CorreccionAsistencia.corregido_por_nombre`: el nombre de un actor se
        resuelve ACÁ, nunca en el frontend, que si no termina pintando el id
        crudo -- el panel "Beneficio del club" mostraba literalmente
        "Asignado por persona #1".

        No es `Optional`, a diferencia de `registrado_por_nombre`: esta FK es
        NOT NULL (ver el comentario de la columna), así que la relación
        siempre resuelve. Mismo par que `corregido_por_nombre`, el hermano no
        nullable del patrón.

        Se resuelve por lazy load: los dos únicos consumidores
        (`BeneficioServicio.a_response_dto` y
        `PagoServicio._a_cobertura_response_dto`) convierten UNA fila cada
        uno, así que no hay listado donde esto pudiera degenerar en un N+1.
        """
        return f"{self.asignado_por.nombres} {self.asignado_por.apellidos}".strip()

    # Nullable: NULL es "todavía vigente". Ver el docstring de la clase para
    # por qué esto reemplaza a un booleano `activo` separado.
    retirado_por_persona_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("persona.id"), nullable=True
    )
    retirado_en: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class CoberturaBonificada(Base):
    """Cobertura de membresía otorgada por un beneficio 100% personal
    (issue #400, slice 4d): cuando `AsignacionDescuento` cubre el monto base
    completo de un período, la persona no debe pagar nada -- pero "no pagar
    nada" NUNCA puede significar un `Pago` fabricado (método/comprobante
    inventados). Esta tabla es la fila auditable que reemplaza a esa
    invención: mismo espíritu que `HistorialEstadoMembresia` (huella de un
    hecho, nunca reconstruible desde otra tabla).

    Por qué NO es una fila de `Pago` con un `TipoPago` nuevo: `Pago.tipo_pago`
    ya carga un significado que no es "cobro" (`REGULARIZACION`, bookkeeping
    del admin) y CADA consumidor de `Pago` (cola de validación, PDF, `reconciliar_
    comprobantes_faltantes`, reportes) tendría que recordar excluir un segundo
    caso. Una tabla dedicada hace "sin comprobante, sin voucher, sin PDF"
    estructuralmente cierto -- no un hecho que dependa de que cada consumidor
    lo recuerde.

    Por qué NO tiene `estado`/ciclo de vida (a diferencia de `Pago`, que nace
    PENDIENTE_VALIDACION): el derecho ya fue concedido antes, en la
    `AsignacionDescuento` que referencia (issue #398, admin-only). Aplicarlo a
    un período concreto es un hecho que se otorga completo de una sola vez --
    no hay paso de aprobación pendiente que modelar acá.

    `tarifa_mensual_aplicada`/`meses_comprados` son el mismo snapshot congelado
    que `Pago` (ver su docstring): la tarifa vigente al momento de otorgar,
    para que un cambio posterior al catálogo no reescriba el histórico.
    `asignacion_descuento_id` es el vínculo permanente al beneficio que hizo
    esto gratis -- a diferencia de `Pago.descuento_id` (que apunta al
    catálogo `Descuento`), acá interesa la CONCESIÓN concreta, no solo qué
    descuento era.

    `descuento_valor_aplicado`/`descuento_porcentaje_aplicado` (hallazgo del
    revisor) son el mismo congelamiento que `Pago.descuento_valor_aplicado`/
    `_porcentaje_aplicado`: el valor CALCULADO al otorgar, copiado -- no una
    referencia viva al catálogo. Sin esto, `DescuentoServicio.actualizar`
    editando el `Descuento` original DESPUÉS de otorgada esta cobertura
    reescribiría en los hechos cuánto valió (ej. de 100% a 50%), aunque el
    monto que la persona pagó por ella -- cero -- nunca cambió.
    `descuento_valor_aplicado` es NOT NULL: esta fila solo existe cuando el
    beneficio cubrió el 100%, así que el valor siempre se conoce al crearla
    (a diferencia de `Pago`, donde la columna es nullable porque un pago
    puede no llevar ningún descuento). `_porcentaje_aplicado` sigue siendo
    NULL cuando el descuento congelado era de monto fijo.

    `otorgada_por_persona_id` nombra a quien ejecutó "Aplicar beneficio" --
    por diseño (issue #400) es autoservicio del propio pagador o su
    representante, nunca un administrador actuando "por" ellos (ver
    `PagoServicio.aplicar_beneficio_bonificado`). El nombre de la columna
    queda neutro a propósito: si algún día las reglas de titularidad
    permitieran a un representante distinto actuar, la columna ya describe
    "quién ejecutó", no "el titular".

    Sin invariante en la base contra pisar la cobertura de un `Pago`
    aprobado: eso lo exige el pre-check de servicio
    (`PagoServicio._hay_cobertura_en_rango`, que consulta las DOS tablas),
    red de seguridad que Postgres no puede expresar como constraint entre
    dos tablas distintas.
    Lo que SÍ respalda la base es que esta tabla no se solape CONSIGO MISMA
    para la misma membresía (ver `ex_cobertura_bonificada_periodo_no_solapa`
    más abajo) -- mismo criterio que el resto del módulo (auditoría hallazgo
    7, issue #8): el pre-check del servicio es el camino primario de error,
    el constraint es la red ante la carrera que el pre-check no puede ver.

    Creada por la migración `b4736d8ac9ee`.
    """

    __tablename__ = "cobertura_bonificada"
    __table_args__ = (
        CheckConstraint(
            "meses_comprados > 0",
            name="ck_cobertura_bonificada_meses_positivo",
        ),
        # Red de seguridad (issue #8): dos otorgamientos concurrentes para la
        # MISMA membresía con períodos que se solapan no pueden coexistir --
        # el pre-check de servicio es el camino primario de error, esto es lo
        # que Postgres hace cumplir cuando dos transacciones lo esquivan.
        # Requiere la extensión `btree_gist` (habilitada por la misma
        # migración) para poder comparar `membresia_id` con `=` dentro de un
        # índice GiST.
        # `ddl_if(dialect="postgresql")`: los tests de siembra (`test_seed_dev_
        # base.py`/`test_seed_dev_bulk.py`) construyen `Base.metadata.create_
        # all()` contra SQLite en memoria -- un motor que no sabe compilar
        # `EXCLUDE USING gist` (no existe en SQLite). Sin este filtro,
        # `create_all()` revienta con `UnsupportedCompilationError` para
        # CUALQUIER tabla del esquema, no solo esta. El resto del módulo
        # (índices, CHECK, FKs) es SQL estándar y no necesita el filtro.
        ExcludeConstraint(
            (Column("membresia_id"), "="),
            (
                func.daterange(Column("fecha_inicio"), Column("fecha_fin"), text("'[)'")),
                "&&",
            ),
            name="ex_cobertura_bonificada_periodo_no_solapa",
            using="gist",
        ).ddl_if(dialect="postgresql"),
        Index("ix_cobertura_bonificada_membresia_id", "membresia_id"),
        Index("ix_cobertura_bonificada_persona_id", "persona_id"),
        Index(
            "ix_cobertura_bonificada_asignacion_descuento_id",
            "asignacion_descuento_id",
        ),
        Index(
            "ix_cobertura_bonificada_otorgada_por_persona_id",
            "otorgada_por_persona_id",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    membresia_id: Mapped[int] = mapped_column(ForeignKey("membresia.id"), nullable=False)
    persona_id: Mapped[int] = mapped_column(ForeignKey("persona.id"), nullable=False)
    asignacion_descuento_id: Mapped[int] = mapped_column(
        ForeignKey("asignacion_descuento.id"), nullable=False
    )

    tarifa_mensual_aplicada: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    meses_comprados: Mapped[int] = mapped_column(Integer, nullable=False)
    # Congelamiento del valor del descuento (hallazgo del revisor, ver
    # docstring de la clase): copia del cálculo de `_congelar_beneficio_
    # activo` al momento de otorgar, nunca una referencia viva al catálogo.
    descuento_valor_aplicado: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    descuento_porcentaje_aplicado: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(5, 2), nullable=True
    )
    fecha_inicio: Mapped[date] = mapped_column(Date, nullable=False)
    fecha_fin: Mapped[date] = mapped_column(Date, nullable=False)

    otorgada_por_persona_id: Mapped[int] = mapped_column(
        ForeignKey("persona.id"), nullable=False
    )
    otorgada_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_ahora_utc
    )


class ComprobantePago(Base):
    __tablename__ = "comprobante_pago"
    id: Mapped[int] = mapped_column(primary_key=True)
    # Mismo criterio que `Pago.voucher_url` (ver ese docstring): desde el fix
    # de privacidad "voucher no enumerable" guarda el `public_id` de un
    # recurso `type="authenticated"`, no una URL, pese al nombre de la
    # columna.
    archivo_url: Mapped[str] = mapped_column(String(255))
    formato_archivo: Mapped[str] = mapped_column(String(20))
    fecha_carga: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_ahora_utc)

    pago_id: Mapped[int] = mapped_column(ForeignKey("pago.id"), unique=True)
    pago: Mapped["Pago"] = relationship(back_populates="comprobante")


# ---------------------------------------------------------------------------
# Asistencia y Horarios
# ---------------------------------------------------------------------------
class CategoriaHorario(Base):
    """Catálogo de categorías de horario (antes un `dict` congelado en
    `app.dominio.categoria_metadata.CATEGORIA_METADATA`, movido a tabla para
    que el club pueda sumar una categoría nueva sin un deploy de código).

    Esta es la ÚNICA fuente de `hora_inicio`/`hora_fin`/días permitidos:
    `HorarioEntrenamiento.hora_inicio`/`hora_fin` siempre se derivan de acá
    y el cliente nunca puede enviarlos directamente (ver
    `asistencia_schemas.HorarioCreateDTO` y
    `AsistenciaServicio._validar_dia_y_derivar_horas`) -- la garantía que ya
    existía con el enum no cambia, solo cambia de dónde se lee.

    ABM del admin (docs/archive/fixes/24-abm-categorias.md): `AsistenciaServicio.
    crear_categoria`/`actualizar_categoria`/`eliminar_categoria` son el
    único camino de escritura -- alta atómica de la fila + sus
    `categoria_horario_dia` + un `horario_entrenamiento` por día marcado,
    todo en una transacción. `codigo` lo deriva el servidor del nombre
    (ver `_generar_codigo_categoria`) y es INMUTABLE una vez creado: es la
    FK de `horario_entrenamiento.categoria`, así que un rename solo toca
    `label`, nunca `codigo`. `label` es único en la base (red de
    seguridad; el servicio ya rechaza el duplicado con un mensaje legible
    antes de llegar acá) -- ver migración `f1a2b3c4d5e6`.
    """
    __tablename__ = "categoria_horario"
    __table_args__ = (
        UniqueConstraint("label", name="uq_categoria_horario_label"),
    )
    codigo: Mapped[str] = mapped_column(String(20), primary_key=True)
    label: Mapped[str] = mapped_column(String(50))
    hora_inicio: Mapped[time] = mapped_column(Time)
    hora_fin: Mapped[time] = mapped_column(Time)

    dias_permitidos: Mapped[List["CategoriaHorarioDia"]] = relationship(
        back_populates="categoria", cascade="all, delete-orphan"
    )


class CategoriaHorarioDia(Base):
    """Un día de semana permitido para una `CategoriaHorario`.

    Tabla relacional (no una columna array) a propósito: reutiliza el mismo
    tipo enum Postgres `diasemana` que ya respalda
    `HorarioEntrenamiento.dia_semana`, así que cada fila queda tan
    consultable y restringida por tipo como el resto del esquema en vez de
    depender de que el array nunca reciba un valor fuera de `DiaSemana`.
    """
    __tablename__ = "categoria_horario_dia"
    categoria_codigo: Mapped[str] = mapped_column(
        String(20), ForeignKey("categoria_horario.codigo"), primary_key=True
    )
    dia_semana: Mapped[DiaSemana] = mapped_column(SAEnum(DiaSemana), primary_key=True)

    categoria: Mapped["CategoriaHorario"] = relationship(back_populates="dias_permitidos")


class HorarioEntrenamiento(Base):
    """
    Sin entrenador titular: el club no asigna entrenadores a horarios -- la
    clase la da el entrenador disponible (docs/product/concepto-alcance-modelo.md §4).
    """
    __tablename__ = "horario_entrenamiento"
    id: Mapped[int] = mapped_column(primary_key=True)
    # FK a `categoria_horario.codigo` (cutover: hasta acá era un
    # `SAEnum(Categoria)` directo, con la columna de transición
    # `categoria_codigo` viviendo en paralelo desde el paso "expand" --
    # ver `a4e7c2f9b1d8`). Bloquea dia_semana/hora_inicio/hora_fin a los
    # valores canónicos de la fila de categoría -- ver validación en
    # `AsistenciaServicio.crear_horario`/`actualizar_horario`. Se guarda
    # como `str` liso (no `Mapped[Categoria]`): `Categoria` sigue
    # existiendo como el enum que hoy gatea qué códigos acepta la API
    # (alta/edición de categorías queda fuera de este cambio), pero la
    # columna en sí ya no depende de un tipo Postgres enum fijo.
    categoria: Mapped[str] = mapped_column(String(20), ForeignKey("categoria_horario.codigo"))
    dia_semana: Mapped[DiaSemana] = mapped_column(SAEnum(DiaSemana))
    hora_inicio: Mapped[time] = mapped_column(Time)
    hora_fin: Mapped[time] = mapped_column(Time)

    asistencias: Mapped[List["Asistencia"]] = relationship(back_populates="horario")
    alumno_horarios: Mapped[List["AlumnoHorario"]] = relationship(back_populates="horario")

    # Invariante de negocio EN LA BASE (INS-3, decisión de negocio #5,
    # 2026-08-11): una sola fila por (categoria, dia_semana). Las horas de
    # un horario se derivan de la categoria (ver `AsistenciaServicio.
    # _validar_dia_y_derivar_horas`), así que dos filas Formativo-Lunes
    # serían idénticas -- no existe el caso legítimo de "dos grupos el mismo
    # día". El chequeo de `AsistenciaServicio.crear_horario` sigue siendo el
    # camino primario de error (mensaje legible); este UNIQUE es la red de
    # seguridad ante escrituras concurrentes que lo burlen -- mismo patrón
    # que `uq_alumno_horario` arriba. A diferencia de esa, ESTA sí necesitó
    # migración (`b7e4a9f2c6d1`), que además colapsa los duplicados
    # preexistentes -- ver el comentario de esa migración para la regla de
    # limpieza.
    __table_args__ = (
        Index("ix_horario_entrenamiento_categoria", "categoria"),
        UniqueConstraint("categoria", "dia_semana", name="uq_horario_categoria_dia"),
    )


class Asistencia(Base):
    """
    No registra quién DICTÓ la sesión: los entrenadores cobran un mensual
    fijo y ese dato no tiene consumidor (docs/product/concepto-alcance-modelo.md §4).

    Matiz (#263): SÍ registra quién TOMÓ la lista, en `registrado_por_id` -- FK
    a `persona.id` (la identidad del sistema es `persona_id`, no `usuario_id`;
    el JWT la trae y `Asistencia` ya usaba `persona_id` para el alumno). Quién
    corrige DESPUÉS es un follow-up documentado, FUERA de este alcance (no
    existe columna `corregido_por`).

    `uq_asistencia_persona_horario_fecha` (#389): el servicio ya trataba
    (persona_id, horario_id, fecha_entrenamiento) como clave de upsert, pero
    nada a nivel de base lo hacía cumplir -- dos requests concurrentes para
    el mismo alumno podían pasar ambas el chequeo "no existe todavía" y crear
    dos filas, esquivando el cierre de sesión por timing. El constraint es la
    red de seguridad real; el servicio sigue chequeando primero para dar un
    mensaje legible.
    """
    __tablename__ = "asistencia"
    __table_args__ = (
        Index("ix_asistencia_persona_id", "persona_id"),
        Index("ix_asistencia_horario_id", "horario_id"),
        Index("ix_asistencia_registrado_por_id", "registrado_por_id"),
        UniqueConstraint(
            "persona_id", "horario_id", "fecha_entrenamiento",
            name="uq_asistencia_persona_horario_fecha",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    fecha_entrenamiento: Mapped[date] = mapped_column(Date)
    fecha_registro: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_ahora_utc)
    estado: Mapped[EstadoAsistencia] = mapped_column(SAEnum(EstadoAsistencia))
    justificativo: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    estado_justificativo: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)

    persona_id: Mapped[int] = mapped_column(ForeignKey("persona.id"))
    # `foreign_keys` explícito: ver `Persona.asistencias` -- misma ambigüedad
    # (dos FKs a `persona.id`), mismo motivo.
    persona: Mapped["Persona"] = relationship(
        back_populates="asistencias", foreign_keys=[persona_id]
    )

    horario_id: Mapped[int] = mapped_column(ForeignKey(_HORARIO_FK))
    horario: Mapped["HorarioEntrenamiento"] = relationship(back_populates="asistencias")

    # Quién tomó la lista (#263). Nullable a propósito: las filas históricas no
    # tienen autor conocido (sin backfill falso) y se muestran como "No
    # registrado". Se setea SOLO en la rama de creación de `registrar_asistencia`
    # (la identidad viene del token, nunca del DTO); la corrección (#262) NO lo
    # pisa.
    registrado_por_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("persona.id"), nullable=True,
    )
    registrado_por: Mapped[Optional["Persona"]] = relationship(
        foreign_keys=[registrado_por_id]
    )

    @property
    def registrado_por_nombre(self) -> Optional[str]:
        """Nombre de quien tomó la lista, expuesto como `registrado_por_nombre`
        en `AsistenciaResponseDTO` (from_attributes). `None` para las filas
        históricas sin autor. La relación `registrado_por` va eager-loaded en
        los listados del repositorio (evita N+1); en la creación (una sola fila)
        se resuelve por lazy load."""
        autor = self.registrado_por
        if autor is None:
            return None
        return f"{autor.nombres} {autor.apellidos}".strip()

    @property
    def persona_nombre_completo(self) -> str:
        """Nombre completo de la persona, expuesto como `personaNombreCompleto`
        en `AsistenciaResponseDTO` (issue #358). Reemplaza el rodeo que hacía
        el BFF (`fetchPersonaNameMap`, attendance-adapter.ts): pedir la ficha
        completa por `GET /personas/{id}` -- cédula, teléfono, fecha de
        nacimiento incluidos -- solo para pintar este nombre en "revisar
        listas". `persona_id` es FK NOT NULL, así que `self.persona` siempre
        resuelve. Mismo criterio de eager-load que `registrado_por_nombre`:
        va joinedloaded en los listados del repositorio (evita N+1); en la
        creación (una sola fila) se resuelve por lazy load."""
        return f"{self.persona.nombres} {self.persona.apellidos}".strip()


class SesionAsistencia(Base):
    """Marca el CIERRE atómico de una sesión de asistencia (issue #389,
    slice 1 de la cadena). Una fila = una sesión cerrada, donde "sesión" es
    el par (`horario_id`, `fecha_entrenamiento`) -- `Asistencia` no tenía
    ningún otro concepto de sesión (no existe una tabla "clase del día"
    previa a este cambio), así que ese par ES la sesión.

    El cierre es ATÓMICO y RACE-SAFE por el `UniqueConstraint` de abajo,
    mismo patrón que `HorarioEntrenamiento.uq_horario_categoria_dia` (líneas
    620-635): el chequeo del servicio
    (`AsistenciaServicio.registrar_asistencia`) sigue siendo el camino
    primario de error, y el UNIQUE es la red de seguridad ante dos primeras
    inserciones concurrentes para el mismo par -- solo una gana, la otra
    relee la fila que la ganadora ya creó en vez de fallar (ver
    `SesionAsistenciaRepositorio.obtener_o_crear_cerrada`).

    NO es todavía la traza de auditoría de corrección que pide el issue
    (quién/cuándo/motivo/valor anterior de CADA corrección): eso vive en
    `asistencia_correccion`, una tabla distinta que llega en un slice
    posterior de esta misma cadena. Esta tabla solo responde "¿esta sesión
    ya se cerró, quién la cerró y cuándo?" -- una vez que existe la fila, la
    sesión queda cerrada para siempre: nadie vuelve a tomar lista ahí, ni
    un ADMINISTRADOR (`registrar_asistencia` rechaza con `OperacionInvalida`
    cualquier alumno que ya tenga fila de `Asistencia` en esa sesión, sin
    excepción de rol -- a diferencia del tope de 30 días que existía antes
    de este slice, que sí dejaba una puerta abierta).

    `cerrada_por_id` es NOT NULL a propósito (a diferencia de
    `Asistencia.registrado_por_id`, nullable por filas históricas sin autor
    conocido): esta tabla nace junto con este slice, así que no hay
    historia previa sin autor -- siempre es la persona cuyo primer INSERT
    exitoso de `Asistencia` disparó el cierre de la sesión. Sin
    `ondelete="CASCADE"`: mismo criterio que `ConsultaFichaEmergencia`
    (líneas 780-817) y el resto del archivo -- `Persona` se da de baja
    LÓGICA (`Persona.activo`), nunca se borra, así que la cascada nunca
    dispararía y agregarla sería documentar un caso que no puede pasar.
    """

    __tablename__ = "sesion_asistencia"
    __table_args__ = (
        UniqueConstraint(
            "horario_id", "fecha_entrenamiento", name="uq_sesion_asistencia_horario_fecha",
        ),
        # Cobertura de la FK `cerrada_por_id` (`test_indices_fk.py`, guardia
        # de índices de cobertura de FK del proyecto): `horario_id` ya queda
        # cubierto por ser la columna más a la izquierda del UNIQUE de
        # arriba, mismo criterio que `AlumnoHorario.uq_alumno_horario`.
        Index("ix_sesion_asistencia_cerrada_por_id", "cerrada_por_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    horario_id: Mapped[int] = mapped_column(ForeignKey(_HORARIO_FK))
    fecha_entrenamiento: Mapped[date] = mapped_column(Date)
    cerrada_por_id: Mapped[int] = mapped_column(ForeignKey("persona.id"), nullable=False)
    cerrada_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_ahora_utc, nullable=False,
    )

    horario: Mapped["HorarioEntrenamiento"] = relationship()
    cerrada_por: Mapped["Persona"] = relationship(foreign_keys=[cerrada_por_id])


class AsistenciaCorreccion(Base):
    """Traza de auditoría de CORRECCIÓN (issue #389, slice 2), la tabla que
    el docstring de `SesionAsistencia` ya anunciaba como pendiente.
    Append-only: cada corrección exitosa de
    `AsistenciaServicio.corregir_asistencia` agrega una fila nueva, nunca
    actualiza una existente.

    Guarda el valor ANTERIOR de los tres campos que una corrección puede
    tocar; el valor NUEVO ya vive en la fila mutada de `Asistencia` --
    duplicarlo acá daría dos fuentes de verdad que podrían desincronizarse.

    Sin `ondelete="CASCADE"` en ninguna FK, mismo criterio que
    `ConsultaFichaEmergencia`/`SesionAsistencia`: `Asistencia` nunca se
    borra (siempre queda como historial) y `Persona` se da de baja LÓGICA
    (`Persona.activo`), así que la cascada nunca dispararía."""

    __tablename__ = "asistencia_correccion"
    __table_args__ = (
        # Historial de esta fila, más reciente primero -- mismo criterio
        # que `ix_consulta_ficha_emergencia_alumno_consultada`. Cubre
        # también la FK `asistencia_id` (columna más a la izquierda).
        Index(
            "ix_asistencia_correccion_asistencia_corregido_en",
            "asistencia_id", "corregido_en",
        ),
        # Cobertura de la FK `corregido_por_id` (`test_indices_fk.py`).
        Index("ix_asistencia_correccion_corregido_por_id", "corregido_por_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    asistencia_id: Mapped[int] = mapped_column(ForeignKey("asistencia.id"), nullable=False)
    corregido_por_id: Mapped[int] = mapped_column(ForeignKey("persona.id"), nullable=False)
    corregido_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_ahora_utc, nullable=False,
    )
    # Ancho 500, no 255: mismo criterio que `Notificacion.MENSAJE_MAX` --
    # este proyecto ya tiene un incidente documentado de un techo de 255
    # truncando texto libre.
    motivo: Mapped[str] = mapped_column(String(500), nullable=False)
    estado_anterior: Mapped[EstadoAsistencia] = mapped_column(
        SAEnum(EstadoAsistencia), nullable=False,
    )
    justificativo_anterior: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    estado_justificativo_anterior: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)

    asistencia: Mapped["Asistencia"] = relationship()
    corregido_por: Mapped["Persona"] = relationship(foreign_keys=[corregido_por_id])

    @property
    def corregido_por_nombre(self) -> str:
        """Mismo criterio que `Asistencia.registrado_por_nombre`, sin
        `Optional`: `corregido_por_id` es NOT NULL (tabla nueva, sin
        historial previo sin autor)."""
        autor = self.corregido_por
        return f"{autor.nombres} {autor.apellidos}".strip()


# ---------------------------------------------------------------------------
# Asignación directa Alumno ↔ Horario (muchos a muchos)
# Permite que dos alumnos en el mismo nivel asistan a horarios distintos.
# ---------------------------------------------------------------------------
class AlumnoHorario(Base):
    __tablename__ = "alumno_horario"
    # El par (persona_id, horario_id) es único: la fila NO lleva ningún dato
    # que pudiera distinguir dos asignaciones del mismo alumno al mismo
    # horario (solo `id` y `fecha_asignacion`), y
    # `AsistenciaServicio.asignar_alumno_a_horario` ya rechaza el duplicado
    # con `OperacionInvalida`. La restricción existe en la base desde
    # `b2c3d4e5f6a7` y se declara acá para que el modelo la refleje: es la
    # red de seguridad ante escrituras concurrentes que burlen el chequeo
    # previo del servicio. No hace falta migración — la base ya la tiene.
    __table_args__ = (
        UniqueConstraint("persona_id", "horario_id", name="uq_alumno_horario"),
        Index("ix_alumno_horario_horario_id", "horario_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    persona_id: Mapped[int] = mapped_column(ForeignKey("persona.id"))
    horario_id: Mapped[int] = mapped_column(ForeignKey(_HORARIO_FK))
    fecha_asignacion: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_ahora_utc)

    persona: Mapped["Persona"] = relationship(back_populates="alumno_horarios")
    horario: Mapped["HorarioEntrenamiento"] = relationship(back_populates="alumno_horarios")


# ---------------------------------------------------------------------------
# Ficha médica
# ---------------------------------------------------------------------------
class FichaMedica(Base):
    __tablename__ = "ficha_medica"
    id: Mapped[int] = mapped_column(primary_key=True)
    tipo_sangre: Mapped[TipoSangre] = mapped_column(SAEnum(TipoSangre))

    # --- Campos agregados: el frontend los necesita para su ficha de
    # emergencia (alergias + a quién/cómo contactar), y no existían en el
    # modelo original. Los tres son opcionales: una ficha médica puede
    # registrarse sin esta información y completarse después.
    alergias: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    contacto_emergencia: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    telefono_emergencia: Mapped[Optional[str]] = mapped_column(String(15), nullable=True)

    persona_id: Mapped[int] = mapped_column(ForeignKey("persona.id"), unique=True)
    persona: Mapped["Persona"] = relationship(back_populates="ficha_medica")

    # 0..* : una ficha médica puede no tener ninguna enfermedad registrada.
    # cascade="all, delete-orphan": necesario para que reemplazar la lista
    # completa (PATCH de ficha médica) borre las filas antiguas en vez de
    # violar el NOT NULL de enfermedades.ficha_medica_id.
    enfermedades: Mapped[List["Enfermedades"]] = relationship(
        back_populates="ficha_medica", cascade="all, delete-orphan"
    )


class Enfermedades(Base):
    __tablename__ = "enfermedades"
    __table_args__ = (
        Index("ix_enfermedades_ficha_medica_id", "ficha_medica_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre_enfermedad: Mapped[str] = mapped_column(String(150))

    ficha_medica_id: Mapped[int] = mapped_column(ForeignKey("ficha_medica.id"))
    ficha_medica: Mapped["FichaMedica"] = relationship(back_populates="enfermedades")


class ConsultaFichaEmergencia(Base):
    """Registro OBSERVACIONAL de una consulta a la ficha de emergencia
    (issue #360). No decide nada -- igual que `Sesion` (#303), a la que este
    modelo copia el patrón a propósito.

    El club no asigna entrenadores a horarios (modelo líneas 597-598,
    `docs/product/concepto-alcance-modelo.md §4`), así que cualquier
    ENTRENADOR puede consultar la ficha de emergencia de cualquier alumno: el
    acceso se acota por QUÉ DATO expone el DTO, no por a quién se le permite
    pedirlo. Esta tabla es la protección posterior -- quién miró el dato de
    quién, y cuándo -- no una compuerta previa: el issue pide explícitamente
    "sin fricción" para no perder segundos en una emergencia real.

    Nunca se lee para autorizar nada: si algún día se consultara para decidir
    acceso, se habría movido un control de seguridad a una tabla que nació
    para auditar.
    """

    __tablename__ = "consulta_ficha_emergencia"
    __table_args__ = (
        # El acceso esperado es "quién consultó a este alumno, más reciente
        # primero" -- mismo criterio que `ix_sesion_usuario_iniciada`.
        Index("ix_consulta_ficha_emergencia_alumno_consultada", "alumno_persona_id", "consultada_en"),
        # Cobertura de la segunda FK (`test_indices_fk.py`, guardia de índices
        # de cobertura de FK del proyecto): sin esta, un borrado o consulta
        # por `consultante_persona_id` hace table scan.
        Index("ix_consulta_ficha_emergencia_consultante_persona_id", "consultante_persona_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    alumno_persona_id: Mapped[int] = mapped_column(ForeignKey("persona.id"), nullable=False)
    consultante_persona_id: Mapped[int] = mapped_column(ForeignKey("persona.id"), nullable=False)
    consultada_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_ahora_utc, nullable=False,
    )

    alumno: Mapped["Persona"] = relationship(foreign_keys=[alumno_persona_id])
    consultante: Mapped["Persona"] = relationship(foreign_keys=[consultante_persona_id])


# ---------------------------------------------------------------------------
# Notificación in-app. Genérica a propósito: no se acopla a un único flujo,
# para poder reutilizarse en otros procesos del sistema (ej. vencimiento de
# membresía, ver `alertas_tareas.py`).
# ---------------------------------------------------------------------------
class Notificacion(Base):
    __tablename__ = "notificacion"
    __table_args__ = (
        Index("ix_notificacion_persona_id", "persona_id"),
            Index("uq_notificacion_enrollment_outbox_id", "enrollment_outbox_id", unique=True, postgresql_where=text("enrollment_outbox_id IS NOT NULL")),
    )

    # Ancho real, no un número elegido al azar. El peor caso conocido con los
    # anchos actuales de columna es un rechazo de pago: hasta 255 caracteres
    # de motivo (tope de `PagoValidarDTO.motivo_rechazo`) reenviados al
    # representante con el nombre completo del alumno por delante (hasta 100
    # + 100 de `Persona.nombres`/`apellidos`) -- unos 488 caracteres. 500 deja
    # margen sin convertir la columna en un campo sin límite real (hallazgo en
    # vivo, 2026-08-11: con el VARCHAR(255) anterior, un rechazo con nota de
    # ~230+ caracteres hacía que el INSERT de esta fila tirara un `DataError`
    # DESPUÉS de que el rechazo del pago ya estaba commiteado en Postgres).
    MENSAJE_MAX = 500

    id: Mapped[int] = mapped_column(primary_key=True)
    tipo: Mapped[TipoNotificacion] = mapped_column(SAEnum(TipoNotificacion))
    mensaje: Mapped[str] = mapped_column(String(MENSAJE_MAX))
    leida: Mapped[bool] = mapped_column(Boolean, default=False)
    fecha_creacion: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_ahora_utc)
    # Id de la entidad relacionada (ej. la Membresia o el Pago que originó
    # la notificación), sin FK estricta porque el tipo de entidad varía
    # según `tipo` -- mantenerlo simple evita una jerarquía de tablas.
    entidad_relacionada_id: Mapped[Optional[int]] = mapped_column(nullable=True)
    enrollment_outbox_id: Mapped[Optional[int]] = mapped_column(nullable=True)

    persona_id: Mapped[int] = mapped_column(ForeignKey("persona.id"))
    persona: Mapped["Persona"] = relationship(back_populates="notificaciones")

    @validates("mensaje")
    def _recortar_mensaje(self, key: str, value: str) -> str:
        """Último resorte, no la estrategia: cada sitio que arma un mensaje ya
        acorta lo que le agrega (nombres de persona, ver
        `notificacion_servicio.acortar_nombre_para_notificacion`) para que la
        columna nunca tenga que enterarse. Esto atrapa lo que ese cuidado no
        previó -- de cualquier escritor presente o futuro, incluidos los que
        no pasan por `NotificacionRepositorio` (ej. `alertas_tareas.py`, que
        hace `db.add_all(...)` directo) -- así un mensaje inesperadamente
        largo se recorta con un aviso en el log en vez de tirar el
        `DataError` post-commit que motivó este candado."""
        if value is not None and len(value) > self.MENSAJE_MAX:
            _log.warning(
                "Notificacion.mensaje recortado de %d a %d caracteres (tipo=%s, persona_id=%s)",
                len(value), self.MENSAJE_MAX,
                getattr(self, "tipo", None), getattr(self, "persona_id", None),
            )
            return value[: self.MENSAJE_MAX - 1].rstrip() + "…"
        return value


# ---------------------------------------------------------------------------
class EnrollmentNotificacionOutbox(Base):
    """Entrega durable de una notificación de inscripción."""
    __tablename__ = "enrollment_notificacion_outbox"
    __table_args__ = (
        Index("ix_enrollment_notif_outbox_pending_next", "status", "next_attempt_at"),
        Index("ix_enrollment_notif_outbox_admin", "admin_persona_id"),
        Index("ix_enrollment_notif_outbox_alumno", "alumno_persona_id"),
        UniqueConstraint("admin_persona_id", "alumno_persona_id", name="uq_enrollment_notif_outbox_admin_alumno"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    admin_persona_id: Mapped[int] = mapped_column(ForeignKey("persona.id"), nullable=False)
    alumno_persona_id: Mapped[int] = mapped_column(ForeignKey("persona.id"), nullable=False)
    mensaje: Mapped[str] = mapped_column(String(Notificacion.MENSAJE_MAX), nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="PENDIENTE")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_ahora_utc, nullable=False)
    claimed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_ahora_utc, nullable=False)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error_redacted: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)


# INS-2 (docs/product/decisiones-de-negocio-2026-08-11.md §1): un representante puede
# vincular a su cuenta un representado YA EXISTENTE escribiendo su cédula,
# sin que nadie apruebe. El guardarraíl de auditoría de esa decisión ("queda
# registrado quién vinculó a quién y cuándo") es esta tabla: una fila por
# vinculación, nunca actualizada ni borrada -- un log de eventos, no el
# estado actual (para eso está `Persona.representante_id`, que sí muta).
# ---------------------------------------------------------------------------
class Sponsor(Base):
    """Logo público administrado por el club; sin URL comercial ni estado extra."""
    __tablename__ = "sponsor"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(80))
    logo_url: Mapped[str] = mapped_column(String(500))
    # Identificador interno para retirar el recurso del proveedor al borrar.
    logo_public_id: Mapped[str] = mapped_column(String(64), unique=True)


class VinculacionRepresentante(Base):
    __tablename__ = "vinculacion_representante"
    __table_args__ = (
        Index("ix_vinculacion_representante_persona_id", "persona_id"),
        Index("ix_vinculacion_representante_representante_anterior_id", "representante_anterior_id"),
        Index("ix_vinculacion_representante_representante_nuevo_id", "representante_nuevo_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    fecha: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_ahora_utc)

    # El representado que cambió de cuenta.
    persona_id: Mapped[int] = mapped_column(ForeignKey("persona.id"))
    persona: Mapped["Persona"] = relationship(foreign_keys=[persona_id])

    # `None` cuando el representado no tenía representante legal antes de
    # esta vinculación (ej. se había independizado, o quedó huérfano de
    # representante por algún otro camino).
    representante_anterior_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("persona.id"), nullable=True
    )
    representante_anterior: Mapped[Optional["Persona"]] = relationship(
        foreign_keys=[representante_anterior_id]
    )

    representante_nuevo_id: Mapped[int] = mapped_column(ForeignKey("persona.id"))
    representante_nuevo: Mapped["Persona"] = relationship(foreign_keys=[representante_nuevo_id])


# ---------------------------------------------------------------------------
# Idempotencia de la autoinscripción pública
# ---------------------------------------------------------------------------
# Una fila por intento de inscripción, identificada por la clave de
# idempotencia. Deduplica reintentos y corta el reciclaje de una clave hacia
# otro alumno. TTL de 24h; la limpieza borra las filas vencidas.
class InscripcionIdempotencia(Base):
    __tablename__ = "inscripcion_idempotencia"
    __table_args__ = (
        Index("ix_inscripcion_idempotencia_persona_id", "persona_id"),
    )

    # La clave ES la PK: la base detiene carreras concurrentes.
    idempotency_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    estado: Mapped[str] = mapped_column(String(20), nullable=False)
    persona_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("persona.id"), nullable=True
    )
    persona: Mapped[Optional["Persona"]] = relationship()
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_ahora_utc, nullable=False
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    vence_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: _ahora_utc() + timedelta(hours=24),
        nullable=False,
    )


class RecuperacionOutbox(Base):
    __tablename__ = "recuperacion_outbox"
    __table_args__ = (
        Index("ix_recuperacion_outbox_pending_next", "status", "next_attempt_at"),
        Index("ix_recuperacion_outbox_usuario_id", "usuario_id"),
        Index(
            "uq_recuperacion_outbox_usuario_activo",
            "usuario_id",
            unique=True,
            postgresql_where=text("status IN ('PENDIENTE', 'ENVIANDO')"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuario.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="PENDIENTE")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_ahora_utc
    )
    claimed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_ahora_utc
    )
    sent_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_error_redacted: Mapped[Optional[str]] = mapped_column(
        String(500), nullable=True
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    usuario: Mapped["Usuario"] = relationship()
