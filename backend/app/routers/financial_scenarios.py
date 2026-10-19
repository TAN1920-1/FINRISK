"""Financial exposure API: documented loss scenarios and their calculations.

Every number returned here comes from :mod:`app.scoring.financial`, which
publishes its formulas in module documentation.  Nothing is estimated by the
API layer itself.
"""

from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .. import domain
from ..audit import record_audit
from ..deps import CanManage, CanWrite, Paging, SessionDep, Tenant, client_ip
from ..models import Asset, FinancialScenario, Risk
from ..schemas import (
    FinancialScenarioCreate,
    FinancialScenarioOut,
    FinancialScenarioUpdate,
    Message,
    Page,
    ScenarioCalculationOut,
    ScenarioInputs,
)
from ..scoring.financial import LossInputs, compute_losses, sensitivity_analysis, to_breakdown
from ..serializers import scenario_out
from ..services.common import build_page, count_for, ordered
from ..services.exports import csv_response
from ..services.scenarios import calculate_scenario, inputs_from_scenario

router = APIRouter(prefix="/api/financial-scenarios", tags=["financial scenarios"])

SORTABLE = {
    "name": FinancialScenario.name,
    "scenario_type": FinancialScenario.scenario_type,
    "probability": FinancialScenario.probability,
    "time_horizon_months": FinancialScenario.time_horizon_months,
    "currency": FinancialScenario.currency,
    "created_at": FinancialScenario.created_at,
    "updated_at": FinancialScenario.updated_at,
}

CSV_HEADERS = [
    "id",
    "name",
    "scenario_type",
    "risk_ref",
    "currency",
    "time_horizon_months",
    "probability",
    "gross_loss",
    "net_loss",
    "expected_loss",
    "expected_residual_loss",
    "potential_avoided_loss",
    "mitigation_cost",
    "return_on_mitigation",
]


def _get_scenario(db: Session, organization_id: int, scenario_id: int) -> FinancialScenario:
    scenario = db.execute(
        select(FinancialScenario).where(
            FinancialScenario.id == scenario_id,
            FinancialScenario.organization_id == organization_id,
        )
    ).scalar_one_or_none()
    if scenario is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scenario not found.")
    return scenario


def _validate_links(
    db: Session, organization_id: int, risk_id: Optional[int], asset_id: Optional[int]
) -> None:
    if risk_id is not None:
        found = db.execute(
            select(Risk.id).where(Risk.id == risk_id, Risk.organization_id == organization_id)
        ).first()
        if found is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Risk not found in this organization.")
    if asset_id is not None:
        found = db.execute(
            select(Asset.id).where(Asset.id == asset_id, Asset.organization_id == organization_id)
        ).first()
        if found is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Asset not found in this organization.")


def _context(db: Session, scenarios: list[FinancialScenario]) -> list[FinancialScenarioOut]:
    if not scenarios:
        return []
    risk_ids = {item.risk_id for item in scenarios if item.risk_id}
    asset_ids = {item.asset_id for item in scenarios if item.asset_id}
    risks = (
        {risk.id: risk for risk in db.execute(select(Risk).where(Risk.id.in_(risk_ids))).scalars()}
        if risk_ids
        else {}
    )
    assets = (
        {asset.id: asset for asset in db.execute(select(Asset).where(Asset.id.in_(asset_ids))).scalars()}
        if asset_ids
        else {}
    )
    return [
        scenario_out(
            scenario,
            risk=risks.get(scenario.risk_id),
            asset=assets.get(scenario.asset_id),
            calculation=calculate_scenario(scenario).breakdown,
        )
        for scenario in scenarios
    ]


@router.get("/meta", summary="Scenario vocabularies")
def scenario_meta(tenant: Tenant) -> dict:
    return {
        "scenario_types": [item.value for item in domain.ScenarioType],
        "organization_currency": tenant.organization.currency,
        "formula": {
            "gross_loss": "direct + business interruption + revenue + recovery + incident response + regulatory + other",
            "business_interruption": "downtime_hours x downtime_cost_per_hour",
            "net_loss": "gross_loss - recoveries (never below zero)",
            "expected_loss": "probability x net_loss",
            "expected_residual_loss": "residual_probability x net_loss",
            "potential_avoided_loss": "expected_loss - expected_residual_loss",
        },
    }


