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
    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100))
    pais_id: Mapped[int] = mapped_column(ForeignKey("pais.id"))

    pais: Mapped["Pais"] = relationship(back_populates="provincias")
    cantones: Mapped[List["Canton"]] = relationship(back_populates="provincia")


class Canton(Base):
    __tablename__ = "canton"
    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100))
    provincia_id: Mapped[int] = mapped_column(ForeignKey("provincia.id"))

    provincia: Mapped["Provincia"] = relationship(back_populates="cantones")
    direcciones: Mapped[List["Direccion"]] = relationship(back_populates="canton")


class Direccion(Base):
    __tablename__ = "direccion"
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


# ---------------------------------------------------------------------------
# Persona (entidad central, con relación reflexiva Representante/Representados)
# ---------------------------------------------------------------------------
class Persona(Base):
    __tablename__ = "persona"
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
    asistencias: Mapped[List["Asistencia"]] = relationship(
        back_populates="persona", foreign_keys="Asistencia.persona_id"
    )
    pagos: Mapped[List["Pago"]] = relationship(back_populates="persona")
    membresias: Mapped[List["Membresia"]] = relationship(back_populates="persona")
    # 1..0..1 con Ranking: una persona puede o no tener fila de ranking.
    ranking: Mapped[Optional["Ranking"]] = relationship(back_populates="persona", uselist=False)
    notificaciones: Mapped[List["Notificacion"]] = relationship(back_populates="persona")

    # Asignación directa a horarios
    alumno_horarios: Mapped[List["AlumnoHorario"]] = relationship(back_populates="persona")

    # Como entrenador:
    horarios_a_cargo: Mapped[List["HorarioEntrenamiento"]] = relationship(
        back_populates="entrenador", foreign_keys="HorarioEntrenamiento.entrenador_id"
    )
    asistencias_dictadas: Mapped[List["Asistencia"]] = relationship(
        back_populates="entrenador", foreign_keys="Asistencia.entrenador_id"
    )


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
    __tablename__ = "tipo_membresia"
    id: Mapped[int] = mapped_column(primary_key=True)
    categoria: Mapped[str] = mapped_column(String(80))
    franja_horaria: Mapped[str] = mapped_column(String(80))
    precio: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    modalidad: Mapped[TipoModalidad] = mapped_column(SAEnum(TipoModalidad))

    membresias: Mapped[List["Membresia"]] = relationship(back_populates="tipo_membresia")


class Membresia(Base):
    __tablename__ = "membresia"
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
    persona: Mapped["Persona"] = relationship(back_populates="pagos")

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
# ---------------------------------------------------------------------------
# Nivel de Ranking (E03) — unifica "grupo de entrenamiento" y "nivel
# competitivo": el nivel de ranking es una asignación independiente de los
# horarios — un alumno puede estar en cualquier horario con cualquier nivel
# (incluido sin nivel). El nivel trae el límite de capacidad que pedía
# E03-RF001 (6 a 10 deportistas) y se asigna vía `Ranking.nivel_ranking_id`.
#
# Nota de diseño: el máximo (10) SÍ se valida de forma dura al asignar una
# persona a un nivel (servicios_negocio lanza OperacionInvalida si ya está
# lleno). El mínimo (6) se expone como información en el DTO de respuesta
# (`necesita_revision`) pero NO bloquea operaciones: un club nuevo o un nivel
# recién creado puede tener menos de 6 personas temporalmente, y bloquear ahí
# dejaría al Administrador sin forma de operar. Es una decisión de diseño
# explícita, no una omisión.
# ---------------------------------------------------------------------------
class NivelRanking(Base):
    __tablename__ = "nivel_ranking"
    id: Mapped[int] = mapped_column(primary_key=True)
    # Orden jerárquico: 1 = nivel más alto/competitivo. Único para poder
    # calcular "nivel inmediatamente superior/inferior" sin ambigüedad.
    numero_nivel: Mapped[int] = mapped_column(unique=True)
    nombre: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    capacidad_minima: Mapped[int] = mapped_column(default=6)
    capacidad_maxima: Mapped[int] = mapped_column(default=10)

    rankings: Mapped[List["Ranking"]] = relationship(back_populates="nivel_ranking")


