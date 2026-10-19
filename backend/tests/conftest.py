"""Shared fixtures for the FinRisk AI backend test suite.

Two constraints shape this file:

* :mod:`app.config` builds its ``Settings`` object and :mod:`app.db` builds its
  SQLAlchemy engine *at import time*.  The environment is therefore configured
  before any ``app.*`` module is imported, so the tests run against a throwaway
  SQLite file instead of the developer's ``finrisk.db``.
* Every test starts from a freshly migrated schema.  ``reset_database()`` drops
  and recreates the tables, which also re-runs the questionnaire seed migration,
  so the TILT templates are present exactly as a first start would leave them.

Network access is never required: ``OSINT_LIVE_CHECKS`` is false, which is the
documented offline behaviour of :mod:`app.services.osint`.
"""

from __future__ import annotations

import itertools
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Optional, Union

_TEMP_DIR = Path(tempfile.mkdtemp(prefix="finrisk-tests-"))

# --- environment: must be set before importing anything under ``app`` -------
os.environ["ENVIRONMENT"] = "development"
os.environ["DATABASE_URL"] = f"sqlite:///{(_TEMP_DIR / 'tests.db').as_posix()}"
os.environ["SECRET_KEY"] = "finrisk-test-signing-key-not-for-production-use"
os.environ["DEMO_DATA_ENABLED"] = "false"
os.environ["ALLOW_OPEN_REGISTRATION"] = "true"
os.environ["OSINT_LIVE_CHECKS"] = "false"
# The login limiter is exercised directly in test_auth; keeping the threshold
# high stops unrelated tests from tripping over each other's failed sign-ins.
os.environ["LOGIN_RATE_LIMIT_ATTEMPTS"] = "1000"

import pytest  # noqa: E402 - see the environment block above
from fastapi.testclient import TestClient  # noqa: E402

from app.db import reset_database, session_scope  # noqa: E402
from app.domain import Role  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Membership, Organization, User  # noqa: E402
from app.security import create_access_token, hash_password  # noqa: E402
from app.services.common import slugify  # noqa: E402

#: Password used for every account the suite creates.  It satisfies the
#: documented policy in :func:`app.security.validate_password_strength`.
TEST_PASSWORD = "TestPassword123!"


@dataclass(frozen=True)
class Actor:
    """A seeded user with a signed token and a membership in one organization."""

    email: str
    user_id: int
    organization_id: int
    role: str
    password: str
    token: str

    def headers(self, organization_id: Optional[int] = None) -> dict[str, str]:
        """Authorization headers, optionally acting inside another organization.

        Passing a foreign ``organization_id`` is how the tenancy tests attempt
        (and expect) to be refused.
        """
        return {
            "Authorization": f"Bearer {self.token}",
            "X-Organization-Id": str(organization_id or self.organization_id),
        }


def create_organization(
    name: str,
    *,
    slug: Optional[str] = None,
    currency: str = "USD",
) -> int:
    """Insert an organization directly and return its id."""
    with session_scope() as db:
        organization = Organization(
            name=name,
            slug=slug or slugify(name),
            currency=currency,
        )
        db.add(organization)
        db.flush()
        return organization.id


def create_actor(
    *,
    email: str,
    role: Union[Role, str],
    organization_id: int,
    is_superuser: bool = False,
    full_name: Optional[str] = None,
    password: str = TEST_PASSWORD,
) -> Actor:
    """Insert a user + membership and mint a token for them.

    Accounts are created directly rather than through ``/api/auth/register``
    because that endpoint promotes the very first account to superuser and
    always grants the admin role, which would make the authorization tests
    meaningless.
    """
    role_value = role.value if isinstance(role, Role) else str(role)
    address = email.strip().lower()

    with session_scope() as db:
        user = User(
            email=address,
            full_name=full_name or address.split("@")[0].replace(".", " ").title(),
            password_hash=hash_password(password),
            is_superuser=is_superuser,
        )
        db.add(user)
        db.flush()

        db.add(
            Membership(
                user_id=user.id,
                organization_id=organization_id,
                role=role_value,
            )
        )
        db.flush()

        token, _ = create_access_token(
            user_id=user.id,
            email=user.email,
            token_version=user.token_version,
            organization_id=organization_id,
            role=role_value,
        )
        return Actor(
            email=user.email,
            user_id=user.id,
            organization_id=organization_id,
            role=role_value,
            password=password,
            token=token,
        )


@pytest.fixture(autouse=True)
def clean_database() -> Iterator[None]:
    """Give every test an empty, fully migrated schema."""
    reset_database()
    yield


@pytest.fixture()
def client() -> Iterator[TestClient]:
    """HTTP client with the application's lifespan (migrations) running."""
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def organization() -> int:
    """The primary organization used by a test."""
    return create_organization("Acme Risk Group")


@pytest.fixture()
def other_organization() -> int:
    """A second organization used to prove tenant isolation."""
    return create_organization("Globex Holdings")


@pytest.fixture()
def make_actor():
    """Factory for actors; each gets a unique email unless one is supplied."""
    counter = itertools.count(1)

    def factory(
        role: Union[Role, str] = Role.ANALYST,
        *,
        organization_id: int,
        email: Optional[str] = None,
        is_superuser: bool = False,
    ) -> Actor:
        role_value = role.value if isinstance(role, Role) else str(role)
        address = email or f"{role_value}-{next(counter)}@acmerisk.com"
        return create_actor(
            email=address,
            role=role_value,
            organization_id=organization_id,
            is_superuser=is_superuser,
        )

    return factory


@pytest.fixture()
def admin(make_actor, organization) -> Actor:
    return make_actor(Role.ADMIN, organization_id=organization, email="admin@acmerisk.com")


@pytest.fixture()
def risk_manager(make_actor, organization) -> Actor:
    return make_actor(
        Role.RISK_MANAGER, organization_id=organization, email="manager@acmerisk.com"
    )


@pytest.fixture()
def analyst(make_actor, organization) -> Actor:
    return make_actor(Role.ANALYST, organization_id=organization, email="analyst@acmerisk.com")


@pytest.fixture()
def viewer(make_actor, organization) -> Actor:
    return make_actor(Role.VIEWER, organization_id=organization, email="viewer@acmerisk.com")


@pytest.fixture()
def make_risk(client):
    """Create a risk through the API so validation and auditing also run."""
    store = client

    def factory(actor: Actor, **overrides) -> dict:
        payload = {
            "title": "Unpatched internet-facing application server",
            "category": "cybersecurity",
            "likelihood": 4,
            "impact": 5,
        }
        payload.update(overrides)
        response = store.post("/api/risks", json=payload, headers=actor.headers())
        assert response.status_code == 201, response.text
        return response.json()

    return factory
