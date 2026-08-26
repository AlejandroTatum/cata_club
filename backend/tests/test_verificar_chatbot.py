"""
Tests del smoke check no sensible del proveedor del chatbot (issue #645).

El script corre DENTRO del contenedor backend
(`docker compose exec backend uv run python scripts/verificar_chatbot.py`),
así que mira el mismo proceso que atiende las consultas. Lo que se prueba acá:

  - los tres estados salen con códigos de salida distinguibles;
  - `--exigir` convierte "ausente" en fallo para el despliegue que SÍ
    habilitó el chatbot, sin convertirlo en fallo para el que no;
  - nada de lo que imprime contiene la clave ni un fragmento de la clave,
    ni siquiera cuando el valor configurado es el que está mal.

Mismo montaje `importlib` que `test_crear_primer_admin.py`: el script vive
fuera del paquete `app`, y así se ejercita el archivo real que corre en
producción, no una copia.
"""
import importlib.util
from pathlib import Path

import pytest

from app.soporte_transversal.diagnostico_chatbot import diagnosticar

SCRIPT = Path(__file__).parents[1] / "scripts" / "verificar_chatbot.py"

CLAVE_FALSA = "clave-inventada-solo-para-tests-qwx9v8u7t6"


def _cargar_modulo():
    spec = importlib.util.spec_from_file_location("verificar_chatbot", SCRIPT)
    modulo = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(modulo)
    return modulo


def _correr(argv, valor):
    """Corre el script con un diagnóstico inyectado y devuelve
    `(codigo_de_salida, texto_impreso)`."""
    modulo = _cargar_modulo()
    salida: list[str] = []
    codigo = modulo.main(
        argv,
        diagnosticar_ahora=lambda: diagnosticar(valor),
        escribir=salida.append,
    )
    return codigo, "\n".join(salida)


def _fragmentos(clave: str, largo: int = 8) -> list[str]:
    return [clave[i : i + largo] for i in range(len(clave) - largo + 1)]


# ─── Los tres estados, con códigos de salida distinguibles ─────────────────


def test_una_clave_configurada_sale_con_exito():
    codigo, texto = _correr([], CLAVE_FALSA)

    assert codigo == 0
    assert "configurada" in texto


def test_una_clave_ausente_no_falla_porque_el_chatbot_conserva_su_faq_local():
    codigo, texto = _correr([], "")

    assert codigo == 0
    assert "ausente" in texto


def test_una_clave_incompleta_siempre_falla_porque_nadie_la_configura_asi():
    codigo, texto = _correr([], "<api-key>")

    assert codigo == 1
    assert "incompleta" in texto


def test_exigir_convierte_la_ausencia_en_fallo_para_un_despliegue_que_la_habilito():
    codigo, _ = _correr(["--exigir"], "")

    assert codigo == 2


def test_exigir_no_cambia_el_resultado_de_una_clave_configurada():
    assert _correr(["--exigir"], CLAVE_FALSA)[0] == 0


def test_los_tres_codigos_de_salida_son_distintos_entre_si():
    codigos = {
        _correr(["--exigir"], CLAVE_FALSA)[0],
        _correr(["--exigir"], "")[0],
        _correr(["--exigir"], "<api-key>")[0],
    }

    assert len(codigos) == 3


# ─── No sensible: la salida nunca materializa el secreto ──────────────────


# `(valor configurado, credencial que ese valor contiene)`. Los fragmentos se
# buscan sobre la CREDENCIAL, no sobre la línea entera: la línea mal escrita
# arrastra texto del operador (un comentario, unas comillas) que el mensaje de
# ayuda nombra a propósito, y buscar fragmentos de eso mide la redacción del
# consejo en vez del filtrado del secreto. La línea completa igual se exige
# ausente en la primera aserción.
_VALORES_CON_SU_CREDENCIAL = [
    (CLAVE_FALSA, CLAVE_FALSA),
    (f'"{CLAVE_FALSA}"', CLAVE_FALSA),
    (f" {CLAVE_FALSA}", CLAVE_FALSA),
    (f"{CLAVE_FALSA} # comentario", CLAVE_FALSA),
    ("<api-key>", "<api-key>"),
]


