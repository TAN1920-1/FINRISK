"""Environment-driven application configuration.

Values are read from real environment variables first, then from a ``.env``
file in the repository root or in ``backend/``.  Nothing here is required for
local development: every setting has a safe default, and the JWT signing key is
generated once and stored in a git-ignored file so that restarts do not
invalidate sessions.

Set ``ENVIRONMENT=production`` (and an explicit ``SECRET_KEY``) to enable
production guard rails (no auto-generated signing key, no open registration,
no demo data).  Variable names are the upper-cased field names below, with no
prefix: ``ENVIRONMENT``, ``DATABASE_URL``, ``SECRET_KEY``, ``CORS_ORIGINS`` …
"""

from __future__ import annotations

import secrets
from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_DIR.parent
SECRET_FILE = BACKEND_DIR / ".finrisk_secret"


def _load_or_create_signing_key() -> str:
    """Return a persisted development signing key (generated on first use)."""
    if SECRET_FILE.exists():
        value = SECRET_FILE.read_text(encoding="utf-8").strip()
        if value:
            return value
    value = secrets.token_urlsafe(48)
    SECRET_FILE.write_text(value, encoding="utf-8")
    return value


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(PROJECT_ROOT / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- application -------------------------------------------------------
    app_name: str = "FinRisk AI"
    app_version: str = "2.0.0"
    environment: str = "development"
    debug: bool = False

    # --- persistence -------------------------------------------------------
    database_url: str = Field(
        default=f"sqlite:///{(BACKEND_DIR / 'finrisk.db').as_posix()}",
        description="SQLAlchemy database URL. PostgreSQL is recommended for multi-user deployments.",
    )
    sql_echo: bool = False

    # --- authentication ----------------------------------------------------
    secret_key: str = ""
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 720
    min_password_length: int = 10
    allow_open_registration: bool = True
    login_rate_limit_attempts: int = 8
    login_rate_limit_window_seconds: int = 300

    # --- HTTP --------------------------------------------------------------
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,https://finrisk-beta.vercel.app"
    max_upload_mb: int = 5
    http_timeout_seconds: int = 15

    # --- external intelligence services ------------------------------------
    nvd_api_key: str = ""
    nvd_base_url: str = "https://services.nvd.nist.gov/rest/json/cves/2.0"
    kev_feed_url: str = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
    osint_live_checks: bool = True
    vulnerability_cache_ttl_hours: int = 24

    # --- demo / seed data --------------------------------------------------
    demo_data_enabled: bool = True

    # --- machine learning --------------------------------------------------
    retrain_min_rows: int = 60

    @field_validator("environment")
    @classmethod
    def _normalise_environment(cls, value: str) -> str:
        return (value or "development").strip().lower()

    @model_validator(mode="after")
    def _apply_environment_guards(self) -> "Settings":
        if not self.secret_key:
            if self.is_production:
                raise ValueError(
                    "SECRET_KEY must be provided explicitly when ENVIRONMENT=production."
                )
            self.secret_key = _load_or_create_signing_key()
        if self.is_production:
            # Never allow demo data or open self-registration in production.
            self.demo_data_enabled = False
            self.allow_open_registration = False
        return self

    @property
    def is_production(self) -> bool:
        return self.environment in {"production", "prod"}

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide settings singleton."""
    return Settings()


settings = get_settings()
