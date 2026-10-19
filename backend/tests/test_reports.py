"""Report catalog, preview, export and the recorded export history."""

from __future__ import annotations


def test_catalog_lists_the_available_reports(client, analyst):
    response = client.get("/api/reports/catalog", headers=analyst.headers())

    assert response.status_code == 200
    keys = {entry["key"] for entry in response.json()}
    assert "risk_register" in keys
    assert "executive_summary" in keys


def test_preview_returns_the_dataset_for_the_rows(client, analyst, make_risk):
    make_risk(analyst)

    response = client.post(
        "/api/reports/preview",
        headers=analyst.headers(),
        json={"report_type": "risk_register", "format": "json"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["report_type"] == "risk_register"
    assert body["columns"]
    assert body["row_count"] >= 1
    # The methodology is always part of the payload so the numbers are auditable.
    assert body["methodology"]
    assert body["currency"] == "USD"


def test_export_requires_the_write_role(client, viewer, analyst, make_risk):
    make_risk(analyst)

    refused = client.post(
        "/api/reports/export",
        headers=viewer.headers(),
        json={"report_type": "risk_register", "format": "csv"},
    )
    assert refused.status_code == 403

    allowed = client.post(
        "/api/reports/export",
        headers=analyst.headers(),
        json={"report_type": "risk_register", "format": "csv"},
    )
    assert allowed.status_code == 200
    assert allowed.headers["content-type"].startswith("text/csv")
    assert "X-Report-Rows" in allowed.headers


def test_export_rejects_the_json_format(client, analyst):
    response = client.post(
        "/api/reports/export",
        headers=analyst.headers(),
        json={"report_type": "risk_register", "format": "json"},
    )

    assert response.status_code == 400


def test_an_export_is_recorded_in_the_history(client, analyst):
    client.post(
        "/api/reports/export",
        headers=analyst.headers(),
        json={"report_type": "executive_summary", "format": "csv"},
    )

    history = client.get("/api/reports", headers=analyst.headers())

    assert history.status_code == 200
    assert history.json()["total"] >= 1
    assert history.json()["items"][0]["report_type"] == "executive_summary"


def test_an_inverted_date_range_is_a_bad_request(client, analyst):
    response = client.post(
        "/api/reports/preview",
        headers=analyst.headers(),
        json={
            "report_type": "executive_summary",
            "start_date": "2026-06-01",
            "end_date": "2026-01-01",
        },
    )

    assert response.status_code == 400
