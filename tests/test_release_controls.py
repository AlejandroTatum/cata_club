"""Focused contracts for production release controls."""

import os
import subprocess
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
    (stack / ".env").write_text("IMAGE_TAG=abcdef1\n")
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
        '  *" --images backend "*) echo "registry.example/cata-backend:${IMAGE_TAG}"; if [ "${MULTI_IMAGE_OUTPUT:-0}" = "1" ]; then echo "registry.example/cata-frontend:${IMAGE_TAG}"; fi ;;\n'
        '  *" manifest inspect "*) [ "$3" = "registry.example/cata-backend:${IMAGE_TAG}" ] || exit 1 ;;\n'
        '  *" --status running "*) if [ "${DB_RUNNING:-0}" = "1" ]; then echo db; fi ;;\n'
        "esac\n"
        "exit 0\n"
    )
    (bin_dir / "docker").chmod(0o755)
    _stub_age(bin_dir)
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
    (stack / ".env").write_text("IMAGE_TAG=abcdef1\n")

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
    assert "MIGRATION_COMPATIBILITY" in result.stderr
    assert "manual-review-required" in result.stderr


def test_preflight_accepts_an_explicitly_backward_compatible_release(tmp_path):
    backup = tmp_path / "backups"
    backup.mkdir()
    (backup / "cataclub_today.dump").write_text("dump")
    stack = tmp_path / "stack"
    stack.mkdir()
    (stack / ".env").write_text("IMAGE_TAG=abcdef1\n")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "docker").write_text(
        "#!/usr/bin/env bash\n"
        'case " $* " in *" --images backend "*) echo registry.example/cata-backend:${IMAGE_TAG};; esac\n'
        "exit 0\n"
    )
    (bin_dir / "docker").chmod(0o755)

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
