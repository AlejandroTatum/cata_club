"""
Contrato "no hay N+1" sobre los repositorios con `listar()` de entidad plana
(consultas-sin-n1, slice 5, Design D8): `descuento`, `geografia` (país,
provincia, cantón), `institucion` y `persona.listar` (ya paginado) deben
resolver su listado en un número FIJO de SELECTs, sin crecer con la
cantidad de filas devueltas.

Fuera de este contrato (D8): `antecedentes_club_repositorio.py` y
`usuario_ficha_repositorio.py` no tienen ningún método de listado
multi-fila. Un test de conteo de SELECTs ahí afirmaría una condición que
hoy es IMPOSIBLE de violar -- no hay bucle sobre filas que pudiera
degenerar en N+1 -- así que no protegería nada real y solo agregaría
líneas vacías de mantenimiento.

`rol_repositorio.py` SÍ tiene un camino multi-fila: el issue #810 probó
que `RolRepositorio.obtener_por_tipo` + `[u.persona for u in rol.usuarios
if u.persona]` (el aviso a administradores de `enrollment_servicio.py`)
emite un SELECT por administrador. Ese camino está cubierto abajo.

Estos tests NO pueden ser RED-first (Design, sección "Testing Strategy"):
ya pasan hoy, porque ninguno de estos `listar()` toca una relación dentro
de un bucle. La prueba de que NO son vacíos está documentada en el
docstring de cada uno: se detalla la mutación temporal (acceder a una
relación lazy por cada fila, DENTRO del bloque medido) que se aplicó, se
corrió, SÍ hizo subir el conteo de SELECTs -- confirmando que el fixture
`contar_selects` detecta un N+1 real si alguna vez se introduce uno acá --
y luego se revirtió. Ningún archivo de producción fue tocado para esta
prueba: la mutación vive, se ejecuta y se revierte enteramente en el test.
"""
from datetime import date
from decimal import Decimal

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import TipoEscuela, TipoRol
from app.dominio.modelos import Canton, Descuento, Institucion, Pais, Persona, Provincia, Rol, Usuario
from app.infraestructura.repositorios.descuento_repositorio import DescuentoRepositorio
from app.infraestructura.repositorios.geografia_repositorio import (
    CantonRepositorio, PaisRepositorio, ProvinciaRepositorio,
)
from app.infraestructura.repositorios.institucion_repositorio import InstitucionRepositorio
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.infraestructura.repositorios.rol_repositorio import RolRepositorio


def _selects(sentencias):
    return [s for s in sentencias if s.strip().upper().startswith("SELECT")]


def test_descuento_listar_no_incurre_en_n_mas_uno(db_session, contar_selects):
    """Mutación probada y revertida: dentro del bloque medido se agregó
    `for d in resultado: _ = d.aplicaciones` (relación lazy `List[
    DescuentoAplicado]`) -- el conteo de SELECTs subió de 1 a 4 (uno extra
    por cada uno de los 3 descuentos). Confirma que el fixture SÍ detecta
    un N+1 si alguna vez se introduce uno acá."""
    for i in range(3):
        db_session.add(Descuento(nombre=f"Descuento {i}", porcentaje=Decimal("10")))
    db_session.commit()
    db_session.expire_all()  # fuerza recarga real desde la BD

    repo = DescuentoRepositorio(db_session)

    with contar_selects() as sentencias:
        resultado = repo.listar()

    assert len(resultado) == 3
    selects = _selects(sentencias)
    assert len(selects) == 1, (
        f"Se esperaba 1 sola sentencia SELECT, se ejecutaron {len(selects)}: {selects}"
    )


def test_pais_listar_no_incurre_en_n_mas_uno(db_session, contar_selects):
    """Mutación probada y revertida: dentro del bloque medido se agregó
    `for p in resultado: _ = p.provincias` (relación lazy `List[Provincia]`)
    -- el conteo de SELECTs subió de 1 a 4 (uno extra por cada uno de los
    3 países)."""
    for nombre in ["Ecuador", "Perú", "Colombia"]:
        db_session.add(Pais(nombre=nombre))
    db_session.commit()
    db_session.expire_all()

    repo = PaisRepositorio(db_session)

    with contar_selects() as sentencias:
        resultado = repo.listar()

    assert len(resultado) == 3
    selects = _selects(sentencias)
    assert len(selects) == 1, (
        f"Se esperaba 1 sola sentencia SELECT, se ejecutaron {len(selects)}: {selects}"
    )


