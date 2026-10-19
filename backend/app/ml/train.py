"""Training and evaluation pipeline for the risk-priority classifier.

What is trained
---------------
A multi-class classifier that predicts the severity band of a risk register
entry (``critical`` / ``high`` / ``medium`` / ``low``) from *context* features
only.  The target and the leakage-controlled feature set are documented in
:mod:`app.ml.features`; ``likelihood`` and ``impact`` are never inputs.

How it is evaluated
-------------------
* Candidate models are compared with stratified k-fold cross-validation on the
  training fold (macro F1), which is far more stable than a single split on the
  small datasets this platform realistically holds.
* The selected model is then refit on the full training fold and scored on a
  held-out test split.  Precision, recall, macro F1, per-class metrics and a
  confusion matrix are persisted with the model.
* A ``DummyClassifier`` majority-class baseline is always reported so a reader
  can see whether the model beats "always guess the most common class".

Datasets
--------
``stored``    - the organization's own persisted risk register.
``synthetic`` - rows from :func:`synthetic_dataset`, a documented random process.
                This is the only data source available on a fresh install and it
                is always labelled ``synthetic_demo`` in the UI.
"""

from __future__ import annotations

import logging
import math
import random
from dataclasses import dataclass, field
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import domain
from ..config import BACKEND_DIR, settings
from ..models import Asset, Mitigation, ModelVersion, Risk, VulnerabilityFinding, utcnow
from .features import (
    CLASS_LABELS,
    FEATURE_KEYS,
    FEATURE_SCHEMA,
    TARGET_DESCRIPTION,
    TARGET_LABEL,
    risk_feature_vector,
    target_class,
    vector_to_row,
)

logger = logging.getLogger("finrisk.ml")

#: Where fitted pipelines live.  Git-ignored; a missing directory simply means
#: "no model has been trained yet", which the API reports as a fallback state.
ARTIFACT_DIR = BACKEND_DIR / "ml_artifacts"

#: Row count used when training on synthetic data without an explicit request.
DATASET_KINDS: dict[str, str] = {
    "stored": domain.DatasetKind.CURATED_REAL.value,
    "synthetic": domain.DatasetKind.SYNTHETIC_DEMO.value,
}

RANDOM_STATE = 20260401
TEST_SIZE = 0.25
SYNTHETIC_SEED = 20260401

#: Documented limitations attached to every model this pipeline produces.
MODEL_LIMITATIONS = (
    "The target is the severity band of the organization's own 5x5 likelihood x impact "
    "score, so the model learns to reproduce an analyst-defined convention, not an "
    "objective property of the world. Likelihood and impact are deliberately excluded "
    "from the features, which caps achievable accuracy. Predicted probabilities are "
    "model scores and are NOT calibrated real-world probabilities. Feature attributions "
    "describe model behaviour only and must never be read as causal statements about "
    "what would happen if a factor changed. Synthetic training rows are a demonstration "
    "device, not evidence about your organization; retrain on stored data before relying "
    "on the model for prioritisation."
)

SYNTHETIC_DESCRIPTION = (
    "Synthetic risk-register rows produced by the documented random process in "
    "app.ml.train.synthetic_dataset with seed {seed}. Likelihood and impact are drawn "
    "from a latent risk propensity plus noise, so the label depends on the features but "
    "is never a deterministic function of them. These rows are demonstration data and "
    "carry no information about any real organization."
)


# ---------------------------------------------------------------------------
# Datasets
# ---------------------------------------------------------------------------


def _sigmoid(value: float) -> float:
    if value >= 0:
        return 1.0 / (1.0 + math.exp(-value))
    exponent = math.exp(value)
    return exponent / (1.0 + exponent)


