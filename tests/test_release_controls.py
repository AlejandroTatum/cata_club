"""Focused contracts for production release controls."""

import os
import subprocess
import time
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent

# Destinatario age de mentira. Acá `age` está stubeado igual que `docker` y
# `crontab` (esta suite stubea sus fronteras a propósito): lo que se prueba en
# este archivo es que deploy/install-cron EXIJAN cifrado configurado, no la
# criptografía en sí. El cifrado real se verifica de punta a punta contra el
# binario `age` en tests/test_backup_controls.py.
DESTINATARIO_DE_PRUEBA = "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsxxxxxx"

# URL de heartbeat de mentira. El token va en el path, así que si estos bytes
# aparecen en el crontab es porque `install-cron` los escribió ahí -- y
# `crontab -l` lo lista sin privilegios. `.invalid` es un TLD reservado
# (RFC 2606): ningún camino de esta suite puede tocar la red.
URL_DE_HEARTBEAT_DE_PRUEBA = "https://heartbeat.invalid/ping/TOKEN-DE-PRUEBA"


def run_script(script: str, *args: str, env: dict[str, str] | None = None):
    return subprocess.run(
        ["bash", str(ROOT / script), *args],
        cwd=ROOT,
        env={**os.environ, **(env or {})},
        capture_output=True,
        text=True,
    )


# Respuestas de `docker compose` que TODOS los stubs de preflight comparten,
# reproduciendo lo que Compose devuelve de verdad (issue #846):
#
# - `config --images backend` trae también las imágenes de las dependencias,
#   porque `backend` declara `depends_on: db, redis` (docker-compose.yml:73-77);
# - la resolución confiable es `.services.backend.image` de `config --format
#   json`, que devuelve una sola referencia por construcción.
#
# Que el arm de `--images` mienta con la salida REAL (tres líneas) es
# deliberado: si el preflight volviera a parsear esa salida, rompen todos estos
# tests y no solo los que ejercitan la resolución a propósito.
_ARMS_IMAGEN_BACKEND = (
    '  *" --format json "*) printf "%s\\n" '
    '"{\\"services\\":{\\"backend\\":{\\"image\\":\\"registry.example/cata-backend:${IMAGE_TAG}\\"}}}" ;;\n'
    '  *" --images backend "*) printf \'%s\\n\' "postgres:16-alpine" "redis:7-alpine" '
    '"registry.example/cata-backend:${IMAGE_TAG}" ;;\n'
)
_CASE_IMAGEN_BACKEND = 'case " $* " in\n' + _ARMS_IMAGEN_BACKEND + "esac\n"


def _stub_age(bin_dir: Path) -> None:
    """`age` de mentira: copia stdin a la salida, respetando `-o`."""
    stub = bin_dir / "age"
    stub.write_text(
        "#!/usr/bin/env bash\n"
        'destino=""; previo=""\n'
        'for a in "$@"; do [ "$previo" = "-o" ] && destino="$a"; previo="$a"; done\n'
        'if [ -n "$destino" ]; then cat > "$destino"; else cat; fi\n'
    )
    stub.chmod(0o755)


def _stub_smtp_tools(bin_dir: Path, *, deterministic: bool = False) -> None:
    scripts = {
        "getent": "#!/usr/bin/env bash\n"
        + ('[ "${SMTP_PREFLIGHT_MODE:-}" = dns-failure ] && exit 2\n' if deterministic else "")
        + "exit 0\n",
        "timeout": "#!/usr/bin/env bash\n"
        + ('[ "${SMTP_PREFLIGHT_MODE:-}" = connect-timeout ] && [ "${2:-}" = bash ] && exit 124\n'
           '[ "${SMTP_PREFLIGHT_MODE:-}" = connect-failure ] && [ "${2:-}" = bash ] && exit 1\n'
           '[ "${SMTP_PREFLIGHT_MODE:-}" = connect-refused ] && [ "${2:-}" = bash ] && exit 1\n'
           '[ "${SMTP_PREFLIGHT_MODE:-}" = starttls-failure ] && [ "${2:-}" = openssl ] && exit 1\n'
           '[ "${SMTP_PREFLIGHT_MODE:-}" = elapsed-bound ] && exec /usr/bin/timeout "$@"\n' if deterministic else "")
        + "exit 0\n",
        "openssl": "#!/usr/bin/env bash\n"
        + ('[ "${SMTP_PREFLIGHT_MODE:-}" = elapsed-bound ] && sleep 5\n' if deterministic else "")
        + "exit 0\n",
    }
    for name, content in scripts.items():
        stub = bin_dir / name
        stub.write_text(content)
        stub.chmod(0o755)


def _smtp_preflight_env(
    tmp_path: Path,
    *,
    host: str = "smtp.example.test",
    port: str = "2587",
    mode: str = "success",
) -> dict[str, str]:
    stack = tmp_path / "stack"
    stack.mkdir(parents=True)
    (stack / ".env").write_text(
        f"IMAGE_TAG=abcdef1\nSMTP_HOST={host}\nSMTP_PORT={port}\nSMTP_STARTTLS=true\n"
    )
    backup = tmp_path / "backups"
    backup.mkdir()
    (backup / "cataclub_today.dump").write_text("dump")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "docker").write_text(
        "#!/usr/bin/env bash\n"
        + _CASE_IMAGEN_BACKEND +
        "exit 0\n"
    )
    (bin_dir / "docker").chmod(0o755)
    _stub_smtp_tools(bin_dir, deterministic=True)
    return {
        "STACK_DIR": str(stack),
        "BACKUP_DIR": str(backup),
        "IMAGE_TAG": "abcdef1",
        "MIGRATION_COMPATIBILITY": "backward-compatible",
        "SMTP_PREFLIGHT_MODE": mode,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
    }


def test_preflight_smtp_starttls_succeeds_without_authentication(tmp_path):
    result = run_script(
        "scripts/ops/preflight-production.sh",
        env=_smtp_preflight_env(tmp_path),
    )

    assert result.returncode == 0, result.stderr
    assert "SMTP preflight OK" in result.stdout


def test_preflight_smtp_dns_failure_is_fail_closed(tmp_path):
    result = run_script(
        "scripts/ops/preflight-production.sh",
        env=_smtp_preflight_env(tmp_path, mode="dns-failure"),
    )

    assert result.returncode != 0
    assert "DNS" in result.stderr


def test_preflight_smtp_connect_timeout_is_bounded_and_fail_closed(tmp_path):
    result = run_script(
        "scripts/ops/preflight-production.sh",
        env=_smtp_preflight_env(tmp_path, mode="connect-timeout"),
    )

    assert result.returncode != 0
    assert "conexión" in result.stderr.lower() or "timeout" in result.stderr.lower()


def test_preflight_smtp_rejects_invalid_port_and_host_without_network_access(tmp_path):
    invalid_port = run_script(
        "scripts/ops/preflight-production.sh",
        env=_smtp_preflight_env(tmp_path / "invalid-port", port="65536"),
    )
    invalid_host = run_script(
        "scripts/ops/preflight-production.sh",
        env=_smtp_preflight_env(tmp_path / "invalid-host", host="smtp;cat-secret"),
    )

    assert invalid_port.returncode != 0
    assert "smtp_port" in invalid_port.stderr.lower()
    assert invalid_host.returncode != 0
    assert "host" in invalid_host.stderr.lower()


def test_preflight_smtp_refused_connection_is_fail_closed(tmp_path):
    result = run_script(
        "scripts/ops/preflight-production.sh",
        env=_smtp_preflight_env(tmp_path, mode="connect-refused"),
    )

    assert result.returncode != 0
    assert "conexión" in result.stderr.lower()


def test_preflight_smtp_starttls_failure_is_fail_closed(tmp_path):
    result = run_script(
        "scripts/ops/preflight-production.sh",
        env=_smtp_preflight_env(tmp_path, mode="starttls-failure"),
    )

    assert result.returncode != 0
    assert "starttls" in result.stderr.lower()


def test_preflight_smtp_timeout_bounds_elapsed_time(tmp_path):
    env = _smtp_preflight_env(tmp_path, mode="elapsed-bound")
    env["SMTP_PREFLIGHT_TIMEOUT_SECONDS"] = "1"
    started = time.monotonic()
    result = run_script("scripts/ops/preflight-production.sh", env=env)
    elapsed = time.monotonic() - started

    assert result.returncode != 0
    assert elapsed < 3


def test_preflight_smtp_diagnostics_never_leak_credentials(tmp_path):
    env = _smtp_preflight_env(tmp_path, mode="connect-failure")
    env["SMTP_PASSWORD"] = "super-secret-password"
    result = run_script("scripts/ops/preflight-production.sh", env=env)

    output = result.stdout + result.stderr
    assert result.returncode != 0
    assert "super-secret-password" not in output


def _stub_crontab(bin_dir: Path) -> None:
    """`crontab` de mentira: lee y escribe `$CRON_FILE` en vez del crontab real."""
    stub = bin_dir / "crontab"
    stub.write_text(
        "#!/usr/bin/env bash\n"
        'if [ "${1:-}" = "-l" ]; then [ -f "$CRON_FILE" ] && cat "$CRON_FILE"; exit 0; fi\n'
        'if [ "${1:-}" = "-" ]; then cat > "$CRON_FILE"; exit 0; fi\n'
        "exit 1\n"
    )
    stub.chmod(0o755)


def _entorno_install_cron(tmp_path, bin_dir: Path, **extra: str) -> dict[str, str]:
    """Entorno hermético de `install-cron`: nada mira el /etc real de la máquina."""
    destinatarios = tmp_path / "backup-recipients.txt"
    destinatarios.write_text(f"{DESTINATARIO_DE_PRUEBA}\n")
    heartbeat = tmp_path / "heartbeat-url.txt"
    heartbeat.write_text(f"{URL_DE_HEARTBEAT_DE_PRUEBA}\n")
    entorno = {
        "CRON_FILE": str(tmp_path / "crontab"),
        "BACKUP_AGE_RECIPIENTS_FILE": str(destinatarios),
        "BACKUP_CRON_LOG": str(tmp_path / "cataclub-backup.log"),
        "HEARTBEAT_URL_FILE": str(heartbeat),
        # Hermético también para la réplica fuera del host: sin esto, la
        # compuerta de `install-cron` leería el /etc real de la máquina que
        # corre la suite y el resultado dependería del host.
        "BACKUP_B2_CONFIG_FILE": str(tmp_path / "no-existe" / "b2-backup.env"),
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
    }
    entorno.update(extra)
    return entorno