class HorarioEntrenamiento(Base):
    """
    entrenador_id: entrenador TITULAR asignado a este horario (fijo por defecto).
    No garantiza que sea quien dicte cada sesión puntual -- eso lo registra
    Asistencia.entrenador_id, que puede diferir por sustituciones.
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

    entrenador_id: Mapped[int] = mapped_column(ForeignKey("persona.id"))
    entrenador: Mapped["Persona"] = relationship(
        back_populates="horarios_a_cargo", foreign_keys=[entrenador_id]
    )

    # Horario y nivel de ranking son INDEPENDIENTES: un alumno puede estar en
    # cualquier horario sin que medie su nivel de ranking, y viceversa. El
    # nivel de cada alumno vive exclusivamente en `Ranking.nivel_ranking_id`.
    asistencias: Mapped[List["Asistencia"]] = relationship(back_populates="horario")
    alumno_horarios: Mapped[List["AlumnoHorario"]] = relationship(back_populates="horario")


class Asistencia(Base):
    """
    entrenador_id: quien REALMENTE dictó esta sesión puntual. Suele coincidir
    con HorarioEntrenamiento.entrenador (el titular) pero puede diferir cuando
    hay una sustitución -- por eso se registra por asistencia, no se asume.
    """
    __tablename__ = "asistencia"
    id: Mapped[int] = mapped_column(primary_key=True)
    fecha_entrenamiento: Mapped[date] = mapped_column(Date)
    fecha_registro: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_ahora_utc)
    estado: Mapped[EstadoAsistencia] = mapped_column(SAEnum(EstadoAsistencia))
    justificativo: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    estado_justificativo: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)

    persona_id: Mapped[int] = mapped_column(ForeignKey("persona.id"))
    persona: Mapped["Persona"] = relationship(
        back_populates="asistencias", foreign_keys=[persona_id]
    )

    entrenador_id: Mapped[int] = mapped_column(ForeignKey("persona.id"))
    entrenador: Mapped["Persona"] = relationship(
        back_populates="asistencias_dictadas", foreign_keys=[entrenador_id]
    )

    horario_id: Mapped[int] = mapped_column(ForeignKey(_HORARIO_FK))
    horario: Mapped["HorarioEntrenamiento"] = relationship(back_populates="asistencias")


# ---------------------------------------------------------------------------
# Asignación directa Alumno ↔ Horario (muchos a muchos)
# Permite que dos alumnos en el mismo nivel asistan a horarios distintos.
# ---------------------------------------------------------------------------
class AlumnoHorario(Base):
    __tablename__ = "alumno_horario"
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
    id: Mapped[int] = mapped_column(primary_key=True)
    nombre_enfermedad: Mapped[str] = mapped_column(String(150))

    ficha_medica_id: Mapped[int] = mapped_column(ForeignKey("ficha_medica.id"))
    ficha_medica: Mapped["FichaMedica"] = relationship(back_populates="enfermedades")


# ---------------------------------------------------------------------------
# Ranking (E03)
#
# Regla E03 (actualizada — el comentario original de este bloque describía una
# fórmula desactualizada de 90/80/70... que NO corresponde a los requisitos
# reales; se corrige aquí):
#   - Fórmula de puntos (RF004), definida junto con el equipo a partir de los
#     tres anclajes del requisito (puesto 1 = 90, puesto 90+ = 1, descenso
#     proporcional entre medio): puntos(p) = max(91 - p, 1). Implementada en
#     app.servicios_negocio.ranking_servicio.calcular_puntos_por_posicion.
#   - Es OBLIGATORIO diferenciar un alumno que "No participó" de uno que quedó
#     en "Último lugar con 0 puntos". Se resuelve con `participo` (Boolean):
#       * participo=False  -> No figura en el ranking (no suma, no se muestra).
#       * participo=True   -> Sí figura, aunque el puntaje sea 0 (último lugar).
#   - `esta_en_ranking` es el flag de VISIBILIDAD usado por los endpoints del
#     frontend. Los dos mecanismos que antes lo ponían en False
#     automáticamente ya no existen: la tarea de Celery Beat de limpieza por
#     inactividad (dependía de `ultimo_combate_o_asistencia`, campo también
#     removido -- ver apply-progress de `limpieza-asistencia-y-nivel-
#     entrenador` slice E) y el cierre mensual manual RF007 (removido en la
#     slice B2 del mismo change). Hoy la baja es manual/administrativa.
#   - `nivel_ranking_id`: el nivel de ranking ES el grupo de entrenamiento
#     (ver NivelRanking arriba). Puede ser NULL momentáneamente entre que se
#     crea la fila de Ranking (alumno nuevo) y el Entrenador le asigna nivel
#     inicial (RF002) -- por eso es nullable, no obligatorio en el modelo.
# ---------------------------------------------------------------------------
class Ranking(Base):
    __tablename__ = "ranking"
    id: Mapped[int] = mapped_column(primary_key=True)
    persona_id: Mapped[int] = mapped_column(ForeignKey("persona.id"), unique=True)
    # Congelados: el único escritor era el cierre mensual RF007 (removido en
    # slice B2 de `limpieza-asistencia-y-nivel-entrenador`). Ya no se exponen
    # en TablaRankingItemDTO/PerfilRankingAlumnoDTO/AsignacionRankingResponseDTO;
    # siguen en el modelo solo porque RankingResponseDTO (asignar-nivel-inicial,
    # mover-de-nivel) todavía los declara.
    puntaje_acumulado: Mapped[int] = mapped_column(default=0)
    posicion_actual: Mapped[Optional[int]] = mapped_column(nullable=True)

    # --- Diferenciación explícita E03 ---
    participo: Mapped[bool] = mapped_column(Boolean, default=False)
    # ----------------------------------------------------------------------

    esta_en_ranking: Mapped[bool] = mapped_column(Boolean, default=True)

    # --- E03-RF002/RF009: nivel operativo actual (= grupo de entrenamiento) ---
    nivel_ranking_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("nivel_ranking.id"), nullable=True
    )
    nivel_ranking: Mapped[Optional["NivelRanking"]] = relationship(back_populates="rankings")

    persona: Mapped["Persona"] = relationship(back_populates="ranking")


# ---------------------------------------------------------------------------
# Notificación in-app. Genérica a propósito: no se acopla a un único flujo,
# para poder reutilizarse en otros procesos del sistema (ej. vencimiento de
# membresía, ver `alertas_tareas.py`).
# ---------------------------------------------------------------------------
class Notificacion(Base):
    __tablename__ = "notificacion"
    id: Mapped[int] = mapped_column(primary_key=True)
    tipo: Mapped[TipoNotificacion] = mapped_column(SAEnum(TipoNotificacion))
    mensaje: Mapped[str] = mapped_column(String(255))
    leida: Mapped[bool] = mapped_column(Boolean, default=False)
    fecha_creacion: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_ahora_utc)
    # Id de la entidad relacionada (ej. el Ranking o JustificativoRanking que
    # originó la notificación), sin FK estricta porque el tipo de entidad
    # varía según `tipo` -- mantenerlo simple evita una jerarquía de tablas.
    entidad_relacionada_id: Mapped[Optional[int]] = mapped_column(nullable=True)

    persona_id: Mapped[int] = mapped_column(ForeignKey("persona.id"))
    persona: Mapped["Persona"] = relationship(back_populates="notificaciones")
