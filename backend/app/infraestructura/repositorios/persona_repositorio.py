from typing import Optional, List, Tuple
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.dominio.modelos import Persona, Ranking, Usuario, Rol, usuario_rol
from app.dominio.enums import TipoRol


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

    def listar_por_rol(self, tipo_rol: TipoRol) -> List[Persona]:
        """Personas con un Usuario que tenga el `tipo_rol` dado (ej. listar
        entrenadores para un selector). Mismo criterio de "rol asignado" que
        `AsistenciaServicio._validar_entrenador` usa para validar."""
        return (
            self.db.query(Persona)
            .join(Usuario, Usuario.persona_id == Persona.id)
            .join(Usuario.roles)
            .filter(Rol.tipo_rol == tipo_rol)
            # Baja lógica: listado OPERATIVO (selector de entrenador para
            # asignar a un horario). A alguien que ya no está en el club no se
            # le puede asignar una clase, así que no debe ni aparecer.
            .filter(Persona.activo.is_(True))
            # Mismo orden de nómina que `listar`: alimenta selectores
            # (entrenadores) y el ranking, donde un orden alfabético estable
            # es lo que el usuario espera al buscar un nombre en la lista.
            .order_by(*self._ORDEN_NOMINA)
            .all()
        )

    def listar_por_rol_con_ranking(
        self, tipo_rol: TipoRol, skip: int = 0, limit: Optional[int] = None
    ) -> List[Tuple[Persona, Optional[Ranking]]]:
        """Igual que `listar_por_rol`, pero trae además la fila de `Ranking`
        de cada persona (o `None`) en la MISMA sentencia.

        Existe para que el roster de niveles no dispare un SELECT de ranking
        por alumno (N+1: con 68 alumnos eran 69 consultas). Detalles que NO
        son negociables:

        - `outerjoin`: una persona puede no tener fila de `Ranking` todavía
          (aún sin grupo asignado). Con un INNER JOIN esos alumnos
          desaparecerían del roster sin error visible -- son justamente los
          que la pantalla muestra como "Sin nivel asignado".
        - `distinct`: el filtro por rol pasa por persona-usuario-rol, que
          multiplica filas cuando el usuario tiene varios roles. `listar_por_rol`
          no lo notaba porque `Query` deduplica entidades completas; acá las
          filas son tuplas, así que la deduplicación es explícita. Es segura
          porque `Ranking.persona_id` es UNIQUE: como mucho hay una fila de
          ranking por persona, nunca un producto cartesiano real.
        - Mismo `_ORDEN_NOMINA` que `listar_por_rol`: el orden del listado no
          puede cambiar por optimizar la consulta.
        """
        stmt = (
            select(Persona, Ranking)
            .join(Usuario, Usuario.persona_id == Persona.id)
            .join(usuario_rol, usuario_rol.c.usuario_id == Usuario.id)
            .join(Rol, Rol.id == usuario_rol.c.rol_id)
            .outerjoin(Ranking, Ranking.persona_id == Persona.id)
            # Baja lógica: listado OPERATIVO (roster de niveles del
            # entrenador). Un ex-miembro no compite ni ocupa cupo de nivel.
            .where(Rol.tipo_rol == tipo_rol, Persona.activo.is_(True))
            .distinct()
            .order_by(*self._ORDEN_NOMINA)
            # Paginación (issue #7): el roster crece con el padrón. El orden
            # ya es TOTAL (`_ORDEN_NOMINA` termina en `Persona.id`), condición
            # necesaria para que OFFSET/LIMIT no repita ni saltee filas.
            .offset(skip)
        )
        if limit is not None:
            stmt = stmt.limit(limit)
        return [(persona, ranking) for persona, ranking in self.db.execute(stmt)]

    def contar_por_rol(self, tipo_rol: TipoRol) -> int:
        """Total de personas ACTIVAS con el rol dado: el MISMO filtro que
        `listar_por_rol_con_ranking`, para que el `total` del envelope
        paginado cuente el conjunto completo y no la página. `DISTINCT`
        por la misma razón que allá: el JOIN con roles multiplica filas
        cuando el usuario tiene varios roles."""
        stmt = (
            select(func.count(func.distinct(Persona.id)))
            .select_from(Persona)
            .join(Usuario, Usuario.persona_id == Persona.id)
            .join(usuario_rol, usuario_rol.c.usuario_id == Usuario.id)
            .join(Rol, Rol.id == usuario_rol.c.rol_id)
            .where(Rol.tipo_rol == tipo_rol, Persona.activo.is_(True))
        )
        return self.db.execute(stmt).scalar_one()

    def crear(self, persona: Persona) -> Persona:
        self.db.add(persona)
        self.db.commit()
        self.db.refresh(persona)
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
        filtro = f"%{q}%"
        stmt = stmt.where(
            (Persona.nombres.ilike(filtro)) | (Persona.apellidos.ilike(filtro))
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
