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
from datetime import datetime, date, time, timezone
from decimal import Decimal
from typing import List, Optional

from sqlalchemy import (
    String, ForeignKey, Numeric, DateTime, Date, Time, Boolean, Integer, Table, Column,
    CheckConstraint, Index, UniqueConstraint, text,
    Enum as SAEnum,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.dominio.enums import (
    TipoRol, EstadoMembresia, TipoModalidad, EstadoPago,
    TipoPago, EstadoAsistencia, TipoEscuela, NivelTecnicoAlumno, TipoSangre, DiaSemana,
    TipoNotificacion,
    TipoManoDominante, Categoria,
)


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
    asistencias: Mapped[List["Asistencia"]] = relationship(back_populates="persona")
    # `foreign_keys` explícito: `Pago` ahora tiene DOS FKs a `persona.id`
    # (`persona_id` y `descuento_autorizado_por_persona_id`, issue #11
    # colapsado a columnas) -- sin esto, SQLAlchemy no puede elegir cuál usar
    # para esta relación y falla con `AmbiguousForeignKeysError`.
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
    # Invariante de negocio EN LA BASE (auditoría hallazgo 7, issue #8): una
    # sola membresía ACTIVA por persona. El chequeo de
    # `MembresiaServicio.crear_membresia` sigue siendo el camino primario de
    # error (UX); este índice único PARCIAL es la red de seguridad ante
    # escrituras concurrentes que lo burlen -- en particular dos
    # `validar_pago` simultáneos aprobando pagos de dos membresías INACTIVAS
    # de la misma persona. Parcial a propósito: el historial (VENCIDA,
    # INACTIVA) convive sin límite; el WHERE es el espejo exacto del chequeo
    # del servicio (`estado == ACTIVA`). Creado por la migración
    # `c3d9f2b7a1e5`.
    __table_args__ = (
        Index(
            "uq_membresia_activa_por_persona",
            "persona_id",
            unique=True,
            postgresql_where=text("estado = 'ACTIVA'"),
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
        # Espejo en la base del invariante que `PagoServicio._congelar_descuento`
        # ya respeta: un descuento congelado sin su valor sería un hecho
        # histórico incompleto. El servicio sigue siendo el camino primario de
        # error (mensaje claro); esto es la red de seguridad ante un INSERT que
        # lo esquive (mismo criterio que los CHECK de `Descuento` más abajo).
        CheckConstraint(
            "descuento_id IS NULL OR descuento_valor_aplicado IS NOT NULL",
            name="ck_pago_descuento_valor_congelado",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    monto: Mapped[Decimal] = mapped_column(Numeric(10, 2))
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
    # Auditoría de quién autorizó el descuento (issue #11: "el admin decide,
    # el sistema registra" -- ver `PagoServicio.registrar_pago`).
    descuento_autorizado_por_persona_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("persona.id"), nullable=True,
    )


# ---------------------------------------------------------------------------
# Descuento (issue #11, modelo firmado docs/concepto-alcance-modelo.md §4)
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


class ComprobantePago(Base):
    __tablename__ = "comprobante_pago"
    id: Mapped[int] = mapped_column(primary_key=True)
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

    Paso 1 de 2 (expand): esta tabla existe y está poblada, pero
    `HorarioEntrenamiento.categoria` TODAVÍA es el enum viejo -- nada lee de
    acá todavía. El cutover (leer `hora_inicio`/`hora_fin`/días permitidos
    de esta fila en vez del enum) es el PR siguiente, a propósito: este PR
    es aditivo puro y no cambia ningún comportamiento existente.

    Sin pantalla de alta/edición todavía (fuera de alcance de este cambio):
    hoy las filas solo las siembra la migración que creó esta tabla.
    """
    __tablename__ = "categoria_horario"
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
    clase la da el entrenador disponible (docs/concepto-alcance-modelo.md §4).
    """
    __tablename__ = "horario_entrenamiento"
    id: Mapped[int] = mapped_column(primary_key=True)
    # Categoría fija de negocio (Formativo/Infantil/Juvenil/Competitivo/Adultos)
    # que bloquea dia_semana/hora_inicio/hora_fin a los valores canónicos de
    # `app.dominio.categoria_metadata.CATEGORIA_METADATA` -- ver validación en
    # `AsistenciaServicio.crear_horario`/`actualizar_horario`.
    categoria: Mapped[Categoria] = mapped_column(SAEnum(Categoria))
    dia_semana: Mapped[DiaSemana] = mapped_column(SAEnum(DiaSemana))
    hora_inicio: Mapped[time] = mapped_column(Time)
    hora_fin: Mapped[time] = mapped_column(Time)
    # Paso "expand" (ver `CategoriaHorario`): FK nueva a `categoria_horario`,
    # ya backfilleada para toda fila existente, pero TODAVÍA sin uso -- ni
    # `AsistenciaServicio` ni ningún schema la leen o la escriben en este PR.
    # Nullable a propósito: una fila creada por el camino viejo (que no la
    # setea) no puede violar NOT NULL. Mapeada acá solo para que
    # `Base.metadata` coincida con lo que la migración `a4e7c2f9b1d8`
    # realmente crea (`test_drift_migraciones.py`). El cutover real
    # -- reemplazar `categoria` por esta columna y volverla NOT NULL -- es
    # el PR siguiente.
    categoria_codigo: Mapped[Optional[str]] = mapped_column(
        String(20), ForeignKey("categoria_horario.codigo"), nullable=True
    )

    asistencias: Mapped[List["Asistencia"]] = relationship(back_populates="horario")
    alumno_horarios: Mapped[List["AlumnoHorario"]] = relationship(back_populates="horario")

    __table_args__ = (
        Index("ix_horario_entrenamiento_categoria_codigo", "categoria_codigo"),
    )


class Asistencia(Base):
    """
    No registra quién dictó la sesión: los entrenadores cobran un mensual
    fijo y el dato no tiene consumidor (docs/concepto-alcance-modelo.md §4).
    """
    __tablename__ = "asistencia"
    __table_args__ = (
        Index("ix_asistencia_persona_id", "persona_id"),
        Index("ix_asistencia_horario_id", "horario_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    fecha_entrenamiento: Mapped[date] = mapped_column(Date)
    fecha_registro: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_ahora_utc)
    estado: Mapped[EstadoAsistencia] = mapped_column(SAEnum(EstadoAsistencia))
    justificativo: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    estado_justificativo: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)

    persona_id: Mapped[int] = mapped_column(ForeignKey("persona.id"))
    persona: Mapped["Persona"] = relationship(back_populates="asistencias")

    horario_id: Mapped[int] = mapped_column(ForeignKey(_HORARIO_FK))
    horario: Mapped["HorarioEntrenamiento"] = relationship(back_populates="asistencias")


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


# ---------------------------------------------------------------------------
# Notificación in-app. Genérica a propósito: no se acopla a un único flujo,
# para poder reutilizarse en otros procesos del sistema (ej. vencimiento de
# membresía, ver `alertas_tareas.py`).
# ---------------------------------------------------------------------------
class Notificacion(Base):
    __tablename__ = "notificacion"
    __table_args__ = (
        Index("ix_notificacion_persona_id", "persona_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tipo: Mapped[TipoNotificacion] = mapped_column(SAEnum(TipoNotificacion))
    mensaje: Mapped[str] = mapped_column(String(255))
    leida: Mapped[bool] = mapped_column(Boolean, default=False)
    fecha_creacion: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_ahora_utc)
    # Id de la entidad relacionada (ej. la Membresia o el Pago que originó
    # la notificación), sin FK estricta porque el tipo de entidad varía
    # según `tipo` -- mantenerlo simple evita una jerarquía de tablas.
    entidad_relacionada_id: Mapped[Optional[int]] = mapped_column(nullable=True)

    persona_id: Mapped[int] = mapped_column(ForeignKey("persona.id"))
    persona: Mapped["Persona"] = relationship(back_populates="notificaciones")
