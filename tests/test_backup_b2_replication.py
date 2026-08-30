"""Contratos de la réplica cifrada fuera del host (Backblaze B2, API S3).

El backup local ya sale cifrado de `backup-db.sh`, pero vive en el MISMO disco
que la aplicación (`monitoring.md`, follow-up 3). La pérdida total del droplet
se lleva el padrón entero. Lo que falta es copiar el artefacto **ya cifrado** a
un object store, sin que la identidad `age` privada aparezca nunca en el host.

De ahí salen las propiedades que se verifican acá:

* solo se replica el artefacto COMPLETO y CIFRADO (`.dump.age`); un `.dump` en
  claro o un `.tmp` a medio escribir se rechaza antes de tocar la red;
* la réplica se verifica contra el objeto remoto (tamaño + sha256 propio, más
  el listado del bucket), porque un `put` que sale 0 no prueba que haya algo
  legible del otro lado;
* si la réplica está activada y falla, el backup falla — fail-closed, igual que
  el cifrado;
* las credenciales de B2 no salen por stdout, ni por stderr, ni por `argv`;
* la retención local no cambia: replicar no borra nada del disco.

Todo es hermético: `aws` es un doble en el PATH que hace round-trip real sobre
el cuerpo que recibe. Ni red, ni credenciales reales, ni bucket real.
"""

import hashlib
import os
import shlex
import shutil
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent

# Valores de mentira con forma de credencial real: la aserción "esto no aparece
# en la salida" solo significa algo si el literal es distinguible.
KEY_ID_FALSO = "0055aabbccddeeff0000000012"
APP_KEY_FALSA = "K005NoEsUnaClaveRealPeroLoParece0123456"

BUCKET_PRODUCCION = "cataclub-prod-backups-loja-ec"

# El doble de `aws`. Hace round-trip real: `put-object` guarda tamaño y sha256
# del `--body` que recibió y `head-object` los devuelve, así el camino feliz
# ejercita la verificación de verdad en vez de comparar dos constantes.
#
# Todo su comportamiento se inyecta por entorno (códigos de salida, valores
# remotos corruptos, fuga de credenciales), así que hay UN solo doble y cada
# test cambia exactamente una cosa.
#
# Registra `argv` y el entorno de cada invocación: es lo que permite afirmar
# que la credencial viaja por el entorno del proceso hijo y NUNCA por la línea
# de comandos, que `ps` lista para cualquier usuario del host.
AWS_FALSO = r"""#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_AWS_ARGV"
printf 'id=%s secreto=%s\n' "${AWS_ACCESS_KEY_ID:-}" "${AWS_SECRET_ACCESS_KEY:-}" \
  >> "$FAKE_AWS_ENV"
if [ "${FAKE_AWS_LEAK:-0}" = "1" ]; then
  printf 'fuga id=%s secreto=%s\n' "${AWS_ACCESS_KEY_ID:-}" \
    "${AWS_SECRET_ACCESS_KEY:-}" >&2
fi

sub=""; cuerpo=""; clave=""; prefijo=""; previo=""
for a in "$@"; do
  case "$a" in
    put-object|head-object|list-objects-v2) [ -z "$sub" ] && sub="$a" ;;
  esac
  [ "$previo" = "--body" ] && cuerpo="$a"
  [ "$previo" = "--key" ] && clave="$a"
  [ "$previo" = "--prefix" ] && prefijo="$a"
  previo="$a"
done

case "$sub" in
  put-object)
    [ -n "$cuerpo" ] || { echo "put-object sin --body" >&2; exit 64; }
    rc="${FAKE_AWS_PUT_RC:-0}"
    [ "$rc" -eq 0 ] || { echo "An error occurred (InvalidAccessKeyId)" >&2; exit "$rc"; }
    wc -c < "$cuerpo" | tr -d ' ' > "${FAKE_AWS_STATE}.size"
    sha256sum "$cuerpo" | cut -d' ' -f1 > "${FAKE_AWS_STATE}.sha"
    printf '%s' "$clave" > "${FAKE_AWS_STATE}.key"
    ;;
  head-object)
    rc="${FAKE_AWS_HEAD_RC:-0}"
    [ "$rc" -eq 0 ] || {
      echo "An error occurred (404) when calling the HeadObject operation" >&2
      exit "$rc"
    }
    printf '%s\t%s\n' \
      "${FAKE_AWS_SIZE:-$(cat "${FAKE_AWS_STATE}.size")}" \
      "${FAKE_AWS_SHA:-$(cat "${FAKE_AWS_STATE}.sha")}"
    ;;
  list-objects-v2)
    rc="${FAKE_AWS_LIST_RC:-0}"
    [ "$rc" -eq 0 ] || { echo "An error occurred (AccessDenied)" >&2; exit "$rc"; }
    if [ -n "${FAKE_AWS_LISTADO+definida}" ]; then
      printf '%s\n' "$FAKE_AWS_LISTADO"
      exit 0
    fi
    # El listado devuelve la clave que REALMENTE se subió, y solo si cae bajo
    # el prefijo consultado. Una constante acá haría que el test dependiera de
    # la fecha del día (el artefacto lleva `date +%F` en el nombre) y que un
    # prefijo equivocado pasara igual.
    subida="$(cat "${FAKE_AWS_STATE}.key" 2>/dev/null || true)"
    case "$subida" in
      "$prefijo"*) printf '%s\n' "$subida" ;;
      *) printf '\n' ;;
    esac
    ;;
esac
exit 0
"""


