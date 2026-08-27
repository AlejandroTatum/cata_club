from typing import Optional, List
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.dominio.modelos import Persona, Usuario, Rol, usuario_rol

# Mismo mapeo de acentos que el `func.translate` de más abajo, pero en
# Python: como el patrón LIKE ahora lo arma `.contains(autoescape=True)` (que
# NO pasa el término por `translate`/`lower` de la columna), el término se
# normaliza acá para que "Anahí" siga encontrando a "Anahí" y "Muño" a
# "Muñoz". Se conserva la ñ, igual que en SQL.
_ACENTOS_A_LLANOS = str.maketrans("áéíóúü", "aeiouu")


def _normalizar_termino(palabra: str) -> str:
    """Refleja el `lower(translate(...))` que se aplica a la columna."""
    return palabra.translate(_ACENTOS_A_LLANOS).lower()


class PersonaRepositorio:
    """Encapsula todo el acceso a datos de Persona. Es la ÚNICA clase
    del proyecto que debe importar Session y ejecutar db.query/add/commit
    para esta entidad.

    NO expone `eliminar`: una Persona nunca se borra. La baja es lógica
    (`Persona.activo`), porque su historial de asistencias, pagos y ficha
    médica tiene que sobrevivir a que deje el club."""

    def __init__(self, db: Session):
        self.db = db

    def obtener_por_id(self, persona_id: int) -> Optional[Persona]:
        return self.db.get(Persona, persona_id)

    def obtener_por_cedula(self, cedula: str) -> Optional[Persona]:
        return self.db.query(Persona).filter(Persona.cedula == cedula).first()

    # Orden estable del roster: como se lee una nómina, por apellidos y luego
    # nombres. El id va de desempate para que el orden sea TOTAL -- sin él,
    # dos homónimos podrían repartirse de forma distinta entre páginas y
    # `OFFSET/LIMIT` repetiría o se saltaría filas.
    _ORDEN_NOMINA = (Persona.apellidos.asc(), Persona.nombres.asc(), Persona.id.asc())

    # `listar`/`contar` alimentan el roster ADMINISTRATIVO (`GET /personas/`,
    # la página admin de Miembros): a propósito NO filtran por `activo`. Si
    # escondieran a las personas dadas de baja, un administrador no tendría
    # ninguna forma de volver a encontrarlas para reactivarlas. El DTO expone
    # `activo` para que la UI las pueda marcar.
    def listar(self, skip: int = 0, limit: int = 50) -> List[Persona]:
        return (
            self.db.query(Persona)
            .order_by(*self._ORDEN_NOMINA)
            .offset(skip)
            .limit(limit)
            .all()
        )

    def contar(self) -> int:
        return self.db.query(Persona).count()

    def listar_representados(self, representante_id: int) -> List[Persona]:
        """Dependientes ACTIVOS de un representante.

        Baja lógica: un dependiente dado de baja ya no entrena, así que no
        pertenece a la lista operativa que ven el portal del representante y
        el panel admin. Sigue siendo alcanzable por el roster administrativo
        (`listar`) y por `obtener_por_id`, que es por donde se lo reactiva."""
        return (
            self.db.query(Persona)
            .filter(
                Persona.representante_id == representante_id,
                Persona.activo.is_(True),
            )
            .order_by(*self._ORDEN_NOMINA)
            .all()
        )

    # `listar_por_rol` (selector de entrenadores) se eliminó con la relación
    # entrenador–horario (issue #13): su único consumidor era el dropdown de
    # `GET /personas/entrenadores`. `listar_por_rol_con_ranking`/
    # `contar_por_rol` se eliminaron junto con el ranking competitivo: su
    # único consumidor era `RankingServicio.listar_alumnos_con_nivel`.

    def crear(self, persona: Persona, *, commit: bool = True) -> Persona:
        """`commit=False` deja la fila en un `flush()` (con `id` ya asignado)
        sin cerrar la transacción -- lo usa `EnrollmentServicio.enroll` para
        que representante + menor + roles + inscripción se escriban en una
        sola transacción atómica (issue #338): todo o nada."""
        self.db.add(persona)
        if commit:
            self.db.commit()
            self.db.refresh(persona)
        else:
            self.db.flush()
        return persona

    def actualizar(self, persona: Persona, cambios: dict) -> Persona:
        for campo, valor in cambios.items():
            setattr(persona, campo, valor)
        self.db.commit()
        self.db.refresh(persona)
        return persona

    # --- Reportes (E04-RF014) --------------------------------------------------
    def listar_nuevas_por_periodo(self, fecha_inicio, fecha_fin) -> List[Persona]:
        """E04-RF014: alumnos nuevos registrados en un rango de fechas.

        Reporte HISTÓRICO: a propósito NO filtra por `activo`. Haberse
        registrado en marzo es un hecho que no deja de ser cierto porque la
        persona se dio de baja en junio; esconderla falsearía el reporte."""
        return (
            self.db.query(Persona)
            .filter(Persona.fecha_registro >= fecha_inicio, Persona.fecha_registro <= fecha_fin)
            .order_by(Persona.fecha_registro.asc())
            .all()
        )

    def buscar_por_nombre(
        self, q: str, rol: Optional[str] = None, skip: int = 0, limit: int = 20
    ) -> List[Persona]:
        """Búsqueda de personas por nombre/apellido con filtro opcional por rol."""
        stmt = select(Persona)
        if rol:
            stmt = (
                stmt.join(Usuario, Usuario.persona_id == Persona.id)
                .join(usuario_rol, usuario_rol.c.usuario_id == Usuario.id)
                .join(Rol, Rol.id == usuario_rol.c.rol_id)
                .where(Rol.tipo_rol == rol)
            )
        # `q` completa contra CADA columna por separado nunca encontraba
        # "nombre apellido" juntos: ni nombres ni apellidos, por sí solos,
        # calzaban con la cadena entera. Partimos `q` en palabras y exigimos
        # que CADA una matchee nombres O apellidos (AND de ORes): así da
        # igual el orden en que se escriban ("Emilio Zambrano" o "Zambrano
        # Emilio") y un apellido compuesto alcanza con nombrar una porción
        # ("Ariana Chavez" encuentra a "Ariana Chavez Bravo"). Con una sola
        # palabra el comportamiento es idéntico al de antes.
        palabras = q.split()
        if palabras:

            def normalizador(expresion):
                return func.lower(func.translate(expresion, "áéíóúü", "aeiouu"))

            # SEGURIDAD: el término entra a un patrón LIKE, así que `%` y `_`
            # se tratan como LITERALES y no como comodines. `contains(...,
            # autoescape=True)` es el mecanismo de SQLAlchemy para eso: escapa
            # `%`, `_` y el propio carácter de escape, y emite `... LIKE ...
            # ESCAPE ...`. Antes se concatenaba `%<palabra>%` sin escapar: un
            # `q="%%"` calzaba con TODA la tabla y `min_length=2` era
            # decorativo, con lo que cualquier término comodín enumeraba el
            # roster entero (nombres de menores incluidos). Ahora `q="%%"`
            # sólo encuentra a quien literalmente tenga "%%" en el nombre.
            stmt = stmt.where(
                and_(
                    *[
                        or_(
                            normalizador(Persona.nombres).contains(
                                _normalizar_termino(palabra), autoescape=True
                            ),
                            normalizador(Persona.apellidos).contains(
                                _normalizar_termino(palabra), autoescape=True
                            ),
                        )
                        for palabra in palabras
                    ]
                )
            )
        # Baja lógica: el autocomplete es OPERATIVO -- se usa para elegir a
        # quién registrarle un pago, una asistencia o una membresía. Ofrecer a
        # un ex-miembro ahí es invitar a operar sobre alguien que ya no está.
        # Para encontrarlo y reactivarlo está el roster admin (`listar`).
        stmt = stmt.where(Persona.activo.is_(True))
        # `skip`/`limit` viajaban por toda la cadena (router -> servicio ->
        # repositorio) sin llegar nunca a la sentencia: el tope `le=50` del
        # router era decorativo y una `q` de dos caracteres que matcheara a
        # todo el club devolvía el club entero. El `order_by` es parte del
        # arreglo: sin orden total, paginar con OFFSET no es determinista.
        stmt = stmt.order_by(*self._ORDEN_NOMINA).offset(skip).limit(limit)
        return list(self.db.execute(stmt).scalars().all())
