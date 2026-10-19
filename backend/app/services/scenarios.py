"""Adapter between persisted :class:`FinancialScenario` rows and the pure
loss-estimation engine in :mod:`app.scoring.financial`.

Kept in the service layer so that both the financial router and the dashboard
use exactly the same calculation path.
"""

from __future__ import annotations

from ..models import FinancialScenario
from ..schemas import LossBreakdown, ScenarioCalculationOut
from ..scoring.financial import LossInputs, compute_losses, sensitivity_analysis, to_breakdown


def inputs_from_scenario(scenario: FinancialScenario) -> LossInputs:
    """Map a persisted scenario onto the (side-effect free) engine inputs."""
    return LossInputs(
        currency=scenario.currency or "USD",
        time_horizon_months=scenario.time_horizon_months or 12,
        probability=scenario.probability or 0.0,
        residual_probability=scenario.residual_probability,
        direct_loss=scenario.direct_loss,
        revenue_loss=scenario.revenue_loss,
        downtime_hours=scenario.downtime_hours,
        downtime_cost_per_hour=scenario.downtime_cost_per_hour,
        recovery_cost=scenario.recovery_cost,
        incident_response_cost=scenario.incident_response_cost,
        regulatory_cost=scenario.regulatory_cost,
        other_cost=scenario.other_cost,
        insurance_recovery=scenario.insurance_recovery,
        mitigation_cost=scenario.mitigation_cost,
    )


def scenario_breakdown(scenario: FinancialScenario) -> LossBreakdown:
    return to_breakdown(compute_losses(inputs_from_scenario(scenario)))


def calculate_scenario(scenario: FinancialScenario) -> ScenarioCalculationOut:
    inputs = inputs_from_scenario(scenario)
    return ScenarioCalculationOut(
        breakdown=to_breakdown(compute_losses(inputs)),
        sensitivity=sensitivity_analysis(inputs),
    )