def test_provincia_listar_no_incurre_en_n_mas_uno(db_session, contar_selects):
    """Mutación probada y revertida: dentro del bloque medido se agregó
    `for pv in resultado: _ = pv.cantones` (relación lazy `List[Canton]`)
    -- el conteo de SELECTs subió de 1 a 3 (uno extra por cada una de las
    2 provincias)."""
    pais = Pais(nombre="Ecuador")
    db_session.add(pais)
    db_session.flush()
    for nombre in ["Pichincha", "Guayas"]:
        db_session.add(Provincia(nombre=nombre, pais_id=pais.id))
    db_session.commit()
    db_session.expire_all()

    repo = ProvinciaRepositorio(db_session)

    with contar_selects() as sentencias:
        resultado = repo.listar()

    assert len(resultado) == 2
    selects = _selects(sentencias)
    assert len(selects) == 1, (
        f"Se esperaba 1 sola sentencia SELECT, se ejecutaron {len(selects)}: {selects}"
    )


def test_canton_listar_no_incurre_en_n_mas_uno(db_session, contar_selects):
    """Mutación probada y revertida: dentro del bloque medido se agregó
    `for c in resultado: _ = c.direcciones` (relación lazy `List[
    Direccion]`) -- el conteo de SELECTs subió de 1 a 3 (uno extra por
    cada uno de los 2 cantones)."""
    pais = Pais(nombre="Ecuador")
    db_session.add(pais)
    db_session.flush()
    provincia = Provincia(nombre="Pichincha", pais_id=pais.id)
    db_session.add(provincia)
    db_session.flush()
    for nombre in ["Quito", "Rumiñahui"]:
        db_session.add(Canton(nombre=nombre, provincia_id=provincia.id))
    db_session.commit()
    db_session.expire_all()

    repo = CantonRepositorio(db_session)

    with contar_selects() as sentencias:
        resultado = repo.listar()

    assert len(resultado) == 2
    selects = _selects(sentencias)
    assert len(selects) == 1, (
        f"Se esperaba 1 sola sentencia SELECT, se ejecutaron {len(selects)}: {selects}"
    )


def test_institucion_listar_no_incurre_en_n_mas_uno(db_session, contar_selects):
    """Mutación probada y revertida: dentro del bloque medido se agregó
    `for i_ in resultado: _ = i_.personas` (relación lazy `List[Persona]`)
    -- el conteo de SELECTs subió de 1 a 4 (uno extra por cada una de las
    3 instituciones)."""
    for nombre in ["Colegio A", "Colegio B", "Colegio C"]:
        db_session.add(Institucion(nombre=nombre, tipo_escuela=TipoEscuela.FISCAL))
    db_session.commit()
    db_session.expire_all()

    repo = InstitucionRepositorio(db_session)

    with contar_selects() as sentencias:
        resultado = repo.listar()

    assert len(resultado) == 3
    selects = _selects(sentencias)
    assert len(selects) == 1, (
        f"Se esperaba 1 sola sentencia SELECT, se ejecutaron {len(selects)}: {selects}"
    )


def test_persona_listar_no_incurre_en_n_mas_uno(db_session, contar_selects):
    """`PersonaRepositorio.listar` ya está paginado (`skip`/`limit`); este
    test guarda que, además, siga siendo plano. Mutación probada y
    revertida: dentro del bloque medido se agregó `for p in resultado: _ =
    p.usuario` (relación lazy `Optional[Usuario]`, to-one) -- el conteo de
    SELECTs subió de 1 a 4 (uno extra por cada una de las 3 personas)."""
    for i in range(3):
        db_session.add(Persona(
            nombres="Ana", apellidos=f"Torres {i}", cedula=cedula_valida(600 + i),
            fecha_nacimiento=date(1990, 1, 1), telefono="0991234567",
        ))
    db_session.commit()
    db_session.expire_all()

    repo = PersonaRepositorio(db_session)

    with contar_selects() as sentencias:
        resultado = repo.listar(skip=0, limit=50)

    assert len(resultado) == 3
    selects = _selects(sentencias)
    assert len(selects) == 1, (
        f"Se esperaba 1 sola sentencia SELECT, se ejecutaron {len(selects)}: {selects}"
    )


