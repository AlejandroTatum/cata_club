"""Guardias de retención y privacidad del aviso administrativo (#1401)."""
from datetime import datetime, timedelta, timezone

from app.dominio.enums import TipoNotificacion, TipoRol
from app.dominio.modelos import Notificacion, ReporteError, Rol, Usuario
from app.infraestructura.tareas.celery_app import celery_app


def test_purga_programada_diariamente():
    schedule = celery_app.conf.beat_schedule["purgar-reportes-error-diario"]
    assert schedule["task"] == "app.infraestructura.tareas.reporte_error_tareas.purgar_reportes_error"


def test_aviso_admin_no_incluye_descripcion_ni_captura(client, db_session, persona_sin_usuario):
    admin = Usuario(correo="admin-reporte@club.test", contrasenia="hash", persona_id=persona_sin_usuario.id,
                    roles=[Rol(tipo_rol=TipoRol.ADMINISTRADOR, descripcion="Administrador")])
    db_session.add(admin)
    db_session.flush()
    response = client.post("/api/v1/reportes-error/", data={"descripcion": "Dato muy privado", "consentimiento_captura": "true"},
                           files={"captura": ("a.png", b"\x89PNG\r\n\x1a\nprivate", "image/png")})
    assert response.status_code == 201, response.text
    aviso = db_session.query(Notificacion).filter_by(tipo=TipoNotificacion.NUEVO_REPORTE_ERROR).one()
    assert str(response.json()["id"]) in aviso.mensaje
    assert "Dato muy privado" not in aviso.mensaje
    assert "private" not in aviso.mensaje


def test_purga_real_borra_solo_reportes_expirados(db_session, persona_sin_usuario, monkeypatch):
    from app.infraestructura.tareas import reporte_error_tareas
    from app.infraestructura.repositorios.reporte_error_repositorio import ReporteErrorRepositorio

    class SessionContext:
        def __enter__(self):
            return db_session
        def __exit__(self, *_):
            return False

    monkeypatch.setattr(reporte_error_tareas, "SessionLocal", lambda: SessionContext())
    repo = ReporteErrorRepositorio(db_session)
    repo.crear(ReporteError(persona_id=persona_sin_usuario.id, descripcion="viejo", captura=b"secret",
                            fecha_creacion=datetime.now(timezone.utc) - timedelta(days=91)))
    repo.crear(ReporteError(persona_id=persona_sin_usuario.id, descripcion="nuevo", captura=b"secret"))
    assert reporte_error_tareas.purgar_reportes_error() == 1
    assert [r.descripcion for r in repo.listar(0, 10)] == ["nuevo"]