def _config_b2(tmp_path: Path, **overrides: str) -> Path:
    """Archivo de configuración de la réplica, como el que lee el cron."""
    valores = {
        "BACKUP_B2_ENABLED": "1",
        "BACKUP_B2_ENDPOINT": "https://s3.us-west-004.backblazeb2.com",
        "BACKUP_B2_REGION": "us-west-004",
        "BACKUP_B2_BUCKET": "cataclub-backups-test",
        "BACKUP_B2_PREFIX": "cataclub/produccion",
        "BACKUP_B2_KEY_ID": "0055aabbccddeeff0000000012",
        "BACKUP_B2_APPLICATION_KEY": "K005NoEsUnaClaveReal0123456789",
    }
    valores.update(overrides)
    archivo = tmp_path / "b2-backup.env"
    archivo.write_text(
        "".join(f"{k}={v}\n" for k, v in valores.items() if v != "")
    )
    return archivo


def test_install_cron_se_niega_si_la_replica_esta_activada_y_mal_configurada(tmp_path):
    """Una réplica activada a medias falla a las 03:30, contra un log que nadie mira.

    Es el mismo criterio que el destinatario de cifrado y la URL del heartbeat:
    lo que el cron va a necesitar se verifica ACÁ, con el operador todavía en
    la terminal, y si falta se aborta en vez de instalar un cron que se ve bien
    y no replica nada.
    """
    cron_file = tmp_path / "crontab"
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _stub_crontab(bin_dir)
    _stub_age(bin_dir)
    (bin_dir / "aws").write_text("#!/usr/bin/env bash\nexit 0\n")
    (bin_dir / "aws").chmod(0o755)

    resultado = run_script(
        "scripts/deploy/deploy.sh",
        "install-cron",
        "--confirm-install-cron",
        env=_entorno_install_cron(
            tmp_path,
            bin_dir,
            BACKUP_B2_CONFIG_FILE=str(_config_b2(tmp_path, BACKUP_B2_BUCKET="")),
        ),
    )

    assert resultado.returncode != 0, resultado.stdout
    assert "BACKUP_B2_BUCKET" in resultado.stderr
    assert not cron_file.exists(), "no se instala un cron cuya réplica no funciona"


def test_install_cron_se_niega_si_falta_el_cliente_s3(tmp_path):
    """Réplica activada sin cliente S3 instalado: falla todas las noches."""
    cron_file = tmp_path / "crontab"
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _stub_crontab(bin_dir)
    _stub_age(bin_dir)

    resultado = run_script(
        "scripts/deploy/deploy.sh",
        "install-cron",
        "--confirm-install-cron",
        env=_entorno_install_cron(
            tmp_path,
            bin_dir,
            BACKUP_B2_CONFIG_FILE=str(_config_b2(tmp_path)),
            BACKUP_B2_AWS_BIN=str(tmp_path / "no-existe" / "aws"),
        ),
    )

    assert resultado.returncode != 0, resultado.stdout
    assert not cron_file.exists()


def test_install_cron_instala_con_la_replica_bien_configurada(tmp_path):
    """La compuerta anterior no puede bloquear el caso que existe para servir."""
    cron_file = tmp_path / "crontab"
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _stub_crontab(bin_dir)
    _stub_age(bin_dir)
    (bin_dir / "aws").write_text("#!/usr/bin/env bash\nexit 0\n")
    (bin_dir / "aws").chmod(0o755)

    resultado = run_script(
        "scripts/deploy/deploy.sh",
        "install-cron",
        "--confirm-install-cron",
        env=_entorno_install_cron(
            tmp_path, bin_dir, BACKUP_B2_CONFIG_FILE=str(_config_b2(tmp_path))
        ),
    )

    assert resultado.returncode == 0, resultado.stderr
    assert "backup-db.sh" in cron_file.read_text()


def test_install_cron_requires_confirmation_before_modifying_crontab(tmp_path):
    cron_file = tmp_path / "crontab"
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _stub_crontab(bin_dir)
    _stub_age(bin_dir)
    entorno = _entorno_install_cron(tmp_path, bin_dir)

    refused = run_script("scripts/deploy/deploy.sh", "install-cron", env=entorno)

    assert refused.returncode == 2
    assert "--confirm-install-cron" in refused.stderr
    assert not cron_file.exists()

    installed = run_script(
        "scripts/deploy/deploy.sh",
        "install-cron",
        "--confirm-install-cron",
        env=entorno,
    )

    assert installed.returncode == 0, installed.stderr
    installed_cron = cron_file.read_text()
    assert "backup-db.sh" in installed_cron
    assert "check-backup-freshness.sh" in installed_cron


def _deploy_env(tmp_path, db_running: bool) -> tuple[dict[str, str], Path, Path]:
    """Deploy fixture: stack, backups, releases and a docker stub that logs argv."""
    stack = tmp_path / "stack"
    stack.mkdir()
    (stack / ".env").write_text("IMAGE_TAG=abcdef1\nSMTP_HOST=smtp.example.test\nSMTP_PORT=2587\nSMTP_STARTTLS=true\n")
    backups = tmp_path / "backups"
    backups.mkdir()
    records = tmp_path / "releases"
    docker_log = tmp_path / "docker.log"
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "docker").write_text(
        "#!/usr/bin/env bash\n"
        'printf \'%s\\n\' "$*" >> "$DOCKER_LOG"\n'
        'case " $* " in\n'
            # Issue #791: `do_checks` ya NO filtra por servicio en el argv --
            # ese filtro posicional no es un contrato estable entre
            # versiones de Compose (ver comentario junto a
            # `esperar_celery_saludable` en deploy.sh). Pide SIEMPRE el
            # listado completo (`ps --format json`, sin nombre de servicio)
            # y filtra del lado de Python por el campo `Service`. Este case
            # tiene que ir ANTES del `--format json` genérico de más abajo
            # (usado por `configured_backend_image`): ambos patrones
            # matchean el mismo argv, y `case` toma la primera rama que
            # coincide.
            #
            # `PS_JSON_SHAPE` pinnea la forma de salida que deploy.sh tiene
            # que aceptar: "lines" (default, Compose reciente: un objeto
            # JSON por línea) o "array" (Compose viejo: un único array
            # JSON). `PS_JSON_GARBAGE=1` devuelve basura no-JSON, para
            # probar que el parser falla cerrado sin reventar python3.
            #
            # `${VAR-default}` (SIN `:`) a propósito: el default solo debe
            # aplicar cuando la variable no está seteada. Con `:-` una
            # variable seteada a "" (el caso "el servicio nunca arrancó",
            # que acá se traduce en OMITIR su registro por completo) caería
            # igual al default "running"/"healthy" y el test de esa falla
            # nunca vería el escenario que dice ejercitar.
            '  *" ps --format json "*)\n'
            '    if [ "${PS_JSON_GARBAGE:-0}" = "1" ]; then\n'
            '      printf \'%s\' \'esto-no-es-json{{{\'\n'
            '    else\n'
            '      registros=""\n'
            '      if [ -n "${CELERY_WORKER_STATE-running}" ]; then\n'
            '        salud="${CELERY_WORKER_HEALTH-healthy}"\n'
            '        objeto=\'{"Service":"celery-worker","State":"\'"${CELERY_WORKER_STATE-running}"\'","Health":"\'"$salud"\'"}\'\n'
            '        registros="$registros$objeto\n"\n'
            # Segundo registro para celery-worker (issue #791, dureza del
            # candado ante réplicas): SOLO se agrega si la variable está
            # SETEADA -- ni siquiera en "" -- de ahí `${VAR+x}` en vez de
            # `-n`/`:-`. Simula lo que produciría `deploy.replicas: 2`: dos
            # contenedores con el mismo `Service` y salud distinta.
            '        if [ "${CELERY_WORKER_REPLICA_HEALTH+seteada}" = "seteada" ]; then\n'
            '          objeto2=\'{"Service":"celery-worker","State":"running","Health":"\'"${CELERY_WORKER_REPLICA_HEALTH}"\'"}\'\n'
            '          registros="$registros$objeto2\n"\n'
            '        fi\n'
            '      fi\n'
            '      if [ -n "${CELERY_BEAT_STATE-running}" ]; then\n'
            '        salud="${CELERY_BEAT_HEALTH-healthy}"\n'
            '        objeto=\'{"Service":"celery-beat","State":"\'"${CELERY_BEAT_STATE-running}"\'","Health":"\'"$salud"\'"}\'\n'
            '        registros="$registros$objeto\n"\n'
            '      fi\n'
            '      if [ "${PS_JSON_SHAPE:-lines}" = "array" ]; then\n'
            '        contenido="$(printf \'%s\' "$registros" | sed \'/^$/d\' | paste -sd, -)"\n'
            '        printf \'[%s]\\n\' "$contenido"\n'
            '      else\n'
            '        printf \'%s\' "$registros"\n'
            '      fi\n'
            '    fi ;;\n'
            '  *" --format json "*) printf "%s\\n" "{\\\"services\\\":{\\\"backend\\\":{\\\"image\\\":\\\"registry.example/cata-backend:${IMAGE_TAG}\\\"}}}" ;;\n'
            '  *" --images backend "*) if [ "${REALISTIC_COMPOSE_OUTPUT:-0}" = "1" ]; then printf "%s\\n" "postgres:16" "redis:7" "registry.example/cata-backend:${IMAGE_TAG}"; else echo "registry.example/cata-backend:${IMAGE_TAG}"; if [ "${MULTI_IMAGE_OUTPUT:-0}" = "1" ]; then echo "registry.example/cata-backend:${IMAGE_TAG}"; elif [ "${AMBIGUOUS_IMAGE_OUTPUT:-0}" = "1" ]; then echo "registry.example/cata-frontend:${IMAGE_TAG}"; fi; fi ;;\n'
        # El smoke check del chatbot corre DENTRO del contenedor backend
        # (issue #766). `CHATBOT_CHECK_EXIT` reproduce sus tres códigos de
        # salida reales: 0 configurada/ausente, 1 incompleta, 2 ausente con
        # --exigir.
        '  *verificar_chatbot.py*) exit "${CHATBOT_CHECK_EXIT:-0}" ;;\n'
        # Round-trip de celery-worker (issue #791): un `inspect ping` real
        # contra el broker, disparado desde el contenedor backend.
        # `CELERY_PING_EXIT` reproduce el caso en que ningún worker contesta.
        '  *"inspect ping"*) exit "${CELERY_PING_EXIT:-0}" ;;\n'
        '  *" manifest inspect "*) [ "$3" = "registry.example/cata-backend:${IMAGE_TAG}" ] || exit 1 ;;\n'
        '  *" --status running "*) if [ "${DB_RUNNING:-0}" = "1" ]; then echo db; fi ;;\n'
        # El preflight (issue #805) deriva la revisión desplegada y la
        # compara contra el head de Alembic en la imagen. Acá no importa
        # ESE rango, solo que el default `none` sin migraciones pendientes
        # siga siendo un deploy legítimo: current == head, cero pendientes.
        '  *" exec -T db "*) [ "${DB_RUNNING:-0}" = "1" ] && echo "fakehead001" ;;\n'
        '  *"alembic heads"*) echo "fakehead001 (head)" ;;\n'
        "esac\n"
        "exit 0\n"
    )
    (bin_dir / "docker").chmod(0o755)
    _stub_age(bin_dir)
    _stub_smtp_tools(bin_dir)
    env = {
        "STACK_DIR": str(stack),
        "BACKUP_DIR": str(backups),
        "RELEASE_RECORD_DIR": str(records),
        "IMAGE_TAG": "abcdef1",
        "MIGRATION_COMPATIBILITY": "none",
        "DOCKER_LOG": str(docker_log),
        "DB_RUNNING": "1" if db_running else "0",
        # El backup pre-deploy cifra: sin destinatario configurado, deploy
        # aborta a propósito (ver test_deploy_aborta_si_el_backup_no_puede_cifrar).
        "BACKUP_AGE_RECIPIENTS": DESTINATARIO_DE_PRUEBA,
        # Hermético: nunca mirar el /etc real de la máquina que corre la suite.
        "BACKUP_AGE_RECIPIENTS_FILE": str(tmp_path / "no-existe" / "recipients.txt"),
        # Poll de salud de celery al mínimo en la suite: la pila del stub
        # responde en el primer intento (o falla de entrada), así que no hay
        # motivo para que un test real espere el `intervalo` de producción.
        "CELERY_HEALTH_MAX_INTENTOS": "1",
        "CELERY_HEALTH_INTERVALO_SEGUNDOS": "0",
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
    }
    return env, backups, docker_log


