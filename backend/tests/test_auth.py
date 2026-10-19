"""Registration, sign-in, sessions, memberships and the login rate limiter."""

from __future__ import annotations

import pytest

from app.security import login_limiter

STRONG_PASSWORD = "FounderPass123!"

REGISTER_PAYLOAD = {
    "email": "founder@example.com",
    "password": STRONG_PASSWORD,
    "full_name": "Founder Person",
    "organization_name": "Founder Org",
}


def _clear_login_limiter() -> None:
    login_limiter._events.clear()


def test_first_registration_bootstraps_an_admin(client):
    response = client.post("/api/auth/register", json=REGISTER_PAYLOAD)

    assert response.status_code == 201
    body = response.json()
    assert body["role"] == "admin"
    assert body["access_token"]
    assert body["active_organization_id"]
    assert body["user"]["email"] == "founder@example.com"


def test_registration_returns_the_permission_list(client):
    """Register must carry the capability list, not only ``/api/auth/me``.

    The frontend shell decides which actions to render from this payload. When
    it was omitted the shell fell back to an empty list, so every "New ..."
    control stayed hidden until the page was reloaded and ``/me`` was read.
    """
    response = client.post("/api/auth/register", json=REGISTER_PAYLOAD)

    assert response.status_code == 201
    permissions = response.json()["permissions"]
    assert "asset:write" in permissions
    assert "risk:write" in permissions
    assert "audit:read" in permissions


def test_registration_rejects_a_weak_password(client):
    payload = dict(REGISTER_PAYLOAD, email="weak@example.com", password="password")

    response = client.post("/api/auth/register", json=payload)

    assert response.status_code == 422


def test_registration_rejects_a_duplicate_email(client):
    assert client.post("/api/auth/register", json=REGISTER_PAYLOAD).status_code == 201

    duplicate = dict(REGISTER_PAYLOAD, organization_name="Another Org")
    response = client.post("/api/auth/register", json=duplicate)

    assert response.status_code == 409


