"""Tests for the local-only QA password-recovery delivery smoke."""

import sys
from pathlib import Path
from unittest.mock import patch

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "scripts"))

import qa_verify_recovery_delivery as smoke  # noqa: E402


def test_es_correo_de_recuperacion_si_coinciden_destinatario_y_asunto():
    assert smoke.is_recovery_message(
        {
            "To": [{"Address": smoke.QA_RECIPIENT}],
            "Subject": "Recuperación de contraseña - Cata Club",
        }
    )


def test_no_confunde_otro_correo_del_mismo_destinatario_con_recuperacion():
    assert not smoke.is_recovery_message(
        {"To": [{"Address": smoke.QA_RECIPIENT}], "Subject": "Comprobante de pago"}
    )


def test_wait_for_recovery_message_reintenta_hasta_que_mailpit_recibe_el_correo():
    responses = iter(
        [
            {"messages": []},
            {
                "messages": [
                    {
                        "To": [{"Address": smoke.QA_RECIPIENT}],
                        "Subject": "Recuperación de contraseña - Cata Club",
                    }
                ]
            },
        ]
    )
    sleeps = []

    message = smoke.wait_for_recovery_message(
        fetch_messages=lambda: next(responses),
        sleep=sleeps.append,
        timeout_seconds=5,
        poll_interval_seconds=1,
    )

    assert message["Subject"] == "Recuperación de contraseña - Cata Club"
    assert sleeps == [1]


def test_wait_for_recovery_message_falla_si_el_worker_no_entrega_el_correo():
    with patch.object(smoke, "time") as mock_time:
        mock_time.monotonic.side_effect = [0, 0, 5]
        try:
            smoke.wait_for_recovery_message(
                fetch_messages=lambda: {"messages": []},
                sleep=lambda _: None,
                timeout_seconds=5,
                poll_interval_seconds=1,
            )
        except RuntimeError as exc:
            assert smoke.QA_RECIPIENT in str(exc)
        else:
            raise AssertionError("se esperaba RuntimeError cuando Mailpit no recibe el correo")


def test_main_dispara_la_recuperacion_y_solo_consulta_las_urls_locales():
    with (
        patch.object(smoke, "request_recovery") as request_recovery,
        patch.object(smoke, "wait_for_recovery_message", return_value={"Subject": "ok"}),
    ):
        assert smoke.main([]) == 0

    request_recovery.assert_called_once_with()