def run_script(script: str, *args: str, env: dict[str, str] | None = None):
    return subprocess.run(
        ["bash", str(ROOT / script), *args],
        cwd=ROOT,
        env={**os.environ, **(env or {})},
        capture_output=True,
        text=True,
    )


requiere_age = pytest.mark.skipif(
    shutil.which("age") is None or shutil.which("age-keygen") is None,
    reason="requiere `age` y `age-keygen` en PATH (CI los instala)",
)


# --- Dobles ------------------------------------------------------------------


def _aws_falso(bin_dir: Path) -> None:
    bin_dir.mkdir(parents=True, exist_ok=True)
    falso = bin_dir / "aws"
    falso.write_text(AWS_FALSO)
    falso.chmod(0o755)


def _docker_que_emite_un_dump(bin_dir: Path, contenido: str) -> None:
    """`docker` de mentira para backup-db.sh: escribe el dump en stdout."""
    bin_dir.mkdir(parents=True, exist_ok=True)
    falso = bin_dir / "docker"
    falso.write_text(f"#!/usr/bin/env bash\nprintf '%s' {shlex.quote(contenido)}\n")
    falso.chmod(0o755)


def _par_de_claves_age(tmp_path: Path) -> tuple[Path, str]:
    """Genera una identidad age y devuelve (archivo de identidad, destinatario)."""
    identidad = tmp_path / "identidad.txt"
    resultado = subprocess.run(
        ["age-keygen", "-o", str(identidad)], capture_output=True, text=True
    )
    assert resultado.returncode == 0, resultado.stderr
    destinatario = next(
        linea.split(":", 1)[1].strip()
        for linea in resultado.stderr.splitlines()
        if linea.startswith("Public key:")
    )
    return identidad, destinatario


# --- Entornos ----------------------------------------------------------------


def _entorno_b2(tmp_path: Path, **extra: str) -> dict[str, str]:
    bin_dir = tmp_path / "bin"
    _aws_falso(bin_dir)
    entorno = {
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "FAKE_AWS_ARGV": str(tmp_path / "argv.log"),
        "FAKE_AWS_ENV": str(tmp_path / "env.log"),
        "FAKE_AWS_STATE": str(tmp_path / "estado"),
        "BACKUP_B2_ENABLED": "1",
        "BACKUP_B2_ENDPOINT": "https://s3.us-west-004.backblazeb2.com",
        "BACKUP_B2_REGION": "us-west-004",
        "BACKUP_B2_BUCKET": "cataclub-backups-test",
        "BACKUP_B2_PREFIX": "cataclub/produccion",
        "BACKUP_B2_KEY_ID": KEY_ID_FALSO,
        "BACKUP_B2_APPLICATION_KEY": APP_KEY_FALSA,
        # Hermético: nunca leer el /etc real de la máquina que corre la suite.
        "BACKUP_B2_CONFIG_FILE": str(tmp_path / "no-existe" / "b2.env"),
    }
    entorno.update(extra)
    return entorno


