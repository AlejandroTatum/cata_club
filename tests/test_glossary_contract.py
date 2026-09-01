"""The canonical-glossary contract shared by backend and frontend (issue #903)."""

import copy
import hashlib
import json
import re
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
CONOCIMIENTO = RAIZ / "backend" / "app" / "servicios_negocio" / "conocimiento_club.json"
ESPEJO = RAIZ / "frontend" / "src" / "data" / "club-knowledge.json"
ATAJOS = RAIZ / "frontend" / "src" / "data" / "club-quick-replies.json"
PROMPT = RAIZ / "backend" / "app" / "servicios_negocio" / "prompt_sistema.txt"
CONTRATO = RAIZ / "docs" / "operations" / "glossary-contract.md"

# Las superficies que el gate comparte: los bytes que el backend manda al
# modelo y los bytes que el frontend embarca como copy de ayuda. Todas dentro
# del repo: el gate corre offline, sin clonar cata_club-docs.
SUPERFICIES = {
    "backend:prompt": PROMPT,
    "frontend:ayuda": ESPEJO,
    "frontend:atajos": ATAJOS,
}

# Usos representativos: (superficie, id de la entrada, fragmento visible que
# debe aparecer). El fragmento puede ser el término canónico o una forma de
# contexto que el propio glosario declara (`context_forms`).
USOS_BACKEND = [
    ("backend:prompt", "membresia", "Membresías y Pagos"),
    ("backend:prompt", "ficha_medica", "Ficha médica"),
    ("backend:prompt", "horario_entrenamiento", "Horarios de entrenamiento"),
    ("backend:prompt", "asistencia", "Asistencia"),
]
USOS_FRONTEND = [
    ("frontend:ayuda", "membresia", "Membresías y Pagos"),
    ("frontend:ayuda", "tipo_membresia", "valor de cada plan"),
    ("frontend:ayuda", "jugador", "selector de estudiante"),
    ("frontend:atajos", "asistencia", "¿Dónde veo la asistencia?"),
]