@router.get("", response_model=Page[FinancialScenarioOut], summary="List financial scenarios")
def list_scenarios(
    tenant: Tenant,
    db: SessionDep,
    paging: Paging,
    q: Annotated[Optional[str], Query(max_length=120)] = None,
    scenario_type: Annotated[Optional[domain.ScenarioType], Query()] = None,
    risk_id: Annotated[Optional[int], Query()] = None,
    asset_id: Annotated[Optional[int], Query()] = None,
    currency: Annotated[Optional[str], Query(min_length=3, max_length=3)] = None,
) -> Page[FinancialScenarioOut]:
    stmt = select(FinancialScenario).where(FinancialScenario.organization_id == tenant.organization_id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(FinancialScenario.name.ilike(like), FinancialScenario.description.ilike(like)))
    if scenario_type:
        stmt = stmt.where(FinancialScenario.scenario_type == scenario_type.value)
    if risk_id is not None:
        stmt = stmt.where(FinancialScenario.risk_id == risk_id)
    if asset_id is not None:
        stmt = stmt.where(FinancialScenario.asset_id == asset_id)
    if currency:
        stmt = stmt.where(FinancialScenario.currency == currency.upper())

    total = int(db.execute(count_for(stmt)).scalar_one())
    rows = (
        db.execute(
            ordered(stmt, paging, SORTABLE, FinancialScenario.created_at)
            .offset(paging.offset)
            .limit(paging.limit)
        )
        .scalars()
        .all()
    )
    return build_page(_context(db, list(rows)), total, paging)


@router.get("/export", summary="Export scenarios (CSV)")
def export_scenarios(
    request: Request,
    tenant: Tenant,
    db: SessionDep,
    scenario_type: Annotated[Optional[domain.ScenarioType], Query()] = None,
    risk_id: Annotated[Optional[int], Query()] = None,
) -> Response:
    stmt = select(FinancialScenario).where(FinancialScenario.organization_id == tenant.organization_id)
    if scenario_type:
        stmt = stmt.where(FinancialScenario.scenario_type == scenario_type.value)
    if risk_id is not None:
        stmt = stmt.where(FinancialScenario.risk_id == risk_id)
    rows = db.execute(stmt.order_by(FinancialScenario.id)).scalars().all()

    risk_refs = {
        risk.id: risk.risk_ref
        for risk in db.execute(
            select(Risk).where(Risk.id.in_({item.risk_id for item in rows if item.risk_id} or {0}))
        ).scalars()
    }

    def _iter():
        for scenario in rows:
            result = compute_losses(inputs_from_scenario(scenario))
            yield [
                scenario.id,
                scenario.name,
                scenario.scenario_type,
                risk_refs.get(scenario.risk_id),
                result.currency,
                result.time_horizon_months,
                f"{result.probability:.4f}",
                result.gross_loss,
                result.net_loss,
                result.expected_loss,
                result.expected_residual_loss,
                result.potential_avoided_loss,
                result.mitigation_cost,
                "" if result.return_on_mitigation is None else f"{result.return_on_mitigation:.4f}",
            ]

    record_audit(
        db,
        action=domain.AuditAction.DATA_EXPORTED.value,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="financial_scenario",
        detail={"rows": len(rows)},
        ip_address=client_ip(request),
    )
    db.commit()
    return csv_response(filename="finrisk-financial-scenarios.csv", headers=CSV_HEADERS, rows=_iter())


@router.post("/preview", response_model=ScenarioCalculationOut, summary="Calculate without saving")
def preview_scenario(payload: ScenarioInputs, tenant: Tenant) -> ScenarioCalculationOut:
    """Run the loss engine on unsaved inputs so the UI can show a live preview."""
    inputs = LossInputs(
        currency=payload.currency.upper(),
        time_horizon_months=payload.time_horizon_months,
        probability=payload.probability,
        residual_probability=payload.residual_probability,
        direct_loss=payload.direct_loss,
        revenue_loss=payload.revenue_loss,
        downtime_hours=payload.downtime_hours,
        downtime_cost_per_hour=payload.downtime_cost_per_hour,
        recovery_cost=payload.recovery_cost,
        incident_response_cost=payload.incident_response_cost,
        regulatory_cost=payload.regulatory_cost,
        other_cost=payload.other_cost,
        insurance_recovery=payload.insurance_recovery,
        mitigation_cost=payload.mitigation_cost,
    )
    return ScenarioCalculationOut(
        breakdown=to_breakdown(compute_losses(inputs)),
        sensitivity=sensitivity_analysis(inputs),
    )