def _entorno_de_backup(tmp_path: Path, **extra: str) -> dict[str, str]:
    backups = tmp_path / "backups"
    backups.mkdir(exist_ok=True)
    entorno = _entorno_b2(
        tmp_path,
        BACKUP_DIR=str(backups),
        BACKUP_STACK_DIR=str(tmp_path),
        BACKUP_AGE_RECIPIENTS_FILE=str(tmp_path / "no-existe" / "recipients.txt"),
        BACKUP_AGE_RECIPIENTS="",
        BACKUP_ALLOW_PLAINTEXT="",
        AMBIENTE="",
    )
    entorno.update(extra)
    return entorno


def _artefacto_cifrado(
    tmp_path: Path, contenido: bytes = b"age-encryption.org/v1\nx"
) -> Path:
    backups = tmp_path / "backups"
    backups.mkdir(exist_ok=True)
    artefacto = backups / "cataclub_2026-08-29.dump.age"
    artefacto.write_bytes(contenido)
    return artefacto


def _argv(tmp_path: Path) -> str:
    log = tmp_path / "argv.log"
    return log.read_text() if log.exists() else ""


def _artefactos(tmp_path: Path) -> list[str]:
    return sorted(p.name for p in (tmp_path / "backups").iterdir())


# --- Réplica desactivada -----------------------------------------------------


def test_la_replicacion_desactivada_no_llama_a_aws_y_sale_cero(tmp_path):
    """Sin réplica configurada el uploader es un no-op silencioso.

    Es lo que permite cablearlo incondicionalmente en `backup-db.sh` sin romper
    ni el desarrollo local ni un host que todavía no tiene bucket.
    """
    artefacto = _artefacto_cifrado(tmp_path)

    resultado = run_script(
        "scripts/backup/upload-b2.sh",
        str(artefacto),
        env=_entorno_b2(tmp_path, BACKUP_B2_ENABLED="0"),
    )

    assert resultado.returncode == 0, resultado.stderr
    assert _argv(tmp_path) == ""
    assert artefacto.exists()


# --- Solo el artefacto completo y cifrado ------------------------------------


@pytest.mark.parametrize(
    "nombre",
    [
        "cataclub_2026-08-29.dump",  # el padrón EN CLARO
        "cataclub_2026-08-29.dump.age.tmp",  # a medio escribir
        "cataclub_2026-08-29.sql.gz",
        "identidad.txt",
    ],
)
def test_rechaza_todo_lo_que_no_sea_un_dump_age_completo(tmp_path, nombre):
    """Un `.dump` es el padrón en claro; un `.tmp` es un dump a medio escribir.

    Ninguno de los dos puede salir del host. El rechazo ocurre ANTES de
    cualquier llamada a la red: si el filtro fallara y la subida fallara
    después por otra razón, el control seguiría pareciendo que funciona.
    """
    archivo = tmp_path / nombre
    archivo.write_bytes(b"lo que sea")

    resultado = run_script(
        "scripts/backup/upload-b2.sh", str(archivo), env=_entorno_b2(tmp_path)
    )

    assert resultado.returncode != 0, resultado.stdout
    assert ".dump.age" in resultado.stderr
    assert _argv(tmp_path) == ""


def test_rechaza_un_artefacto_inexistente(tmp_path):
    resultado = run_script(
        "scripts/backup/upload-b2.sh",
        str(tmp_path / "no-existe.dump.age"),
        env=_entorno_b2(tmp_path),
    )

    assert resultado.returncode != 0
    assert _argv(tmp_path) == ""


