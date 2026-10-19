"""Inference and explanation for the risk-priority classifier.

Honesty rules enforced here
---------------------------
* A prediction is **never** returned on its own: the deterministic rule-based
  class is always computed and reported next to it, along with whether the two
  agree.  A human decides.
* Feature attributions explain *model behaviour*.  They are never described as
  causal, and every response says so.
* Probabilities are model scores.  They are reported as such and explicitly
  flagged as uncalibrated.
* When no trained model is active (or its artifact is missing) the platform
  falls back to the documented rule-based classification and says
  ``used_fallback=true`` rather than inventing a prediction.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import domain
from ..config import BACKEND_DIR
from ..models import Asset, Mitigation, ModelPrediction, ModelVersion, Risk, VulnerabilityFinding, User
from ..schemas import FeatureContribution, PredictionOut
from ..scoring.risk_scoring import rule_based_priority_class
from .features import FEATURE_KEYS, FEATURE_LABELS, risk_feature_vector, target_class, vector_to_row

logger = logging.getLogger("finrisk.ml")

#: Reported when the platform is answering from the deterministic matrix.
FALLBACK_VERSION = "rules-only"
FALLBACK_ALGORITHM = "rule_based_matrix"
FALLBACK_ARTIFACT = "none"

#: Severity ordinals used to express an attribution as "effect on risk".
_SEVERITY_ORDINAL = {
    domain.Severity.LOW.value: 1.0,
    domain.Severity.MEDIUM.value: 2.0,
    domain.Severity.HIGH.value: 3.0,
    domain.Severity.CRITICAL.value: 4.0,
}

MAX_RECOMMENDATIONS = 5

#: Documented bounds for each feature, used to validate and clamp incoming values.
FEATURE_BOUNDS: dict[str, tuple[float, float]] = {
    "asset_criticality": (1.0, 5.0),
    "asset_data_sensitivity": (1.0, 5.0),
    "asset_internet_exposed": (0.0, 1.0),
    "asset_type_code": (0.0, float(len(domain.AssetType) - 1)),
    "category_code": (0.0, float(len(domain.RiskCategory) - 1)),
    "evidence_confidence": (0.0, 1.0),
    "has_owner": (0.0, 1.0),
    "has_asset": (0.0, 1.0),
    "has_threat_scenario": (0.0, 1.0),
    "has_existing_controls": (0.0, 1.0),
    "has_mitigation_plan": (0.0, 1.0),
    "open_findings_on_asset": (0.0, 20.0),
    "days_open": (0.0, 730.0),
    "mitigation_coverage": (0.0, 1.0),
}

_BUNDLE_CACHE: dict[tuple[str, str, float], dict[str, Any]] = {}


# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------


def active_model(db: Session) -> Optional[ModelVersion]:
    """The model the platform should be using, if any."""
    return db.execute(
        select(ModelVersion)
        .where(ModelVersion.is_active.is_(True))
        .order_by(ModelVersion.trained_at.desc(), ModelVersion.id.desc())
    ).scalars().first()


def resolve_artifact(model_row: ModelVersion) -> Optional[Path]:
    if not model_row.artifact_path:
        return None
    candidate = Path(model_row.artifact_path)
    if not candidate.is_absolute():
        candidate = BACKEND_DIR / candidate
    return candidate


def load_bundle(model_row: Optional[ModelVersion]) -> tuple[Optional[dict[str, Any]], list[str]]:
    """Load the persisted pipeline, returning ``(bundle, warnings)``.

    A missing file, an unreadable file or an artifact trained with a different
    feature schema all degrade to ``(None, warnings)`` so the caller can fall
    back to the rules instead of failing the request.
    """
    if model_row is None:
        return None, []
    if model_row.is_fallback:
        return None, [
            f"Model {model_row.version} is registered as a rules-only fallback; there is no "
            "artifact to load."
        ]

    path = resolve_artifact(model_row)
    if path is None or not path.exists():
        return None, [
            f"The artifact for model {model_row.version} is not present at "
            f"{model_row.artifact_path or 'an unrecorded path'}; the rule-based classification "
            "is being used instead."
        ]

    try:
        stat = path.stat()
        key = (model_row.version, str(path), stat.st_mtime)
        cached = _BUNDLE_CACHE.get(key)
        if cached is not None:
            bundle = cached
        else:
            import joblib

            bundle = joblib.load(path)
            if not isinstance(bundle, dict) or "estimator" not in bundle:
                return None, [
                    f"The artifact for model {model_row.version} is not a FinRisk pipeline; the "
                    "rule-based classification is being used instead."
                ]
            _BUNDLE_CACHE.clear()
            _BUNDLE_CACHE[key] = bundle
    except ImportError as exc:
        return None, [
            "The optional machine-learning runtime needed to load the model is unavailable "
            f"({exc}); the rule-based classification is being used instead."
        ]
    except Exception as exc:  # noqa: BLE001 - any load failure must degrade, not 500
        logger.warning("Could not load model artifact %s: %s", path, exc)
        return None, [
            f"The artifact for model {model_row.version} could not be loaded ({exc.__class__.__name__}); "
            "the rule-based classification is being used instead."
        ]

    stored_keys = list(bundle.get("feature_keys") or [])
    if stored_keys and stored_keys != list(FEATURE_KEYS):
        return None, [
            f"Model {model_row.version} was trained against a different feature schema "
            f"({len(stored_keys)} features) than this build expects ({len(FEATURE_KEYS)}); the "
            "rule-based classification is being used instead. Retrain the model."
        ]

    return bundle, []


# ---------------------------------------------------------------------------
# Feature validation
# ---------------------------------------------------------------------------


def validate_vector(vector: dict[str, Any]) -> tuple[list[float], dict[str, float], list[str]]:
    """Clamp and normalise an incoming feature vector.

    Missing keys fall back to a documented neutral value and every adjustment is
    reported as a warning, so an incomplete request is visible rather than
    silently scored as if it were complete.
    """
    warnings: list[str] = []
    normalised: dict[str, float] = {}
    missing: list[str] = []
    adjusted: list[str] = []

    for key in FEATURE_KEYS:
        low, high = FEATURE_BOUNDS.get(key, (0.0, float("inf")))
        if key not in vector or vector[key] is None:
            missing.append(key)
            normalised[key] = 0.0
            continue
        try:
            value = float(vector[key])
        except (TypeError, ValueError):
            adjusted.append(key)
            normalised[key] = 0.0
            continue
        if value != value or value in (float("inf"), float("-inf")):  # NaN / infinity
            adjusted.append(key)
            normalised[key] = 0.0
            continue
        clamped = max(low, min(high, value))
        if clamped != value:
            adjusted.append(key)
        normalised[key] = float(clamped)

    if missing:
        warnings.append(
            "The following features were not supplied and were treated as zero: "
            + ", ".join(FEATURE_LABELS.get(key, key) for key in missing)
            + ". The prediction is correspondingly less reliable."
        )
    if adjusted:
        warnings.append(
            "The following features were outside their documented range and were clamped: "
            + ", ".join(FEATURE_LABELS.get(key, key) for key in adjusted)
            + "."
        )

    return vector_to_row(normalised), normalised, warnings


# ---------------------------------------------------------------------------
# Attribution
# ---------------------------------------------------------------------------


def _median_background(bundle: dict[str, Any]) -> list[list[float]]:
    background = bundle.get("background") or []
    rows: list[list[float]] = []
    for row in background:
        try:
            values = [float(value) for value in row]
        except (TypeError, ValueError):
            continue
        if len(values) == len(FEATURE_KEYS):
            rows.append(values)
    if rows:
        return rows
    # No background recorded (model trained before this feature existed): use a
    # documented neutral vector so attributions remain available and explainable.
    return [[0.0] * len(FEATURE_KEYS)]


def _column_medians(background: list[list[float]]) -> list[float]:
    columns: list[float] = []
    for index in range(len(FEATURE_KEYS)):
        values = sorted(row[index] for row in background)
        columns.append(values[len(values) // 2] if values else 0.0)
    return columns


def _severity_expectation(probabilities: list[float], classes: list[str]) -> float:
    total = sum(probabilities) or 1.0
    return sum(
        (_SEVERITY_ORDINAL.get(str(label), 2.0) * float(probability))
        for label, probability in zip(classes, probabilities)
    ) / total


def _perturbation_attributions(
    estimator: Any,
    row: list[float],
    medians: list[float],
) -> list[float]:
    """Attribution = change in the model's expected severity when a feature is reset.

    Equivalent in spirit to a permutation explanation: every feature is set to
    the training median in turn and the resulting expected severity (severity
    ordinals 1-4 weighted by the predicted class probabilities) is compared with
    the actual value.  Positive means "this value pushes the model towards a
    more severe class".  It describes model behaviour, not causation.
    """
    import numpy as np

    classes = [str(label) for label in estimator.classes_]
    baseline = _severity_expectation(list(estimator.predict_proba(np.asarray([row]))[0]), classes)

    contributions: list[float] = []
    for index in range(len(row)):
        perturbed = list(row)
        perturbed[index] = medians[index] if medians else 0.0
        probabilities = list(estimator.predict_proba(np.asarray([perturbed]))[0])
        contributions.append(round(baseline - _severity_expectation(probabilities, classes), 4))
    return contributions


def _shap_attributions(
    estimator: Any,
    row: list[float],
    background: list[list[float]],
    predicted_class: str,
) -> Optional[list[float]]:
    """SHAP attributions for the predicted class, or ``None`` if unavailable.

    Any failure (missing package, unsupported estimator, unexpected output
    shape) returns ``None`` so the caller can use the built-in method; a
    prediction is never lost because an explainer could not be built.
    """
    try:
        import numpy as np
        import shap
    except ImportError:
        return None

    try:
        classes = [str(label) for label in estimator.classes_]
        if predicted_class not in classes:
            return None
        class_index = classes.index(predicted_class)

        explainer = shap.Explainer(
            lambda data: estimator.predict_proba(np.asarray(data)),
            shap.maskers.Independent(np.asarray(background, dtype=float)),
        )
        values = explainer(np.asarray([row], dtype=float))
        raw = np.asarray(getattr(values, "values", values), dtype=float)
        if raw.ndim == 3:
            per_feature = raw[0, :, class_index]
        elif raw.ndim == 2:
            per_feature = raw[0, :]
        else:
            return None
        if per_feature.shape[0] != len(FEATURE_KEYS):
            return None

        # A positive SHAP value means "pushed towards the predicted class"; its
        # risk direction therefore depends on which class was predicted.
        sign = 1.0 if predicted_class in (domain.Severity.CRITICAL.value, domain.Severity.HIGH.value) else -1.0
        return [round(float(value) * sign, 4) for value in per_feature]
    except Exception as exc:  # noqa: BLE001 - explanation must never break inference
        logger.info("SHAP explanation unavailable (%s); using the built-in attribution.", exc)
        return None


def build_explanation(
    estimator: Any,
    bundle: dict[str, Any],
    row: list[float],
    values: dict[str, float],
    predicted_class: str,
) -> tuple[list[FeatureContribution], dict[str, Any]]:
    """Return ``(contributions, explanation_metadata)`` for one prediction."""
    background = _median_background(bundle)
    medians = _column_medians(background)

    method = "built_in_perturbation"
    contributions_values = _shap_attributions(estimator, row, background, predicted_class)
    if contributions_values is not None:
        method = "shap"
    else:
        try:
            contributions_values = _perturbation_attributions(estimator, row, medians)
        except Exception as exc:  # noqa: BLE001 - attribution is best-effort
            logger.info("Built-in attribution failed (%s); returning the prediction without it.", exc)
            return [], {
                "method": "unavailable",
                "disclaimer": "Feature attribution could not be computed for this model.",
            }

    threshold = 1e-4
    contributions: list[FeatureContribution] = []
    for index, key in enumerate(FEATURE_KEYS):
        value = contributions_values[index]
        if value > threshold:
            direction = "increases_risk"
        elif value < -threshold:
            direction = "reduces_risk"
        else:
            direction = "neutral"
        contributions.append(
            FeatureContribution(
                key=key,
                label=FEATURE_LABELS.get(key, key),
                value=values.get(key),
                contribution=round(float(value), 4),
                direction=direction,
            )
        )

    contributions.sort(key=lambda item: abs(item.contribution), reverse=True)

    explanation = {
        "method": method,
        "target": bundle.get("target_label"),
        "scales": {
            "shap": "log-odds contribution to the predicted class",
            "built_in_perturbation": "change in expected severity (ordinal 1-4) when reset to the training median",
        }.get(method),
        "disclaimer": (
            "Feature attributions describe how this model behaved on this input. They are not "
            "causal statements: they do not mean that changing the factor would change the real "
            "risk by that amount, and they say nothing about the true drivers of risk."
        ),
    }
    return contributions, explanation


# ---------------------------------------------------------------------------
# Recommendations
# ---------------------------------------------------------------------------


def build_recommendations(values: dict[str, float]) -> list[str]:
    """Deterministic, evidence-linked next steps derived from the feature values."""
    items: list[str] = []
    if values.get("has_owner", 1.0) < 0.5:
        items.append("Assign an accountable owner to this risk so remediation has a named driver.")
    if values.get("has_asset", 1.0) < 0.5:
        items.append("Link the risk to a registered asset to make exposure calculations and reporting possible.")
    if values.get("has_threat_scenario", 1.0) < 0.5:
        items.append("Document the threat scenario so the likelihood rating can be reviewed against concrete evidence.")
    if values.get("has_existing_controls", 1.0) < 0.5:
        items.append("Record the controls that are already in place; unrecorded controls are invisible to reviewers.")
    if values.get("open_findings_on_asset", 0.0) > 0:
        items.append(
            f"Remediate or formally accept the {int(values['open_findings_on_asset'])} open vulnerability "
            "finding(s) on the linked asset."
        )
    if values.get("asset_internet_exposed", 0.0) >= 0.5:
        items.append("Confirm that compensating controls are in place for the internet-facing asset.")
    if values.get("evidence_confidence", 1.0) < 0.9:
        items.append("Strengthen the supporting evidence; the current evidence quality lowers confidence in this rating.")
    if values.get("mitigation_coverage", 1.0) <= 0.0:
        items.append("Create a mitigation plan with at least one tracked action.")
    if values.get("days_open", 0.0) > 365:
        items.append(
            f"Review this risk: it has been open for {int(values['days_open'])} days, beyond a typical annual cycle."
        )
    return items[:MAX_RECOMMENDATIONS]


# ---------------------------------------------------------------------------
# Prediction
# ---------------------------------------------------------------------------


@dataclass
class PredictionReport:
    """A prediction plus the audit row the caller should persist with it."""

    prediction: PredictionOut
    record: Optional[ModelPrediction] = None
    warnings: list[str] = field(default_factory=list)


def _base_warnings(dataset_kind: Optional[str]) -> list[str]:
    warnings = [
        "This is decision support, not a verdict. Review it against the rule-based classification "
        "and your own judgement before acting.",
        "Reported probabilities are model scores and are not calibrated real-world probabilities.",
        "Feature attributions describe model behaviour and are not causal.",
    ]
    if dataset_kind == domain.DatasetKind.SYNTHETIC_DEMO.value:
        warnings.append(
            "The active model was trained on synthetic demonstration rows, so its outputs say nothing "
            "about your organization. Retrain on stored data once the register has enough history."
        )
    return warnings


def predict_vector(
    db: Session,
    vector: dict[str, Any],
    *,
    rule_class: Optional[str] = None,
    rule_source: Optional[tuple[Optional[int], Optional[int], Optional[str]]] = None,
    risk_id: Optional[int] = None,
    organization_id: Optional[int] = None,
    requested_by_id: Optional[int] = None,
    persist: bool = False,
) -> PredictionReport:
    """Predict the priority class for one feature vector.

    ``rule_source`` is ``(likelihood, impact, evidence_quality)`` when the vector
    came from a stored risk; it is used to compute the rule-based comparison.
    When it is omitted the caller must supply ``rule_class`` directly.
    """
    if rule_class is None:
        likelihood, impact, evidence = rule_source or (None, None, None)
        rule_class = rule_based_priority_class(likelihood, impact, evidence)
    else:
        likelihood, impact, evidence = rule_source or (None, None, None)

    row, values, warnings = validate_vector(vector)
    model_row = active_model(db)
    bundle, load_warnings = load_bundle(model_row)
    warnings = list(warnings) + list(load_warnings)

    if bundle is None:
        prediction = PredictionOut(
            predicted_class=rule_class,
            rule_based_class=rule_class,
            agrees_with_rules=True,
            used_fallback=True,
            confidence=None,
            confidence_is_calibrated=False,
            class_probabilities={},
            model_version=FALLBACK_VERSION,
            algorithm=FALLBACK_ALGORITHM,
            dataset_kind=domain.DatasetKind.SYNTHETIC_DEMO.value,
            contributions=[],
            increasing_factors=[],
            reducing_factors=[],
            recommendations=build_recommendations(values),
            warnings=[
                "No trained model is active, so the documented rule-based classification "
                "(likelihood x impact) is being reported in its place."
            ]
            + warnings
            + _base_warnings(None),
            feature_values=values,
            risk_id=risk_id,
        )
        return PredictionReport(
            prediction=prediction,
            record=_stage_record(
                db,
                prediction,
                model_row=None,
                explanation=None,
                likelihood=likelihood,
                impact=impact,
                organization_id=organization_id,
                requested_by_id=requested_by_id,
                risk_id=risk_id,
                persist=persist,
            ),
            warnings=prediction.warnings,
        )

    estimator = bundle["estimator"]
    try:
        import numpy as np

        probabilities = list(estimator.predict_proba(np.asarray([row], dtype=float))[0])
        classes = [str(label) for label in estimator.classes_]
    except Exception as exc:  # noqa: BLE001 - inference failure must degrade, not 500
        logger.warning("Model inference failed (%s); falling back to the rules.", exc)
        note = (
            f"The active model {bundle.get('version')} could not score this input "
            f"({exc.__class__.__name__}); the rule-based classification is being reported instead."
        )
        prediction = PredictionOut(
            predicted_class=rule_class,
            rule_based_class=rule_class,
            agrees_with_rules=True,
            used_fallback=True,
            confidence=None,
            confidence_is_calibrated=False,
            class_probabilities={},
            model_version=str(bundle.get("version") or FALLBACK_VERSION),
            algorithm=str(bundle.get("algorithm") or FALLBACK_ALGORITHM),
            dataset_kind=model_row.dataset_kind if model_row else domain.DatasetKind.SYNTHETIC_DEMO.value,
            contributions=[],
            increasing_factors=[],
            reducing_factors=[],
            recommendations=build_recommendations(values),
            warnings=[note] + warnings + _base_warnings(model_row.dataset_kind if model_row else None),
            feature_values=values,
            risk_id=risk_id,
        )
        return PredictionReport(
            prediction=prediction,
            record=_stage_record(
                db,
                prediction,
                model_row=model_row,
                explanation={"method": "unavailable", "error": exc.__class__.__name__},
                likelihood=likelihood,
                impact=impact,
                organization_id=organization_id,
                requested_by_id=requested_by_id,
                risk_id=risk_id,
                persist=persist,
            ),
            warnings=prediction.warnings,
        )

    probability_map = {label: round(float(value), 4) for label, value in zip(classes, probabilities)}
    best_index = max(range(len(probabilities)), key=lambda index: probabilities[index])
    predicted_class = classes[best_index]
    confidence = round(float(probabilities[best_index]), 4)

    contributions, explanation = build_explanation(estimator, bundle, row, values, predicted_class)

    prediction = PredictionOut(
        predicted_class=predicted_class,
        rule_based_class=rule_class,
        agrees_with_rules=predicted_class == rule_class,
        used_fallback=False,
        confidence=confidence,
        confidence_is_calibrated=False,
        class_probabilities=probability_map,
        model_version=str(bundle.get("version") or (model_row.version if model_row else FALLBACK_VERSION)),
        algorithm=str(bundle.get("algorithm") or (model_row.algorithm if model_row else FALLBACK_ALGORITHM)),
        dataset_kind=model_row.dataset_kind if model_row else domain.DatasetKind.SYNTHETIC_DEMO.value,
        contributions=contributions,
        increasing_factors=[item.label for item in contributions if item.direction == "increases_risk"][:3],
        reducing_factors=[item.label for item in contributions if item.direction == "reduces_risk"][:3],
        recommendations=build_recommendations(values),
        warnings=warnings + _base_warnings(model_row.dataset_kind if model_row else None),
        feature_values=values,
        risk_id=risk_id,
    )

    if not prediction.agrees_with_rules:
        prediction.warnings.append(
            f"The model predicts '{predicted_class}' while the rule-based matrix implies "
            f"'{rule_class}'. Both are shown so the difference can be reviewed rather than "
            "silently resolved."
        )

    return PredictionReport(
        prediction=prediction,
        record=_stage_record(
            db,
            prediction,
            model_row=model_row,
            explanation=explanation,
            likelihood=likelihood,
            impact=impact,
            organization_id=organization_id,
            requested_by_id=requested_by_id,
            risk_id=risk_id,
            persist=persist,
        ),
        warnings=prediction.warnings,
    )


def _stage_record(
    db: Session,
    prediction: PredictionOut,
    *,
    model_row: Optional[ModelVersion],
    explanation: Optional[dict[str, Any]],
    likelihood: Optional[int],
    impact: Optional[int],
    organization_id: Optional[int],
    requested_by_id: Optional[int],
    risk_id: Optional[int],
    persist: bool,
) -> Optional[ModelPrediction]:
    """Stage (but do not commit) the prediction audit row."""
    if not persist or organization_id is None:
        return None

    record = ModelPrediction(
        organization_id=organization_id,
        risk_id=risk_id,
        model_version_id=model_row.id if model_row else None,
        requested_by_id=requested_by_id,
        predicted_class=prediction.predicted_class,
        rule_based_class=prediction.rule_based_class,
        used_fallback=prediction.used_fallback,
        confidence=prediction.confidence,
        class_probabilities=prediction.class_probabilities,
        explanation=explanation,
        feature_values=prediction.feature_values,
        recommendations=prediction.recommendations,
        warnings=prediction.warnings,
    )
    db.add(record)
    return record


# ---------------------------------------------------------------------------
# Convenience: predict for a stored risk
# ---------------------------------------------------------------------------


def predict_risk(
    db: Session,
    risk: Risk,
    *,
    organization_id: int,
    requested_by: Optional[User] = None,
    persist: bool = True,
) -> PredictionReport:
    """Build the feature vector for a stored risk and predict its class."""
    asset: Optional[Asset] = db.get(Asset, risk.asset_id) if risk.asset_id else None

    open_findings = 0
    if risk.asset_id:
        open_findings = int(
            db.execute(
                select(func.count(VulnerabilityFinding.id)).where(
                    VulnerabilityFinding.asset_id == risk.asset_id,
                    VulnerabilityFinding.remediation_status.in_(domain.OPEN_REMEDIATION_STATUSES),
                )
            ).scalar_one()
        )

    totals = db.execute(
        select(Mitigation.status, func.count(Mitigation.id))
        .where(Mitigation.risk_id == risk.id)
        .group_by(Mitigation.status)
    ).all()
    mitigation_total = sum(int(row[1]) for row in totals)
    mitigation_completed = sum(
        int(row[1]) for row in totals if row[0] == domain.MitigationStatus.COMPLETED.value
    )

    vector = risk_feature_vector(
        risk,
        asset,
        open_findings=open_findings,
        mitigation_total=mitigation_total,
        mitigation_completed=mitigation_completed,
    )

    report = predict_vector(
        db,
        vector,
        rule_source=(risk.likelihood, risk.impact, risk.evidence_quality),
        risk_id=risk.id,
        organization_id=organization_id,
        requested_by_id=requested_by.id if requested_by else None,
        persist=persist,
    )
    return report


def vector_from_risk(db: Session, risk: Risk) -> dict[str, float]:
    """Expose the raw feature vector for a stored risk (used by the API)."""
    asset: Optional[Asset] = db.get(Asset, risk.asset_id) if risk.asset_id else None
    open_findings = 0
    if risk.asset_id:
        open_findings = int(
            db.execute(
                select(func.count(VulnerabilityFinding.id)).where(
                    VulnerabilityFinding.asset_id == risk.asset_id,
                    VulnerabilityFinding.remediation_status.in_(domain.OPEN_REMEDIATION_STATUSES),
                )
            ).scalar_one()
        )
    totals = db.execute(
        select(Mitigation.status, func.count(Mitigation.id))
        .where(Mitigation.risk_id == risk.id)
        .group_by(Mitigation.status)
    ).all()
    mitigation_total = sum(int(row[1]) for row in totals)
    mitigation_completed = sum(
        int(row[1]) for row in totals if row[0] == domain.MitigationStatus.COMPLETED.value
    )
    return risk_feature_vector(
        risk,
        asset,
        open_findings=open_findings,
        mitigation_total=mitigation_total,
        mitigation_completed=mitigation_completed,
    )


def current_label(risk: Risk) -> str:
    """The rule-based label for a stored risk (documented target definition)."""
    return target_class(risk.likelihood, risk.impact)
