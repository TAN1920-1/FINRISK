"""Audit trail: administrator-only access and the entries written by other calls."""

from __future__ import annotations


def test_audit_trail_is_administrator_only(client, admin, analyst, make_risk):
    make_risk(admin)

    refused = client.get("/api/audit-logs", headers=analyst.headers())
    assert refused.status_code == 403

    allowed = client.get("/api/audit-logs", headers=admin.headers())
    assert allowed.status_code == 200


def test_creating_a_risk_writes_an_audit_entry(client, admin, make_risk):
    make_risk(admin)

    body = client.get("/api/audit-logs", headers=admin.headers()).json()

    assert body["total"] >= 1
    actions = {item["action"] for item in body["items"]}
    assert "risk.created" in actions


def test_audit_meta_lists_the_action_vocabulary(client, admin):
    response = client.get("/api/audit-logs/meta", headers=admin.headers())

    assert response.status_code == 200
    assert "risk.created" in response.json()["actions"]


def test_audit_trail_can_be_filtered_by_action(client, admin, make_risk):
    make_risk(admin)
    make_risk(admin, title="A second risk to log")

    response = client.get(
        "/api/audit-logs", headers=admin.headers(), params={"action": "risk.created"}
    )

    assert response.status_code == 200
    assert response.json()["total"] == 2
    assert {item["action"] for item in response.json()["items"]} == {"risk.created"}


def test_audit_trail_exports_as_csv(client, admin, make_risk):
    make_risk(admin)

    response = client.get("/api/audit-logs/export", headers=admin.headers())

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "risk.created" in response.text