def test_rechaza_una_invocacion_sin_artefacto(tmp_path):
    resultado = run_script("scripts/backup/upload-b2.sh", env=_entorno_b2(tmp_path))

    assert resultado.returncode != 0
    assert _argv(tmp_path) == ""


# --- Configuración faltante --------------------------------------------------


@pytest.mark.parametrize(
    "variable",
    [
        "BACKUP_B2_ENDPOINT",
        "BACKUP_B2_REGION",
        "BACKUP_B2_BUCKET",
        "BACKUP_B2_PREFIX",
        "BACKUP_B2_KEY_ID",
        "BACKUP_B2_APPLICATION_KEY",
    ],
)
def test_la_configuracion_incompleta_falla_y_nombra_la_variable(tmp_path, variable):
    """Réplica activada + configuración a medias = falla ruidosa, no silencio.

    El mensaje nombra la variable que falta porque quien lo lee está en un
    droplet a las 03:30 y no tiene este archivo abierto al lado.
    """
    artefacto = _artefacto_cifrado(tmp_path)

    resultado = run_script(
        "scripts/backup/upload-b2.sh",
        str(artefacto),
        env=_entorno_b2(tmp_path, **{variable: ""}),
    )

    assert resultado.returncode != 0, resultado.stdout
    assert variable in resultado.stderr
    assert _argv(tmp_path) == ""


def test_lee_las_credenciales_de_un_archivo_cuando_no_estan_en_el_entorno(tmp_path):
    """El cron no hereda el shell del operador; un archivo sí está a las 03:30.

    Es el mismo reparto que ya usa `BACKUP_AGE_RECIPIENTS_FILE`.
    """
    artefacto = _artefacto_cifrado(tmp_path)
    credenciales = tmp_path / "b2.env"
    credenciales.write_text(
        "# credenciales de la aplicación B2\n"
        f"BACKUP_B2_KEY_ID={KEY_ID_FALSO}\n"
        f"BACKUP_B2_APPLICATION_KEY={APP_KEY_FALSA}\n"
    )

    resultado = run_script(
        "scripts/backup/upload-b2.sh",
        str(artefacto),
        env=_entorno_b2(
            tmp_path,
            BACKUP_B2_KEY_ID="",
            BACKUP_B2_APPLICATION_KEY="",
            BACKUP_B2_CONFIG_FILE=str(credenciales),
        ),
    )

    assert resultado.returncode == 0, resultado.stderr
    assert f"id={KEY_ID_FALSO}" in (tmp_path / "env.log").read_text()


def test_el_archivo_de_credenciales_no_se_ejecuta(tmp_path):
    """Se parsea `CLAVE=valor`; no se hace `source`.

    Un `source` convierte un archivo de configuración en ejecución de código
    con el usuario del cron. El testigo prueba que la línea de más no corrió.
    """
    artefacto = _artefacto_cifrado(tmp_path)
    testigo = tmp_path / "ejecutado"
    credenciales = tmp_path / "b2.env"
    credenciales.write_text(
        f"BACKUP_B2_KEY_ID={KEY_ID_FALSO}\n"
        f"BACKUP_B2_APPLICATION_KEY={APP_KEY_FALSA}\n"
        f"touch {testigo}\n"
    )

    run_script(
        "scripts/backup/upload-b2.sh",
        str(artefacto),
        env=_entorno_b2(
            tmp_path,
            BACKUP_B2_KEY_ID="",
            BACKUP_B2_APPLICATION_KEY="",
            BACKUP_B2_CONFIG_FILE=str(credenciales),
        ),
    )

    assert not testigo.exists(), "el archivo de credenciales se ejecutó"


