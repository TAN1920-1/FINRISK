"""Tenant isolation: a session can never reach another organization's data."""

from __future__ import annotations

from app.domain import Role


def test_foreign_organization_header_is_forbidden(
    client, organization, other_organization, analyst
):
    response = client.get("/api/risks", headers=analyst.headers(other_organization))

    assert response.status_code == 403
    assert response.json()["detail"] == "You do not have access to this organization."


def test_the_header_cannot_widen_access_even_for_superusers(
    client, organization, other_organization, make_actor
):
    outsider = make_actor(
        Role.ADMIN, organization_id=other_organization, is_superuser=True
    )

    response = client.get("/api/risks", headers=outsider.headers(organization))

    assert response.status_code == 403


def test_risks_are_isolated_between_organizations(
    client, organization, other_organization, make_actor, make_risk
):
    owner = make_actor(Role.ANALYST, organization_id=organization)
    stranger = make_actor(Role.ANALYST, organization_id=other_organization)

    make_risk(owner)

    assert client.get("/api/risks", headers=owner.headers()).json()["total"] == 1
    assert client.get("/api/risks", headers=stranger.headers()).json()["total"] == 0


def test_a_foreign_risk_is_reported_as_not_found(
    client, organization, other_organization, make_actor, make_risk
):
    owner = make_actor(Role.ANALYST, organization_id=organization)
    stranger = make_actor(Role.ANALYST, organization_id=other_organization)
    risk = make_risk(owner)

    # 404 rather than 403: the existence of another tenant's record is not
    # disclosed to a caller who has no access to it.
    response = client.get(f"/api/risks/{risk['id']}", headers=stranger.headers())

    assert response.status_code == 404


def test_organizations_are_listed_from_the_users_memberships(client, analyst):
    response = client.get("/api/auth/me", headers=analyst.headers())

    assert response.status_code == 200
    organizations = response.json()["organizations"]
    assert any(item["id"] == analyst.organization_id for item in organizations)
