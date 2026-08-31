"""Focused contracts for the backup freshness alarm (check-backup-freshness.sh)."""

import hashlib
import os
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SCRIPT = "scripts/ops/check-backup-freshness.sh"


def run_script(*args: str, env: dict[str, str] | None = None):
    return subprocess.run(
        ["bash", str(ROOT / SCRIPT), *args],
        cwd=ROOT,
        env={
            **os.environ,
            "BACKUP_B2_CONFIG_FILE": str(ROOT / "tests" / "no-b2-config.env"),
            **(env or {}),
        },
        capture_output=True,
        text=True,
    )


def make_dump(backup_dir: Path, age_hours: float = 0) -> Path:
    dump = backup_dir / "cataclub_2026-08-21.dump.age"
    dump.write_text("dump")
    if age_hours:
        old = time.time() - age_hours * 3600
        os.utime(dump, (old, old))
    return dump


def b2_enabled_env(tmp_path: Path) -> dict[str, str]:
    config = tmp_path / "b2-backup.env"
    config.write_text(
        "BACKUP_B2_ENABLED=1\n"
        "BACKUP_B2_ENDPOINT=https://s3.invalid\n"
        "BACKUP_B2_REGION=test\n"
        "BACKUP_B2_BUCKET=backups-test\n"
        "BACKUP_B2_PREFIX=cataclub/test\n"
        "BACKUP_B2_KEY_ID=not-a-secret\n"
        "BACKUP_B2_APPLICATION_KEY=not-a-secret\n"
    )
    return {"BACKUP_B2_CONFIG_FILE": str(config)}


def write_receipt(dump: Path, age_hours: float = 0, sha256: str | None = None):
    receipt = dump.with_name(f"{dump.name}.b2-receipt")
    receipt.write_text(
        f"artifact={dump.name}\n"
        f"sha256={sha256 or hashlib.sha256(dump.read_bytes()).hexdigest()}\n"
        f"size={dump.stat().st_size}\n"
    )
    if age_hours:
        old = time.time() - age_hours * 3600
        os.utime(receipt, (old, old))
    return receipt


def test_documented_invocation_accepts_max_age_hours_flag(tmp_path):
    make_dump(tmp_path)

    result = run_script("--max-age-hours", "26", env={"BACKUP_DIR": str(tmp_path)})

    assert result.returncode == 0, result.stderr
    assert "dump más reciente" in result.stdout


def test_defaults_to_26_hours_without_arguments(tmp_path):
    make_dump(tmp_path, age_hours=25)

    result = run_script(env={"BACKUP_DIR": str(tmp_path)})

    assert result.returncode == 0, result.stderr


def test_fresh_dump_with_b2_enabled_needs_a_matching_receipt(tmp_path):
    """The 07:00 heartbeat cannot trust only the local 03:30 dump."""
    dump = make_dump(tmp_path, age_hours=3.5)

    result = run_script(
        "--max-age-hours", "26", env={"BACKUP_DIR": str(tmp_path), **b2_enabled_env(tmp_path)}
    )

    assert result.returncode != 0
    assert "recibo" in result.stdout.lower() or "receipt" in result.stdout.lower()
    assert not dump.with_name(f"{dump.name}.b2-receipt").exists()


def test_b2_disabled_keeps_the_explicit_local_freshness_contract(tmp_path):
    make_dump(tmp_path, age_hours=3.5)

    result = run_script(
        "--max-age-hours",
        "26",
        env={"BACKUP_DIR": str(tmp_path), "BACKUP_B2_ENABLED": "0"},
    )

    assert result.returncode == 0, result.stderr


def test_matching_b2_receipt_allows_the_0330_to_0700_heartbeat_window(tmp_path):
    dump = make_dump(tmp_path, age_hours=3.5)
    write_receipt(dump, age_hours=3.5)

    result = run_script(
        "--max-age-hours", "26", env={"BACKUP_DIR": str(tmp_path), **b2_enabled_env(tmp_path)}
    )

    assert result.returncode == 0, result.stderr
    assert "recibo b2 verificado" in result.stdout.lower()


def test_b2_receipt_must_be_fresh_and_match_the_dump(tmp_path):
    dump = make_dump(tmp_path, age_hours=3.5)
    receipt = write_receipt(dump, age_hours=27)

    stale = run_script(
        "--max-age-hours", "26", env={"BACKUP_DIR": str(tmp_path), **b2_enabled_env(tmp_path)}
    )

    assert stale.returncode != 0
    assert "recibo" in stale.stdout.lower()

    write_receipt(dump, sha256="otro-hash")
    mismatched = run_script(
        "--max-age-hours", "26", env={"BACKUP_DIR": str(tmp_path), **b2_enabled_env(tmp_path)}
    )

    assert mismatched.returncode != 0
    assert "recibo" in mismatched.stdout.lower()
    assert receipt.exists()


def test_rejects_non_numeric_threshold(tmp_path):
    make_dump(tmp_path)

    result = run_script(
        "--max-age-hours", "veintiséis", env={"BACKUP_DIR": str(tmp_path)}
    )

    assert result.returncode == 2
    assert "umbral" in result.stderr.lower()


def test_rejects_unknown_arguments(tmp_path):
    make_dump(tmp_path)

    result = run_script("--frescura", env={"BACKUP_DIR": str(tmp_path)})

    assert result.returncode == 2
    assert "uso:" in result.stderr


def test_stale_dump_alerts_with_exit_2(tmp_path):
    make_dump(tmp_path, age_hours=30)

    result = run_script("--max-age-hours", "26", env={"BACKUP_DIR": str(tmp_path)})

    assert result.returncode == 2
    assert "ALERTA" in result.stdout


def test_missing_dump_alerts_with_exit_1(tmp_path):
    result = run_script(env={"BACKUP_DIR": str(tmp_path)})

    assert result.returncode == 1
    assert "ALERTA" in result.stdout


def test_first_provision_tolerates_a_missing_dump(tmp_path):
    """deploy.sh exports BACKUP_TOLERATE_MISSING=1 on the very first provision,
    where no backup can exist because the database has never started."""
    result = run_script(
        env={"BACKUP_DIR": str(tmp_path), "BACKUP_TOLERATE_MISSING": "1"}
    )

    assert result.returncode == 0, result.stderr
    assert "AVISO" in result.stdout


def test_tolerance_never_silences_a_stale_dump(tmp_path):
    make_dump(tmp_path, age_hours=30)

    result = run_script(
        "--max-age-hours",
        "26",
        env={"BACKUP_DIR": str(tmp_path), "BACKUP_TOLERATE_MISSING": "1"},
    )

    assert result.returncode == 2
    assert "ALERTA" in result.stdout


def test_rejects_invalid_tolerance_values(tmp_path):
    make_dump(tmp_path)

    result = run_script(
        env={"BACKUP_DIR": str(tmp_path), "BACKUP_TOLERATE_MISSING": "sí"}
    )

    assert result.returncode == 2
    assert "BACKUP_TOLERATE_MISSING" in result.stderr
