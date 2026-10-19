"""Database engine, session handling and the ordered migration runner.

The project deliberately avoids destructive schema recreation: migrations are an
ordered, append-only list.  Each entry is applied at most once and recorded in
``schema_migrations``.  Adding a migration is a matter of appending a function
to :data:`MIGRATIONS`; existing entries are never edited or reordered.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Callable, Iterator, Optional

import sqlalchemy as sa
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from .config import BACKEND_DIR, settings
from .models import Base, SchemaMigration

logger = logging.getLogger("finrisk.db")

LEGACY_DB_PATH = BACKEND_DIR / "tilt_data.db"
DATA_DIR = BACKEND_DIR / "data"

_connect_args: dict[str, object] = {}
if settings.database_url.startswith("sqlite"):
    _connect_args = {"check_same_thread": False}

engine: Engine = sa.create_engine(
    settings.database_url,
    echo=settings.sql_echo,
    future=True,
    pool_pre_ping=True,
    connect_args=_connect_args,
)

if settings.database_url.startswith("sqlite"):

    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, _record):  # pragma: no cover - driver hook
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    """FastAPI dependency yielding a request-scoped session."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    """Transactional scope for scripts, seeds and tests."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Migrations
# ---------------------------------------------------------------------------


def _migration_0001_initial_schema(conn: sa.Connection) -> None:
    """Create every table declared on the ORM metadata (idempotent)."""
    Base.metadata.create_all(bind=engine)


def _migration_0002_questionnaire_templates(conn: sa.Connection) -> None:
    """Seed the preserved TILT questionnaires from the bundled JSON files."""
    from .models import QuestionnaireTemplate

    session = Session(bind=conn)
    existing = session.execute(sa.select(sa.func.count()).select_from(QuestionnaireTemplate)).scalar_one()
    if existing:
        return

    standard_path = DATA_DIR / "questions_standard.json"
    cloud_path = DATA_DIR / "questions_cloud.json"

    if standard_path.exists():
        for item in json.loads(standard_path.read_text(encoding="utf-8")):
            session.add(
                QuestionnaireTemplate(
                    kind="standard",
                    position=int(item["id"]),
                    category=item.get("category"),
                    nist_control=item.get("nist_control"),
                    policy_ref=item.get("policy_ref"),
                    text=item["question"],
                    description=item.get("description"),
                    weight=item.get("weight"),
                    maturity_levels={str(k): v for k, v in (item.get("maturity_levels") or {}).items()},
                    notes=item.get("notes"),
                )
            )

    if cloud_path.exists():
        for item in json.loads(cloud_path.read_text(encoding="utf-8")):
            session.add(
                QuestionnaireTemplate(
                    kind="cloud",
                    position=int(item["id"]),
                    category=item.get("category"),
                    text=item["criterion"],
                    description=item.get("description"),
                    criticality=item.get("criticality"),
                    points=item.get("points"),
                    osint_source=item.get("osint_source"),
                    maturity_levels={str(k): v for k, v in (item.get("maturity_levels") or {}).items()},
                )
            )

    session.flush()