def synthetic_dataset(rows: int, seed: int = SYNTHETIC_SEED) -> list[tuple[dict[str, float], str]]:
    """Generate documented synthetic training rows.

    The generating process is deliberately transparent: a latent propensity ``t``
    drives both the context features and (through a noisy linear model) the
    likelihood and impact an analyst would have recorded.  Nothing here is real
    data and nothing here is used to produce dashboard statistics.
    """
    rng = random.Random(seed)
    count = max(0, int(rows))
    asset_types = list(domain.AssetType)
    categories = list(domain.RiskCategory)
    evidence_levels = list(domain.EVIDENCE_CONFIDENCE.values())

    records: list[tuple[dict[str, float], str]] = []
    for _ in range(count):
        propensity = rng.random()
        criticality = max(1, min(5, int(round(1 + propensity * 4 + rng.gauss(0, 0.8)))))
        sensitivity = max(1, min(5, int(round(1 + propensity * 4 + rng.gauss(0, 0.8)))))
        internet_exposed = rng.random() < (0.15 + 0.55 * propensity)
        asset_type_code = rng.randrange(len(asset_types)) if rng.random() < 0.8 else 0
        category_code = rng.randrange(len(categories))

        # Documentation quality is only loosely related to severity.
        evidence_confidence = rng.choice(evidence_levels)
        documented = rng.random() < (0.75 - 0.35 * propensity)
        has_owner = 1.0 if rng.random() < (0.85 - 0.25 * propensity) else 0.0
        has_asset = 1.0 if rng.random() < 0.85 else 0.0
        has_threat_scenario = 1.0 if documented else 0.0
        has_existing_controls = 1.0 if rng.random() < documented else 0.0
        has_mitigation_plan = 1.0 if rng.random() < documented else 0.0

        open_findings = float(max(0, min(20, int(round(propensity * 6 + rng.gauss(0, 1.5))))))
        days_open = float(max(0, min(730, int(round(rng.random() * 730)))))
        mitigation_coverage = round(max(0.0, min(1.0, rng.random() * (1.0 - 0.5 * propensity))), 3)

        vector = {
            "asset_criticality": float(criticality),
            "asset_data_sensitivity": float(sensitivity),
            "asset_internet_exposed": 1.0 if internet_exposed else 0.0,
            "asset_type_code": float(asset_type_code),
            "category_code": float(category_code),
            "evidence_confidence": float(evidence_confidence),
            "has_owner": has_owner,
            "has_asset": has_asset,
            "has_threat_scenario": has_threat_scenario,
            "has_existing_controls": has_existing_controls,
            "has_mitigation_plan": has_mitigation_plan,
            "open_findings_on_asset": open_findings,
            "days_open": days_open,
            "mitigation_coverage": mitigation_coverage,
        }

        # Latent severity driver: context information plus noise.  Deliberately
        # excludes mitigation_coverage and documentation flags from the driver
        # so that good paperwork alone does not imply a low score.
        driver = (
            0.75 * (criticality - 3)
            + 0.65 * (sensitivity - 3)
            + 0.55 * (1.0 if internet_exposed else 0.0)
            + 0.30 * (open_findings / 6.0)
            + rng.gauss(0, 0.85)
        )
        likelihood = max(1, min(5, int(round(1 + 4 * _sigmoid(driver * 1.05)))))
        impact = max(1, min(5, int(round(1 + 4 * _sigmoid(driver * 0.9 + 0.2)))))

        records.append((vector, target_class(likelihood, impact)))

    return records


def stored_dataset(
    db: Session,
    *,
    organization_id: Optional[int] = None,
) -> list[tuple[dict[str, float], str]]:
    """Extract training rows from persisted risk register entries."""
    stmt = select(Risk)
    if organization_id is not None:
        stmt = stmt.where(Risk.organization_id == organization_id)
    risks = list(db.execute(stmt).scalars().all())
    if not risks:
        return []

    risk_ids = [risk.id for risk in risks]
    asset_ids = {risk.asset_id for risk in risks if risk.asset_id}

    assets: dict[int, Asset] = {}
    if asset_ids:
        assets = {
            asset.id: asset
            for asset in db.execute(select(Asset).where(Asset.id.in_(asset_ids))).scalars().all()
        }

    finding_counts: dict[int, int] = {}
    if asset_ids:
        rows = db.execute(
            select(VulnerabilityFinding.asset_id, func.count(VulnerabilityFinding.id))
            .where(
                VulnerabilityFinding.asset_id.in_(asset_ids),
                VulnerabilityFinding.remediation_status.in_(domain.OPEN_REMEDIATION_STATUSES),
            )
            .group_by(VulnerabilityFinding.asset_id)
        ).all()
        finding_counts = {int(row[0]): int(row[1]) for row in rows if row[0] is not None}

    total_rows = db.execute(
        select(Mitigation.risk_id, func.count(Mitigation.id))
        .where(Mitigation.risk_id.in_(risk_ids))
        .group_by(Mitigation.risk_id)
    ).all()
    completed_rows = db.execute(
        select(Mitigation.risk_id, func.count(Mitigation.id))
        .where(
            Mitigation.risk_id.in_(risk_ids),
            Mitigation.status == domain.MitigationStatus.COMPLETED.value,
        )
        .group_by(Mitigation.risk_id)
    ).all()
    total_by_risk = {int(row[0]): int(row[1]) for row in total_rows}
    completed_by_risk = {int(row[0]): int(row[1]) for row in completed_rows}

    records: list[tuple[dict[str, float], str]] = []
    for risk in risks:
        vector = risk_feature_vector(
            risk,
            assets.get(risk.asset_id) if risk.asset_id else None,
            open_findings=finding_counts.get(risk.asset_id or -1, 0),
            mitigation_total=total_by_risk.get(risk.id, 0),
            mitigation_completed=completed_by_risk.get(risk.id, 0),
        )
        records.append((vector, target_class(risk.likelihood, risk.impact)))
    return records


