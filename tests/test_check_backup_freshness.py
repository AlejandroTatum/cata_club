"""Focused contracts for the backup freshness alarm (check-backup-freshness.sh)."""

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
        env={**os.environ, **(env or {})},
        capture_output=True,
        text=True,
    )


def make_dump(backup_dir: Path, age_hours: float = 0) -> Path:
    dump = backup_dir / "cataclub_2026-08-21.dump"
    dump.write_text("dump")
    if age_hours:
        old = time.time() - age_hours * 3600
        os.utime(dump, (old, old))
    return dump


def test_documented_invocation_accepts_max_age_hours_flag(tmp_path):
    make_dump(tmp_path)

    result = run_script("--max-age-hours", "26", env={"BACKUP_DIR": str(tmp_path)})

    assert result.returncode == 0, result.stderr
    assert "dump más reciente" in result.stdout


def test_defaults_to_26_hours_without_arguments(tmp_path):
    make_dump(tmp_path, age_hours=25)

    result = run_script(env={"BACKUP_DIR": str(tmp_path)})

    assert result.returncode == 0, result.stderr


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
