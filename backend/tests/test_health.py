"""System endpoints: liveness and the service card."""

from __future__ import annotations


def test_health_reports_ok_and_applied_migrations(client):
    response = client.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["version"]
    # ``reset_database`` runs every migration before the app is exercised, so a
    # healthy process must report the schema revisions it believes are applied.
    assert "0001_initial_schema" in body["migrations"]
    assert "0002_questionnaire_templates" in body["migrations"]


def test_root_returns_service_card(client):
    response = client.get("/")

    assert response.status_code == 200
    body = response.json()
    assert body["health"] == "/api/health"
    assert body["docs"] == "/docs"


def test_request_id_header_is_echoed(client):
    response = client.get("/api/health", headers={"X-Request-Id": "test-request-id"})

    assert response.headers["X-Request-Id"] == "test-request-id"


def test_validation_failure_uses_the_shared_error_envelope(client):
    # A malformed email must be refused with field-level detail, and the raw
    # input is never echoed back.
    response = client.post(
        "/api/auth/login",
        json={"email": "not-an-email", "password": "x"},
    )

    assert response.status_code == 422
    body = response.json()
    assert body["detail"] == "The request could not be validated."
    assert isinstance(body["errors"], list) and body["errors"]
