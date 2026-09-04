"""Verify that QA password recovery is delivered to the local Mailpit catcher.

This smoke deliberately has no configurable URLs: it may only call the QA stack
bound to loopback, never an operator's SMTP provider or another HTTP host.

`--paso` splits the smoke in two because QA does not run `celery-beat` (see
`QA_SERVICIOS` in the Makefile and `test_qa_up_incluye_worker_y_excluye_beat`).
Since issue #14-A moved recovery behind a durable outbox, the request only
inserts a `PENDIENTE` row and the dispatch is 100% beat-driven, so this smoke
could no longer pass in QA on its own: it was written (#530) when the request
published the Celery task itself. Rather than run beat in QA just for this,
`make qa-up` requests delivery, publishes `despachar_recuperaciones_pendientes`
exactly as beat would, and then waits. The seam under test is unchanged --
outbox row -> worker -> SMTP -> Mailpit -- and the beat dependency stops being
invisible (issue #764).
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping
from pathlib import Path


def _cargar_asunto_recuperacion() -> str:
    """Carga `ASUNTO_RECUPERACION` por ruta de archivo, sin importar `app`.

    Este script corre con `python3` puro desde la raíz del repo (ver
    `Makefile`), sin el venv de `backend`, así que no puede hacer
    `from app.infraestructura.asuntos_correo import ...` como sí puede el
    test que lo acompaña. El asunto vivía duplicado como literal acá y en
    el backend -- el PR #984 cambió uno y no el otro, y este script quedó
    30 segundos acusando al worker por un correo que sí había llegado
    (issue #1010).
    """
    ruta = Path(__file__).resolve().parent.parent / "backend/app/infraestructura/asuntos_correo.py"
    if not ruta.is_file():
        raise RuntimeError(f"no se encontró el módulo de asuntos de correo en {ruta}")
    spec = importlib.util.spec_from_file_location("asuntos_correo", ruta)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"no se pudo cargar el módulo de asuntos de correo desde {ruta}")
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo.ASUNTO_RECUPERACION


QA_RECIPIENT = "admin@cataclub.com"
RECOVERY_SUBJECT = _cargar_asunto_recuperacion()
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


def _asuntos_recibidos_por_destinatario(messages: list) -> list[str]:
    """Asuntos (deduplicados, hasta 10) que Mailpit sí tenía para `QA_RECIPIENT`.

    Si el timeout se agota con esta lista vacía, el correo nunca llegó y el
    problema está en el worker o en SMTP, como decía siempre el error. Si la
    lista no está vacía, el correo llegó con OTRO asunto -- el caso del
    #1010 -- y el error tiene que señalar eso, no el worker.
    """
    vistos: list[str] = []
    for message in messages:
        if not isinstance(message, dict):
            continue
        recipients = message.get("To")
        para_destinatario = isinstance(recipients, list) and any(
            isinstance(recipient, dict) and recipient.get("Address") == QA_RECIPIENT
            for recipient in recipients
        )
        if not para_destinatario:
            continue
        asunto = message.get("Subject")
        if isinstance(asunto, str) and asunto not in vistos:
            vistos.append(asunto)
        if len(vistos) >= 10:
            break
    return vistos


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
            asuntos_vistos = _asuntos_recibidos_por_destinatario(messages)
            detalle_asuntos = (
                f"; asuntos que sí vio Mailpit para {QA_RECIPIENT}: {asuntos_vistos}"
                if asuntos_vistos
                else ""
            )
            raise RuntimeError(
                f"Mailpit no recibió el correo de recuperación para {QA_RECIPIENT} "
                f"en {timeout_seconds} segundos; verificá celery-worker y SMTP_HOST=mailpit"
                f"{detalle_asuntos}"
            )
        sleep(poll_interval_seconds)


PASOS = ("completo", "solicitar", "esperar")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Verifica recuperación de contraseña contra el Mailpit local de QA."
    )
    parser.add_argument(
        "--paso",
        choices=PASOS,
        default="completo",
        help=(
            "'solicitar' pide el enlace y termina; 'esperar' solo espera a "
            "Mailpit. Entre los dos hay que despachar el outbox, que en QA no "
            "hace nadie porque no corre celery-beat. 'completo' (default) hace "
            "los dos y solo sirve donde beat sí tickea."
        ),
    )
    args = parser.parse_args(argv)
    try:
        if args.paso in ("completo", "solicitar"):
            request_recovery()
        if args.paso in ("completo", "esperar"):
            wait_for_recovery_message(fetch_messages)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    if args.paso == "solicitar":
        print(f"Recuperación solicitada para {QA_RECIPIENT}; falta despachar el outbox.")
    else:
        print(f"Mailpit recibió el correo de recuperación para {QA_RECIPIENT}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
