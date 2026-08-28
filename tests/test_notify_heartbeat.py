"""Focused contracts for the heartbeat ping (notify-heartbeat.sh).

El heartbeat es un dead-man's-switch: el monitor externo alerta cuando el ping
DEJA de llegar. Su URL lleva el token en el path, así que quien la lea puede
pingear a mano y dejar la alarma en verde para siempre mientras el backup está
muerto. Por eso la propiedad que más se prueba acá no es que pingee: es que la
URL no aparezca NUNCA en la salida, ni en el camino feliz ni en ninguna falla.
"""

import os
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent
SCRIPT = "scripts/ops/notify-heartbeat.sh"

# URL de mentira, inconfundible: si estos bytes aparecen en stdout o stderr, es
# porque el script los imprimió. `.invalid` es un TLD reservado (RFC 2606), así
# que ningún camino de este archivo puede tocar la red de verdad.
URL_DE_PRUEBA = "https://heartbeat.invalid/ping/TOKEN-SECRETO-DE-PRUEBA"

ARCHIVO_REAL_DEL_HOST = Path("/etc/cataclub/heartbeat-url.txt")


def run_script(*args: str, env: dict[str, str] | None = None):
    entorno = {**os.environ, **(env or {})}
    entorno.pop("HEARTBEAT_URL_FILE", None)
    entorno.update(env or {})
    return subprocess.run(
        ["bash", str(ROOT / SCRIPT), *args],
        cwd=ROOT,
        env=entorno,
        capture_output=True,
        text=True,
    )


def _stub_curl(bin_dir: Path, *, exit_code: int = 0) -> Path:
    """`curl` de mentira: anota su argv y, al fallar, filtra la URL por stderr.

    Filtrarla es exactamente lo que hace el curl real ante un fallo de DNS
    (`curl: (6) Could not resolve host: ...`). El stub lo reproduce para que el
    candado de "la URL no sale nunca" pruebe algo: si el script no tapa el
    stderr de curl, estos tests se ponen en rojo.
    """
    bin_dir.mkdir(parents=True, exist_ok=True)
    stub = bin_dir / "curl"
    stub.write_text(
        "#!/usr/bin/env bash\n"
        'printf \'%s\\n\' "$*" >> "$CURL_LOG"\n'
        f"if [ {exit_code} -ne 0 ]; then\n"
        '  printf \'curl: (6) Could not resolve host: %s\\n\' "${*: -1}" >&2\n'
        "fi\n"
        f"exit {exit_code}\n"
    )
    stub.chmod(0o755)
    return stub


def _entorno(tmp_path, bin_dir: Path, archivo: Path) -> dict[str, str]:
    return {
        "HEARTBEAT_URL_FILE": str(archivo),
        "CURL_LOG": str(tmp_path / "curl.log"),
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
    }


def test_pingea_la_url_configurada_sin_imprimirla(tmp_path):
    bin_dir = tmp_path / "bin"
    _stub_curl(bin_dir)
    archivo = tmp_path / "heartbeat-url.txt"
    archivo.write_text(f"{URL_DE_PRUEBA}\n")

    result = run_script(env=_entorno(tmp_path, bin_dir, archivo))

    assert result.returncode == 0, result.stderr
    invocacion = (tmp_path / "curl.log").read_text()
    assert URL_DE_PRUEBA in invocacion, "el heartbeat no llegó a pingear la URL"
    assert "-m 10" in invocacion, "el ping tiene que llevar timeout"
    assert URL_DE_PRUEBA not in result.stdout + result.stderr, (
        "la URL del heartbeat no puede aparecer en la salida: quien la lee "
        "puede silenciar la alarma pingeando a mano"
    )


def test_falla_sin_imprimir_la_url_cuando_el_ping_no_sale(tmp_path):
    """El curl real nombra el host al fallar; el script no puede dejar pasar eso."""
    bin_dir = tmp_path / "bin"
    _stub_curl(bin_dir, exit_code=6)
    archivo = tmp_path / "heartbeat-url.txt"
    archivo.write_text(f"{URL_DE_PRUEBA}\n")

    result = run_script(env=_entorno(tmp_path, bin_dir, archivo))

    assert result.returncode != 0
    assert URL_DE_PRUEBA not in result.stdout + result.stderr
    assert "heartbeat.invalid" not in result.stdout + result.stderr
    assert "6" in result.stderr, "el código de salida de curl es el único diagnóstico"