def test_el_archivo_de_configuracion_alcanza_para_activar_la_replica(tmp_path):
    """El cron corre con un entorno mínimo; el archivo tiene que alcanzar solo.

    Es la corrida que importa: la de las 03:30. Si activar la réplica exigiera
    un `export` en la terminal del operador, la réplica estaría activada
    exactamente en la sesión donde nadie la necesita y apagada todas las
    noches, sin que nada lo diga. Mismo reparto que
    `BACKUP_AGE_RECIPIENTS_FILE`.
    """
    artefacto = _artefacto_cifrado(tmp_path)
    config = tmp_path / "b2.env"
    config.write_text(
        "# Replica del backup cifrado fuera del host\n"
        "BACKUP_B2_ENABLED=1\n"
        "BACKUP_B2_ENDPOINT=https://s3.us-west-004.backblazeb2.com\n"
        "BACKUP_B2_REGION=us-west-004\n"
        "BACKUP_B2_BUCKET=cataclub-desde-el-archivo\n"
        "BACKUP_B2_PREFIX=cataclub/produccion\n"
        f"BACKUP_B2_KEY_ID={KEY_ID_FALSO}\n"
        f"BACKUP_B2_APPLICATION_KEY={APP_KEY_FALSA}\n"
    )
    entorno = _entorno_b2(tmp_path, BACKUP_B2_CONFIG_FILE=str(config))
    # El cron no trae NADA de esto en el entorno.
    for clave in (
        "BACKUP_B2_ENABLED",
        "BACKUP_B2_ENDPOINT",
        "BACKUP_B2_REGION",
        "BACKUP_B2_BUCKET",
        "BACKUP_B2_PREFIX",
        "BACKUP_B2_KEY_ID",
        "BACKUP_B2_APPLICATION_KEY",
    ):
        entorno[clave] = ""

    resultado = run_script(
        "scripts/backup/upload-b2.sh", str(artefacto), env=entorno
    )

    assert resultado.returncode == 0, resultado.stderr
    assert "--bucket cataclub-desde-el-archivo" in _argv(tmp_path)


# --- Verificación de configuración sin red ----------------------------------


def test_check_config_valida_la_configuracion_sin_tocar_la_red(tmp_path):
    """`install-cron` necesita saber HOY que el cron de las 03:30 va a poder.

    Verificar sin red y sin artefacto es lo que permite llamarla desde el
    deploy, con el operador todavía en la terminal.
    """
    resultado = run_script(
        "scripts/backup/upload-b2.sh", "--check-config", env=_entorno_b2(tmp_path)
    )

    assert resultado.returncode == 0, resultado.stderr
    assert _argv(tmp_path) == ""


def test_check_config_falla_con_la_configuracion_incompleta(tmp_path):
    resultado = run_script(
        "scripts/backup/upload-b2.sh",
        "--check-config",
        env=_entorno_b2(tmp_path, BACKUP_B2_BUCKET=""),
    )

    assert resultado.returncode != 0, resultado.stdout
    assert "BACKUP_B2_BUCKET" in resultado.stderr


def test_check_config_con_la_replica_desactivada_sale_cero(tmp_path):
    """No configurar réplica es una decisión válida, no una falla del deploy."""
    resultado = run_script(
        "scripts/backup/upload-b2.sh",
        "--check-config",
        env=_entorno_b2(tmp_path, BACKUP_B2_ENABLED="0"),
    )

    assert resultado.returncode == 0, resultado.stderr


def test_rechaza_un_argumento_desconocido(tmp_path):
    resultado = run_script(
        "scripts/backup/upload-b2.sh", "--subir-todo", env=_entorno_b2(tmp_path)
    )

    assert resultado.returncode != 0
    assert _argv(tmp_path) == ""


# --- Camino feliz y verificación remota --------------------------------------