def test_first_deploy_passes_without_any_previous_backup(tmp_path):
    """First provision: the db has never started, so no dump can exist and the
    freshness alarm must not abort the documented day-one path."""
    env, backups, _ = _deploy_env(tmp_path, db_running=False)

    result = run_script("scripts/deploy/deploy.sh", env=env)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "no hay nada que respaldar" in result.stdout
    assert not list(backups.glob("*.dump"))


def test_deploy_resolves_single_backend_image_when_compose_emits_multiple_lines(tmp_path):
    """Docker Compose >= 5.5 can emit more than one image line for
    `config --images backend`; deploy must resolve a single backend reference
    or `docker manifest inspect` rejects the newline and aborts the deploy."""
    env, _, _ = _deploy_env(tmp_path, db_running=False)
    env["MULTI_IMAGE_OUTPUT"] = "1"

    result = run_script("scripts/deploy/deploy.sh", env=env)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "Desplegando imágenes con SHA abcdef1" in result.stdout


def test_deploy_inspects_only_backend_when_compose_emits_dependency_images(tmp_path):
    env, _, docker_log = _deploy_env(tmp_path, db_running=False)
    env["REALISTIC_COMPOSE_OUTPUT"] = "1"

    result = run_script("scripts/deploy/deploy.sh", env=env)

    assert result.returncode == 0, result.stdout + result.stderr
    manifest_calls = [line for line in docker_log.read_text().splitlines() if "manifest inspect" in line]
    assert manifest_calls == ["manifest inspect registry.example/cata-backend:abcdef1"]


def test_deploy_backs_up_the_database_before_starting_new_images(tmp_path):
    """With a running db, deploy must dump BEFORE `up -d` (which migrates)."""
    env, backups, docker_log = _deploy_env(tmp_path, db_running=True)

    result = run_script("scripts/deploy/deploy.sh", env=env)

    assert result.returncode == 0, result.stdout + result.stderr
    # `.dump.age`: el backup pre-deploy sale cifrado, igual que el del cron.
    assert list(backups.glob("cataclub_*.dump.age"))
    assert not list(backups.glob("cataclub_*.dump")), "no debe quedar un dump en claro"
    lines = docker_log.read_text().splitlines()
    dump_calls = [i for i, line in enumerate(lines) if "pg_dump" in line]
    up_calls = [i for i, line in enumerate(lines) if "up -d" in line]
    assert dump_calls, "deploy nunca ejecutó pg_dump"
    assert up_calls, "deploy nunca ejecutó up -d"
    assert dump_calls[0] < up_calls[0], "el backup debe correr antes de up -d"


def test_preflight_requires_explicitly_safe_migration_attestation(tmp_path):
    backup = tmp_path / "backups"
    backup.mkdir()
    (backup / "cataclub_today.dump").write_text("dump")
    stack = tmp_path / "stack"
    stack.mkdir()
    (stack / ".env").write_text("IMAGE_TAG=abcdef1\nSMTP_HOST=smtp.example.test\nSMTP_PORT=2587\nSMTP_STARTTLS=true\n")

    result = run_script(
        "scripts/ops/preflight-production.sh",
        env={
            "STACK_DIR": str(stack),
            "BACKUP_DIR": str(backup),
            "IMAGE_TAG": "abcdef1",
            "MIGRATION_COMPATIBILITY": "manual-review-required",
        },
    )

    assert result.returncode == 1
    assert "MIGRATION_" in result.stderr
    assert "manual-review-required" in result.stderr


# Cadena Alembic FALSA para estos tests, deliberadamente DISTINTA del literal
# viejo que este mismo fix borra (`c556legal01->e762rolunico->a790verifcorreo`,
# issue #805): si algún predicado del script volviera a comparar contra ese
# literal en vez del rango derivado, esta cadena lo expondría.
FAKE_CURRENT_REVISION = "f100curren"
FAKE_PENDING_1 = "f200midrev"
FAKE_HEAD_REVISION = "f300headrv"
FAKE_MIGRATION_RANGE = f"{FAKE_CURRENT_REVISION}->{FAKE_PENDING_1}->{FAKE_HEAD_REVISION}"
FAKE_PENDING_MIGRATIONS = f"{FAKE_PENDING_1},{FAKE_HEAD_REVISION}"


def _manual_review_approval(path: Path, **overrides: str) -> None:
    values = {
        "IMAGE_TAG": "abcdef1",
        "MIGRATION_RANGE": FAKE_MIGRATION_RANGE,
        "CURRENT_REVISION": FAKE_CURRENT_REVISION,
        "PENDING_MIGRATIONS": FAKE_PENDING_MIGRATIONS,
        "RESTORE_CHECK": "passed",
        "MAINTENANCE_WINDOW": "planned",
        "APPROVED_BY": "release-reviewer",
        "APPROVED_AT": "2026-12-31T23:59:59Z",
        "EXPIRES_AT": "2099-12-31T23:59:59Z",
    }
    values.update(overrides)
    path.write_text("".join(f"{key}={value}\n" for key, value in values.items()))


def _docker_stub_con_migraciones_derivables(bin_dir: Path) -> None:
    """`docker` de mentira que responde lo necesario para que
    `preflight-production.sh` derive el estado real de Alembic (issue #805):
    el servicio `db` corriendo, su `alembic_version` (`FAKE_CURRENT_REVISION`)
    y, DENTRO de la imagen, los heads y el historial hasta ese head."""
    stub = bin_dir / "docker"
    stub.write_text(
        "#!/usr/bin/env bash\n"
        "case \" $* \" in\n"
        + _ARMS_IMAGEN_BACKEND +
        f'  *" --status running "*) echo db ;;\n'
        f'  *" exec -T db "*) echo "{FAKE_CURRENT_REVISION}" ;;\n'
        f'  *"alembic heads"*) echo "{FAKE_HEAD_REVISION} (head)" ;;\n'
        f'  *"alembic history -r {FAKE_CURRENT_REVISION}:heads"*)\n'
        f'    printf \'%s\\n\' \\\n'
        f'      "{FAKE_PENDING_1} -> {FAKE_HEAD_REVISION} (head), migración de prueba dos" \\\n'
        f'      "{FAKE_CURRENT_REVISION} -> {FAKE_PENDING_1}, migración de prueba uno" ;;\n'
        "esac\n"
        "exit 0\n"
    )
    stub.chmod(0o755)


def _manual_review_env(tmp_path: Path, approval: Path | None = None) -> dict[str, str]:
    backup = tmp_path / "backups"
    backup.mkdir()
    (backup / "cataclub_today.dump").write_text("dump")
    stack = tmp_path / "stack"
    stack.mkdir()
    (stack / ".env").write_text("IMAGE_TAG=abcdef1\nSMTP_HOST=smtp.example.test\nSMTP_PORT=2587\nSMTP_STARTTLS=true\n")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _docker_stub_con_migraciones_derivables(bin_dir)
    _stub_smtp_tools(bin_dir)
    env = {
        "STACK_DIR": str(stack),
        "BACKUP_DIR": str(backup),
        "IMAGE_TAG": "abcdef1",
        "MIGRATION_COMPATIBILITY": "manual-review-required",
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
    }
    if approval is not None:
        env["MIGRATION_APPROVAL_FILE"] = str(approval)
    return env


def test_preflight_accepts_only_an_exact_current_manual_review_approval(tmp_path):
    approval = tmp_path / "approval.env"
    _manual_review_approval(approval)

    result = run_script(
        "scripts/ops/preflight-production.sh",
        env=_manual_review_env(tmp_path, approval),
    )

    assert result.returncode == 0, result.stderr
    assert "manual-review-required" in result.stdout