def test_login_succeeds_with_the_correct_password(client, analyst):
    response = client.post(
        "/api/auth/login", json={"email": analyst.email, "password": analyst.password}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["role"] == "analyst"
    assert body["active_organization_id"] == analyst.organization_id


def test_login_returns_the_permission_list(client, admin):
    """Login must carry the capability list so write actions render at once."""
    response = client.post(
        "/api/auth/login", json={"email": admin.email, "password": admin.password}
    )

    assert response.status_code == 200
    permissions = response.json()["permissions"]
    assert "asset:write" in permissions
    assert "audit:read" in permissions


def test_switching_organization_returns_the_permission_list(client, admin):
    response = client.post(
        f"/api/auth/switch-organization/{admin.organization_id}", headers=admin.headers()
    )

    assert response.status_code == 200
    assert "asset:write" in response.json()["permissions"]


def test_login_rejects_a_wrong_password(client, analyst):
    response = client.post(
        "/api/auth/login", json={"email": analyst.email, "password": "WrongPassword123!"}
    )

    assert response.status_code == 401


def test_login_rejects_an_unknown_account(client):
    response = client.post(
        "/api/auth/login", json={"email": "ghost@example.com", "password": STRONG_PASSWORD}
    )

    assert response.status_code == 401


def test_login_is_rate_limited_after_repeated_failures(client, analyst):
    original_attempts = login_limiter.max_attempts
    login_limiter.max_attempts = 3
    _clear_login_limiter()
    try:
        for _ in range(3):
            attempt = client.post(
                "/api/auth/login",
                json={"email": analyst.email, "password": "WrongPassword123!"},
            )
            assert attempt.status_code == 401

        blocked = client.post(
            "/api/auth/login", json={"email": analyst.email, "password": "WrongPassword123!"}
        )
        assert blocked.status_code == 429
    finally:
        login_limiter.max_attempts = original_attempts
        _clear_login_limiter()


def test_me_reports_role_and_permissions(client, analyst):
    response = client.get("/api/auth/me", headers=analyst.headers())

    assert response.status_code == 200
    body = response.json()
    assert body["role"] == "analyst"
    assert "risk:write" in body["permissions"]
    # Only administrators may read the audit trail.
    assert "audit:read" not in body["permissions"]


def test_admin_has_the_audit_permission(client, admin):
    body = client.get("/api/auth/me", headers=admin.headers()).json()

    assert "audit:read" in body["permissions"]


def test_requests_without_a_token_are_rejected(client):
    assert client.get("/api/auth/me").status_code == 401


def test_password_change_invalidates_existing_tokens(client, analyst):
    assert client.get("/api/auth/me", headers=analyst.headers()).status_code == 200

    changed = client.post(
        "/api/auth/password",
        headers=analyst.headers(),
        json={"current_password": analyst.password, "new_password": "RotatedPass456!"},
    )
    assert changed.status_code == 200

    # token_version was bumped, so the token minted before the change is dead.
    assert client.get("/api/auth/me", headers=analyst.headers()).status_code == 401

    relogin = client.post(
        "/api/auth/login", json={"email": analyst.email, "password": "RotatedPass456!"}
    )
    assert relogin.status_code == 200


def test_password_change_requires_the_current_password(client, analyst):
    response = client.post(
        "/api/auth/password",
        headers=analyst.headers(),
        json={"current_password": "NotThePassword1!", "new_password": "RotatedPass456!"},
    )

    assert response.status_code == 400


def test_roles_endpoint_lists_the_vocabulary(client):
    response = client.get("/api/auth/roles")

    assert response.status_code == 200
    assert set(response.json()) == {"admin", "risk_manager", "analyst", "viewer"}


def test_list_members_returns_the_organization_members(client, admin, analyst):
    response = client.get("/api/auth/members", headers=admin.headers())

    assert response.status_code == 200
    emails = {member["email"] for member in response.json()}
    assert {admin.email, analyst.email} <= emails


def test_admin_can_add_a_member_and_that_member_can_sign_in(client, admin):
    response = client.post(
        "/api/auth/members",
        headers=admin.headers(),
        json={
            "email": "newcomer@acmerisk.com",
            "full_name": "New Comer",
            "password": STRONG_PASSWORD,
            "role": "analyst",
        },
    )

    assert response.status_code == 201
    assert response.json()["role"] == "analyst"

    login = client.post(
        "/api/auth/login", json={"email": "newcomer@acmerisk.com", "password": STRONG_PASSWORD}
    )
    assert login.status_code == 200
    assert login.json()["role"] == "analyst"


def test_adding_a_member_creates_a_notification_for_them(client, admin):
    client.post(
        "/api/auth/members",
        headers=admin.headers(),
        json={
            "email": "notified@acmerisk.com",
            "full_name": "Notified Person",
            "password": STRONG_PASSWORD,
            "role": "viewer",
        },
    )

    login = client.post(
        "/api/auth/login", json={"email": "notified@acmerisk.com", "password": STRONG_PASSWORD}
    ).json()
    headers = {
        "Authorization": f"Bearer {login['access_token']}",
        "X-Organization-Id": str(login["active_organization_id"]),
    }

    summary = client.get("/api/notifications/summary", headers=headers)
    assert summary.status_code == 200
    assert summary.json()["unread"] >= 1


def test_only_administrators_may_add_members(client, risk_manager):
    response = client.post(
        "/api/auth/members",
        headers=risk_manager.headers(),
        json={
            "email": "blocked@acmerisk.com",
            "full_name": "Blocked Person",
            "password": STRONG_PASSWORD,
            "role": "viewer",
        },
    )

    assert response.status_code == 403


def test_manager_can_change_a_members_role(client, risk_manager, viewer):
    members = client.get("/api/auth/members", headers=risk_manager.headers()).json()
    membership = next(item for item in members if item["email"] == viewer.email)

    response = client.patch(
        f"/api/auth/members/{membership['id']}",
        headers=risk_manager.headers(),
        json={"role": "analyst"},
    )

    assert response.status_code == 200
    assert response.json()["role"] == "analyst"


def test_an_admin_cannot_demote_themselves(client, admin):
    members = client.get("/api/auth/members", headers=admin.headers()).json()
    membership = next(item for item in members if item["email"] == admin.email)

    response = client.patch(
        f"/api/auth/members/{membership['id']}",
        headers=admin.headers(),
        json={"role": "viewer"},
    )

    assert response.status_code == 400


@pytest.mark.integration
def test_logout_records_the_session_end(client, analyst):
    response = client.post("/api/auth/logout", headers=analyst.headers())

    assert response.status_code == 200