def test_sube_el_artefacto_y_lo_verifica_contra_el_objeto_remoto(tmp_path):
    """Subir y verificar: tamaño, sha256 propio y presencia en el listado.

    Un `put-object` que sale 0 no prueba que del otro lado haya un objeto
    legible bajo la clave esperada. Por eso el control mira el objeto remoto
    con HEAD (tamaño + metadato `sha256`, calculado sobre el mismo artefacto)
    y confirma que la clave aparece en el listado del bucket.

    El ETag NO sirve como checksum: para una subida multiparte no es el MD5 del
    contenido, y eso vale igual para S3 y para B2.
    """
    contenido = b"age-encryption.org/v1\n" + b"\x00\xff" * 512
    artefacto = _artefacto_cifrado(tmp_path, contenido)

    resultado = run_script(
        "scripts/backup/upload-b2.sh", str(artefacto), env=_entorno_b2(tmp_path)
    )

    assert resultado.returncode == 0, resultado.stderr
    argv = _argv(tmp_path)
    clave = "cataclub/produccion/cataclub_2026-08-29.dump.age"

    assert "put-object" in argv
    assert "head-object" in argv
    assert "list-objects-v2" in argv
    assert "--endpoint-url https://s3.us-west-004.backblazeb2.com" in argv
    assert "--region us-west-004" in argv
    assert "--bucket cataclub-backups-test" in argv
    assert clave in argv
    assert f"sha256={hashlib.sha256(contenido).hexdigest()}" in argv

    # La retención local no cambia: replicar no borra nada del disco.
    assert artefacto.read_bytes() == contenido


def test_la_falla_de_la_subida_aborta_antes_de_verificar(tmp_path):
    """Fail-closed: si el `put` falla, no se declara nada replicado."""
    artefacto = _artefacto_cifrado(tmp_path)

    resultado = run_script(
        "scripts/backup/upload-b2.sh",
        str(artefacto),
        env=_entorno_b2(tmp_path, FAKE_AWS_PUT_RC="1"),
    )

    assert resultado.returncode != 0, resultado.stdout
    assert "head-object" not in _argv(tmp_path)
    assert artefacto.exists()


def test_la_falla_de_la_verificacion_remota_aborta(tmp_path):
    """Un HEAD que no encuentra el objeto es una réplica que no existe."""
    artefacto = _artefacto_cifrado(tmp_path)

    resultado = run_script(
        "scripts/backup/upload-b2.sh",
        str(artefacto),
        env=_entorno_b2(tmp_path, FAKE_AWS_HEAD_RC="1"),
    )

    assert resultado.returncode != 0, resultado.stdout
    assert "verific" in resultado.stderr.lower()


def test_una_discrepancia_de_tamano_aborta(tmp_path):
    """Un objeto truncado del otro lado es un backup que no se puede restaurar."""
    artefacto = _artefacto_cifrado(tmp_path, b"age-encryption.org/v1\n" + b"x" * 300)

    resultado = run_script(
        "scripts/backup/upload-b2.sh",
        str(artefacto),
        env=_entorno_b2(tmp_path, FAKE_AWS_SIZE="7"),
    )

    assert resultado.returncode != 0, resultado.stdout
    assert "tama" in resultado.stderr.lower()


def test_una_discrepancia_de_checksum_aborta(tmp_path):
    """Mismo tamaño y bytes distintos: solo el checksum lo ve."""
    artefacto = _artefacto_cifrado(tmp_path)

    resultado = run_script(
        "scripts/backup/upload-b2.sh",
        str(artefacto),
        env=_entorno_b2(tmp_path, FAKE_AWS_SHA="0" * 64),
    )

    assert resultado.returncode != 0, resultado.stdout
    assert "sha256" in resultado.stderr.lower()


def test_un_listado_que_no_ve_la_clave_aborta(tmp_path):
    """El objeto tiene que ser direccionable bajo el prefijo esperado.

    HEAD sobre la clave y el listado del prefijo son evidencias distintas: la
    segunda es la que se usa para encontrar el backup el día del desastre.
    """
    artefacto = _artefacto_cifrado(tmp_path)

    resultado = run_script(
        "scripts/backup/upload-b2.sh",
        str(artefacto),
        env=_entorno_b2(tmp_path, FAKE_AWS_LISTADO=""),
    )

    assert resultado.returncode != 0, resultado.stdout
    assert "listado" in resultado.stderr.lower()


def test_un_listado_que_falla_aborta(tmp_path):
    artefacto = _artefacto_cifrado(tmp_path)

    resultado = run_script(
        "scripts/backup/upload-b2.sh",
        str(artefacto),
        env=_entorno_b2(tmp_path, FAKE_AWS_LIST_RC="1"),
    )

    assert resultado.returncode != 0, resultado.stdout


