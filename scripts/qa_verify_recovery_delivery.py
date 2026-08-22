"""Verify that QA password recovery is delivered to the local Mailpit catcher.

This smoke deliberately has no configurable URLs: it may only call the QA stack
bound to loopback, never an operator's SMTP provider or another HTTP host.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping

QA_RECIPIENT = "admin@cataclub.com"
RECOVERY_SUBJECT = "Recuperación de contraseña - Cata Club"
RECOVERY_URL = "http://127.0.0.1:8000/api/v1/auth/recuperar-contrasenia"
MAILPIT_MESSAGES_URL = "http://127.0.0.1:8025/api/v1/messages"
POLL_INTERVAL_SECONDS = 1
TIMEOUT_SECONDS = 30


def _read_json(request: urllib.request.Request | str) -> object:
    try:
        with urllib.request.urlopen(request, timeout=10) as response:  # noqa: S310
            return json.loads(response.read())
    except (OSError, urllib.error.URLError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"falló la consulta local de QA: {exc}") from exc


def request_recovery() -> None:
    """Request recovery for the seeded QA admin through the local backend only."""
    request = urllib.request.Request(
        RECOVERY_URL,
        data=json.dumps({"correo": QA_RECIPIENT}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    _read_json(request)


def fetch_messages() -> Mapping[str, object]:
    payload = _read_json(MAILPIT_MESSAGES_URL)
    if not isinstance(payload, dict) or not isinstance(payload.get("messages"), list):
        raise RuntimeError("Mailpit local no devolvió una lista de mensajes")
    return payload


def is_recovery_message(message: object) -> bool:
    if not isinstance(message, dict) or message.get("Subject") != RECOVERY_SUBJECT:
        return False
    recipients = message.get("To")
    return isinstance(recipients, list) and any(
        isinstance(recipient, dict) and recipient.get("Address") == QA_RECIPIENT
        for recipient in recipients
    )


def wait_for_recovery_message(
    fetch_messages: Callable[[], Mapping[str, object]],
    sleep: Callable[[float], None] = time.sleep,
    *,
    timeout_seconds: float = TIMEOUT_SECONDS,
    poll_interval_seconds: float = POLL_INTERVAL_SECONDS,
) -> Mapping[str, object]:
    """Poll local Mailpit until Celery delivers the requested recovery email."""
    started_at = time.monotonic()
    while True:
        messages = fetch_messages().get("messages", [])
        for message in messages:
            if is_recovery_message(message):
                return message
        if time.monotonic() - started_at >= timeout_seconds:
            raise RuntimeError(
                f"Mailpit no recibió el correo de recuperación para {QA_RECIPIENT} "
                f"en {timeout_seconds} segundos; verificá celery-worker y SMTP_HOST=mailpit"
            )
        sleep(poll_interval_seconds)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Verifica recuperación de contraseña contra el Mailpit local de QA."
    )
    parser.parse_args(argv)
    try:
        request_recovery()
        wait_for_recovery_message(fetch_messages)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(f"Mailpit recibió el correo de recuperación para {QA_RECIPIENT}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