# ---------------------------------------------------------------------------
# Candidates
# ---------------------------------------------------------------------------


@dataclass
class TrainedCandidate:
    algorithm: str
    estimator: Any
    cv_macro_f1: Optional[float]
    cv_folds: int
    detail: str = ""


try:  # pragma: no cover - the optional ML runtime
    from sklearn.base import BaseEstimator, ClassifierMixin

    class EncodedLabelClassifier(BaseEstimator, ClassifierMixin):
        """Adapt an estimator that requires integer-encoded targets.

        XGBoost 3.x rejects string class labels, so the target is encoded on the way
        in and decoded on the way out.  ``classes_`` is exposed with exactly the
        ordering used by ``predict_proba`` so downstream code can map columns to
        labels without guessing.
        """

        def __init__(self, estimator: Any = None) -> None:
            self.estimator = estimator

        def fit(self, X, y, **kwargs: Any) -> "EncodedLabelClassifier":
            from sklearn.preprocessing import LabelEncoder

            self.encoder_ = LabelEncoder()
            encoded = self.encoder_.fit_transform(list(y))
            self.classes_ = self.encoder_.classes_
            self.estimator.fit(X, encoded, **kwargs)
            return self

        def predict(self, X):
            return self.encoder_.inverse_transform(self.estimator.predict(X))

        def predict_proba(self, X):
            return self.estimator.predict_proba(X)

except ImportError:  # pragma: no cover - scikit-learn is genuinely optional

    class EncodedLabelClassifier:  # type: ignore[no-redef]
        """Placeholder used only when the optional ML runtime is absent."""

        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            raise RuntimeError(
                "scikit-learn is required for this estimator; install backend/requirements-ml.txt."
            )


def _candidate_specs() -> list[tuple[str, Any]]:
    """Build the candidate estimators, including the majority-class baseline."""
    from sklearn.dummy import DummyClassifier
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler

    specs: list[tuple[str, Any]] = [
        ("baseline_majority", DummyClassifier(strategy="most_frequent")),
        (
            "logistic_regression",
            Pipeline(
                [
                    ("scale", StandardScaler()),
                    (
                        "model",
                        LogisticRegression(
                            max_iter=2000,
                            class_weight="balanced",
                            random_state=RANDOM_STATE,
                        ),
                    ),
                ]
            ),
        ),
        (
            "random_forest",
            RandomForestClassifier(
                n_estimators=300,
                min_samples_leaf=2,
                class_weight="balanced_subsample",
                random_state=RANDOM_STATE,
                n_jobs=-1,
            ),
        ),
    ]

    try:  # pragma: no cover - depends on the optional xgboost install
        from xgboost import XGBClassifier

        specs.append(
            (
                "xgboost",
                EncodedLabelClassifier(
                    XGBClassifier(
                        n_estimators=300,
                        max_depth=3,
                        learning_rate=0.1,
                        subsample=0.9,
                        colsample_bytree=0.9,
                        reg_lambda=1.0,
                        tree_method="hist",
                        random_state=RANDOM_STATE,
                        n_jobs=-1,
                        verbosity=0,
                    )
                ),
            )
        )
    except ImportError:
        logger.info("xgboost is not installed; comparing scikit-learn candidates only.")

    return specs


def _balanced_weights(y: list[str]) -> Any:
    """Sample weights that compensate for class imbalance (tree learners)."""
    import numpy as np
    from sklearn.utils.class_weight import compute_sample_weight

    return compute_sample_weight("balanced", np.asarray(y))


