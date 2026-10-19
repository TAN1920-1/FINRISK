"""Preserved TILT module: templates, vendor assessments, scoring and OSINT.

``OSINT_LIVE_CHECKS`` is false for the whole suite, so the scan is exercised in
its documented offline mode: no network or DNS call is made.
"""

from __future__ import annotations

from app.domain import Role

STANDARD_VENDOR = {"vendor_name": "Acme Cloud Vendor", "assessment_type": "standard"}


def test_questionnaire_templates_are_seeded_for_both_kinds(client, analyst):
    standard = client.get("/api/tilt/templates/standard", headers=analyst.headers())
    cloud = client.get("/api/tilt/templates/cloud", headers=analyst.headers())

    assert standard.status_code == 200
    assert cloud.status_code == 200
    assert len(standard.json()) > 0
    assert len(cloud.json()) > 0


def test_manager_only_may_add_a_template(client, analyst, risk_manager):
    payload = {"position": 9999, "text": "Is the service monitored 24/7?", "weight": "High"}

    refused = client.post(
        "/api/tilt/templates/standard", headers=analyst.headers(), json=payload
    )
    assert refused.status_code == 403

    created = client.post(
        "/api/tilt/templates/standard", headers=risk_manager.headers(), json=payload
    )
    assert created.status_code == 201

    duplicate = client.post(
        "/api/tilt/templates/standard", headers=risk_manager.headers(), json=payload
    )
    assert duplicate.status_code == 409


def test_only_writers_may_create_a_vendor(client, viewer, analyst, risk_manager):
    refused = client.post("/api/tilt/vendors", headers=viewer.headers(), json=STANDARD_VENDOR)
    assert refused.status_code == 403

    created = client.post("/api/tilt/vendors", headers=analyst.headers(), json=STANDARD_VENDOR)
    assert created.status_code == 201
    vendor_id = created.json()["id"]

    # Deletion is a manager action.
    assert (
        client.delete(f"/api/tilt/vendors/{vendor_id}", headers=analyst.headers()).status_code
        == 403
    )
    assert (
        client.delete(
            f"/api/tilt/vendors/{vendor_id}", headers=risk_manager.headers()
        ).status_code
        == 200
    )


def test_vendors_are_tenant_scoped(client, organization, other_organization, make_actor):
    owner = make_actor(Role.ANALYST, organization_id=organization)
    stranger = make_actor(Role.ANALYST, organization_id=other_organization)

    vendor_id = client.post(
        "/api/tilt/vendors", headers=owner.headers(), json=STANDARD_VENDOR
    ).json()["id"]

    assert client.get(f"/api/tilt/vendors/{vendor_id}", headers=stranger.headers()).status_code == 404
    assert client.get("/api/tilt/vendors", headers=stranger.headers()).json()["total"] == 0


def test_standard_assessment_with_no_answers_is_fully_vulnerable(client, analyst):
    vendor_id = client.post(
        "/api/tilt/vendors",
        headers=analyst.headers(),
        json={"vendor_name": "Unassessed Vendor", "assessment_type": "standard", "answers": {}},
    ).json()["id"]

    response = client.post(
        f"/api/tilt/vendors/{vendor_id}/calculate", headers=analyst.headers()
    )

    assert response.status_code == 200
    body = response.json()
    assert body["score"] == 0
    assert body["max_score"] == 100
    assert body["verdict"] == "REJECT (Critical Risk)"


def test_standard_assessment_scored_all_fives_earns_standard_approval(client, analyst):
    templates = client.get("/api/tilt/templates/standard", headers=analyst.headers()).json()
    answers = {str(item["id"]): 5 for item in templates}

    vendor_id = client.post(
        "/api/tilt/vendors",
        headers=analyst.headers(),
        json={
            "vendor_name": "Mature Vendor",
            "assessment_type": "standard",
            "answers": answers,
        },
    ).json()["id"]

    body = client.post(
        f"/api/tilt/vendors/{vendor_id}/calculate", headers=analyst.headers()
    ).json()

    # Every answer at full maturity -> 20% residual vulnerability -> 80/100.
    assert body["score"] == 80
    assert body["max_score"] == 100
    assert body["verdict"] == "Standard Approval"


def test_cloud_assessment_missing_a_critical_criterion_is_rejected(client, analyst):
    vendor_id = client.post(
        "/api/tilt/vendors",
        headers=analyst.headers(),
        json={"vendor_name": "Cloud Provider", "assessment_type": "cloud", "cloud_scores": {}},
    ).json()["id"]

    body = client.post(
        f"/api/tilt/vendors/{vendor_id}/calculate", headers=analyst.headers()
    ).json()

    assert body["max_score"] == 55
    assert body["score"] == 0
    assert body["verdict"] == "REJECT (Critical Risk)"


def test_osint_scan_is_offline_and_acknowledgeable(client, analyst):
    vendor_id = client.post(
        "/api/tilt/vendors",
        headers=analyst.headers(),
        json={
            "vendor_name": "Scan Target",
            "primary_domain": "scan-target.example",
            "assessment_type": "standard",
        },
    ).json()["id"]

    scanned = client.post(
        f"/api/tilt/vendors/{vendor_id}/osint-scan", headers=analyst.headers()
    )

    assert scanned.status_code == 200
    body = scanned.json()
    assert body["live_checks_enabled"] is False
    assert body["warnings"] == []
    assert any("disabled" in note.lower() for note in body["notes"])
    assert body["vendor"]["last_scanned_at"] is not None

    acknowledged = client.post(
        f"/api/tilt/vendors/{vendor_id}/acknowledge", headers=analyst.headers()
    )
    assert acknowledged.status_code == 200
    assert acknowledged.json()["osint_acknowledged"] is True
