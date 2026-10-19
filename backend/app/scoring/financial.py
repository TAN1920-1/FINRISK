"""Transparent financial loss-estimation engine.

Definitions (documented so the numbers can be audited):

* **Gross scenario loss** - the sum of every defined loss component for a single
  occurrence of the scenario, before any recovery:
  ``direct + business interruption + revenue + recovery + incident response +
  regulatory + other``.
* **Net scenario loss** - ``gross loss - applicable recoveries`` (insurance).
  Recoveries are capped at the gross loss; they never create a negative loss.
* **Probability** - the chance that the scenario occurs at least once within
  ``time_horizon_months``.  A scenario covering 6 months with ``p = 0.2`` is a
  20% chance of at least one occurrence in that period.
* **Expected loss** - ``probability x net scenario loss`` for the stated horizon.
  This is an *estimate*, not a prediction.
* **Expected residual loss** - the same calculation using
  ``residual_probability`` (the probability that survives the planned
  mitigation).  When mitigation is not modelled it equals the expected loss.
* **Potential avoided loss** - ``expected loss - expected residual loss``.

Rules that keep the numbers honest:

* Undefined amounts stay ``None``; they are never silently treated as a real
  zero-value assumption in the output notes.
* Amounts in different currencies are never summed.  A scenario carries exactly
  one currency and the engine never converts.
* Overlapping components (revenue loss plus downtime loss) are reported in the
  notes so the analyst can remove double counting.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

from ..schemas import (
    LossBreakdown,
    LossComponent,
    SensitivityAnalysis,
    SensitivityPoint,
)

CENTS = Decimal("0.01")
ZERO = Decimal("0.00")


def _money(value: Optional[Decimal | float | int]) -> Optional[Decimal]:
    """Normalise a value to 2-decimal money, preserving ``None``."""
    if value is None:
        return None
    if isinstance(value, Decimal):
        decimal_value = value
    else:
        decimal_value = Decimal(str(value))
    return decimal_value.quantize(CENTS, rounding=ROUND_HALF_UP)


def _sum(values: list[Optional[Decimal]]) -> Decimal:
    total = ZERO
    for value in values:
        if value is not None:
            total += value
    return total.quantize(CENTS, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class LossInputs:
    """Engine inputs.  ``None`` means "not estimated", not "zero"."""

    currency: str = "USD"
    time_horizon_months: int = 12
    probability: float = 0.1
    residual_probability: Optional[float] = None
    direct_loss: Optional[Decimal | float | int] = None
    revenue_loss: Optional[Decimal | float | int] = None
    downtime_hours: Optional[float] = None
    downtime_cost_per_hour: Optional[Decimal | float | int] = None
    recovery_cost: Optional[Decimal | float | int] = None
    incident_response_cost: Optional[Decimal | float | int] = None
    regulatory_cost: Optional[Decimal | float | int] = None
    other_cost: Optional[Decimal | float | int] = None
    insurance_recovery: Optional[Decimal | float | int] = None
    mitigation_cost: Optional[Decimal | float | int] = None


@dataclass(frozen=True)
class LossResult:
    """Numeric result of the engine (mirrored by ``schemas.LossBreakdown``)."""

    currency: str
    time_horizon_months: int
    probability: float
    residual_probability: Optional[float]
    components: list[LossComponent]
    gross_loss: Decimal
    total_recoveries: Decimal
    net_loss: Decimal
    expected_loss: Decimal
    expected_residual_loss: Decimal
    potential_avoided_loss: Decimal
    return_on_mitigation: Optional[float]
    mitigation_cost: Decimal
    notes: list[str]


def _business_interruption(inputs: LossInputs, notes: list[str]) -> Optional[Decimal]:
    if inputs.downtime_hours is None or inputs.downtime_cost_per_hour is None:
        if inputs.downtime_hours is not None or inputs.downtime_cost_per_hour is not None:
            notes.append(
                "Business interruption loss could not be calculated: both the downtime "
                "duration and the hourly business cost are required."
            )
        return None
    return _money(inputs.downtime_hours * float(inputs.downtime_cost_per_hour))


def compute_losses(inputs: LossInputs) -> LossResult:
    """Run the deterministic loss calculation for one scenario."""
    notes: list[str] = []

    direct = _money(inputs.direct_loss)
    revenue = _money(inputs.revenue_loss)
    interruption = _business_interruption(inputs, notes)
    recovery = _money(inputs.recovery_cost)
    incident_response = _money(inputs.incident_response_cost)
    regulatory = _money(inputs.regulatory_cost)
    other = _money(inputs.other_cost)
    insurance = _money(inputs.insurance_recovery)
    mitigation_cost = _money(inputs.mitigation_cost) or ZERO

    components = [
        LossComponent(label="Direct loss", amount=direct or ZERO, note=None if direct is not None else "Not estimated"),
        LossComponent(
            label="Business interruption",
            amount=interruption or ZERO,
            note=(
                f"{inputs.downtime_hours:g} h x {_money(inputs.downtime_cost_per_hour)} / h"
                if interruption is not None
                else "Not estimated"
            ),
        ),
        LossComponent(label="Revenue loss", amount=revenue or ZERO, note=None if revenue is not None else "Not estimated"),
        LossComponent(label="Recovery cost", amount=recovery or ZERO, note=None if recovery is not None else "Not estimated"),
        LossComponent(
            label="Incident response cost",
            amount=incident_response or ZERO,
            note=None if incident_response is not None else "Not estimated",
        ),
        LossComponent(
            label="Regulatory / contractual exposure",
            amount=regulatory or ZERO,
            note=None if regulatory is not None else "Not estimated",
        ),
        LossComponent(label="Other defined losses", amount=other or ZERO, note=None if other is not None else "Not estimated"),
    ]

    gross_loss = _sum([component.amount for component in components])

    if revenue is not None and interruption is not None:
        notes.append(
            "Both revenue loss and business-interruption loss are defined. Confirm they do "
            "not describe the same lost revenue before using the gross figure."
        )

    total_recoveries = insurance or ZERO
    if insurance is not None and insurance > gross_loss:
        notes.append(
            "Insurance recovery exceeded the gross scenario loss and was capped at the gross loss."
        )
        total_recoveries = gross_loss

    net_loss = (gross_loss - total_recoveries).quantize(CENTS, rounding=ROUND_HALF_UP)
    if net_loss < ZERO:
        net_loss = ZERO

    probability = max(0.0, min(1.0, float(inputs.probability or 0.0)))
    expected_loss = (net_loss * Decimal(str(probability))).quantize(CENTS, rounding=ROUND_HALF_UP)

    residual_probability = inputs.residual_probability
    if residual_probability is None:
        expected_residual_loss = expected_loss
        notes.append(
            "No post-mitigation probability was provided, so the residual exposure equals the "
            "current expected loss."
        )
    else:
        residual_probability = max(0.0, min(1.0, float(residual_probability)))
        if residual_probability > probability:
            notes.append(
                "The post-mitigation probability is higher than the current probability; review "
                "the mitigation assumptions."
            )
        expected_residual_loss = (net_loss * Decimal(str(residual_probability))).quantize(
            CENTS, rounding=ROUND_HALF_UP
        )

    potential_avoided = (expected_loss - expected_residual_loss).quantize(CENTS, rounding=ROUND_HALF_UP)
    if potential_avoided < ZERO:
        potential_avoided = ZERO

    return_on_mitigation: Optional[float] = None
    if mitigation_cost > ZERO:
        return_on_mitigation = round(
            float((potential_avoided - mitigation_cost) / mitigation_cost), 4
        )

    if gross_loss == ZERO:
        notes.append("No loss components were defined, so all financial outputs are zero by construction.")

    notes.append(
        "All amounts are estimates expressed in "
        f"{inputs.currency} over a {inputs.time_horizon_months}-month horizon. "
        "They are not a prediction of future losses."
    )

    return LossResult(
        currency=inputs.currency,
        time_horizon_months=inputs.time_horizon_months,
        probability=probability,
        residual_probability=residual_probability,
        components=components,
        gross_loss=gross_loss,
        total_recoveries=total_recoveries,
        net_loss=net_loss,
        expected_loss=expected_loss,
        expected_residual_loss=expected_residual_loss,
        potential_avoided_loss=potential_avoided,
        return_on_mitigation=return_on_mitigation,
        mitigation_cost=mitigation_cost,
        notes=notes,
    )


def to_breakdown(result: LossResult) -> LossBreakdown:
    """Convert the engine result into the API response model."""
    return LossBreakdown(
        currency=result.currency,
        time_horizon_months=result.time_horizon_months,
        probability=result.probability,
        residual_probability=result.residual_probability,
        components=result.components,
        gross_loss=result.gross_loss,
        total_recoveries=result.total_recoveries,
        net_loss=result.net_loss,
        expected_loss=result.expected_loss,
        expected_residual_loss=result.expected_residual_loss,
        potential_avoided_loss=result.potential_avoided_loss,
        return_on_mitigation=result.return_on_mitigation,
        mitigation_cost=result.mitigation_cost,
        notes=result.notes,
    )


def sensitivity_analysis(
    inputs: LossInputs,
    *,
    probability_steps: int = 11,
    loss_factors: Optional[list[float]] = None,
) -> SensitivityAnalysis:
    """Show how expected loss responds to the two most influential assumptions."""
    baseline = compute_losses(inputs)
    factors = loss_factors or [0.5, 0.75, 1.0, 1.25, 1.5]

    probability_sweep: list[SensitivityPoint] = []
    for index in range(max(2, probability_steps)):
        probability = round(index / (probability_steps - 1), 4)
        expected = (baseline.net_loss * Decimal(str(probability))).quantize(
            CENTS, rounding=ROUND_HALF_UP
        )
        probability_sweep.append(
            SensitivityPoint(
                label=f"{probability * 100:.0f}% probability",
                probability=probability,
                net_loss=baseline.net_loss,
                expected_loss=expected,
            )
        )

    net_loss_sweep: list[SensitivityPoint] = []
    for factor in factors:
        scaled_net = (baseline.net_loss * Decimal(str(factor))).quantize(CENTS, rounding=ROUND_HALF_UP)
        expected = (scaled_net * Decimal(str(baseline.probability))).quantize(
            CENTS, rounding=ROUND_HALF_UP
        )
        net_loss_sweep.append(
            SensitivityPoint(
                label=f"{factor:.0%} of estimated net loss",
                probability=baseline.probability,
                net_loss=scaled_net,
                expected_loss=expected,
            )
        )

    break_even: Optional[float] = None
    if baseline.net_loss > ZERO and baseline.mitigation_cost > ZERO:
        ratio = baseline.mitigation_cost / baseline.net_loss
        if ratio <= 1:
            break_even = round(float(ratio), 4)

    return SensitivityAnalysis(
        currency=baseline.currency,
        baseline_probability=baseline.probability,
        baseline_expected_loss=baseline.expected_loss,
        probability_sweep=probability_sweep,
        net_loss_sweep=net_loss_sweep,
        break_even_probability=break_even,
    )
