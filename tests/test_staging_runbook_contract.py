"""Candado de acceso de host en los runbooks públicos (issue #1065).

El runbook público de redeploy de staging llegó a publicar un ejemplo SSH con
usuario literal e IPv4 pública del host. La corrección quedó aplicada en el
árbol (el ejemplo usa placeholders), pero nada impedía que la misma forma
volviera a colarse en otro runbook. Este candado la hace determinista.

Tres capas, con alcances deliberadamente distintos:

  · Barrido de los runbooks versionados bajo `docs/`: ningún documento
    versionado puede contener la forma literal `usuario@<IPv4>` (usuario sin
    placeholder seguido de un dotted-quad). El barrido corre sobre
    `git ls-files -- docs/` por dos razones: los runbooks de operaciones son
    la superficie pública donde viven los ejemplos SSH, y el propio fixture de
    este candado (que contiene la forma prohibida como dato de test) vive en
    `tests/`, fuera del alcance del barrido. Si algún día el alcance se
    ensancha, la exclusión del fixture tiene que volverse una lista explícita
    como `ARCHIVOS_DEL_CANDADO` en `test_copy_ortografia_contract.py`, nunca
    una heurística silenciosa.

  · Fixture sintético: demuestra que el detector tiene dientes reproduciendo
    la forma filtrada con `192.0.2.10` (RFC 5737, TEST-NET-1, reservado para
    documentación) y que no se marca el texto limpio equivalente. El valor
    real filtrado nunca se escribe en este archivo ni en ningún otro.

  · Contrato de enlaces: el runbook público de staging no documenta acceso de
    host por su cuenta; deriva el segundo operador y el endurecimiento a
    `provisioning.md`. Si el enlace se rompe, el operador se queda sin la
    guía de etapas y el candado anterior pierde contexto.

Exclusiones compatibles (no calzan con el patrón y no deben marcarse):
placeholders del tipo `<usuario-staging>@<host-staging>`, correos del dominio
del club (`duenio@club.com`) y nombres de host no numéricos. El patrón es
deliberadamente estrecho: prefiere dejar pasar una forma rara a angostar en
silencio lo que hoy es la fuga conocida.

El mensaje de falla reporta archivo y línea pero NO reimprime el texto
encontrado: si el candado agarra una fuga real, el identificador no debe
terminar también en un log de CI.
"""

import re
import subprocess
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]

RUNBOOK_STAGING = RAIZ / "docs" / "operations" / "staging-redeploy.md"
GUIA_PROVISIONING = RAIZ / "docs" / "operations" / "provisioning.md"

# Usuario literal (sin placeholder) seguido de `@` y una IPv4 dotted-quad
# literal. El lookbehind evita partir un token más largo por la mitad y el
# lookahead final evita morder un quinto octeto inexistente.
PATRON_USUARIO_IP = re.compile(
    r"(?<![\w.@-])"
    r"[A-Za-z_][A-Za-z0-9._-]*"
    r"@"
    r"(?:\d{1,3}\.){3}\d{1,3}"
    r"(?!\d)"
)

# Forma filtrada históricamente, reconstruida con datos sintéticos:
# usuario literal + IPv4 de TEST-NET-1 (RFC 5737), válida solo para ejemplos.
FIXTURE_FUGA = "ssh operador@192.0.2.10"

# La forma corregida que hoy vive en el runbook de staging: placeholders.
TEXTO_LIMPIO = "ssh <usuario-staging>@<host-staging>"


def buscar_usuario_ip_literal(texto: str) -> list[int]:
    """Devuelve los números de línea (1-indexados) con la forma prohibida."""
    return [
        numero
        for numero, linea in enumerate(texto.splitlines(), start=1)
        if PATRON_USUARIO_IP.search(linea)
    ]


def _docs_versionados() -> list[Path]:
    resultado = subprocess.run(
        ["git", "ls-files", "--", "docs/"],
        cwd=RAIZ,
        capture_output=True,
        text=True,
        check=True,
    )
    return [RAIZ / linea for linea in resultado.stdout.splitlines() if linea]


class TestBarridoSSH:
    def test_ningun_runbook_versionado_muestra_usuario_ip_literal(self):
        ofensores = []
        for ruta in _docs_versionados():
            texto = ruta.read_text(encoding="utf-8")
            for linea in buscar_usuario_ip_literal(texto):
                # Sin reimprimir el texto encontrado: una fuga real no debe
                # propagarse al log de CI ni a la salida del test.
                ofensores.append(f"{ruta.relative_to(RAIZ)}: línea {linea}")
        assert ofensores == [], (
            "ejemplo SSH con usuario@IPv4 literal encontrado "
            "(ver el archivo en privado y reemplazarlo por placeholders): "
            + ", ".join(ofensores)
        )

    def test_el_detector_marca_la_forma_filtrada_y_no_el_texto_limpio(self):
        assert buscar_usuario_ip_literal(FIXTURE_FUGA) == [1]
        assert buscar_usuario_ip_literal("ssh operador2@192.0.2.10\notra línea") == [1]
        assert buscar_usuario_ip_literal(TEXTO_LIMPIO) == []

    def test_los_placeholders_y_correos_existentes_no_se_marcan(self):
        compatibles = [
            TEXTO_LIMPIO,
            "ssh <usuario>@<host>       # placeholder del runbook",
            "- BOOTSTRAP_ADMIN_EMAIL=duenio@club.com",
            "admin@cataclub.com         # correo del seed de QA",
            "ssh <host>                 # sin usuario, forma de provisioning",
            "curl --fail https://staging.cataclub.com/api/health",
        ]
        for texto in compatibles:
            assert buscar_usuario_ip_literal(texto) == [], repr(texto)


class TestContratoDeEnlace:
    def test_el_runbook_de_staging_deriva_el_acceso_ssh_a_provisioning(self):
        enlace = "provisioning.md#segundo-operador-ssh-y-endurecimiento-del-host"
        assert enlace in RUNBOOK_STAGING.read_text(encoding="utf-8"), (
            "staging-redeploy.md ya no deriva el acceso SSH del host a la "
            "guía de provisioning: el operador se queda sin el runbook de etapas"
        )
        assert "## Segundo operador SSH y endurecimiento del host" in (
            GUIA_PROVISIONING.read_text(encoding="utf-8")
        ), "la sección enlazada ya no existe en provisioning.md"
