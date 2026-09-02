"""Fallback de PRESENTACIÓN para nombres legacy (issue #875): las filas
escritas antes del límite de escritura (#875/@validates) siguen crudas en la
base hasta que corra el backfill. Este archivo cubre que se muestren
canónicas de todos modos -- en la respuesta HTTP y en las propiedades ORM que
arman un nombre completo -- y canda con AST que ningún f-string vuelva a
concatenar `nombres`/`apellidos` en crudo."""
import ast
from datetime import date
from pathlib import Path

from sqlalchemy import insert, select
from sqlalchemy.orm.attributes import set_committed_value

from app.dominio.cedula import cedula_valida
from app.dominio.modelos import Asistencia, Persona


def _sembrar_legacy(db_session) -> int:
    """Mismo patrón que `test_dry_run_normalizacion_nombres.py::_sembrar`:
    INSERT de Core saltea `@validates` y simula una fila LEGACY."""
    db_session.execute(
        insert(Persona).values(
            cedula=cedula_valida(301), nombres="faby", apellidos="ESPINOZA",
            fecha_nacimiento=date(1990, 1, 1), telefono="0990001111",
        )
    )
    db_session.commit()
    return db_session.execute(select(Persona.id).filter_by(cedula=cedula_valida(301))).scalar_one()


def test_get_persona_muestra_nombre_canonico_de_fila_legacy(client, db_session):
    persona_id = _sembrar_legacy(db_session)

    resp = client.get(f"/api/v1/personas/{persona_id}")

    assert resp.status_code == 200
    cuerpo = resp.json()
    assert cuerpo["nombres"] == "Faby"
    assert cuerpo["apellidos"] == "Espinoza"
    # La base sigue guardando el valor crudo: esto es un fallback de LECTURA,
    # no una escritura retroactiva.
    fila = db_session.execute(select(Persona.nombres, Persona.apellidos).filter_by(id=persona_id)).one()
    assert fila == ("faby", "ESPINOZA")


def test_buscar_personas_muestra_nombre_canonico_de_fila_legacy(client, db_session):
    _sembrar_legacy(db_session)

    resp = client.get("/api/v1/personas/buscar", params={"q": "faby"})

    assert resp.status_code == 200
    coincidencias = [p for p in resp.json() if p["apellidos"] == "Espinoza"]
    assert coincidencias
    assert coincidencias[0]["nombres"] == "Faby"


def test_asistencia_persona_nombre_completo_normaliza_persona_legacy():
    """`Asistencia.persona_nombre_completo` (modelos.py) sobre una `Persona`
    con valores crudos en memoria -- `set_committed_value` bypasea
    `@validates`, igual que un INSERT de Core sobre una fila legacy."""
    persona = Persona()
    set_committed_value(persona, "nombres", "faby")
    set_committed_value(persona, "apellidos", "ESPINOZA")
    asistencia = Asistencia()
    asistencia.persona = persona

    assert asistencia.persona_nombre_completo == "Faby Espinoza"


def _concatena_nombres_apellidos_crudos(joined: ast.JoinedStr) -> bool:
    valores = [v.value for v in joined.values if isinstance(v, ast.FormattedValue)]
    return any(
        isinstance(a, ast.Attribute) and a.attr == "nombres"
        and isinstance(b, ast.Attribute) and b.attr == "apellidos"
        for a, b in zip(valores, valores[1:])
    )


def test_ningun_fstring_concatena_nombres_y_apellidos_crudos():
    """Candado AST: todo nombre completo para presentación pasa por
    `nombre_completo` (fallback de lectura, issue #875) -- nunca un
    `f"{x.nombres} {x.apellidos}"` armado a mano."""
    directorio_app = Path(__file__).resolve().parent.parent / "app"
    hallazgos = []
    for archivo in sorted(directorio_app.rglob("*.py")):
        arbol = ast.parse(archivo.read_text(encoding="utf-8"), filename=str(archivo))
        for nodo in ast.walk(arbol):
            if isinstance(nodo, ast.JoinedStr) and _concatena_nombres_apellidos_crudos(nodo):
                hallazgos.append(f"{archivo.relative_to(directorio_app.parent.parent)}:{nodo.lineno}")
    assert not hallazgos, "f-string cruda nombres+apellidos en: " + ", ".join(hallazgos)
