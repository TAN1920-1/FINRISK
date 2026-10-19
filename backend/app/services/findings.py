"""Finding-level helpers shared by the vulnerability router and the seeder.

The context-aware priority is computed here so that a finding created by the
API and one created by the demonstration seeder carry exactly the same score
built by exactly the same code.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Asset, Vulnerability, VulnerabilityFinding
from ..scoring.risk_scoring import compute_finding_priority
from .intelligence import normalise_cve_id


def recompute_priority(
    db: Session, finding: VulnerabilityFinding, asset: Optional[Asset]
) -> None:
    """Recompute and persist the context-aware priority for one finding.

    Cached upstream intelligence (CVSS/EPSS/KEV) is used when it is available;
    when it is not, the missing factors are simply omitted from the score rather
    than being invented.  The caller owns the commit.
    """
    intel = None
    if finding.vulnerability_id:
        intel = db.get(Vulnerability, finding.vulnerability_id)
    elif normalise_cve_id(finding.cve_id):
        intel = db.execute(
            select(Vulnerability).where(Vulnerability.cve_id == normalise_cve_id(finding.cve_id))
        ).scalar_one_or_none()

    result = compute_finding_priority(
        cvss_score=finding.cvss_score,
        exploit_evidence=finding.exploit_evidence,
        kev_listed=bool(intel.kev_listed) if intel else False,
        epss_score=intel.epss_score if intel else None,
        internet_exposed=finding.internet_exposed,
        asset_criticality=asset.criticality if asset else None,
        asset_data_sensitivity=asset.data_sensitivity if asset else None,
        vulnerability_age_days=finding.vulnerability_age_days,
        has_compensating_controls=bool(finding.compensating_controls),
    )
    finding.priority_score = result.score
    finding.priority_band = result.band
    finding.priority_factors = [factor.model_dump() for factor in result.factors]