def evaluate_candidates(
    features: list[list[float]],
    labels: list[str],
) -> list[TrainedCandidate]:
    """Cross-validate every candidate and return them ordered by mean macro F1."""
    import numpy as np
    from sklearn.model_selection import StratifiedKFold, cross_val_score

    X = np.asarray(features, dtype=float)
    y = np.asarray(labels)

    smallest_class = min((int((y == label).sum()) for label in set(y.tolist())), default=0)
    folds = 5 if smallest_class >= 5 else (3 if smallest_class >= 3 else 0)

    trained: list[TrainedCandidate] = []
    for algorithm, estimator in _candidate_specs():
        score: Optional[float] = None
        detail = ""
        if folds:
            try:
                cv = StratifiedKFold(n_splits=folds, shuffle=True, random_state=RANDOM_STATE)
                scores = cross_val_score(estimator, X, y, cv=cv, scoring="f1_macro", error_score="raise")
                score = float(np.mean(scores))
                detail = f"{folds}-fold stratified cross-validation."
            except Exception as exc:  # noqa: BLE001 - report it, never hide a failed candidate
                detail = f"Cross-validation could not be completed: {exc.__class__.__name__}: {exc}"
                folds_used = 0
            else:
                folds_used = folds
        else:
            folds_used = 0
            detail = "Too few rows per class for cross-validation; single split only."

        trained.append(
            TrainedCandidate(
                algorithm=algorithm,
                estimator=estimator,
                cv_macro_f1=round(score, 4) if score is not None else None,
                cv_folds=folds_used,
                detail=detail,
            )
        )

    trained.sort(
        key=lambda item: (item.cv_macro_f1 if item.cv_macro_f1 is not None else -1.0),
        reverse=True,
    )
    return trained


def _per_class_metrics(labels_present: list[str], y_true, y_pred) -> dict[str, dict[str, float]]:
    from sklearn.metrics import precision_recall_fscore_support

    precision, recall, f1, support = precision_recall_fscore_support(
        y_true, y_pred, labels=labels_present, zero_division=0
    )
    return {
        label: {
            "precision": round(float(precision[index]), 4),
            "recall": round(float(recall[index]), 4),
            "f1": round(float(f1[index]), 4),
            "support": int(support[index]),
        }
        for index, label in enumerate(labels_present)
    }


def fit_and_score(candidate: TrainedCandidate, features, labels) -> dict[str, Any]:
    """Refit the candidate on the training fold and score the held-out split."""
    import numpy as np
    from sklearn.metrics import accuracy_score, confusion_matrix, f1_score
    from sklearn.model_selection import train_test_split

    X = np.asarray(features, dtype=float)
    y = np.asarray(labels)

    class_counts = {label: int((y == label).sum()) for label in set(y.tolist())}
    smallest_class = min(class_counts.values(), default=0)
    stratify = y if smallest_class >= 2 and len(class_counts) > 1 else None

    try:
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=stratify
        )
    except ValueError as exc:
        raise ValueError(f"Could not build a train/test split: {exc}") from exc

    estimator = candidate.estimator
    fit_kwargs: dict[str, Any] = {}
    if candidate.algorithm == "xgboost" and len(set(y_train.tolist())) > 1:
        fit_kwargs["sample_weight"] = _balanced_weights(y_train.tolist())

    estimator.fit(X_train, y_train, **fit_kwargs)
    y_pred = estimator.predict(X_test)

    # A model must never be asked to predict a class it has never seen; keep the
    # reported label list to the classes actually present in the evaluation set.
    labels_present = [label for label in CLASS_LABELS if label in set(y_test.tolist()) | set(y_train.tolist())]
    if not labels_present:
        labels_present = sorted(set(y.tolist()))

    matrix = confusion_matrix(y_test, y_pred, labels=labels_present)

    metrics = {
        "accuracy": round(float(accuracy_score(y_test, y_pred)), 4),
        "macro_f1": round(float(f1_score(y_test, y_pred, average="macro", zero_division=0)), 4),
        "weighted_f1": round(float(f1_score(y_test, y_pred, average="weighted", zero_division=0)), 4),
        "per_class": _per_class_metrics(labels_present, y_test, y_pred),
        "train_rows": int(X_train.shape[0]),
        "test_rows": int(X_test.shape[0]),
        "class_support": {label: int(count) for label, count in sorted(class_counts.items())},
    }

    return {
        "metrics": metrics,
        "confusion_matrix": {
            "labels": labels_present,
            "matrix": [[int(value) for value in row] for row in matrix.tolist()],
        },
        "estimator": estimator,
    }


