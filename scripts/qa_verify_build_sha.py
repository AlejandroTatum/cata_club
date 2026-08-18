"""
Guard for `make qa-up` (issue #350): checks the SHA served by the QA
frontend's `/api/health` against `origin/main` so a QA screenshot can't
silently be evidence for stale code.

Stdlib-only Python 3 — runs with plain `python3`, no third-party deps and no
backend venv required. Invoked from the Makefile as:

    python3 scripts/qa_verify_build_sha.py --served-url http://localhost:3000/api/health

Exit code 0 means the served SHA matches (or is verifiably not behind)
origin/main; exit code 1 means it's stale or unverifiable.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.request
from collections.abc import Callable
from urllib.error import URLError


def fetch_served_sha(url: str) -> str:
    """GET `url` and return the `sha` field of its JSON body.

    Raises RuntimeError with a message naming the URL/field on any failure —
    a bad response or a missing field must be loud, never a silent pass."""
    try:
        with urllib.request.urlopen(url, timeout=10) as response:  # noqa: S310
            payload = response.read()
    except (URLError, OSError, TimeoutError) as exc:
        raise RuntimeError(f"no se pudo consultar {url}: {exc}") from exc

    try:
        data = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"{url} no devolvió JSON válido: {exc}") from exc

    sha = data.get("sha") if isinstance(data, dict) else None
    if not sha:
        raise RuntimeError(f"{url} no incluye el campo 'sha' en la respuesta: {data!r}")
    return sha


def fetch_origin_main_sha(do_fetch: bool = True) -> str:
    """Return the current SHA of `origin/main`, fetching it first by default."""
    if do_fetch:
        subprocess.run(["git", "fetch", "origin", "main", "--quiet"], check=True)
    resultado = subprocess.run(
        ["git", "rev-parse", "origin/main"],
        check=True,
        capture_output=True,
        text=True,
    )
    return resultado.stdout.strip()


def is_ancestor(candidate_sha: str, ref: str) -> bool:
    """True if `candidate_sha` is an ancestor of `ref` (i.e. behind it)."""
    resultado = subprocess.run(
        ["git", "merge-base", "--is-ancestor", candidate_sha, ref],
    )
    if resultado.returncode == 0:
        return True
    if resultado.returncode == 1:
        return False
    raise RuntimeError(
        f"'git merge-base --is-ancestor {candidate_sha} {ref}' terminó con "
        f"código {resultado.returncode}, no 0 ni 1"
    )


def evaluate(
    served_sha: str,
    origin_sha: str,
    is_ancestor_fn: Callable[[str, str], bool] | None = None,
) -> tuple[str, int]:
    """Pure decision: compare `served_sha` against `origin_sha`.

    `is_ancestor_fn` defaults to the module-level `is_ancestor` (looked up at
    call time, so tests can either inject a callable here or monkeypatch
    `qa_verify_build_sha.is_ancestor` directly)."""
    if served_sha == origin_sha:
        return (f"QA sirve {served_sha}, igual a origin/main.", 0)

    verificar_ancestro = is_ancestor_fn if is_ancestor_fn is not None else is_ancestor
    if verificar_ancestro(served_sha, origin_sha):
        return (
            f"QA sirve {served_sha}, que está detrás de origin/main "
            f"({origin_sha}). Reconstruí con `make qa-up`.",
            1,
        )

    return (
        f"QA sirve {served_sha}, que no se puede verificar contra origin/main "
        f"({origin_sha}).",
        1,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Verifica que el SHA servido por el frontend de QA coincida con "
            "origin/main (issue #350)."
        )
    )
    parser.add_argument(
        "--served-url",
        default="http://localhost:3000/api/health",
        help="URL del healthcheck del frontend de QA (default: %(default)s)",
    )
    args = parser.parse_args(argv)

    try:
        served_sha = fetch_served_sha(args.served_url)
        origin_sha = fetch_origin_main_sha()
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    message, code = evaluate(served_sha, origin_sha)
    print(message, file=sys.stderr if code else sys.stdout)
    return code


if __name__ == "__main__":
    sys.exit(main())