def test_persona_listar_incluye_el_estado_de_la_cuenta_sin_n_mas_uno(db_session, contar_selects):
    """Issue #869: `PersonaResponseDTO.cuenta_activa` lee `Persona.usuario.
    activo` por cada fila -- la misma relación lazy to-one `p.usuario` que el
    test de arriba prueba que dispara un SELECT extra por persona sin eager
    load. `PersonaRepositorio.listar` la trae con `joinedload`, así que
    tocarla (como hace el serializer del DTO al leer `cuenta_activa`) no debe
    sumar ningún SELECT."""
    con_cuenta = Persona(
        nombres="Ana", apellidos="Con Cuenta", cedula=cedula_valida(610),
        fecha_nacimiento=date(1990, 1, 1), telefono="0991234567",
    )
    sin_cuenta = Persona(
        nombres="Ana", apellidos="Sin Cuenta", cedula=cedula_valida(611),
        fecha_nacimiento=date(1990, 1, 1), telefono="0991234567",
    )
    db_session.add_all([con_cuenta, sin_cuenta])
    db_session.commit()
    db_session.add(Usuario(correo="n1-869@test.com", contrasenia="hash", persona_id=con_cuenta.id, activo=True))
    db_session.commit()
    db_session.expire_all()

    repo = PersonaRepositorio(db_session)

    with contar_selects() as sentencias:
        resultado = repo.listar(skip=0, limit=50)
        estados = [p.cuenta_activa for p in resultado]

    # `_ORDEN_NOMINA` ordena por apellidos: "Con Cuenta" antes que "Sin Cuenta".
    assert estados == [True, None]
    selects = _selects(sentencias)
    assert len(selects) == 1, (
        f"Se esperaba 1 sola sentencia SELECT (con JOIN a Usuario), se ejecutaron {len(selects)}: {selects}"
    )


def _sembrar_administradores(db_session, cantidad: int) -> None:
    """Crea `cantidad` Persona + Usuario compartiendo el mismo `Rol`
    ADMINISTRADOR (many-to-many vía `usuario_rol`), como en producción: un
    solo catálogo, N usuarios asignados. Helper compartido por los dos
    casos parametrizados de abajo (evita duplicación de new-code)."""
    rol = Rol(tipo_rol=TipoRol.ADMINISTRADOR, descripcion="Administrador")
    db_session.add(rol)
    db_session.flush()
    for i in range(cantidad):
        persona = Persona(
            nombres="Admin", apellidos=f"Uno {i}", cedula=cedula_valida(700 + i),
            fecha_nacimiento=date(1985, 1, 1), telefono="0990000000",
        )
        db_session.add(persona)
        db_session.flush()
        db_session.add(Usuario(
            correo=f"admin{i}@cataclub.test", contrasenia="hash",
            persona_id=persona.id, roles=[rol],
        ))
    db_session.commit()
    db_session.expire_all()


@pytest.mark.parametrize("cantidad", [3, 6])
def test_rol_obtener_por_tipo_con_usuarios_no_incurre_en_n_mas_uno(db_session, contar_selects, cantidad):
    """Issue #810: el aviso a administradores de
    `enrollment_servicio._notificar_nueva_inscripcion` -- `RolRepositorio.
    obtener_por_tipo(...)` seguido de `[u.persona for u in rol.usuarios if
    u.persona]` -- resolvía `Rol.usuarios` (many-to-many, sin `use_get`)
    con un SELECT por fila: medido con este mismo fixture contra el código
    sin arreglar, 5 sentencias con 3 administradores, 8 con 6 (`2+N`).

    `RolRepositorio.obtener_por_tipo_con_usuarios` es un método NUEVO, no
    un `joinedload` agregado a `obtener_por_tipo`: ese otro método también
    lo usa `obtener_o_crear`, llamado con CUALQUIER `TipoRol` -- incluido
    ALUMNO, dentro de la misma inscripción pública
    (`enrollment_servicio.py:427`) -- y un `joinedload(Rol.usuarios)` ahí
    convertiría un chequeo liviano de existencia en un JOIN contra todo el
    alumnado del club. El método nuevo queda reservado al único llamador
    que sí necesita la colección completa y es chica (administradores)."""
    _sembrar_administradores(db_session, cantidad)

    repo = RolRepositorio(db_session)

    with contar_selects() as sentencias:
        rol = repo.obtener_por_tipo_con_usuarios(TipoRol.ADMINISTRADOR)
        admins = [u.persona for u in rol.usuarios if u.persona]

    assert len(admins) == cantidad
    selects = _selects(sentencias)
    assert len(selects) == 1, (
        f"Se esperaba 1 sola sentencia SELECT, se ejecutaron {len(selects)}: {selects}"
    )