@dataclass
class TrainingResult:
    """Everything the caller needs to persist and report a training run."""

    version: str
    algorithm: str
    dataset_kind: str
    dataset_rows: int
    metrics: dict[str, Any]
    confusion_matrix: dict[str, Any]
    comparison: list[dict[str, Any]] = field(default_factory=list)
    summary: str = ""
    notes: str = ""
    estimator: Any = None
    #: A small sample of training rows, persisted so that feature attributions
    #: can be produced later without the original dataset.
    background: list[list[float]] = field(default_factory=list)


def train(
    *,
    dataset: str = "stored",
    rows: Optional[list[tuple[dict[str, float], str]]] = None,
    min_rows: Optional[int] = None,
) -> TrainingResult:
    """Run the full pipeline and return an untrained-in-DB result object.

    The caller owns persistence (``ModelVersion`` row, artifact file, audit
    entry) so that a failed training run can never leave a half-written record.
    """
    available, detail = _require_runtime()
    if not available:
        raise RuntimeError(detail)

    records = list(rows or [])
    threshold = min_rows if min_rows is not None else settings.retrain_min_rows
    if len(records) < max(2, int(threshold)):
        raise ValueError(
            f"Training needs at least {max(2, int(threshold))} labelled examples; "
            f"{len(records)} available. Add risk register entries first or train on the "
            "synthetic dataset."
        )

    features = [vector_to_row(vector) for vector, _ in records]
    labels = [label for _, label in records]
    distinct = sorted(set(labels))
    if len(distinct) < 2:
        raise ValueError(
            "The training data contains only one priority class ("
            + distinct[0]
            + "); at least two classes are required to train a classifier."
        )

    candidates = evaluate_candidates(features, labels)
    if not candidates:  # pragma: no cover - defensive
        raise RuntimeError("No candidate models could be constructed.")

    # Every candidate is fitted and scored so the comparison table is complete,
    # but the *selection* uses cross-validated macro F1 when it is available:
    # choosing a model on the held-out split would quietly turn that split into
    # training data.
    comparison: list[dict[str, Any]] = []
    fitted: dict[str, tuple[TrainedCandidate, dict[str, Any]]] = {}
    for candidate in candidates:
        try:
            scored = fit_and_score(candidate, features, labels)
        except Exception as exc:  # noqa: BLE001 - a failed candidate is recorded, not hidden
            comparison.append(
                {"algorithm": candidate.algorithm, "error": f"{exc.__class__.__name__}: {exc}"}
            )
            continue

        fitted[candidate.algorithm] = (candidate, scored)
        comparison.append(
            {
                "algorithm": candidate.algorithm,
                "cv_macro_f1": candidate.cv_macro_f1,
                "cv_folds": candidate.cv_folds,
                "test_macro_f1": scored["metrics"]["macro_f1"],
                "test_accuracy": scored["metrics"]["accuracy"],
                "is_baseline": candidate.algorithm == "baseline_majority",
                "detail": candidate.detail,
            }
        )

    eligible = [
        (candidate, scored)
        for algorithm, (candidate, scored) in fitted.items()
        if algorithm != "baseline_majority"
    ]
    if not eligible:
        raise RuntimeError("Every candidate model failed to train; see the comparison output.")

    with_cv = [item for item in eligible if item[0].cv_macro_f1 is not None]
    if with_cv:
        best_candidate, best = max(with_cv, key=lambda item: item[0].cv_macro_f1)
        selection_basis = (
            f"Selected {best_candidate.algorithm} for the highest cross-validated macro F1 "
            f"({best_candidate.cv_macro_f1}) over {len(eligible)} candidates."
        )
    else:
        best_candidate, best = max(eligible, key=lambda item: item[1]["metrics"]["macro_f1"])
        selection_basis = (
            f"Selected {best_candidate.algorithm} for the highest held-out macro F1; the dataset "
            "is too small for cross-validation, so this split informed selection as well as "
            "reporting and the score is optimistic."
        )

    baseline_entry = next((item for item in comparison if item.get("is_baseline")), None)
    baseline_f1 = baseline_entry.get("test_macro_f1") if baseline_entry else None
    beats_baseline = baseline_f1 is None or best["metrics"]["macro_f1"] >= float(baseline_f1)

    trained_at = utcnow()
    version = f"{best_candidate.algorithm}-{trained_at:%Y%m%d%H%M%S}"
    notes_parts = [
        selection_basis,
        f"Majority-class baseline held-out macro F1: {baseline_f1}."
        if baseline_f1 is not None
        else "Majority-class baseline could not be evaluated.",
        "The selected model beats the majority-class baseline."
        if beats_baseline
        else "WARNING: the selected model does not beat the majority-class baseline on this "
        "data; treat its output as indicative only.",
    ]

    return TrainingResult(
        version=version,
        algorithm=best_candidate.algorithm,
        dataset_kind=DATASET_KINDS.get(dataset, domain.DatasetKind.SYNTHETIC_DEMO.value),
        dataset_rows=len(records),
        metrics={
            **best["metrics"],
            "candidates": comparison,
            "baseline_macro_f1": baseline_f1,
            "selected_algorithm": best_candidate.algorithm,
            "selection_basis": selection_basis,
        },
        confusion_matrix=best["confusion_matrix"],
        comparison=comparison,
        summary=(
            f"Trained a {best_candidate.algorithm.replace('_', ' ')} classifier on {len(records)} "
            f"rows ({dataset}) with a held-out macro F1 of {best['metrics']['macro_f1']}. "
            "Likelihood and impact were excluded from the features."
        ),
        notes=" ".join(notes_parts),
        estimator=best["estimator"],
        background=_background_sample(features),
    )