@router.get("/compare", response_model=list[FinancialScenarioOut], summary="Compare scenarios")
def compare_scenarios(
    tenant: Tenant, db: SessionDep, ids: Annotated[Optional[list[int]], Query()] = None
) -> list[FinancialScenarioOut]:
    if not ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Provide at least one scenario id.")
    rows = (
        db.execute(
            select(FinancialScenario).where(
                FinancialScenario.organization_id == tenant.organization_id,
                FinancialScenario.id.in_(ids),
            )
        )
        .scalars()
        .all()
    )
    order = {value: index for index, value in enumerate(ids)}
    rows.sort(key=lambda item: order.get(item.id, len(order)))
    return _context(db, list(rows))


@router.post(
    "",
    response_model=FinancialScenarioOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a financial scenario",
)
def create_scenario(
    payload: FinancialScenarioCreate, request: Request, tenant: CanWrite, db: SessionDep
) -> FinancialScenarioOut:
    _validate_links(db, tenant.organization_id, payload.risk_id, payload.asset_id)
    scenario = FinancialScenario(
        organization_id=tenant.organization_id,
        created_by_id=tenant.user.id,
        **payload.model_dump(),
    )
    db.add(scenario)
    db.flush()
    record_audit(
        db,
        action=domain.AuditAction.SCENARIO_CREATED.value,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="financial_scenario",
        entity_id=scenario.id,
        detail={"name": scenario.name, "currency": scenario.currency},
        ip_address=client_ip(request),
    )
    db.commit()
    db.refresh(scenario)
    return _context(db, [scenario])[0]


@router.get("/{scenario_id}", response_model=FinancialScenarioOut, summary="Fetch one scenario")
def get_scenario(scenario_id: int, tenant: Tenant, db: SessionDep) -> FinancialScenarioOut:
    return _context(db, [_get_scenario(db, tenant.organization_id, scenario_id)])[0]


@router.patch("/{scenario_id}", response_model=FinancialScenarioOut, summary="Update a scenario")
def update_scenario(
    scenario_id: int,
    payload: FinancialScenarioUpdate,
    request: Request,
    tenant: CanWrite,
    db: SessionDep,
) -> FinancialScenarioOut:
    scenario = _get_scenario(db, tenant.organization_id, scenario_id)
    data = payload.model_dump(exclude_unset=True)
    if "risk_id" in data or "asset_id" in data:
        _validate_links(
            db,
            tenant.organization_id,
            data.get("risk_id", scenario.risk_id),
            data.get("asset_id", scenario.asset_id),
        )
    for field, value in data.items():
        setattr(scenario, field, value)

    record_audit(
        db,
        action=domain.AuditAction.SCENARIO_UPDATED.value,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="financial_scenario",
        entity_id=scenario.id,
        detail={"fields": sorted(data.keys())},
        ip_address=client_ip(request),
    )
    db.commit()
    db.refresh(scenario)
    return _context(db, [scenario])[0]


@router.post(
    "/{scenario_id}/calculate",
    response_model=ScenarioCalculationOut,
    summary="Calculate a saved scenario",
)
def calculate_saved(scenario_id: int, request: Request, tenant: Tenant, db: SessionDep) -> ScenarioCalculationOut:
    scenario = _get_scenario(db, tenant.organization_id, scenario_id)
    record_audit(
        db,
        action=domain.AuditAction.DATA_EXPORTED.value,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="financial_scenario",
        entity_id=scenario.id,
        detail={"operation": "calculate"},
        ip_address=client_ip(request),
    )
    db.commit()
    return calculate_scenario(scenario)


@router.delete("/{scenario_id}", response_model=Message, summary="Delete a scenario")
def delete_scenario(
    scenario_id: int, request: Request, tenant: CanManage, db: SessionDep
) -> Message:
    scenario = _get_scenario(db, tenant.organization_id, scenario_id)
    name = scenario.name
    db.delete(scenario)
    record_audit(
        db,
        action=domain.AuditAction.SCENARIO_DELETED.value,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="financial_scenario",
        entity_id=scenario_id,
        detail={"name": name},
        ip_address=client_ip(request),
    )
    db.commit()
    return Message(message="Scenario deleted.")