def test_preflight_rejects_a_manual_review_approval_bound_to_another_image(tmp_path):
    approval = tmp_path / "approval.env"
    _manual_review_approval(approval, IMAGE_TAG="deadbee")

    result = run_script(
        "scripts/ops/preflight-production.sh",
        env=_manual_review_env(tmp_path, approval),
    )

    assert result.returncode == 1
    assert "IMAGE_TAG" in result.stderr


def test_preflight_rejects_a_stale_manual_review_approval(tmp_path):
    approval = tmp_path / "approval.env"
    _manual_review_approval(approval, EXPIRES_AT="2000-01-01T00:00:00Z")

    result = run_script(
        "scripts/ops/preflight-production.sh",
        env=_manual_review_env(tmp_path, approval),
    )

    assert result.returncode == 1
    assert "expir" in result.stderr


def test_preflight_rejects_an_approval_bound_to_the_old_hardcoded_migration_range(tmp_path):
    """El defecto central del issue #805: el rango ya NO se compara contra el
    literal de un deploy anterior. Una aprobación que declara justamente ESE
    literal viejo tiene que rechazarse porque no es el rango real derivado."""
    approval = tmp_path / "approval.env"
    _manual_review_approval(
        approval,
        MIGRATION_RANGE="c556legal01->e762rolunico->a790verifcorreo",
    )

    result = run_script(
        "scripts/ops/preflight-production.sh",
        env=_manual_review_env(tmp_path, approval),
    )

    assert result.returncode == 1
    assert "no corresponde al rango de migración real" in result.stderr


def test_preflight_rejects_an_approval_bound_to_the_wrong_current_revision(tmp_path):
    approval = tmp_path / "approval.env"
    _manual_review_approval(approval, CURRENT_REVISION="otrarevision")

    result = run_script(
        "scripts/ops/preflight-production.sh",
        env=_manual_review_env(tmp_path, approval),
    )

    assert result.returncode == 1
    assert "no corresponde a la revisión desplegada real" in result.stderr


def test_preflight_rejects_an_approval_bound_to_the_wrong_pending_migrations(tmp_path):
    approval = tmp_path / "approval.env"
    _manual_review_approval(approval, PENDING_MIGRATIONS="otramigracion")

    result = run_script(
        "scripts/ops/preflight-production.sh",
        env=_manual_review_env(tmp_path, approval),
    )

    assert result.returncode == 1
    assert "no corresponde a las migraciones pendientes reales" in result.stderr


def _docker_stub_sin_pendientes(bin_dir: Path) -> None:
    """`docker` de mentira donde la revisión desplegada YA es el head: cero
    migraciones pendientes reales."""
    stub = bin_dir / "docker"
    stub.write_text(
        "#!/usr/bin/env bash\n"
        "case \" $* \" in\n"
        + _ARMS_IMAGEN_BACKEND +
        f'  *" --status running "*) echo db ;;\n'
        f'  *" exec -T db "*) echo "{FAKE_HEAD_REVISION}" ;;\n'
        f'  *"alembic heads"*) echo "{FAKE_HEAD_REVISION} (head)" ;;\n'
        "esac\n"
        "exit 0\n"
    )
    stub.chmod(0o755)


def test_preflight_rejects_manual_review_required_without_real_pending_migrations(tmp_path):
    """No corresponde exigir aprobación manual si no hay nada que aprobar: la
    revisión desplegada real ya es el head de Alembic."""
    approval = tmp_path / "approval.env"
    _manual_review_approval(
        approval,
        MIGRATION_RANGE=FAKE_HEAD_REVISION,
        CURRENT_REVISION=FAKE_HEAD_REVISION,
        PENDING_MIGRATIONS="ninguna",
    )
    backup = tmp_path / "backups"
    backup.mkdir()
    (backup / "cataclub_today.dump").write_text("dump")
    stack = tmp_path / "stack"
    stack.mkdir()
    (stack / ".env").write_text(
        "IMAGE_TAG=abcdef1\nSMTP_HOST=smtp.example.test\nSMTP_PORT=2587\nSMTP_STARTTLS=true\n"
    )
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _docker_stub_sin_pendientes(bin_dir)

    result = run_script(
        "scripts/ops/preflight-production.sh",
        env={
            "STACK_DIR": str(stack),
            "BACKUP_DIR": str(backup),
            "IMAGE_TAG": "abcdef1",
            "MIGRATION_COMPATIBILITY": "manual-review-required",
            "MIGRATION_APPROVAL_FILE": str(approval),
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
        },
    )

    assert result.returncode == 1
    assert "no hay migraciones pendientes reales" in result.stderr


def test_preflight_rejects_none_when_migrations_are_actually_pending(tmp_path):
    """Criterio de cierre del issue #805: declarar `none` no puede convivir
    con migraciones pendientes reales."""
    backup = tmp_path / "backups"
    backup.mkdir()
    (backup / "cataclub_today.dump").write_text("dump")
    stack = tmp_path / "stack"
    stack.mkdir()
    (stack / ".env").write_text(
        "IMAGE_TAG=abcdef1\nSMTP_HOST=smtp.example.test\nSMTP_PORT=2587\nSMTP_STARTTLS=true\n"
    )
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _docker_stub_con_migraciones_derivables(bin_dir)

    result = run_script(
        "scripts/ops/preflight-production.sh",
        env={
            "STACK_DIR": str(stack),
            "BACKUP_DIR": str(backup),
            "IMAGE_TAG": "abcdef1",
            "MIGRATION_COMPATIBILITY": "none",
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
        },
    )

    assert result.returncode == 1
    assert "MIGRATION_COMPATIBILITY=none" in result.stderr
    assert FAKE_PENDING_MIGRATIONS in result.stderr


def test_preflight_accepts_backward_compatible_with_real_pending_migrations(tmp_path):
    """`backward-compatible` SÍ puede convivir con migraciones pendientes
    (Alembic no puede verificar downgrade-safety solo; queda atestiguado por
    quien despliega) — pero el rango tiene que derivarse igual, no omitirse."""
    backup = tmp_path / "backups"
    backup.mkdir()
    (backup / "cataclub_today.dump").write_text("dump")
    stack = tmp_path / "stack"
    stack.mkdir()
    (stack / ".env").write_text(
        "IMAGE_TAG=abcdef1\nSMTP_HOST=smtp.example.test\nSMTP_PORT=2587\nSMTP_STARTTLS=true\n"
    )
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _docker_stub_con_migraciones_derivables(bin_dir)
    _stub_smtp_tools(bin_dir)

    result = run_script(
        "scripts/ops/preflight-production.sh",
        env={
            "STACK_DIR": str(stack),
            "BACKUP_DIR": str(backup),
            "IMAGE_TAG": "abcdef1",
            "MIGRATION_COMPATIBILITY": "backward-compatible",
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
        },
    )

    assert result.returncode == 0, result.stderr
    assert FAKE_MIGRATION_RANGE in result.stdout


# --- Resolución de la imagen backend en el preflight (issue #846) -----------
# `docker compose config --images backend` NO devuelve una sola línea: Compose
# expande el servicio a su grafo de dependencias, y `backend` declara
# `depends_on: db, redis` (docker-compose.yml:73-77), así que esa salida trae
# siempre postgres y redis además de la imagen del backend. `deploy.sh` ya
# había resuelto esto (issue #747) resolviendo `.services.backend.image` desde
# `config --format json`; el preflight se quedó con el patrón viejo y le pasó
# el bloque entero a `docker run`.
COMPOSE_JSON_BACKEND_VALIDO = (
    '{"services":{"backend":{"image":"registry.example/cata-backend:abcdef1"}}}'
)


def _docker_stub_resolucion_imagen(bin_dir: Path) -> None:
    """`docker` de mentira que reproduce dos comportamientos reales a la vez:

    1. `config --images backend` devuelve las imágenes de las dependencias
       además de la del backend, que es lo que hace Compose con `depends_on`;
    2. `docker run` rechaza una referencia vacía o multilínea con el mismo
       error que abortó el preflight de staging (`invalid reference format`).

    La salida de `config --format json` la fija cada test vía `COMPOSE_JSON`, y
    toda invocación de `docker run` queda registrada en `DOCKER_RUN_LOG` para
    poder afirmar QUÉ referencia llegó a ejecutarse (o que no llegó ninguna).
    """
    stub = bin_dir / "docker"
    stub.write_text(
        "#!/usr/bin/env bash\n"
        'if [ "$1" = run ]; then\n'
        # `docker run --rm <imagen> ...`: la referencia es el tercer argumento.
        '  imagen="$3"\n'
        "  printf 'run %q\\n' \"$imagen\" >> \"$DOCKER_RUN_LOG\"\n"
        '  case "$imagen" in\n'
        "    ''|*$'\\n'*) printf 'docker: invalid reference format\\n' >&2; exit 125 ;;\n"
        "  esac\n"
        '  case "$*" in *"alembic heads"*) echo "fakehead001 (head)" ;; esac\n'
        "  exit 0\n"
        "fi\n"
        'case " $* " in\n'
        '  *" --format json "*) printf \'%s\\n\' "$COMPOSE_JSON" ;;\n'
        '  *" --images backend "*) printf \'%s\\n\' "postgres:16-alpine" "redis:7-alpine" '
        '"registry.example/cata-backend:${IMAGE_TAG}" ;;\n'
        '  *" --status running "*) [ "${DB_RUNNING:-0}" = "1" ] && echo db ;;\n'
        '  *" exec -T db "*) echo "fakehead001" ;;\n'
        "esac\n"
        "exit 0\n"
    )
    stub.chmod(0o755)