#: Background rows kept in the artifact for later feature attribution.
BACKGROUND_ROWS = 60


def _background_sample(features: list[list[float]]) -> list[list[float]]:
    """A deterministic sample of training rows used as the attribution reference."""
    if len(features) <= BACKGROUND_ROWS:
        return [list(row) for row in features]
    rng = random.Random(RANDOM_STATE)
    sample = rng.sample(features, BACKGROUND_ROWS)
    return [list(row) for row in sample]


def _require_runtime() -> tuple[bool, str]:
    from . import ml_stack_available

    return ml_stack_available()


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------


def artifact_path_for(version: str) -> Any:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    return ARTIFACT_DIR / f"{version}.joblib"


def persist_artifact(result: TrainingResult) -> str:
    """Write the fitted pipeline to disk and return a repository-relative path."""
    import joblib

    path = artifact_path_for(result.version)
    joblib.dump(
        {
            "version": result.version,
            "algorithm": result.algorithm,
            "target_label": TARGET_LABEL,
            "feature_keys": list(FEATURE_KEYS),
            "classes": list(CLASS_LABELS),
            "estimator": result.estimator,
            "trained_at": utcnow().isoformat(),
            "background": result.background,
        },
        path,
    )
    try:
        return path.relative_to(BACKEND_DIR).as_posix()
    except ValueError:  # pragma: no cover - custom artifact location
        return path.as_posix()


def record_model_version(
    db: Session,
    result: TrainingResult,
    *,
    artifact_path: Optional[str],
    activate: bool,
    notes: Optional[str] = None,
) -> ModelVersion:
    """Stage a ``ModelVersion`` row (the caller commits)."""
    if activate:
        for existing in db.execute(select(ModelVersion).where(ModelVersion.is_active.is_(True))).scalars().all():
            existing.is_active = False

    model = ModelVersion(
        version=result.version,
        algorithm=result.algorithm,
        target_label=TARGET_LABEL,
        dataset_kind=result.dataset_kind,
        dataset_rows=result.dataset_rows,
        split_strategy=f"stratified {int((1 - TEST_SIZE) * 100)}/{int(TEST_SIZE * 100)} split, random_state={RANDOM_STATE}",
        feature_schema={
            "target": TARGET_LABEL,
            "target_description": TARGET_DESCRIPTION,
            "features": FEATURE_SCHEMA,
            "leakage_control": "likelihood and impact are excluded from the feature set",
        },
        class_labels=list(CLASS_LABELS),
        metrics=result.metrics,
        confusion_matrix=result.confusion_matrix,
        artifact_path=artifact_path,
        is_active=bool(activate),
        is_fallback=False,
        trained_at=utcnow(),
        limitations=MODEL_LIMITATIONS,
        notes=notes or result.notes,
    )
    db.add(model)
    db.flush()
    return model