# --- Credenciales ------------------------------------------------------------


def test_la_credencial_no_viaja_por_argv(tmp_path):
    """`ps` lista la línea de comandos de cualquier proceso del host.

    La credencial se pasa por el entorno del proceso hijo, que solo lee el
    mismo usuario (o root) — el mismo límite de confianza que el archivo del
    que salió. En `argv` la leería cualquiera con una sesión abierta.
    """
    artefacto = _artefacto_cifrado(tmp_path)

    resultado = run_script(
        "scripts/backup/upload-b2.sh", str(artefacto), env=_entorno_b2(tmp_path)
    )

    assert resultado.returncode == 0, resultado.stderr
    argv = _argv(tmp_path)
    assert KEY_ID_FALSO not in argv
    assert APP_KEY_FALSA not in argv
    # ...pero sí tiene que haber llegado, o el test no probaría nada.
    assert f"secreto={APP_KEY_FALSA}" in (tmp_path / "env.log").read_text()


def test_no_filtra_la_credencial_cuando_la_herramienta_la_imprime(tmp_path):
    """El error de un cliente S3 puede repetir la credencial que se le pasó.

    Ese texto termina en el log del cron, que no está cifrado y lo lee
    cualquiera que pueda leer `/var/log`. La salida se redacta antes de
    imprimirla, y el control se prueba con una herramienta que efectivamente
    la escupe.
    """
    artefacto = _artefacto_cifrado(tmp_path)

    resultado = run_script(
        "scripts/backup/upload-b2.sh",
        str(artefacto),
        env=_entorno_b2(tmp_path, FAKE_AWS_PUT_RC="1", FAKE_AWS_LEAK="1"),
    )

    assert resultado.returncode != 0
    salida = resultado.stdout + resultado.stderr
    assert KEY_ID_FALSO not in salida
    assert APP_KEY_FALSA not in salida
    assert "***" in salida


# --- El bucket de producción no recibe backups de otro entorno ---------------


def test_un_entorno_no_productivo_no_puede_escribir_en_el_bucket_de_produccion(
    tmp_path,
):
    """El error caro es silencioso en la dirección peligrosa.

    Un staging apuntado al bucket de producción ensucia el histórico del que
    depende la recuperación real, y con Object Lock activo esos objetos no se
    pueden borrar hasta que venza la retención. Es el mismo razonamiento que la
    URL del heartbeat, que tampoco se copia entre entornos (`provisioning.md`).
    """
    artefacto = _artefacto_cifrado(tmp_path)

    resultado = run_script(
        "scripts/backup/upload-b2.sh",
        str(artefacto),
        env=_entorno_b2(
            tmp_path,
            BACKUP_B2_BUCKET=BUCKET_PRODUCCION,
            BACKUP_COMPOSE_FILES="-f docker-compose.yml -f docker-compose.qa.yml",
            AMBIENTE="staging",
        ),
    )

    assert resultado.returncode != 0, resultado.stdout
    assert BUCKET_PRODUCCION in resultado.stderr
    assert _argv(tmp_path) == ""


def test_produccion_si_puede_escribir_en_su_propio_bucket(tmp_path):
    """La compuerta anterior no puede bloquear el caso que existe para servir."""
    artefacto = _artefacto_cifrado(tmp_path)

    resultado = run_script(
        "scripts/backup/upload-b2.sh",
        str(artefacto),
        env=_entorno_b2(
            tmp_path,
            BACKUP_B2_BUCKET=BUCKET_PRODUCCION,
            BACKUP_COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml",
            AMBIENTE="production",
        ),
    )

    assert resultado.returncode == 0, resultado.stderr
    assert f"--bucket {BUCKET_PRODUCCION}" in _argv(tmp_path)


# --- Integración con backup-db.sh -------------------------------------------