def _preflight_imagen_env(
    tmp_path: Path,
    *,
    compose_json: str = COMPOSE_JSON_BACKEND_VALIDO,
    db_running: bool = True,
) -> tuple[dict[str, str], Path]:
    backup = tmp_path / "backups"
    backup.mkdir()
    (backup / "cataclub_today.dump").write_text("dump")
    stack = tmp_path / "stack"
    stack.mkdir()
    (stack / ".env").write_text(
        "IMAGE_TAG=abcdef1\nSMTP_HOST=smtp.example.test\nSMTP_PORT=2587\nSMTP_STARTTLS=true\n"
    )
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _docker_stub_resolucion_imagen(bin_dir)
    _stub_smtp_tools(bin_dir)
    run_log = tmp_path / "docker-run.log"
    run_log.write_text("")
    env = {
        "STACK_DIR": str(stack),
        "BACKUP_DIR": str(backup),
        "IMAGE_TAG": "abcdef1",
        "MIGRATION_COMPATIBILITY": "backward-compatible",
        "COMPOSE_JSON": compose_json,
        "DOCKER_RUN_LOG": str(run_log),
        "DB_RUNNING": "1" if db_running else "0",
        # Hermético: sin esto, el default real (/var/lib/cata-club/releases)
        # filtraría el estado de la máquina que corre la suite hacia el test.
        "RELEASE_RECORD_DIR": str(tmp_path / "no-existe-releases"),
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
    }
    return env, run_log


def test_preflight_resuelve_una_sola_imagen_backend_con_salida_de_dependencias(tmp_path):
    """Reproduce la falla de staging: `config --images backend` trae tres
    líneas y el bloque entero llegaba a `docker run`, que respondía
    `docker: invalid reference format` y abortaba el deploy."""
    env, run_log = _preflight_imagen_env(tmp_path)

    result = run_script("scripts/ops/preflight-production.sh", env=env)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "invalid reference format" not in result.stderr
    ejecutadas = run_log.read_text().splitlines()
    assert ejecutadas, "el preflight nunca corrió Alembic dentro de la imagen"
    for linea in ejecutadas:
        assert "registry.example/cata-backend:abcdef1" in linea, linea
        assert "postgres" not in linea and "redis" not in linea, linea
        assert "\\n" not in linea, f"llegó una referencia multilínea a docker run: {linea}"


def test_preflight_reporta_una_referencia_unica_sin_derivar_migraciones(tmp_path):
    """La verificación final de `IMAGE_REFERENCE` corre incluso con la base
    abajo, y tiene que quedar sujeta a la misma resolución: si copiara el
    bloque multilínea, el `Preflight OK` reportaría postgres y redis como si
    fueran la imagen que se va a desplegar."""
    env, run_log = _preflight_imagen_env(tmp_path, db_running=False)

    result = run_script("scripts/ops/preflight-production.sh", env=env)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "Preflight OK: registry.example/cata-backend:abcdef1;" in result.stdout
    assert "postgres" not in result.stdout and "redis" not in result.stdout
    assert run_log.read_text() == "", "no había base que consultar: nada debía correr"


@pytest.mark.parametrize(
    "compose_json",
    [
        pytest.param('{"services":{"db":{"image":"postgres:16-alpine"}}}', id="sin-backend"),
        pytest.param('{"services":{"backend":{"image":""}}}', id="imagen-vacia"),
        pytest.param('{"services":{"backend":{}}}', id="sin-clave-image"),
        pytest.param("esto-no-es-json{{{", id="json-invalido"),
    ],
)
def test_preflight_falla_cerrado_si_compose_no_resuelve_la_imagen_backend(tmp_path, compose_json):
    env, run_log = _preflight_imagen_env(tmp_path, compose_json=compose_json)

    result = run_script("scripts/ops/preflight-production.sh", env=env)

    assert result.returncode == 1
    assert "no resolvió exactamente una imagen para backend" in result.stderr
    assert run_log.read_text() == "", "falló DESPUÉS de invocar docker run"


def test_preflight_falla_cerrado_si_la_imagen_backend_trae_mas_de_una_referencia(tmp_path):
    """Ambigüedad: dos referencias en el valor de `image`. No se elige ninguna
    —ni la primera ni la última—, se falla cerrado ANTES de `docker run`."""
    env, run_log = _preflight_imagen_env(
        tmp_path,
        compose_json=(
            '{"services":{"backend":{"image":"registry.example/cata-backend:abcdef1'
            '\\nregistry.example/cata-frontend:abcdef1"}}}'
        ),
    )

    result = run_script("scripts/ops/preflight-production.sh", env=env)

    assert result.returncode == 1
    assert "no resolvió exactamente una imagen para backend" in result.stderr
    assert "invalid reference format" not in result.stderr
    assert run_log.read_text() == "", "falló DESPUÉS de invocar docker run"


def test_preflight_falla_cerrado_si_la_imagen_backend_no_usa_el_image_tag_pedido(tmp_path):
    """El bloque multilínea terminaba en `:abcdef1`, así que la comparación de
    tag lo daba por bueno. Con una sola referencia, un tag distinto se ve."""
    env, run_log = _preflight_imagen_env(
        tmp_path,
        compose_json='{"services":{"backend":{"image":"registry.example/cata-backend:deadbee"}}}',
    )

    result = run_script("scripts/ops/preflight-production.sh", env=env)

    assert result.returncode == 1
    assert "no usa IMAGE_TAG=abcdef1" in result.stderr
    assert run_log.read_text() == "", "falló DESPUÉS de invocar docker run"


def _docker_stub_db_inalcanzable(bin_dir: Path) -> None:
    """`docker` de mentira donde el servicio `db` está corriendo pero leer
    `alembic_version` falla (base inalcanzable, credenciales rotas, etc.)."""
    stub = bin_dir / "docker"
    stub.write_text(
        "#!/usr/bin/env bash\n"
        "case \" $* \" in\n"
        + _ARMS_IMAGEN_BACKEND +
        '  *" --status running "*) echo db ;;\n'
        '  *" exec -T db "*) echo "no se pudo conectar a la base" >&2; exit 1 ;;\n'
        "esac\n"
        "exit 0\n"
    )
    stub.chmod(0o755)


def test_preflight_falla_cerrado_si_no_puede_leer_la_revision_desplegada(tmp_path):
    """La base desplegada está inalcanzable: el preflight tiene que fallar
    cerrado y decirlo con un mensaje DISTINGUIBLE del de una aprobación que no
    coincide (para que el operador sepa qué está roto)."""
    backup = tmp_path / "backups"
    backup.mkdir()
    (backup / "cataclub_today.dump").write_text("dump")
    stack = tmp_path / "stack"
    stack.mkdir()
    (stack / ".env").write_text(
        "IMAGE_TAG=abcdef1\nSMTP_HOST=smtp.example.test\nSMTP_PORT=2587\nSMTP_STARTTLS=true\n"
    )
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _docker_stub_db_inalcanzable(bin_dir)

    result = run_script(
        "scripts/ops/preflight-production.sh",
        env={
            "STACK_DIR": str(stack),
            "BACKUP_DIR": str(backup),
            "IMAGE_TAG": "abcdef1",
            "MIGRATION_COMPATIBILITY": "backward-compatible",
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
        },
    )

    assert result.returncode == 1
    assert "no se pudo derivar la revisión desplegada" in result.stderr
    assert "no corresponde" not in result.stderr


def _docker_stub_alembic_falla_en_la_imagen(bin_dir: Path) -> None:
    """`docker` de mentira donde la base responde, pero Alembic no puede
    listar los heads DENTRO de la imagen (imagen corrupta, dependencia rota,
    etc.)."""
    stub = bin_dir / "docker"
    stub.write_text(
        "#!/usr/bin/env bash\n"
        "case \" $* \" in\n"
        + _ARMS_IMAGEN_BACKEND +
        '  *" --status running "*) echo db ;;\n'
        f'  *" exec -T db "*) echo "{FAKE_CURRENT_REVISION}" ;;\n'
        '  *"alembic heads"*) echo "Traceback: alembic explotó" >&2; exit 1 ;;\n'
        "esac\n"
        "exit 0\n"
    )
    stub.chmod(0o755)


def test_preflight_falla_cerrado_si_alembic_no_puede_listar_heads_en_la_imagen(tmp_path):
    backup = tmp_path / "backups"
    backup.mkdir()
    (backup / "cataclub_today.dump").write_text("dump")
    stack = tmp_path / "stack"
    stack.mkdir()
    (stack / ".env").write_text(
        "IMAGE_TAG=abcdef1\nSMTP_HOST=smtp.example.test\nSMTP_PORT=2587\nSMTP_STARTTLS=true\n"
    )
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _docker_stub_alembic_falla_en_la_imagen(bin_dir)

    result = run_script(
        "scripts/ops/preflight-production.sh",
        env={
            "STACK_DIR": str(stack),
            "BACKUP_DIR": str(backup),
            "IMAGE_TAG": "abcdef1",
            "MIGRATION_COMPATIBILITY": "backward-compatible",
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
        },
    )

    assert result.returncode == 1
    assert "no se pudo derivar las migraciones pendientes" in result.stderr
    assert "no corresponde" not in result.stderr


def test_preflight_accepts_an_explicitly_backward_compatible_release(tmp_path):
    backup = tmp_path / "backups"
    backup.mkdir()
    (backup / "cataclub_today.dump").write_text("dump")
    stack = tmp_path / "stack"
    stack.mkdir()
    (stack / ".env").write_text("IMAGE_TAG=abcdef1\nSMTP_HOST=smtp.example.test\nSMTP_PORT=2587\nSMTP_STARTTLS=true\n")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "docker").write_text(
        "#!/usr/bin/env bash\n"
        + _CASE_IMAGEN_BACKEND +
        "exit 0\n"
    )
    (bin_dir / "docker").chmod(0o755)
    _stub_smtp_tools(bin_dir)

    result = run_script(
        "scripts/ops/preflight-production.sh",
        env={
            "STACK_DIR": str(stack),
            "BACKUP_DIR": str(backup),
            "IMAGE_TAG": "abcdef1",
            "MIGRATION_COMPATIBILITY": "backward-compatible",
            # Hermético: si no se fija, el default real
            # (/var/lib/cata-club/releases) filtraría el estado de la máquina
            # que corre la suite hacia adentro del test.
            "RELEASE_RECORD_DIR": str(tmp_path / "no-existe-releases"),
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
        },
    )

    assert result.returncode == 0, result.stderr
    assert "Preflight OK" in result.stdout
    assert "registry.example/cata-backend:abcdef1" in result.stdout


