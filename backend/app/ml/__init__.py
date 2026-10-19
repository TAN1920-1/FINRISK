"""Machine-learning layer.

The only model in this application predicts a **risk-priority class**
(``critical`` / ``high`` / ``medium`` / ``low``) from *context* features.  The
target is the severity band of the risk register's own inherent score
(``likelihood x impact``); the feature set deliberately excludes likelihood and
impact so the model cannot simply read the answer off the label definition.

Nothing in this package is causal.  A prediction is decision support that is
always shown next to the deterministic rule-based classification so a human can
compare the two and disagree.
"""

from __future__ import annotations

#: Required for training and inference.  Everything else in the application runs
#: without these, falling back to the documented rule-based classification.
CORE_PACKAGES: tuple[str, ...] = ("numpy", "sklearn", "joblib")

#: Optional accelerators.  When absent the platform substitutes scikit-learn
#: ensembles and its own permutation attribution, and says so in the response.
OPTIONAL_PACKAGES: tuple[str, ...] = ("xgboost", "shap")


def _missing(packages: tuple[str, ...]) -> list[str]:
    missing: list[str] = []
    for name in packages:
        try:
            __import__(name)
        except ImportError:  # pragma: no cover - depends on the deployment
            missing.append(name)
    return missing


def ml_stack_available() -> tuple[bool, str]:
    """Return ``(available, detail)`` for the optional scikit-learn runtime."""
    missing = _missing(CORE_PACKAGES)
    if missing:
        return False, (
            "The optional machine-learning runtime is not installed (missing: "
            + ", ".join(missing)
            + "). Install backend/requirements-ml.txt to enable training; "
            "predictions fall back to the documented rule-based classification."
        )
    return True, "scikit-learn runtime available."


def optional_runtime() -> dict[str, bool]:
    """Report which optional ML accelerators are importable."""
    return {name: not _missing((name,)) for name in OPTIONAL_PACKAGES}


__all__ = ["CORE_PACKAGES", "OPTIONAL_PACKAGES", "ml_stack_available", "optional_runtime"]