def forma_canonica(entradas: list) -> str:
    """La serialización estable contra la que se calcula `entradas_sha256`.

    Claves ordenadas, sin espacios, UTF-8 crudo: la misma forma que calcula el
    gate del frontend con `node:crypto`, para que el hash signe lo mismo de los
    dos lados.
    """
    return json.dumps(entradas, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def verificar_procedencia(glosario: dict) -> None:
    """El candado de procedencia del snapshot.

    Falla si el snapshot no está marcado como generado, si la procedencia está
    malformada, si el glosario quedó vacío o si alguien editó una entrada a
    mano: el hash del contenido deja de recomputarse.
    """
    assert glosario.get("generado") is True, "el snapshot debe declararse generado"
    assert glosario.get("no_editar_a_mano") is True, "el snapshot no se edita a mano"
    assert glosario.get("autoridad") == "AlejandroTatum/cata_club-docs"
    assert glosario.get("archivo_fuente") == "reference/glosario.json"
    assert re.fullmatch(r"[0-9a-f]{40}", glosario.get("commit_fuente", "")), (
        "commit de procedencia ausente o malformado"
    )
    for campo in ("sha256_fuente_publicada", "entradas_sha256"):
        assert re.fullmatch(r"[0-9a-f]{64}", glosario.get(campo, "")), campo
    entradas = glosario.get("entradas") or []
    assert entradas, "glosario vacío"
    ids = [entrada["id"] for entrada in entradas]
    assert len(ids) == len(set(ids)), "ids duplicados"
    for entrada in entradas:
        assert entrada["canonical_term"].strip(), entrada["id"]
        assert entrada["definition"].strip(), entrada["id"]
        assert entrada["sources"], entrada["id"]
    recalculado = hashlib.sha256(forma_canonica(entradas).encode("utf-8")).hexdigest()
    assert recalculado == glosario["entradas_sha256"], (
        "el hash del contenido no recomputa: ¿edición manual del snapshot?"
    )


def verificar_usos(entradas: list, usos: list, textos: dict) -> None:
    """El gate compartido: cada uso representativo debe existir en su superficie."""
    assert usos, "conjunto de entradas comprobadas vacío"
    terminos = {entrada["id"] for entrada in entradas}
    for superficie, termino, fragmento in usos:
        assert superficie in textos, superficie
        assert termino in terminos, f"el uso referencia una entrada inexistente: {termino}"
        assert fragmento in textos[superficie], (
            f"{superficie} ya no usa el término canónico «{termino}» "
            f"(faltaba «{fragmento}»)"
        )


def variantes_prohibidas(entradas: list) -> list:
    return [
        (entrada["id"], variante)
        for entrada in entradas
        for variante in entrada.get("prohibited_variants", [])
    ]


@pytest.fixture(scope="module")
def glosario() -> dict:
    return json.loads(CONOCIMIENTO.read_text(encoding="utf-8"))["glosario"]


@pytest.fixture(scope="module")
def textos() -> dict:
    # La copy de ayuda embarcada es el conocimiento sin el propio bloque
    # glosario: el snapshot declara sus variantes prohibidas como metadatos
    # y no debe disparar el barrido de copy visible.
    ayuda = json.loads(ESPEJO.read_text(encoding="utf-8"))
    ayuda.pop("glosario", None)
    return {
        "backend:prompt": PROMPT.read_text(encoding="utf-8"),
        "frontend:ayuda": json.dumps(ayuda, ensure_ascii=False),
        "frontend:atajos": ATAJOS.read_text(encoding="utf-8"),
    }


class TestProcedencia:
    def test_el_snapshot_declara_procedencia_verificable(self, glosario):
        verificar_procedencia(glosario)

    def test_el_snapshot_vive_igual_en_backend_y_frontend(self):
        assert ESPEJO.read_bytes() == CONOCIMIENTO.read_bytes(), (
            "el espejo del frontend divergió del snapshot del backend"
        )

    def test_el_contrato_operativo_documenta_la_procedencia(self, glosario):
        contrato = CONTRATO.read_text(encoding="utf-8")
        assert glosario["commit_fuente"] in contrato
        assert glosario["sha256_fuente_publicada"] in contrato
        assert glosario["entradas_sha256"] in contrato


class TestGateCompartido:
    def test_el_backend_usa_los_terminos_canonicos(self, glosario, textos):
        verificar_usos(glosario["entradas"], USOS_BACKEND, textos)

    def test_el_frontend_usa_los_terminos_canonicos(self, glosario, textos):
        verificar_usos(glosario["entradas"], USOS_FRONTEND, textos)

    def test_las_variantes_prohibidas_no_aparecen_en_ninguna_superficie(self, glosario, textos):
        for termino, variante in variantes_prohibidas(glosario["entradas"]):
            for nombre, texto in textos.items():
                assert variante.lower() not in texto.lower(), (
                    f"{nombre} usa la variante prohibida «{variante}» de «{termino}»"
                )


class TestElGateNoEsVacio:
    """Las validaciones posteriores del issue #903, como regresión permanente."""

    def test_una_edicion_manual_del_glosario_quiebra_el_hash(self, glosario):
        editado = copy.deepcopy(glosario)
        editado["entradas"][0]["canonical_term"] += " (editado a mano)"
        with pytest.raises(AssertionError, match="no recomputa"):
            verificar_procedencia(editado)

    def test_un_glosario_vacio_falla(self, glosario):
        vaciado = copy.deepcopy(glosario)
        vaciado["entradas"] = []
        with pytest.raises(AssertionError, match="glosario vacío"):
            verificar_procedencia(vaciado)

    def test_una_procedencia_sin_commit_falla(self, glosario):
        sin_commit = copy.deepcopy(glosario)
        sin_commit["commit_fuente"] = ""
        with pytest.raises(AssertionError, match="commit"):
            verificar_procedencia(sin_commit)

    def test_una_divergencia_sintetica_en_backend_pone_el_gate_rojo(self, glosario, textos):
        divergente = [*USOS_BACKEND, ("backend:prompt", "membresia", "Sección Biblioteca")]
        with pytest.raises(AssertionError, match="backend:prompt"):
            verificar_usos(glosario["entradas"], divergente, textos)

    def test_una_divergencia_sintetica_en_frontend_pone_el_gate_rojo(self, glosario, textos):
        divergente = [*USOS_FRONTEND, ("frontend:ayuda", "ficha_medica", "Historia clínica")]
        with pytest.raises(AssertionError, match="frontend:ayuda"):
            verificar_usos(glosario["entradas"], divergente, textos)

    def test_un_conjunto_de_usos_vacio_falla(self, glosario, textos):
        with pytest.raises(AssertionError, match="vacío"):
            verificar_usos(glosario["entradas"], [], textos)

    def test_un_uso_que_referencia_una_entrada_inexistente_falla(self, glosario, textos):
        uso = [("backend:prompt", "categoria_imaginaria", "Categoría")]
        with pytest.raises(AssertionError, match="inexistente"):
            verificar_usos(glosario["entradas"], uso, textos)


class TestInventarioDeDivergencias:
    def test_las_divergencias_conocidas_quedan_inventariadas_y_asignables(self):
        contrato = CONTRATO.read_text(encoding="utf-8")
        for evidencia in ("Jugador", "socio", "mensualidad"):
            assert evidencia in contrato, evidencia
        assert "Issues hijos" in contrato
