"""Report generation, preview and export.

Reports are assembled from persisted records by :mod:`app.services.reports`,
which is also the only place the loss formulas and their caveats are written.

Two rules govern this router:

* **Authorization is checked before a single row is read.**  Export requires the
  analyst role or above, so a read-only viewer cannot pull the register out of
  the system as a file.
* **Every export is recorded.**  The rendered document is written to
  ``generated_reports`` and to the audit trail, so the history page reflects what
  was actually produced rather than what a client claims it downloaded.
"""

from __future__ import annotations

from typing import Annotated, Any, Optional

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from sqlalchemy import select

from .. import domain
from ..audit import record_audit
from ..deps import CanWrite, Paging, SessionDep, Tenant, client_ip
from ..models import GeneratedReport, utcnow
from ..schemas import (
    Page,
    ReportCatalogEntry,
    ReportDatasetOut,
    ReportFigure,
    ReportOut,
    ReportRequest,
)
from ..services import reports
from ..services.common import build_page, count_for, ordered

router = APIRouter(prefix="/api/reports", tags=["reports"])

#: Formats that produce a downloadable file.  ``json`` is served by the preview
#: endpoint, which returns the dataset for on-screen rendering.
DOWNLOAD_FORMATS: dict[str, str] = {
    "csv": "text/csv; charset=utf-8",
    "pdf": "application/pdf",
}

SORTABLE = {
    "created_at": GeneratedReport.created_at,
    "report_type": GeneratedReport.report_type,
    "format": GeneratedReport.format,
    "row_count": GeneratedReport.row_count,
}


def _filters_from(payload: ReportRequest) -> reports.ReportFilters:
    """Translate the request body into the report service's filter value object.

    Validates the date range here so an inverted range is reported as a bad
    request rather than silently producing an empty report.
    """
    if payload.start_date and payload.end_date and payload.start_date > payload.end_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The start date must not be later than the end date.",
        )
    return reports.ReportFilters(
        start_date=payload.start_date,
        end_date=payload.end_date,
        category=payload.category.value if payload.category else None,
        severity=payload.severity.value if payload.severity else None,
        business_unit=payload.business_unit,
    )


def _filter_dict(filters: reports.ReportFilters) -> dict[str, Any]:
    return {
        key: (value.isoformat() if hasattr(value, "isoformat") else value)
        for key, value in (
            ("start_date", filters.start_date),
            ("end_date", filters.end_date),
            ("category", filters.category),
            ("severity", filters.severity),
            ("business_unit", filters.business_unit),
        )
        if value is not None
    }


def _build(
    db: SessionDep, organization_id: int, report_type: str, filters: reports.ReportFilters, currency: str
) -> reports.ReportDataset:
    try:
        return reports.build_report(
            db, organization_id, report_type, filters=filters, currency=currency
        )
    except KeyError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"There is no report type named '{report_type}'.",
        )


@router.get("/catalog", response_model=list[ReportCatalogEntry], summary="List available reports")
def report_catalog(tenant: Tenant) -> list[ReportCatalogEntry]:
    """Describe the report types this build can produce (never hardcoded by the UI)."""
    return [ReportCatalogEntry(**entry) for entry in reports.report_catalog()]


@router.get("", response_model=Page[ReportOut], summary="List generated reports")
def list_reports(
    tenant: Tenant,
    db: SessionDep,
    paging: Paging,
    report_type: Annotated[Optional[str], Query(max_length=60)] = None,
) -> Page[ReportOut]:
    """History of reports rendered for the organization (metadata only)."""
    stmt = select(GeneratedReport).where(
        GeneratedReport.organization_id == tenant.organization_id
    )
    if report_type:
        stmt = stmt.where(GeneratedReport.report_type == report_type)

    total = int(db.execute(count_for(stmt)).scalar_one())
    rows = (
        db.execute(
            ordered(stmt, paging, SORTABLE, GeneratedReport.created_at)
            .offset(paging.offset)
            .limit(paging.limit)
        )
        .scalars()
        .all()
    )
    return build_page([ReportOut.model_validate(row) for row in rows], total, paging)


@router.post("/preview", response_model=ReportDatasetOut, summary="Build a report as data")
def preview_report(payload: ReportRequest, tenant: Tenant, db: SessionDep) -> ReportDatasetOut:
    """Assemble the report from live records so the UI can render it on screen.

    Previewing does not create a file and does not write to the report history;
    it is the read-only view an analyst uses before exporting.
    """
    filters = _filters_from(payload)
    organization = tenant.organization
    dataset = _build(db, organization.id, payload.report_type, filters, organization.currency)
    return ReportDatasetOut(
        report_type=dataset.report_type,
        title=dataset.title,
        columns=dataset.columns,
        rows=dataset.rows,
        figures=[ReportFigure(label=label, value=value) for label, value in dataset.summary],
        methodology=dataset.methodology,
        limitations=dataset.limitations,
        row_count=dataset.row_count,
        currency=organization.currency,
        organization_id=organization.id,
        generated_at=utcnow(),
        filters=_filter_dict(filters),
    )


@router.post("/export", summary="Generate and download a report file")
def export_report(
    payload: ReportRequest, request: Request, tenant: CanWrite, db: SessionDep
) -> Response:
    """Render a report to CSV or PDF, record it, and return it as a download.

    The role check runs as a dependency, i.e. before the body is assembled, so
    an unauthorized caller cannot cause the register to be read or exported.
    """
    media_type = DOWNLOAD_FORMATS.get(payload.format)
    if media_type is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Exports are available as 'csv' or 'pdf'. Use the preview endpoint for JSON.",
        )

    filters = _filters_from(payload)
    organization = tenant.organization
    dataset = _build(db, organization.id, payload.report_type, filters, organization.currency)
    generated_at = utcnow()

    if payload.format == "csv":
        content = reports.render_csv(dataset)
    else:
        context = reports.ReportContext(
            organization_name=organization.name,
            currency=organization.currency,
            generated_at=generated_at,
            generated_by=tenant.user.full_name or tenant.user.email,
            period_start=filters.start_date,
            period_end=filters.end_date,
            filters=filters,
        )
        content = reports.render_pdf(dataset, context)

    filename = f"{dataset.report_type}-{generated_at:%Y%m%d-%H%M%S}.{payload.format}"

    record = GeneratedReport(
        organization_id=organization.id,
        generated_by_id=tenant.user.id,
        report_type=dataset.report_type,
        format=payload.format,
        title=dataset.title,
        reporting_period_start=filters.start_date,
        reporting_period_end=filters.end_date,
        parameters=_filter_dict(filters) or None,
        row_count=dataset.row_count,
        methodology=dataset.methodology or None,
        limitations=dataset.limitations or None,
    )
    db.add(record)
    record_audit(
        db,
        action=domain.AuditAction.REPORT_GENERATED.value,
        user=tenant.user,
        organization_id=organization.id,
        entity_type="generated_report",
        entity_id=None,
        detail={
            "report_type": dataset.report_type,
            "format": payload.format,
            "row_count": dataset.row_count,
            "filters": _filter_dict(filters),
        },
        ip_address=client_ip(request),
    )
    db.commit()

    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Report-Rows": str(dataset.row_count),
        },
    )
