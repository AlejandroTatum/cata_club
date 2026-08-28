"""Focused contracts for production release controls."""

import os
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent

# Destinatario age de mentira. Acá `age` está stubeado igual que `docker` y
# `crontab` (esta suite stubea sus fronteras a propósito): lo que se prueba en
# este archivo es que deploy/install-cron EXIJAN cifrado configurado, no la
# criptografía en sí. El cifrado real se verifica de punta a punta contra el
# binario `age` en tests/test_backup_controls.py.
DESTINATARIO_DE_PRUEBA = "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsxxxxxx"


def run_script(script: str, *args: str, env: dict[str, str] | None = None):
    return subprocess.run(
        ["bash", str(ROOT / script), *args],
        cwd=ROOT,
        env={**os.environ, **(env or {})},
        capture_output=True,
        text=True,
    )


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
        'case " $* " in *" --images backend "*) echo registry.example/cata-backend:${IMAGE_TAG};; esac\n'
        "exit 0\n"
    )
    (bin_dir / "docker").chmod(0o755)
    (bin_dir / "getent").write_text(
        "#!/usr/bin/env bash\n"
        '[ "${SMTP_PREFLIGHT_MODE:-}" = dns-failure ] && exit 2\n'
        "exit 0\n"
    )
    (bin_dir / "getent").chmod(0o755)
    (bin_dir / "timeout").write_text(
        "#!/usr/bin/env bash\n"
        '[ "${SMTP_PREFLIGHT_MODE:-}" = connect-timeout ] && [ "${2:-}" = bash ] && exit 124\n'
        '[ "${SMTP_PREFLIGHT_MODE:-}" = connect-failure ] && [ "${2:-}" = bash ] && exit 1\n'
        '[ "${SMTP_PREFLIGHT_MODE:-}" = connect-refused ] && [ "${2:-}" = bash ] && exit 1\n'
        '[ "${SMTP_PREFLIGHT_MODE:-}" = starttls-failure ] && [ "${2:-}" = openssl ] && exit 1\n'
        '[ "${SMTP_PREFLIGHT_MODE:-}" = elapsed-bound ] && exec /usr/bin/timeout "$@"\n'
        "exit 0\n"
    )
    (bin_dir / "timeout").chmod(0o755)
    (bin_dir / "openssl").write_text(
        "#!/usr/bin/env bash\n"
        '[ "${SMTP_PREFLIGHT_MODE:-}" = elapsed-bound ] && sleep 5\n'
        "exit 0\n"
    )
    (bin_dir / "openssl").chmod(0o755)
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


def test_install_cron_requires_confirmation_before_modifying_crontab(tmp_path):
    cron_file = tmp_path / "crontab"
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "crontab").write_text(
        "#!/usr/bin/env bash\n"
        'if [ "${1:-}" = "-l" ]; then [ -f "$CRON_FILE" ] && cat "$CRON_FILE"; exit 0; fi\n'
        'if [ "${1:-}" = "-" ]; then cat > "$CRON_FILE"; exit 0; fi\n'
        "exit 1\n"
    )
    (bin_dir / "crontab").chmod(0o755)
    _stub_age(bin_dir)
    destinatarios = tmp_path / "backup-recipients.txt"
    destinatarios.write_text(f"{DESTINATARIO_DE_PRUEBA}\n")
    entorno = {
        "CRON_FILE": str(cron_file),
        "BACKUP_AGE_RECIPIENTS_FILE": str(destinatarios),
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
    }

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
            '  *" --format json "*) printf "%s\\n" "{\\\"services\\\":{\\\"backend\\\":{\\\"image\\\":\\\"registry.example/cata-backend:${IMAGE_TAG}\\\"}}}" ;;\n'
            '  *" --images backend "*) if [ "${REALISTIC_COMPOSE_OUTPUT:-0}" = "1" ]; then printf "%s\\n" "postgres:16" "redis:7" "registry.example/cata-backend:${IMAGE_TAG}"; else echo "registry.example/cata-backend:${IMAGE_TAG}"; if [ "${MULTI_IMAGE_OUTPUT:-0}" = "1" ]; then echo "registry.example/cata-backend:${IMAGE_TAG}"; elif [ "${AMBIGUOUS_IMAGE_OUTPUT:-0}" = "1" ]; then echo "registry.example/cata-frontend:${IMAGE_TAG}"; fi; fi ;;\n'
        # El smoke check del chatbot corre DENTRO del contenedor backend
        # (issue #766). `CHATBOT_CHECK_EXIT` reproduce sus tres códigos de
        # salida reales: 0 configurada/ausente, 1 incompleta, 2 ausente con
        # --exigir.
        '  *verificar_chatbot.py*) exit "${CHATBOT_CHECK_EXIT:-0}" ;;\n'
        '  *" manifest inspect "*) [ "$3" = "registry.example/cata-backend:${IMAGE_TAG}" ] || exit 1 ;;\n'
        '  *" --status running "*) if [ "${DB_RUNNING:-0}" = "1" ]; then echo db; fi ;;\n'
        "esac\n"
        "exit 0\n"
    )
    (bin_dir / "docker").chmod(0o755)
    _stub_age(bin_dir)
    for tool in ("getent", "timeout", "openssl"):
        stub = bin_dir / tool
        stub.write_text("#!/usr/bin/env bash\nexit 0\n")
        stub.chmod(0o755)
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


