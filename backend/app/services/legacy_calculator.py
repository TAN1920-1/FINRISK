"""Legacy TILT scoring maths, ported from the top-level ``risk_calculator``.

The formulas and thresholds of the legacy implementation are preserved verbatim
so that historical assessments keep scoring the same way.

``calculate_standard``
    * Vulnerability: the weighted mean of the *inverted* maturity answers
      ``normalised = (6 - answer) / 5`` (maturity 1 -> 1.0, 5 -> 0.2), weighted
      by importance (``Critical`` = 3x, ``High`` = 2x, otherwise 1x) and scaled
      to 0-100.  No scored answers means 100% vulnerability.
    * Impact / Likelihood: ``clamp(6 - average_answer / 1.2, 1, 5)``.
    * Maturity score: ``100 - vulnerability`` on a 0-100 scale (higher is
      better); its verdict is banded with the legacy thresholds.

``calculate_cloud``
    * Weighted points: ``sum((maturity / 5) * points)`` over the criteria, with
      a fixed maximum of 55 points (the legacy constant).
    * A missing answer counts as maturity 0; a ``Critical`` criterion scored 0
      is a hard failure (``missed_critical``) which forces the REJECT verdict.

``inherent_risk``
    * The verdict uses the legacy absolute bands 15 / 30 / 45 expressed as a
      share of ``max_score`` (i.e. of the legacy maximum of 55), and derives the
      impact/likelihood bands 5/4/3/2 from the same cut-offs.

These functions are pure: no database access, no logging and no printing.  All
answer maps are tolerated as-is, with missing or ``None`` values treated as
unscored rather than raising.
"""

from __future__ import annotations

from typing import Any, Optional

#: Legacy absolute verdict/threshold cut-offs (out of the legacy maximum of 55).
_LOWER_CUT = 15 / 55
_MID_CUT = 30 / 55
_UPPER_CUT = 45 / 55

_VERDICT_REJECT = "REJECT (Critical Risk)"
_VERDICT_RESTRICTED = "Restricted (Deficient)"
_VERDICT_STANDARD = "Standard Approval"
_VERDICT_ELITE = "Elite (Pre-approved)"

_STATUS_COLORS = {
    _VERDICT_REJECT: "red",
    _VERDICT_RESTRICTED: "amber",
    _VERDICT_STANDARD: "yellow",
    _VERDICT_ELITE: "green",
}


def _numeric(value: Any) -> Optional[float]:
    """Coerce an answer to a float, or return None when it is unscored."""
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _answer_for(mapping: Optional[dict], item_id: Any) -> Optional[float]:
    """Look up an answer by id, tolerating int/str JSON key coercion."""
    if not mapping:
        return None
    if item_id in mapping:
        return _numeric(mapping[item_id])
    text_key = str(item_id)
    if text_key in mapping:
        return _numeric(mapping[text_key])
    try:
        int_key = int(item_id)
    except (TypeError, ValueError):
        return None
    return _numeric(mapping.get(int_key))


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _status_color(verdict: str) -> str:
    return _STATUS_COLORS.get(verdict, "yellow")


def inherent_risk(score: float, max_score: float) -> dict:
    """Map a raw score onto the legacy verdict / impact / likelihood bands.

    The legacy thresholds (15 / 30 / 45 out of a maximum of 55) are applied as
    a share of ``max_score`` so the same bands hold for any scoring scale.
    """
    numeric_score = _numeric(score) or 0.0
    maximum = _numeric(max_score) or 0.0
    ratio = (numeric_score / maximum) if maximum > 0 else 0.0

    if ratio < _LOWER_CUT:
        verdict = _VERDICT_REJECT
        band = 5
    elif ratio < _MID_CUT:
        verdict = _VERDICT_RESTRICTED
        band = 4
    elif ratio < _UPPER_CUT:
        verdict = _VERDICT_STANDARD
        band = 3
    else:
        verdict = _VERDICT_ELITE
        band = 2

    vulnerability = round((1 - ratio) * 100)
    return {
        "score": numeric_score,
        "max_score": maximum,
        "verdict": verdict,
        "impact": band,
        "likelihood": band,
        "vulnerability": vulnerability,
    }


def calculate_standard(answers: dict[str, int], template: list[dict]) -> dict:
    """Score a standard TILT questionnaire (maturity answers on a 1-5 scale)."""
    answers = answers or {}

    total_weight = 0
    weighted_score = 0.0
    for question in template or []:
        value = _answer_for(answers, question.get("id"))
        if value is None:
            continue
        normalized = (6 - value) / 5
        weight = 3 if question.get("weight") == "Critical" else (2 if question.get("weight") == "High" else 1)
        weighted_score += normalized * weight
        total_weight += weight

    vulnerability = 100 if total_weight == 0 else round((weighted_score / total_weight) * 100)

    answer_values = [value for value in (_numeric(v) for v in answers.values()) if value is not None]
    if answer_values:
        average = sum(answer_values) / len(answer_values)
        impact = _clamp(6 - average / 1.2, 1, 5)
        likelihood = _clamp(6 - average / 1.2, 1, 5)
    else:
        impact = 3.0
        likelihood = 3.0

    maturity = round(100 - vulnerability, 2)
    return {
        "vulnerability": vulnerability,
        "impact": impact,
        "likelihood": likelihood,
        "maturity": maturity,
        "score": maturity,
        "max_score": 100,
        "verdict": inherent_risk(maturity, 100)["verdict"],
    }


def calculate_cloud(criteria_scores: dict[str, int], template: list[dict]) -> dict:
    """Score a cloud scorecard (maturity answers on a 0-5 scale, max 55 points)."""
    criteria_scores = criteria_scores or {}

    total_score = 0.0
    missed_critical = False
    for criterion in template or []:
        maturity = _answer_for(criteria_scores, criterion.get("id"))
        if maturity is None:
            maturity = 0.0
        points = criterion.get("points") or 0
        total_score += (maturity / 5) * points
        if criterion.get("criticality") == "Critical" and maturity == 0:
            missed_critical = True

    max_score = 55
    rounded_score = round(total_score)
    vulnerability = round((1 - (total_score / max_score)) * 100) if max_score > 0 else 100

    info = inherent_risk(rounded_score, max_score)
    verdict = _VERDICT_REJECT if missed_critical else info["verdict"]

    return {
        "score": rounded_score,
        "max_score": max_score,
        "vulnerability": vulnerability,
        "impact": info["impact"],
        "likelihood": info["likelihood"],
        "verdict": verdict,
        "status": verdict,
        "status_color": _status_color(verdict),
        "missed_critical": missed_critical,
    }