def test_preflight_treats_missing_db_as_first_provision_when_no_release_was_ever_recorded(
    tmp_path,
):
    """`db` no corriendo por sí solo no prueba nada: la señal real es si YA
    se registró un release para este stack (`current.env`, que escribe
    record-release.sh y lee rollback-release.sh:24). Sin ese archivo no hay
    evidencia de un deploy previo, así que se asume primer aprovisionamiento
    y NO se falla cerrado."""
    backup = tmp_path / "backups"
    backup.mkdir()
    (backup / "cataclub_today.dump").write_text("dump")
    stack = tmp_path / "stack"
    stack.mkdir()
    (stack / ".env").write_text(
        "IMAGE_TAG=abcdef1\nSMTP_HOST=smtp.example.test\nSMTP_PORT=2587\nSMTP_STARTTLS=true\n"
    )
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "docker").write_text(
        "#!/usr/bin/env bash\n"
        + _CASE_IMAGEN_BACKEND +
        "exit 0\n"
    )
    (bin_dir / "docker").chmod(0o755)
    _stub_smtp_tools(bin_dir)
    release_record_dir = tmp_path / "no-existe-releases"

    result = run_script(
        "scripts/ops/preflight-production.sh",
        env={
            "STACK_DIR": str(stack),
            "BACKUP_DIR": str(backup),
            "IMAGE_TAG": "abcdef1",
            "MIGRATION_COMPATIBILITY": "backward-compatible",
            "RELEASE_RECORD_DIR": str(release_record_dir),
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
        },
    )

    assert result.returncode == 0, result.stderr
    assert "primer aprovisionamiento" in result.stdout


def test_preflight_fails_closed_when_db_is_down_but_a_release_was_already_recorded(
    tmp_path,
):
    """Contraejemplo del carve-out: si YA hay un release registrado, `db` no
    corriendo es una base caída, no un primer aprovisionamiento. El mensaje
    tiene que decir eso, no inventar la causa benigna."""
    backup = tmp_path / "backups"
    backup.mkdir()
    (backup / "cataclub_today.dump").write_text("dump")
    stack = tmp_path / "stack"
    stack.mkdir()
    (stack / ".env").write_text(
        "IMAGE_TAG=abcdef1\nSMTP_HOST=smtp.example.test\nSMTP_PORT=2587\nSMTP_STARTTLS=true\n"
    )
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "docker").write_text(
        "#!/usr/bin/env bash\n"
        + _CASE_IMAGEN_BACKEND +
        "exit 0\n"
    )
    (bin_dir / "docker").chmod(0o755)
    release_record_dir = tmp_path / "releases"
    release_record_dir.mkdir()
    (release_record_dir / "current.env").write_text(
        "IMAGE_TAG=deadbee\nMIGRATION_COMPATIBILITY=backward-compatible\n"
    )

    result = run_script(
        "scripts/ops/preflight-production.sh",
        env={
            "STACK_DIR": str(stack),
            "BACKUP_DIR": str(backup),
            "IMAGE_TAG": "abcdef1",
            "MIGRATION_COMPATIBILITY": "backward-compatible",
            "RELEASE_RECORD_DIR": str(release_record_dir),
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
        },
    )

    assert result.returncode == 1
    assert "no está corriendo" in result.stderr
    assert "release previo registrado" in result.stderr
    assert "primer aprovisionamiento" not in result.stderr


def test_record_release_writes_auditable_current_record_without_credentials(tmp_path):
    records = tmp_path / "releases"
    stack = tmp_path / "stack"
    stack.mkdir()
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    # Stub de UNA línea a propósito, y es la excepción de esta suite.
    # `record-release.sh:23-31` todavía parsea `config --images backend` con el
    # mismo case defectuoso que este fix saca del preflight, así que contra la
    # salida real escribiría `IMAGE_REFERENCE=postgres:16-alpine\nredis:...` en
    # un registro que `rollback-release.sh:24` lee como autoritativo. Ese
    # defecto queda FUERA del alcance del issue #846 y se sigue en #847; este
    # test mide lo suyo (que el registro no filtre credenciales) sin fingir que
    # aquel está arreglado.
    (bin_dir / "docker").write_text(
        "#!/usr/bin/env bash\n"
        'case " $* " in *" --images backend "*) echo registry.example/cata-backend:${IMAGE_TAG};; esac\n'
        "exit 0\n"
    )
    (bin_dir / "docker").chmod(0o755)

    result = run_script(
        "scripts/ops/record-release.sh",
        env={
            "IMAGE_TAG": "abcdef1",
            "MIGRATION_COMPATIBILITY": "backward-compatible",
            "RELEASE_RECORD_DIR": str(records),
            "STACK_DIR": str(stack),
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
        },
    )

    assert result.returncode == 0, result.stderr
    current = records / "current.env"
    assert current.exists()
    content = current.read_text()
    assert "IMAGE_TAG=abcdef1" in content
    assert "MIGRATION_COMPATIBILITY=backward-compatible" in content
    assert "IMAGE_REFERENCE=registry.example/cata-backend:abcdef1" in content
    assert (records / "abcdef1.env").exists()
    assert "PASSWORD" not in content
    assert "TOKEN" not in content


def test_install_cron_se_niega_si_el_cifrado_no_esta_configurado(tmp_path):
    """El cron no hereda el shell del operador: la clave tiene que estar en disco.

    Sin esta compuerta, `install-cron` deja instalado un backup que revienta a
    las 03:30 contra un log que nadie mira. Falla acá, con el operador todavía
    en la terminal.
    """
    cron_file = tmp_path / "crontab"
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _stub_crontab(bin_dir)
    _stub_age(bin_dir)

    result = run_script(
        "scripts/deploy/deploy.sh",
        "install-cron",
        "--confirm-install-cron",
        env=_entorno_install_cron(
            tmp_path,
            bin_dir,
            BACKUP_AGE_RECIPIENTS_FILE=str(tmp_path / "no-existe.txt"),
        ),
    )

    assert result.returncode != 0
    assert "destinatario de cifrado" in result.stderr
    assert not cron_file.exists(), "no se debe tocar el crontab sin cifrado configurado"


def test_install_cron_se_niega_si_no_puede_crear_el_log_del_cron(tmp_path):
    """Un cron que no puede escribir su log muere ANTES de ejecutar nada.

    Las dos entradas redirigen a `$BACKUP_CRON_LOG`. Si esa redirección falla,
    el shell del cron aborta el comando entero: se caen a la vez el backup de
    las 03:30 y la alarma de frescura de las 07:00, que es lo ÚNICO que avisaría
    del backup muerto. Sin MAILTO ni MTA en el host, las dos mueren calladas y
    `install-cron` reporta éxito. Pasó en el host real: el usuario que corre el
    cron no está en el grupo dueño de `/var/log` y no puede crear el archivo.
    """
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _stub_crontab(bin_dir)
    _stub_age(bin_dir)
    # Directorio inexistente: la creación del log falla con ENOENT para
    # cualquier usuario, incluido root, así que el candado no depende del uid
    # con el que corra la suite.
    log_inalcanzable = tmp_path / "sin-directorio" / "cataclub-backup.log"

    result = run_script(
        "scripts/deploy/deploy.sh",
        "install-cron",
        "--confirm-install-cron",
        env=_entorno_install_cron(
            tmp_path, bin_dir, BACKUP_CRON_LOG=str(log_inalcanzable)
        ),
    )

    assert result.returncode != 0
    assert str(log_inalcanzable) in result.stderr
    assert not (tmp_path / "crontab").exists(), (
        "no se debe instalar un cron que muere en la redirección de su propio log"
    )


@pytest.mark.skipif(
    os.geteuid() == 0, reason="root escribe igual un archivo sin permiso de escritura"
)
def test_install_cron_se_niega_si_el_log_existe_pero_no_es_escribible(tmp_path):
    """El modo de falla del host real: el archivo existe y el cron no lo puede abrir."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _stub_crontab(bin_dir)
    _stub_age(bin_dir)
    log_ajeno = tmp_path / "cataclub-backup.log"
    log_ajeno.write_text("")
    log_ajeno.chmod(0o444)

    result = run_script(
        "scripts/deploy/deploy.sh",
        "install-cron",
        "--confirm-install-cron",
        env=_entorno_install_cron(tmp_path, bin_dir, BACKUP_CRON_LOG=str(log_ajeno)),
    )

    assert result.returncode != 0
    assert str(log_ajeno) in result.stderr
    assert not (tmp_path / "crontab").exists()


def test_install_cron_crea_el_log_cuando_todavia_no_existe(tmp_path):
    """El caso feliz del primer aprovisionamiento: el log no existe y se puede crear."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _stub_crontab(bin_dir)
    _stub_age(bin_dir)
    log_nuevo = tmp_path / "cataclub-backup.log"

    result = run_script(
        "scripts/deploy/deploy.sh",
        "install-cron",
        "--confirm-install-cron",
        env=_entorno_install_cron(tmp_path, bin_dir, BACKUP_CRON_LOG=str(log_nuevo)),
    )

    assert result.returncode == 0, result.stderr
    assert log_nuevo.exists(), "el preflight tiene que dejar el log listo, no solo mirarlo"
    assert "backup-db.sh" in (tmp_path / "crontab").read_text()


def _linea_de_frescura(cron_file: Path) -> str:
    lineas = [
        linea
        for linea in cron_file.read_text().splitlines()
        if "check-backup-freshness.sh" in linea
    ]
    assert len(lineas) == 1, f"se esperaba una sola línea de frescura: {lineas!r}"
    return lineas[0]


