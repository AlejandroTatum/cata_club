"""Regression tests for the retired admin account-creation endpoint."""

import pytest


@pytest.mark.parametrize("client_fixture", ["client", "client_sin_permisos", "client_sin_token"])
def test_admin_account_creation_endpoint_is_unavailable(request, client_fixture):
    """Removing the route must win before authentication or payload handling."""
    client = request.getfixturevalue(client_fixture)

    response = client.post("/api/v1/personas/admin/cuentas", json={})

    assert response.status_code == 404
