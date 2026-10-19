"""FinRisk AI application factory.

Wires every router behind the ``/api`` prefix, applies settings-driven CORS,
installs centralised error handling and runs the ordered migrations on start-up.
The preserved TILT vendor-assessment module is mounted at ``/api/tilt``; there is
no second application.
"""

from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .db import applied_migrations, run_migrations
from .routers import (
    ai,
    assets,
    audit_logs,
    auth,
    dashboard,
    financial_scenarios,
    mitigations,
    notifications,
    organizations,
    reports,
    risks,
    tilt,
    vulnerabilities,
)

logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("finrisk")

DESCRIPTION = """
FinRisk AI turns a risk register, a vulnerability backlog and a set of financial
assumptions into prioritised, explainable decisions.

* **Risk register** - likelihood x impact scoring, lifecycle, evidence quality.
* **Financial exposure** - documented loss formulas, scenario comparison, sensitivity.
* **Cybersecurity** - NVD / CISA KEV / EPSS enrichment and a context-aware priority
  score that is explicitly *not* a CVSS score.
* **AI insights** - a real scikit-learn pipeline predicting a documented priority
  class, always shown beside the rule-based classification; deterministic portfolio
  insights; SHAP-or-equivalent attributions that are never presented as causal.

All figures are modelled estimates from your own records. Every endpoint is
organization-scoped and re-verifies membership server-side.
"""

TAGS_METADATA = [
    {"name": "auth", "description": "Registration, login, sessions, memberships."},
    {"name": "organizations", "description": "Organization profile, members and roles."},
    {"name": "assets", "description": "Asset registry."},
    {"name": "risks", "description": "Risk register, evidence and assessment history."},
    {"name": "financial scenarios", "description": "Financial loss modelling and comparison."},
    {"name": "cybersecurity", "description": "Vulnerability findings and CVE enrichment."},
    {"name": "mitigations", "description": "Remediation workflow and status changes."},
    {"name": "dashboard", "description": "KPIs and charts derived from persisted rows."},
    {"name": "ai", "description": "Model status, training, prediction and deterministic insights."},
    {"name": "reports", "description": "Report catalog, preview, export and history."},
    {"name": "audit", "description": "Organization-scoped audit trail (administrators only)."},
    {"name": "notifications", "description": "Per-user notification inbox."},
    {"name": "tilt", "description": "Preserved TILT vendor-assessment module."},
    {"name": "system", "description": "Health and build information."},
]


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Apply pending migrations before the first request is served."""
    try:
        applied = run_migrations()
    except Exception:  # noqa: BLE001 - a broken schema must not be hidden
        logger.exception("Database migrations failed; the API will start but may be unusable.")
    else:
        if applied:
            logger.info("Applied migrations: %s", ", ".join(applied))
        logger.info("Schema revisions present: %s", ", ".join(applied_migrations()) or "none")
    yield


def create_app() -> FastAPI:
    application = FastAPI(
        title=settings.app_name,
        description=DESCRIPTION,
        version=settings.app_version,
        openapi_tags=TAGS_METADATA,
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
    )

    if settings.cors_origin_list:
        application.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origin_list,
            allow_credentials=True,
            allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
            allow_headers=["Authorization", "Content-Type", "X-Organization-Id", "X-Request-Id"],
            expose_headers=["X-Request-Id"],
        )

    _install_error_handlers(application)

    @application.middleware("http")
    async def _request_id(request: Request, call_next):  # pragma: no cover - framework hook
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-Id"] = request_id
        return response

    for module in (
        auth,
        organizations,
        assets,
        risks,
        financial_scenarios,
        vulnerabilities,
        mitigations,
        dashboard,
        ai,
        reports,
        audit_logs,
        notifications,
        tilt,
    ):
        application.include_router(module.router)

    @application.get("/api/health", tags=["system"])
    def health() -> dict[str, Any]:
        """Liveness plus the schema revisions this process believes are applied."""
        return {
            "status": "ok",
            "app": settings.app_name,
            "version": settings.app_version,
            "environment": settings.environment,
            "migrations": applied_migrations(),
        }

    @application.get("/", tags=["system"])
    def root() -> dict[str, Any]:
        return {
            "name": settings.app_name,
            "version": settings.app_version,
            "docs": "/docs",
            "openapi": "/openapi.json",
            "health": "/api/health",
        }

    return application


def _install_error_handlers(application: FastAPI) -> None:
    """Centralised, consistent error responses for every endpoint."""

    @application.exception_handler(RequestValidationError)
    async def _validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Field-level detail is returned so forms can render it, but the raw
        # input is never echoed back (it can contain secrets).
        errors = [
            {
                "location": ".".join(str(part) for part in error.get("loc", ())),
                "message": error.get("msg", "Invalid value."),
                "type": error.get("type", "value_error"),
            }
            for error in exc.errors()
        ]
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "detail": "The request could not be validated.",
                "errors": errors,
                "request_id": getattr(request.state, "request_id", None),
            },
        )

    @application.exception_handler(Exception)
    async def _unhandled_handler(request: Request, exc: Exception) -> JSONResponse:  # pragma: no cover
        request_id = getattr(request.state, "request_id", None)
        logger.exception("Unhandled error on %s %s (request %s)", request.method, request.url.path, request_id)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "detail": (
                    "An unexpected error occurred. The failure has been logged"
                    + (f" with request id {request_id}." if request_id else ".")
                ),
                "request_id": request_id,
            },
        )


app = create_app()

__all__ = ["app", "create_app"]