def test_install_cron_encadena_el_heartbeat_solo_a_un_chequeo_exitoso(tmp_path):
    """El heartbeat es un dead-man's-switch: se pingea SOLO si el backup está sano.

    `check-backup-freshness.sh` sale 1 sin ningún dump y 2 con un dump vencido.
    Si el ping saliera igual, el monitor externo vería verde exactamente cuando
    hay que alertar -- el monitoreo quedaría peor que no tenerlo, porque además
    daría una garantía falsa. Por eso el encadenado es `&&` y no `;`.
    """
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _stub_crontab(bin_dir)
    _stub_age(bin_dir)

    result = run_script(
        "scripts/deploy/deploy.sh",
        "install-cron",
        "--confirm-install-cron",
        env=_entorno_install_cron(tmp_path, bin_dir),
    )

    assert result.returncode == 0, result.stderr
    linea = _linea_de_frescura(tmp_path / "crontab")
    # `rpartition`: el primer `&&` de la línea es el del `cd` al directorio del
    # stack; el que importa es el último, el que gobierna el ping.
    chequeo, separador, ping = linea.rpartition("&&")
    assert separador == "&&", "la línea de frescura no encadena nada con `&&`"
    assert "check-backup-freshness.sh" in chequeo
    assert "notify-heartbeat.sh" in ping, (
        f"el heartbeat no cuelga del `&&` del chequeo: {linea!r}"
    )
    assert "notify-heartbeat.sh" not in chequeo
    assert ";" not in linea, (
        "un `;` pingearía también con el chequeo en rojo: el dead-man's-switch "
        "solo sirve si el ping falta cuando el backup falta"
    )
    assert "--max-age-hours" in chequeo, (
        "el cron tiene que declarar el umbral como deploy.sh y preflight, no "
        "caer al default implícito del script"
    )


def test_install_cron_nunca_escribe_la_url_del_heartbeat_en_el_crontab(tmp_path):
    """`crontab -l` no pide privilegios; el archivo del heartbeat es de root.

    Escribir la URL en el crontab la vuelve legible para cualquiera en el host,
    y con ella se pingea a mano: la alarma queda en verde para siempre con el
    backup muerto. Ese es el motivo entero de que el script lea la URL de un
    archivo en vez de recibirla por argumento.
    """
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _stub_crontab(bin_dir)
    _stub_age(bin_dir)

    result = run_script(
        "scripts/deploy/deploy.sh",
        "install-cron",
        "--confirm-install-cron",
        env=_entorno_install_cron(tmp_path, bin_dir),
    )

    assert result.returncode == 0, result.stderr
    crontab = (tmp_path / "crontab").read_text()
    assert URL_DE_HEARTBEAT_DE_PRUEBA not in crontab
    assert "TOKEN-DE-PRUEBA" not in crontab
    assert URL_DE_HEARTBEAT_DE_PRUEBA not in result.stdout + result.stderr


def test_install_cron_se_niega_si_el_heartbeat_no_esta_configurado(tmp_path):
    """Sin URL de heartbeat se aborta; NO se instala un cron sin el ping.

    Instalar igual con un aviso degradaría la protección en silencio: el crontab
    quedaría con las dos líneas de siempre, `crontab -l` se vería bien, y el
    aviso se lo lleva el scroll de la terminal. Meses después nadie sabe que el
    dead-man's-switch nunca se cableó, y no hay nada que lo delate -- que es
    exactamente el modo de falla que este cambio existe para cerrar.

    Abortar no cuesta nada: `install-cron` es idempotente y reescribe el crontab
    entero en cada corrida, así que el estado tras el aborto es el de antes, con
    el operador todavía en la terminal leyendo el comando exacto que lo arregla.
    Es el mismo criterio que ya usa la compuerta del destinatario de cifrado.
    """
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _stub_crontab(bin_dir)
    _stub_age(bin_dir)

    result = run_script(
        "scripts/deploy/deploy.sh",
        "install-cron",
        "--confirm-install-cron",
        env=_entorno_install_cron(
            tmp_path, bin_dir, HEARTBEAT_URL_FILE=str(tmp_path / "no-existe.txt")
        ),
    )

    assert result.returncode != 0
    assert str(tmp_path / "no-existe.txt") in result.stderr
    assert not (tmp_path / "crontab").exists(), (
        "no se debe instalar un cron sin el ping: sería una protección degradada "
        "sin que nada lo diga"
    )


def test_install_cron_se_niega_si_el_archivo_de_heartbeat_esta_vacio(tmp_path):
    """Un archivo creado con `touch` y nunca completado no es una configuración."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _stub_crontab(bin_dir)
    _stub_age(bin_dir)
    vacio = tmp_path / "heartbeat-vacio.txt"
    vacio.write_text("   \n\n")

    result = run_script(
        "scripts/deploy/deploy.sh",
        "install-cron",
        "--confirm-install-cron",
        env=_entorno_install_cron(tmp_path, bin_dir, HEARTBEAT_URL_FILE=str(vacio)),
    )

    assert result.returncode != 0
    assert str(vacio) in result.stderr
    assert not (tmp_path / "crontab").exists()


def test_deploy_aborta_si_el_backup_pre_deploy_no_puede_cifrar(tmp_path):
    """Sin backup cifrado no se migra.

    El entrypoint del backend migra en cada arranque y no hay down-migrations,
    así que el dump pre-deploy es el único camino de vuelta. Que ese dump sea
    ilegible para quien robe el disco es parte de que exista: degradar a texto
    plano para no frenar un deploy cambia una caída por una filtración.
    """
    env, backups, docker_log = _deploy_env(tmp_path, db_running=True)
    env["BACKUP_AGE_RECIPIENTS"] = ""

    result = run_script("scripts/deploy/deploy.sh", env=env)

    assert result.returncode != 0
    assert "no se escribe sin cifrar" in result.stderr
    assert list(backups.iterdir()) == []
    # Lo que importa: nunca llegó a levantar las imágenes nuevas.
    assert "up -d" not in docker_log.read_text()


# ─── Smoke check del chatbot como paso del deploy (issue #766) ──────────────
# Una clave con los `<>` del placeholder pegados tumbó el chatbot en staging y
# costó una hora de SSH encontrarla. `scripts/verificar_chatbot.py` YA detecta
# ese caso exacto (`diagnostico_chatbot._motivo_de_incompleta`); lo que faltaba
# era que algo lo corriera solo. Tiene que correr DENTRO del contenedor recién
# creado: el entorno se fija al crearlo, así que mirar el `.env` desde el host
# no prueba que el valor haya llegado al proceso.


def test_deploy_verifica_la_config_del_chatbot_despues_de_recrear_los_contenedores(
    tmp_path,
):
    env, _, docker_log = _deploy_env(tmp_path, db_running=True)

    result = run_script("scripts/deploy/deploy.sh", env=env)

    assert result.returncode == 0, result.stdout + result.stderr
    lines = docker_log.read_text().splitlines()
    check_calls = [i for i, line in enumerate(lines) if "verificar_chatbot.py" in line]
    up_calls = [i for i, line in enumerate(lines) if "up -d" in line]
    assert check_calls, (
        "el deploy no corre scripts/verificar_chatbot.py; nada obliga a "
        "revisar la clave del proveedor después de editar el .env"
    )
    assert up_calls and up_calls[0] < check_calls[0], (
        "el smoke check tiene que correr DESPUÉS de up -d: el entorno del "
        "contenedor se fija al crearlo, y un contenedor viejo todavía tiene "
        "la clave anterior"
    )


def test_una_clave_de_chatbot_rota_aborta_el_deploy_y_no_registra_el_release(tmp_path):
    """Salida 1 = INCOMPLETA. Es SIEMPRE un error del operador, nunca una
    decisión: comillas, espacios o el `<placeholder>` sin reemplazar. El
    release no puede quedar registrado como bueno con esa configuración."""
    env, _, _ = _deploy_env(tmp_path, db_running=True)
    env["CHATBOT_CHECK_EXIT"] = "1"
    records = Path(env["RELEASE_RECORD_DIR"])

    result = run_script("scripts/deploy/deploy.sh", env=env)

    assert result.returncode != 0, result.stdout
    assert "chatbot" in (result.stdout + result.stderr).lower()
    assert not records.exists(), "se registró el release pese al chequeo fallido"


def test_una_clave_de_chatbot_ausente_no_aborta_el_deploy(tmp_path):
    """Salida 0 también cubre AUSENTE sin `--exigir`: un club que no habilitó
    el asistente externo es un despliegue legítimo (`opencode_api_key` está
    fuera del fail-fast de `Settings` justamente por eso). Abortar ahí negaría
    el deploy de TODA la app por una función opcional."""
    env, _, _ = _deploy_env(tmp_path, db_running=True)
    env["CHATBOT_CHECK_EXIT"] = "0"

    result = run_script("scripts/deploy/deploy.sh", env=env)

    assert result.returncode == 0, result.stdout + result.stderr


def test_el_deploy_no_exige_la_clave_salvo_que_el_operador_lo_declare(tmp_path):
    env, _, docker_log = _deploy_env(tmp_path, db_running=True)

    run_script("scripts/deploy/deploy.sh", env=env)

    linea = next(
        line
        for line in docker_log.read_text().splitlines()
        if "verificar_chatbot.py" in line
    )
    assert "--exigir" not in linea, (
        "sin CHATBOT_REQUERIDO, la ausencia de clave es una configuración "
        "válida y el deploy no puede tratarla como un fallo"
    )


def test_chatbot_requerido_convierte_la_ausencia_de_clave_en_un_fallo(tmp_path):
    """El despliegue que SÍ habilitó el asistente declara `CHATBOT_REQUERIDO=1`
    y recupera exactamente el `--exigir` que pide el issue #766."""
    env, _, docker_log = _deploy_env(tmp_path, db_running=True)
    env["CHATBOT_REQUERIDO"] = "1"

    run_script("scripts/deploy/deploy.sh", env=env)

    linea = next(
        line
        for line in docker_log.read_text().splitlines()
        if "verificar_chatbot.py" in line
    )
    assert "--exigir" in linea


def test_una_clave_ausente_con_chatbot_requerido_aborta_el_deploy(tmp_path):
    env, _, _ = _deploy_env(tmp_path, db_running=True)
    env["CHATBOT_REQUERIDO"] = "1"
    env["CHATBOT_CHECK_EXIT"] = "2"

    result = run_script("scripts/deploy/deploy.sh", env=env)

    assert result.returncode != 0, result.stdout


# ─── Salud de celery-worker/celery-beat y round-trip (issue #791) ──────────
#
# `do_checks` imprimía `docker compose ps -a` sin leerlo y solo sondeaba
# `/health` del backend: una imagen que rompe el arranque de celery-worker o
# celery-beat dejaba el deploy en verde y `record-release.sh` anotaba el
# release como bueno con las tareas asíncronas (vencimientos, mora, las
# bandejas de correo) muertas en silencio. Los tres healthchecks de compose
# (`docker-compose.yml`: celery-worker `inspect ping -d`, celery-beat
# freshness del schedule) ya detectan justo esta falla; lo que faltaba era
# que algo los leyera. Fuera de Swarm, Compose no reinicia un contenedor por
# quedar `unhealthy` -- solo por salir -- así que sin este candado un
# contenedor enfermo podía quedar así indefinidamente.