@requiere_age
def test_backup_db_replica_el_artefacto_cifrado_y_conserva_el_local(tmp_path):
    """La réplica corre DESPUÉS del backup local, sobre el artefacto final.

    Lo que sale del host es exactamente el `.dump.age` que quedó en disco: el
    padrón nunca viaja en claro y la identidad `age` privada no participa.
    """
    _, destinatario = _par_de_claves_age(tmp_path)
    entorno = _entorno_de_backup(tmp_path, BACKUP_AGE_RECIPIENTS=destinatario)
    _docker_que_emite_un_dump(tmp_path / "bin", "PGDMP|CEDULA-1728394")

    resultado = run_script("scripts/backup/backup-db.sh", env=entorno)

    assert resultado.returncode == 0, resultado.stderr
    artefactos = _artefactos(tmp_path)
    assert len(artefactos) == 1 and artefactos[0].endswith(".dump.age"), artefactos

    argv = _argv(tmp_path)
    assert "put-object" in argv
    assert artefactos[0] in argv
    # El cuerpo subido es el artefacto cifrado, byte a byte.
    subido = (tmp_path / "estado.sha").read_text().strip()
    local = (tmp_path / "backups" / artefactos[0]).read_bytes()
    assert subido == hashlib.sha256(local).hexdigest()


@requiere_age
def test_backup_db_falla_cuando_la_replicacion_falla_pero_conserva_el_local(tmp_path):
    """Fail-closed sin destruir lo único que quedó bien.

    Un backup que no se replicó no es un backup fuera del host: el cron tiene
    que salir distinto de cero para que la cadena del heartbeat no pingee. Pero
    el artefacto local ya escrito se conserva — borrarlo cambiaría una falla de
    réplica por una pérdida de datos.
    """
    _, destinatario = _par_de_claves_age(tmp_path)
    entorno = _entorno_de_backup(
        tmp_path, BACKUP_AGE_RECIPIENTS=destinatario, FAKE_AWS_PUT_RC="1"
    )
    _docker_que_emite_un_dump(tmp_path / "bin", "PGDMP|CEDULA-1728394")

    resultado = run_script("scripts/backup/backup-db.sh", env=entorno)

    assert resultado.returncode != 0, resultado.stdout
    artefactos = _artefactos(tmp_path)
    assert len(artefactos) == 1 and artefactos[0].endswith(".dump.age"), artefactos


def test_backup_db_con_replicacion_activada_rechaza_un_backup_en_claro(tmp_path):
    """Réplica activada + backup sin cifrar = falla, nunca una subida en claro.

    Solo puede pasar fuera de producción (adentro el cifrado ya es obligatorio),
    y aun ahí el `.dump` no puede salir del host.
    """
    entorno = _entorno_de_backup(
        tmp_path,
        BACKUP_ALLOW_PLAINTEXT="1",
        BACKUP_COMPOSE_FILES="-f docker-compose.yml",
    )
    _docker_que_emite_un_dump(tmp_path / "bin", "PGDMP|CEDULA-1728394")

    resultado = run_script("scripts/backup/backup-db.sh", env=entorno)

    assert resultado.returncode != 0, resultado.stdout
    assert _argv(tmp_path) == ""
    # El dump local se escribió; lo que se rechaza es sacarlo del host.
    escritos = _artefactos(tmp_path)
    assert len(escritos) == 1 and escritos[0].endswith(".dump"), escritos


@requiere_age
def test_backup_db_sin_replicacion_configurada_sigue_funcionando(tmp_path):
    """El cableado no puede romper el host que todavía no tiene bucket."""
    _, destinatario = _par_de_claves_age(tmp_path)
    entorno = _entorno_de_backup(
        tmp_path, BACKUP_AGE_RECIPIENTS=destinatario, BACKUP_B2_ENABLED="0"
    )
    _docker_que_emite_un_dump(tmp_path / "bin", "PGDMP|CEDULA-1728394")

    resultado = run_script("scripts/backup/backup-db.sh", env=entorno)

    assert resultado.returncode == 0, resultado.stderr
    assert _argv(tmp_path) == ""
    assert len(_artefactos(tmp_path)) == 1