def _manual_review_approval(path: Path, **overrides: str) -> None:
    values = {
        "IMAGE_TAG": "abcdef1",
        "MIGRATION_RANGE": "c556legal01->e762rolunico->a790verifcorreo",
        "CURRENT_REVISION": "c556legal01",
        "PENDING_MIGRATIONS": "e762rolunico,a790verifcorreo",
        "RESTORE_CHECK": "passed",
        "MAINTENANCE_WINDOW": "planned",
        "APPROVED_BY": "release-reviewer",
        "APPROVED_AT": "2026-12-31T23:59:59Z",
        "EXPIRES_AT": "2099-12-31T23:59:59Z",
    }
    values.update(overrides)
    path.write_text("".join(f"{key}={value}\n" for key, value in values.items()))


def _manual_review_env(tmp_path: Path, approval: Path | None = None) -> dict[str, str]:
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
        'case " $* " in *" --images backend "*) echo registry.example/cata-backend:${IMAGE_TAG};; esac\n'
        "exit 0\n"
    )
    (bin_dir / "docker").chmod(0o755)
    for tool in ("getent", "timeout", "openssl"):
        stub = bin_dir / tool
        stub.write_text("#!/usr/bin/env bash\nexit 0\n")
        stub.chmod(0o755)
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
        'case " $* " in *" --images backend "*) echo registry.example/cata-backend:${IMAGE_TAG};; esac\n'
        "exit 0\n"
    )
    (bin_dir / "docker").chmod(0o755)
    for tool in ("getent", "timeout", "openssl"):
        stub = bin_dir / tool
        stub.write_text("#!/usr/bin/env bash\nexit 0\n")
        stub.chmod(0o755)

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
    assert "Preflight OK" in result.stdout
    assert "registry.example/cata-backend:abcdef1" in result.stdout


def test_record_release_writes_auditable_current_record_without_credentials(tmp_path):
    records = tmp_path / "releases"
    stack = tmp_path / "stack"
    stack.mkdir()
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
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
    (bin_dir / "crontab").write_text(
        "#!/usr/bin/env bash\n"
        'if [ "${1:-}" = "-l" ]; then [ -f "$CRON_FILE" ] && cat "$CRON_FILE"; exit 0; fi\n'
        'if [ "${1:-}" = "-" ]; then cat > "$CRON_FILE"; exit 0; fi\n'
        "exit 1\n"
    )
    (bin_dir / "crontab").chmod(0o755)
    _stub_age(bin_dir)

    result = run_script(
        "scripts/deploy/deploy.sh",
        "install-cron",
        "--confirm-install-cron",
        env={
            "CRON_FILE": str(cron_file),
            "BACKUP_AGE_RECIPIENTS_FILE": str(tmp_path / "no-existe.txt"),
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
        },
    )

    assert result.returncode != 0
    assert "destinatario de cifrado" in result.stderr
    assert not cron_file.exists(), "no se debe tocar el crontab sin cifrado configurado"


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