def test_deploy_falla_si_celery_worker_no_esta_saludable(tmp_path):
    env, _, docker_log = _deploy_env(tmp_path, db_running=True)
    env["CELERY_WORKER_HEALTH"] = "unhealthy"

    result = run_script("scripts/deploy/deploy.sh", env=env)

    assert result.returncode != 0, result.stdout
    assert "celery-worker" in result.stderr
    assert "up -d" in docker_log.read_text(), "las imágenes nuevas ya deben estar arriba"
    assert not (Path(env["RELEASE_RECORD_DIR"])).exists(), (
        "no se debe registrar el release con celery-worker enfermo"
    )


def test_deploy_falla_si_celery_beat_no_esta_saludable(tmp_path):
    """beat ya reportaba esto en su propio healthcheck (freshness del
    schedule); lo que faltaba era que el deploy lo leyera."""
    env, _, _ = _deploy_env(tmp_path, db_running=True)
    env["CELERY_BEAT_HEALTH"] = "unhealthy"

    result = run_script("scripts/deploy/deploy.sh", env=env)

    assert result.returncode != 0, result.stdout
    assert "celery-beat" in result.stderr
    assert not (Path(env["RELEASE_RECORD_DIR"])).exists()


def test_deploy_falla_si_celery_worker_no_arranco(tmp_path):
    """Un servicio que nunca llegó a crearse (falla en `up -d`) no aparece en
    `docker compose ps`: la ausencia de salud debe abortar igual que
    'unhealthy', no pasar de largo por falta de dato."""
    env, _, _ = _deploy_env(tmp_path, db_running=True)
    env["CELERY_WORKER_STATE"] = ""
    env["CELERY_WORKER_HEALTH"] = ""

    result = run_script("scripts/deploy/deploy.sh", env=env)

    assert result.returncode != 0, result.stdout
    assert "celery-worker" in result.stderr


def test_deploy_falla_si_el_round_trip_de_celery_no_responde(tmp_path):
    """Healthy en el `Health` de Docker no alcanza: si ningún worker contesta
    al ping de control, el deploy tiene que abortar igual."""
    env, _, docker_log = _deploy_env(tmp_path, db_running=True)
    env["CELERY_PING_EXIT"] = "1"

    result = run_script("scripts/deploy/deploy.sh", env=env)

    assert result.returncode != 0, result.stdout
    assert "celery" in result.stderr.lower()
    assert "inspect ping" in docker_log.read_text(), "el deploy nunca intentó el round-trip"
    assert not (Path(env["RELEASE_RECORD_DIR"])).exists()


def test_deploy_pasa_si_celery_worker_y_beat_estan_sanos_y_el_round_trip_responde(tmp_path):
    """Caso feliz explícito: pila sana, deploy verde, y los tres chequeos
    nuevos quedan en el log en el orden esperado (salud antes que el
    round-trip).

    `ps --format json` ya NO lleva el nombre del servicio en el argv (issue
    #791, corrección de dureza: el filtro posicional no es un contrato
    estable entre versiones de Compose) -- el filtro por `Service` ocurre
    del lado de Python, invisible en el log del stub. Lo que este test
    puede observar desde el argv es que la llamada se repite una vez por
    servicio (`esperar_celery_saludable` corre para celery-worker y para
    celery-beat)."""
    env, _, docker_log = _deploy_env(tmp_path, db_running=True)

    result = run_script("scripts/deploy/deploy.sh", env=env)

    assert result.returncode == 0, result.stdout + result.stderr
    lines = docker_log.read_text().splitlines()
    health_calls = [i for i, line in enumerate(lines) if "ps --format json" in line]
    ping_calls = [i for i, line in enumerate(lines) if "inspect ping" in line]
    assert len(health_calls) >= 2, "deploy no consultó la salud de ambos servicios de celery"
    assert ping_calls, "deploy nunca ejecutó el round-trip de celery"
    assert max(health_calls) < ping_calls[0], (
        "el round-trip debe correr DESPUÉS de confirmar que ambos servicios "
        "están sanos, no antes"
    )
    assert (Path(env["RELEASE_RECORD_DIR"]) / "current.env").exists()


# ─── `docker compose ps --format json` no tiene una forma estable ─────────
#
# Compose reciente emite JSON Lines (un objeto por línea); versiones más
# viejas emiten un único array JSON. Un parser que asume una sola forma
# (`sys.stdin.readline()` + `json.loads(linea).get(...)`) revienta con
# `AttributeError` contra un array -- `.get()` no existe en una `list` -- y
# esa excepción NO es un `json.JSONDecodeError`, así que ni siquiera la
# atrapaba el único `except` que tenía el parser original. El resultado no
# era un fallo limpio: era `salud=""` por la razón EQUIVOCADA ("no pude
# interpretar la salida"), indistinguible de "el servicio no está sano", y
# terminaba abortando TODOS los deploys contra un host con Compose viejo.
# Ese gate roto es peor que ningún gate: lo primero que hace cualquiera es
# desactivarlo.


def test_deploy_pasa_si_celery_esta_sano_con_ps_como_array_json(tmp_path):
    """La regresión real: Compose viejo devuelve un array JSON en vez de
    JSON Lines, y una pila sana tiene que seguir pasando el deploy."""
    env, _, _ = _deploy_env(tmp_path, db_running=True)
    env["PS_JSON_SHAPE"] = "array"

    result = run_script("scripts/deploy/deploy.sh", env=env)

    assert result.returncode == 0, result.stdout + result.stderr


def test_deploy_falla_si_celery_worker_no_esta_sano_con_ps_como_array_json(tmp_path):
    env, _, _ = _deploy_env(tmp_path, db_running=True)
    env["PS_JSON_SHAPE"] = "array"
    env["CELERY_WORKER_HEALTH"] = "unhealthy"

    result = run_script("scripts/deploy/deploy.sh", env=env)

    assert result.returncode != 0, result.stdout
    assert "celery-worker" in result.stderr


def test_deploy_pasa_si_celery_esta_sano_con_ps_como_json_lines(tmp_path):
    """Mismo caso feliz, pinneando explícitamente la forma JSON Lines (el
    default de la fixture, pero acá es el comportamiento bajo prueba, no un
    incidental)."""
    env, _, _ = _deploy_env(tmp_path, db_running=True)
    env["PS_JSON_SHAPE"] = "lines"

    result = run_script("scripts/deploy/deploy.sh", env=env)

    assert result.returncode == 0, result.stdout + result.stderr


def test_deploy_falla_si_celery_beat_no_esta_sano_con_ps_como_json_lines(tmp_path):
    env, _, _ = _deploy_env(tmp_path, db_running=True)
    env["PS_JSON_SHAPE"] = "lines"
    env["CELERY_BEAT_HEALTH"] = "unhealthy"

    result = run_script("scripts/deploy/deploy.sh", env=env)

    assert result.returncode != 0, result.stdout
    assert "celery-beat" in result.stderr


def test_deploy_falla_cerrado_si_ps_devuelve_basura_no_json(tmp_path):
    """Ni JSON Lines ni un array: texto no-JSON en la salida (una versión de
    Compose completamente inesperada, o `ps` fallando de una forma que no
    es un `returncode` distinto de 0). El parser tiene que interpretarlo
    como salud vacía y abortar -- nunca reventar python3 ni, mucho menos,
    dejar pasar el deploy en silencio."""
    env, _, _ = _deploy_env(tmp_path, db_running=True)
    env["PS_JSON_GARBAGE"] = "1"

    result = run_script("scripts/deploy/deploy.sh", env=env)

    assert result.returncode != 0, result.stdout
    assert "celery" in result.stderr.lower()


# ─── Regla ante más de un registro para el mismo servicio ─────────────────
#
# Hoy esto no es alcanzable: `ps` sin `-a`/`--all` (que este script nunca
# pasa) no lista contenedores `exited`, y ningún compose de este repo
# declara `deploy.replicas` ni usa `--scale` para celery-worker/celery-beat
# (verificado con `rg`). Pero el día que alguien agregue `deploy.replicas`
# para escalar el worker, `ps --format json` va a devolver DOS registros
# con el mismo `Service`, y la regla fail-closed (sano SOLO si TODOS los
# registros matchean 'healthy') tiene que seguir sosteniéndose sin que
# nadie la haya vuelto a mirar. Sin este candado, invertir la comparación
# de conjuntos (`estados == {"healthy"}` -> `"healthy" in estados`) es un
# cambio de una palabra que ninguna otra prueba de este archivo detecta --
# confirmado: 29/29 seguían en verde con la variante invertida.


def test_deploy_falla_si_una_replica_de_celery_worker_no_esta_saludable(tmp_path):
    """Dos registros para celery-worker (simula `deploy.replicas: 2`): uno
    'healthy', el otro 'unhealthy'. Tiene que abortar -- un solo registro
    sano no alcanza para dar por bueno el servicio."""
    env, _, _ = _deploy_env(tmp_path, db_running=True)
    env["CELERY_WORKER_HEALTH"] = "healthy"
    env["CELERY_WORKER_REPLICA_HEALTH"] = "unhealthy"

    result = run_script("scripts/deploy/deploy.sh", env=env)

    assert result.returncode != 0, result.stdout
    assert "celery-worker" in result.stderr


def test_deploy_falla_si_una_replica_de_celery_worker_no_reporta_salud(tmp_path):
    """Mismo escenario, pero el segundo registro no trae `Health` (cadena
    vacía) en vez de 'unhealthy' -- un contenedor sin healthcheck aplicado
    todavía, o uno cuyo campo vino vacío por la razón que sea. Tampoco debe
    alcanzar con que el otro esté sano."""
    env, _, _ = _deploy_env(tmp_path, db_running=True)
    env["CELERY_WORKER_HEALTH"] = "healthy"
    env["CELERY_WORKER_REPLICA_HEALTH"] = ""

    result = run_script("scripts/deploy/deploy.sh", env=env)

    assert result.returncode != 0, result.stdout
    assert "celery-worker" in result.stderr