def _migration_0003_import_legacy_tilt(conn: sa.Connection) -> None:
    """Import an existing ``tilt_data.db`` (if present) without mutating it.

    The legacy file is opened read-only and its vendors become
    ``vendor_assessments`` rows inside a single organization named after the
    legacy ``settings.orgName`` value.  Re-running the migration is a no-op
    because the revision is recorded once applied.
    """
    if not LEGACY_DB_PATH.exists():
        return

    from .models import Organization, VendorAssessment

    session = Session(bind=conn)
    try:
        legacy = sqlite3.connect(f"file:{LEGACY_DB_PATH.as_posix()}?mode=ro", uri=True)
    except sqlite3.Error:  # pragma: no cover - unreadable legacy file
        logger.warning("Legacy tilt_data.db could not be opened; skipping import.")
        return
    legacy.row_factory = sqlite3.Row

    try:
        org_name = "Imported TILT Organization"
        try:
            row = legacy.execute("SELECT value FROM settings WHERE key='orgName'").fetchone()
            if row and row[0]:
                org_name = row[0]
        except sqlite3.Error:
            pass

        organization = Organization(
            name=org_name,
            slug="imported-tilt-organization",
            currency="USD",
            reporting_period_label="Legacy import",
        )
        session.add(organization)
        session.flush()

        try:
            rows = legacy.execute("SELECT * FROM vendors").fetchall()
        except sqlite3.Error:
            rows = []

        for row in rows:
            record = dict(row)
            session.add(
                VendorAssessment(
                    organization_id=organization.id,
                    vendor_name=record.get("name") or "Unnamed vendor",
                    status=record.get("status") or "Pending",
                    assessment_type=record.get("assessment_type") or "standard",
                    data_classification=record.get("data_classification"),
                    answers=_safe_json(record.get("answers"), {}),
                    cloud_scores=_safe_json(record.get("cloudScores"), {}),
                    impact=record.get("impact"),
                    likelihood=record.get("likelihood"),
                    vulnerability=record.get("vulnerability"),
                    weakness=record.get("weakness"),
                    strength=record.get("strength"),
                    osint_warnings=_safe_json(record.get("osint_warnings"), []),
                    osint_urls=_safe_json(record.get("osint_urls"), {}),
                    osint_acknowledged=bool(record.get("osint_acknowledged") or 0),
                )
            )
        session.flush()
        logger.info("Imported %s legacy vendor assessments.", len(rows))
    finally:
        legacy.close()


def _safe_json(raw: Optional[str], fallback):
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return fallback


#: Ordered, append-only migration list.  ``(revision, note, callable)``.
MIGRATIONS: list[tuple[str, str, Callable[[sa.Connection], None]]] = [
    ("0001_initial_schema", "Create the FinRisk AI relational schema.", _migration_0001_initial_schema),
    ("0002_questionnaire_templates", "Seed TILT questionnaires.", _migration_0002_questionnaire_templates),
    ("0003_import_legacy_tilt", "Import legacy tilt_data.db if present.", _migration_0003_import_legacy_tilt),
]


def run_migrations(bind: Optional[Engine] = None) -> list[str]:
    """Apply pending migrations and return the revisions applied this run."""
    target = bind or engine
    applied: list[str] = []

    with target.begin() as conn:
        conn.execute(
            sa.text(
                "CREATE TABLE IF NOT EXISTS schema_migrations ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "revision VARCHAR(60) NOT NULL UNIQUE, "
                "applied_at DATETIME NOT NULL, "
                "note VARCHAR(255))"
            )
        )
        done = {
            row[0]
            for row in conn.execute(sa.text("SELECT revision FROM schema_migrations")).fetchall()
        }

        for revision, note, func in MIGRATIONS:
            if revision in done:
                continue
            logger.info("Applying migration %s", revision)
            func(conn)
            conn.execute(
                sa.text(
                    "INSERT INTO schema_migrations (revision, applied_at, note) VALUES (:r, :a, :n)"
                ),
                {"r": revision, "a": _now(), "n": note},
            )
            applied.append(revision)

    return applied


def _now():
    from .models import utcnow

    return utcnow()


def applied_migrations(bind: Optional[Engine] = None) -> list[str]:
    """Return the revisions recorded in the database."""
    target = bind or engine
    with target.connect() as conn:
        try:
            rows = conn.execute(
                sa.text("SELECT revision FROM schema_migrations ORDER BY revision")
            ).fetchall()
        except sa.exc.OperationalError:
            return []
    return [row[0] for row in rows]


def reset_database() -> None:
    """Drop and recreate every table.  Development and test helper only."""
    Base.metadata.drop_all(bind=engine)
    run_migrations()


__all__ = [
    "Base",
    "SessionLocal",
    "engine",
    "get_session",
    "session_scope",
    "run_migrations",
    "applied_migrations",
    "reset_database",
    "SchemaMigration",
    "LEGACY_DB_PATH",
]