@pytest.mark.parametrize("valor,credencial", _VALORES_CON_SU_CREDENCIAL)
@pytest.mark.parametrize("argv", [[], ["--exigir"]])
def test_la_salida_nunca_contiene_la_clave_ni_un_fragmento_suyo(valor, credencial, argv):
    _, texto = _correr(argv, valor)

    assert valor not in texto
    assert valor.strip() not in texto
    assert credencial not in texto
    for fragmento in _fragmentos(credencial):
        assert fragmento not in texto, (
            f"el smoke check imprimió un fragmento de la credencial "
            f"({fragmento!r}); su salida va a logs de despliegue y a pantallas "
            f"compartidas, y no puede materializar el secreto"
        )


def test_la_huella_impresa_permite_ver_una_rotacion_sin_ver_ninguna_clave():
    _, antes = _correr([], CLAVE_FALSA)
    _, despues = _correr([], "clave-inventada-tras-rotar-en-tests-t6u7v8")

    assert "sha256:" in antes and "sha256:" in despues
    assert antes != despues


def test_no_imprime_ninguna_huella_cuando_no_hay_clave_configurada():
    """Una huella de la cadena vacía sería la misma constante en todos los
    despliegues sin clave y se leería como una configuración real."""
    for valor in ("", "<api-key>"):
        assert "sha256:" not in _correr([], valor)[1]


# ─── No toca la red: es un chequeo de configuración, no de conectividad ───


def test_el_script_no_importa_ningun_cliente_http_ni_el_sdk_del_proveedor():
    """Un smoke check que llamara al gateway gastaría tokens en cada deploy y
    metería la clave en una request; este solo mira la configuración local."""
    fuente = SCRIPT.read_text(encoding="utf-8")

    for prohibido in ("import openai", "import httpx", "import requests", "urllib"):
        assert prohibido not in fuente


# ─── El runbook no puede desincronizarse del script ───────────────────────
#
# El contrato operativo de esta clave vive en `docs/operations/provisioning.md`
# y lo lee un operador con producción delante. Un runbook que promete un código
# de salida que el script ya no devuelve es peor que no tener runbook: el
# `if` del script de despliegue que lo encadena se rompe en silencio. Por eso
# los códigos NO se releen de una constante ni se copian del texto: se
# OBSERVAN corriendo el script, y el documento se valida contra lo observado.

RUNBOOK = Path(__file__).parents[2] / "docs" / "operations" / "provisioning.md"


def _lineas_del_runbook() -> list[str]:
    return RUNBOOK.read_text(encoding="utf-8").splitlines()


def test_el_runbook_documenta_el_comando_exacto_del_smoke_check():
    texto = RUNBOOK.read_text(encoding="utf-8")

    assert "scripts/verificar_chatbot.py" in texto
    assert SCRIPT.exists(), "el runbook nombra un script que no existe"


def test_el_runbook_documenta_el_codigo_de_salida_real_de_cada_estado():
    observados = {
        "configurada": _correr(["--exigir"], CLAVE_FALSA)[0],
        "ausente": _correr(["--exigir"], "")[0],
        "incompleta": _correr(["--exigir"], "<api-key>")[0],
    }

    for estado, codigo in observados.items():
        assert any(
            estado in linea and str(codigo) in linea for linea in _lineas_del_runbook()
        ), (
            f"el runbook no documenta que el estado '{estado}' sale con "
            f"código {codigo}; corriendo el script se observa ese código y "
            f"un despliegue que encadene el chequeo va a decidir con el "
            f"número equivocado"
        )


def test_el_runbook_cubre_las_cuatro_operaciones_que_pide_el_issue_645():
    """Comprobación de PRESENCIA, no de exactitud: prueba que la sección
    existe y nombra las cuatro operaciones, no que el procedimiento sea
    correcto. Lo que sí queda verificado de verdad es el comando y los
    códigos de salida, arriba."""
    texto = RUNBOOK.read_text(encoding="utf-8").lower()

    for operacion in ("configuración inicial", "verificación", "rotación", "revocación"):
        assert operacion in texto, f"el runbook no cubre la {operacion} de la clave"


