"""Financial loss engine, scenario lifecycle and the dashboard's empty state."""

from __future__ import annotations

from decimal import Decimal


def test_preview_computes_the_documented_losses(client, analyst):
    response = client.post(
        "/api/financial-scenarios/preview",
        headers=analyst.headers(),
        json={
            "currency": "USD",
            "time_horizon_months": 12,
            "probability": 0.5,
            "direct_loss": "1000.00",
            "downtime_hours": 10,
            "downtime_cost_per_hour": "100.00",
            "insurance_recovery": "200.00",
        },
    )

    assert response.status_code == 200
    breakdown = response.json()["breakdown"]
    # gross = direct 1000 + interruption (10 h x 100) = 2000
    assert Decimal(breakdown["gross_loss"]) == Decimal("2000.00")
    # recoveries are subtracted; they never push the loss below zero
    assert Decimal(breakdown["net_loss"]) == Decimal("1800.00")
    # expected = probability x net loss
    assert Decimal(breakdown["expected_loss"]) == Decimal("900.00")


def test_preview_states_when_no_residual_probability_is_given(client, analyst):
    response = client.post(
        "/api/financial-scenarios/preview",
        headers=analyst.headers(),
        json={"probability": 0.25, "direct_loss": "4000.00"},
    )

    breakdown = response.json()["breakdown"]
    assert breakdown["residual_probability"] is None
    # Without a post-mitigation probability the residual equals the current
    # expected loss; the API says so rather than implying mitigation worked.
    assert Decimal(breakdown["expected_residual_loss"]) == Decimal(breakdown["expected_loss"])
    assert any("post-mitigation" in note.lower() for note in breakdown["notes"])


def test_insurance_recovery_is_capped_at_the_gross_loss(client, analyst):
    response = client.post(
        "/api/financial-scenarios/preview",
        headers=analyst.headers(),
        json={"probability": 1.0, "direct_loss": "500.00", "insurance_recovery": "9999.00"},
    )

    breakdown = response.json()["breakdown"]
    assert Decimal(breakdown["net_loss"]) == Decimal("0.00")
    assert any("capped" in note.lower() for note in breakdown["notes"])


def test_scenario_lifecycle_and_calculation(client, analyst, risk_manager, make_risk):
    risk = make_risk(analyst)

    created = client.post(
        "/api/financial-scenarios",
        headers=analyst.headers(),
        json={
            "name": "Ransomware base case",
            "scenario_type": "base_case",
            "risk_id": risk["id"],
            "currency": "USD",
            "probability": 0.2,
            "direct_loss": "10000.00",
        },
    )
    assert created.status_code == 201
    scenario_id = created.json()["id"]

    listed = client.get("/api/financial-scenarios", headers=analyst.headers()).json()
    assert listed["total"] == 1

    calculated = client.post(
        f"/api/financial-scenarios/{scenario_id}/calculate", headers=analyst.headers()
    )
    assert calculated.status_code == 200
    assert Decimal(calculated.json()["breakdown"]["expected_loss"]) == Decimal("2000.00")

    updated = client.patch(
        f"/api/financial-scenarios/{scenario_id}",
        headers=analyst.headers(),
        json={"probability": 0.5},
    )
    assert updated.status_code == 200

    # Deleting a scenario requires the manager role.
    assert (
        client.delete(
            f"/api/financial-scenarios/{scenario_id}", headers=analyst.headers()
        ).status_code
        == 403
    )
    assert (
        client.delete(
            f"/api/financial-scenarios/{scenario_id}", headers=risk_manager.headers()
        ).status_code
        == 200
    )


def test_scenario_cannot_link_to_another_organizations_risk(client, analyst):
    response = client.post(
        "/api/financial-scenarios",
        headers=analyst.headers(),
        json={"name": "Bad link", "risk_id": 999_999, "probability": 0.1},
    )

    assert response.status_code == 400


def test_compare_requires_at_least_one_identifier(client, analyst):
    response = client.get("/api/financial-scenarios/compare", headers=analyst.headers())

    assert response.status_code == 400


def test_compare_returns_the_requested_scenarios_in_order(client, analyst):
    first = client.post(
        "/api/financial-scenarios",
        headers=analyst.headers(),
        json={"name": "First", "probability": 0.1, "direct_loss": "100.00"},
    ).json()
    second = client.post(
        "/api/financial-scenarios",
        headers=analyst.headers(),
        json={"name": "Second", "probability": 0.1, "direct_loss": "200.00"},
    ).json()

    response = client.get(
        "/api/financial-scenarios/compare",
        headers=analyst.headers(),
        params=[("ids", second["id"]), ("ids", first["id"])],
    )

    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [second["id"], first["id"]]


def test_dashboard_reports_the_empty_state(client, analyst):
    response = client.get("/api/dashboard", headers=analyst.headers())

    assert response.status_code == 200
    body = response.json()
    assert body["data_state"] == "empty"
    assert body["generated_at"]
    assert any("No risk" in note for note in body["notes"])