def test_falla_si_el_archivo_no_existe(tmp_path):
    bin_dir = tmp_path / "bin"
    _stub_curl(bin_dir)
    archivo = tmp_path / "no-existe.txt"

    result = run_script(env=_entorno(tmp_path, bin_dir, archivo))

    assert result.returncode != 0
    assert str(archivo) in result.stderr, "el error tiene que nombrar el archivo"
    assert not (tmp_path / "curl.log").exists(), "no se pingea sin URL configurada"


def test_falla_si_el_archivo_esta_vacio(tmp_path):
    bin_dir = tmp_path / "bin"
    _stub_curl(bin_dir)
    archivo = tmp_path / "heartbeat-url.txt"
    archivo.write_text("")

    result = run_script(env=_entorno(tmp_path, bin_dir, archivo))

    assert result.returncode != 0
    assert str(archivo) in result.stderr
    assert not (tmp_path / "curl.log").exists()


def test_falla_si_el_archivo_solo_tiene_espacios(tmp_path):
    """Un archivo creado con `touch` y editado a medias no es una configuración."""
    bin_dir = tmp_path / "bin"
    _stub_curl(bin_dir)
    archivo = tmp_path / "heartbeat-url.txt"
    archivo.write_text("   \n\t\n \n")

    result = run_script(env=_entorno(tmp_path, bin_dir, archivo))

    assert result.returncode != 0
    assert str(archivo) in result.stderr
    assert not (tmp_path / "curl.log").exists()


def test_rechaza_una_url_que_no_sea_https_sin_imprimirla(tmp_path):
    """El token viaja en el path: en claro lo lee cualquiera en el camino."""
    bin_dir = tmp_path / "bin"
    _stub_curl(bin_dir)
    archivo = tmp_path / "heartbeat-url.txt"
    archivo.write_text("http://heartbeat.invalid/ping/TOKEN-SECRETO-DE-PRUEBA\n")

    result = run_script(env=_entorno(tmp_path, bin_dir, archivo))

    assert result.returncode != 0
    assert "TOKEN-SECRETO-DE-PRUEBA" not in result.stdout + result.stderr
    assert "https" in result.stderr
    assert not (tmp_path / "curl.log").exists()


def test_ignora_lineas_en_blanco_y_espacios_alrededor_de_la_url(tmp_path):
    bin_dir = tmp_path / "bin"
    _stub_curl(bin_dir)
    archivo = tmp_path / "heartbeat-url.txt"
    archivo.write_text(f"\n  \n  {URL_DE_PRUEBA}  \n")

    result = run_script(env=_entorno(tmp_path, bin_dir, archivo))

    assert result.returncode == 0, result.stderr
    invocado = (tmp_path / "curl.log").read_text().strip().split()
    assert invocado[-1] == URL_DE_PRUEBA, (
        f"la URL llegó a curl con basura alrededor: {invocado[-1]!r}"
    )


def test_corre_con_el_entorno_minimo_de_cron(tmp_path):
    """Cron no hereda el shell del operador: `PATH=/usr/bin:/bin` y nada más.

    Sin `HOME`, sin `PATH` del operador y sin ninguna variable exportada, el
    script tiene que llegar igual a su propia lógica. Se ejercita el camino de
    archivo ausente a propósito: es el único que no necesita stubear `curl`, y
    llegar a ese mensaje ya prueba que todo lo que el script usa antes resuelve
    dentro del PATH mínimo.
    """
    archivo = tmp_path / "no-existe.txt"

    result = subprocess.run(
        ["bash", str(ROOT / SCRIPT)],
        cwd=ROOT,
        env={"PATH": "/usr/bin:/bin", "HEARTBEAT_URL_FILE": str(archivo)},
        capture_output=True,
        text=True,
    )

    assert result.returncode != 0
    assert str(archivo) in result.stderr, (
        "el script no llegó a su propia lógica con el PATH mínimo del cron: "
        f"{result.stderr!r}"
    )


@pytest.mark.skipif(
    ARCHIVO_REAL_DEL_HOST.exists(),
    reason="la máquina que corre la suite tiene un heartbeat configurado de verdad",
)
def test_lee_por_defecto_el_archivo_documentado_del_host(tmp_path):
    """El default no puede derivar del que documenta provisioning.md."""
    bin_dir = tmp_path / "bin"
    _stub_curl(bin_dir)

    result = run_script(
        env={
            "CURL_LOG": str(tmp_path / "curl.log"),
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
        }
    )

    assert result.returncode != 0
    assert str(ARCHIVO_REAL_DEL_HOST) in result.stderr
