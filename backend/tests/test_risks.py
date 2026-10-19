"""Risk register: scoring, lifecycle, evidence, filters, exports and authorisation."""

from __future__ import annotations


def test_create_risk_computes_score_and_severity(client, analyst):
    response = client.post(
        "/api/risks",
        headers=analyst.headers(),
        json={
            "title": "Unpatched internet-facing application server",
            "category": "cybersecurity",
            "likelihood": 4,
            "impact": 5,
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["inherent_score"] == 20
    assert body["severity"] == "critical"
    assert body["risk_ref"]
    # The initial assessment is recorded with the risk.
    detail = client.get(f"/api/risks/{body['id']}", headers=analyst.headers()).json()
    assert len(detail["assessments"]) == 1


def test_viewers_cannot_write_risks(client, viewer):
    response = client.post(
        "/api/risks",
        headers=viewer.headers(),
        json={"title": "Should be refused", "category": "financial", "likelihood": 2, "impact": 2},
    )

    assert response.status_code == 403


def test_delete_requires_the_manager_role(client, analyst, risk_manager, make_risk):
    risk = make_risk(analyst)

    refused = client.delete(f"/api/risks/{risk['id']}", headers=analyst.headers())
    assert refused.status_code == 403

    allowed = client.delete(f"/api/risks/{risk['id']}", headers=risk_manager.headers())
    assert allowed.status_code == 200


def test_status_change_records_an_assessment_snapshot(client, analyst, make_risk):
    risk = make_risk(analyst)

    response = client.post(
        f"/api/risks/{risk['id']}/status",
        headers=analyst.headers(),
        json={"status": "in_progress", "note": "Delivery started"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "in_progress"

    detail = client.get(f"/api/risks/{risk['id']}", headers=analyst.headers()).json()
    # One from creation, one from the lifecycle change.
    assert len(detail["assessments"]) >= 2


def test_residual_pair_is_required_together(client, analyst):
    response = client.post(
        "/api/risks",
        headers=analyst.headers(),
        json={
            "title": "Half a residual",
            "category": "operational",
            "likelihood": 3,
            "impact": 3,
            "residual_likelihood": 2,
        },
    )

    assert response.status_code == 422


def test_evidence_upgrades_the_evidence_quality(client, analyst, make_risk):
    risk = make_risk(analyst)

    response = client.post(
        f"/api/risks/{risk['id']}/evidence",
        headers=analyst.headers(),
        json={"title": "Independent penetration test report", "quality": "verified"},
    )

    assert response.status_code == 201
    detail = client.get(f"/api/risks/{risk['id']}", headers=analyst.headers()).json()
    assert detail["evidence_quality"] == "verified"
    assert len(detail["evidence"]) == 1


def test_severity_filter_selects_the_matching_band(client, analyst, make_risk):
    make_risk(analyst, title="Very likely and very damaging", likelihood=5, impact=5)
    make_risk(analyst, title="Unlikely and minor", likelihood=1, impact=1)

    critical = client.get(
        "/api/risks", headers=analyst.headers(), params={"severity": "critical"}
    ).json()
    low = client.get("/api/risks", headers=analyst.headers(), params={"severity": "low"}).json()

    assert critical["total"] == 1
    assert low["total"] == 1


def test_search_matches_the_title(client, analyst, make_risk):
    make_risk(analyst, title="Ransomware encryption of the finance share")

    found = client.get(
        "/api/risks", headers=analyst.headers(), params={"q": "ransomware"}
    ).json()
    missing = client.get(
        "/api/risks", headers=analyst.headers(), params={"q": "nothing-like-this"}
    ).json()

    assert found["total"] == 1
    assert missing["total"] == 0


def test_meta_and_options_describe_the_vocabulary(client, analyst, make_risk):
    risk = make_risk(analyst)

    meta = client.get("/api/risks/meta", headers=analyst.headers()).json()
    assert "cybersecurity" in meta["categories"]
    assert "identified" in meta["statuses"]

    options = client.get("/api/risks/options", headers=analyst.headers()).json()
    assert any(item["id"] == risk["id"] for item in options)


def test_export_returns_csv(client, analyst, make_risk):
    make_risk(analyst)

    response = client.get("/api/risks/export", headers=analyst.headers())

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "Risk reference" in response.text