def test_el_runbook_no_contiene_ninguna_clave_con_forma_de_credencial_real():
    """El runbook se edita a mano y es el lugar más probable donde alguien
    pegue una clave real "solo para el ejemplo"."""
    import re

    texto = RUNBOOK.read_text(encoding="utf-8")
    # El valor no puede incluir un backtick ni un paréntesis de cierre: son
    # sintaxis de markdown alrededor del ejemplo, no parte de lo que el
    # operador escribiría en su `.env`. Con `\S+` a secas, `OPENCODE_API_KEY=`
    # dentro de un `código inline` capturaba el backtick y este guard medía la
    # redacción del documento en vez del secreto.
    sospechosas = re.findall(r"OPENCODE_API_KEY\s*=\s*([^\s`)]+)", texto)

    for valor in sospechosas:
        assert valor.startswith("<") or valor in ("", "''", '""'), (
            f"el runbook trae un valor literal para OPENCODE_API_KEY ({valor!r}); "
            f"solo puede mostrar un placeholder entre <>"
        )


# ─── Ejecutado como lo ejecuta un operador ────────────────────────────────
#
# Los tests de arriba cargan el módulo con `importlib` desde el cwd de pytest,
# donde `app` ya está en `sys.path`. Un operador NO lo corre así: lo corre
# `python scripts/verificar_chatbot.py`, y ahí `sys.path[0]` es `scripts/`, no
# la raíz del backend. Este test es la única forma de ver esa diferencia.


def _correr_como_subproceso(valor: str):
    import os
    import subprocess
    import sys

    raiz_backend = Path(__file__).parents[1]
    entorno = {
        **os.environ,
        "AMBIENTE": "development",
        "JWT_SECRET_KEY": "a1b2c3d4" * 8,
        "OPENCODE_API_KEY": valor,
    }
    return subprocess.run(
        [sys.executable, str(SCRIPT)],
        capture_output=True,
        text=True,
        cwd=raiz_backend,
        env=entorno,
    )


@pytest.mark.parametrize(
    "valor,codigo_esperado",
    [(CLAVE_FALSA, 0), ("", 0), ("<api-key>", 1)],
)
def test_el_script_corre_por_ruta_como_lo_documenta_el_runbook(valor, codigo_esperado):
    resultado = _correr_como_subproceso(valor)

    assert resultado.returncode == codigo_esperado, (
        f"el script falló al invocarlo por ruta (stderr: {resultado.stderr!r}); "
        f"es exactamente la invocación que documenta el runbook"
    )
    assert "Proveedor del chatbot" in resultado.stdout


def test_la_salida_del_subproceso_tampoco_contiene_la_credencial():
    resultado = _correr_como_subproceso(CLAVE_FALSA)
    todo = resultado.stdout + resultado.stderr

    for fragmento in _fragmentos(CLAVE_FALSA):
        assert fragmento not in todo, (
            "la ejecución real del smoke check imprimió un fragmento de la "
            "credencial en stdout o stderr"
        )


@pytest.mark.parametrize(
    "ejemplo",
    [".env.example", ".env.production.example", "backend/.env.example"],
)
def test_ningun_archivo_de_ejemplo_trae_un_valor_para_la_clave(ejemplo):
    """Los `.env*.example` SÍ se commitean -- son la plantilla que el operador
    copia -- así que el guard de CI que rechaza `.env` reales no los mira. Es
    el lugar donde una clave real pasaría desapercibida."""
    import re

    raiz = Path(__file__).parents[2]
    for linea in (raiz / ejemplo).read_text(encoding="utf-8").splitlines():
        coincidencia = re.match(r"^\s*#?\s*OPENCODE_API_KEY\s*=\s*(.*)$", linea)
        if coincidencia is None:
            continue
        valor = coincidencia.group(1).strip()
        assert valor == "" or valor.startswith("<"), (
            f"{ejemplo} trae un valor para OPENCODE_API_KEY ({valor!r}); "
            f"una plantilla solo puede quedar vacía o mostrar un placeholder"
        )


def test_por_defecto_diagnostica_la_configuracion_real_del_proceso(monkeypatch):
    """Sin inyección, el script mira `settings.opencode_api_key` -- el mismo
    valor que `ChatbotServicio` le pasa al cliente del gateway."""
    from app.soporte_transversal import configuracion

    monkeypatch.setattr(configuracion.settings, "opencode_api_key", CLAVE_FALSA)
    modulo = _cargar_modulo()
    salida: list[str] = []

    assert modulo.main([], escribir=salida.append) == 0
    assert "configurada" in "\n".join(salida)
