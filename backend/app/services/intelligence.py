"""Upstream cybersecurity intelligence clients: NVD, CISA KEV and FIRST EPSS.

Design rules (these are what keep the module honest and safe to run offline):

* every network call is **timeout bounded** and wrapped: a failure produces a
  warning string, never an exception that breaks a user-facing request;
* responses are **cached** in the ``vulnerabilities`` table with a TTL from
  :mod:`app.config`, and the KEV catalogue is additionally cached in memory;
* nothing is ever invented: a field that could not be retrieved stays ``None``
  and the reason is reported in ``warnings``;
* lookups are read-only enrichment.  The module performs no scanning, no
  exploitation and no authentication attempts against third-party systems.
"""

from __future__ import annotations

import re
import threading
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Optional

import requests
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Vulnerability, VulnerabilityFinding, as_utc, utcnow
from ..schemas import CveLookupOut

CVE_PATTERN = re.compile(r"^CVE-\d{4}-\d{4,7}$", re.IGNORECASE)
EPSS_API_URL = "https://api.first.org/data/v1/epss"

_KEV_LOCK = threading.Lock()
_KEV_CACHE: dict[str, Any] = {"fetched_at": None, "by_cve": {}, "warnings": []}


def normalise_cve_id(value: Optional[str]) -> Optional[str]:
    """Return a canonical ``CVE-YYYY-NNNN`` identifier, or ``None``."""
    if not value:
        return None
    candidate = value.strip().upper()
    return candidate if CVE_PATTERN.match(candidate) else None


def _cache_is_fresh(fetched_at: Optional[datetime]) -> bool:
    reference = as_utc(fetched_at)
    if reference is None:
        return False
    ttl = timedelta(hours=settings.vulnerability_cache_ttl_hours)
    return utcnow() - reference < ttl


# ---------------------------------------------------------------------------
# CISA Known Exploited Vulnerabilities catalogue
# ---------------------------------------------------------------------------


def kev_catalog(*, force: bool = False) -> tuple[dict[str, dict], list[str]]:
    """Return ``({cve_id: entry}, warnings)`` for the CISA KEV catalogue."""
    with _KEV_LOCK:
        if not force and _KEV_CACHE["by_cve"] and _cache_is_fresh(_KEV_CACHE["fetched_at"]):
            return _KEV_CACHE["by_cve"], list(_KEV_CACHE["warnings"])

    warnings: list[str] = []
    by_cve: dict[str, dict] = {}
    try:
        response = requests.get(settings.kev_feed_url, timeout=settings.http_timeout_seconds)
        response.raise_for_status()
        payload = response.json()
        for item in payload.get("vulnerabilities", []) or []:
            identifier = normalise_cve_id(item.get("cveID"))
            if identifier:
                by_cve[identifier] = {
                    "dueDate": item.get("dueDate"),
                    "requiredAction": item.get("requiredAction"),
                    "vendorProject": item.get("vendorProject"),
                    "product": item.get("product"),
                    "knownRansomwareCampaignUse": item.get("knownRansomwareCampaignUse"),
                }
    except Exception as exc:  # noqa: BLE001 - degraded mode is expected
        warnings.append(f"CISA KEV catalogue is currently unavailable ({type(exc).__name__}).")

    with _KEV_LOCK:
        if by_cve:
            _KEV_CACHE.update({"fetched_at": utcnow(), "by_cve": by_cve, "warnings": warnings})
        return _KEV_CACHE["by_cve"], (warnings or list(_KEV_CACHE["warnings"]))


# ---------------------------------------------------------------------------
# NVD and EPSS
# ---------------------------------------------------------------------------


def _nvd_lookup(cve_id: str) -> tuple[dict[str, Any], list[str]]:
    warnings: list[str] = []
    headers = {}
    if settings.nvd_api_key:
        headers["apiKey"] = settings.nvd_api_key
    try:
        response = requests.get(
            settings.nvd_base_url,
            params={"cveId": cve_id},
            headers=headers,
            timeout=settings.http_timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"NVD lookup failed ({type(exc).__name__}).")
        return {}, warnings

    entries = payload.get("vulnerabilities") or []
    if not entries:
        warnings.append("NVD returned no record for this identifier.")
        return {}, warnings

    cve = entries[0].get("cve", {})
    result: dict[str, Any] = {
        "description": next(
            (item.get("value") for item in cve.get("descriptions", []) if item.get("lang") == "en"),
            None,
        ),
        "published_at": _parse_timestamp(cve.get("published")),
        "last_modified_at": _parse_timestamp(cve.get("lastModified")),
        "references": [
            {"url": ref.get("url"), "source": ref.get("source"), "tags": ref.get("tags")}
            for ref in cve.get("references", []) or []
        ][:25],
        "weaknesses": [
            entry.get("value")
            for weakness in cve.get("weaknesses", []) or []
            for entry in weakness.get("description", []) or []
        ][:25],
    }

    metrics = cve.get("metrics", {}) or {}
    for key in ("cvssMetricV31", "cvssMetricV30", "cvssMetricV2"):
        candidates = metrics.get(key) or []
        if candidates:
            data = candidates[0].get("cvssData", {}) or {}
            result["cvss_score"] = data.get("baseScore")
            result["cvss_severity"] = data.get("baseSeverity") or candidates[0].get("baseSeverity")
            result["cvss_vector"] = data.get("vectorString")
            break
    else:
        warnings.append("NVD record contains no CVSS metrics.")

    return result, warnings


def _epss_lookup(cve_id: str) -> tuple[Optional[float], Optional[float], list[str]]:
    try:
        response = requests.get(
            EPSS_API_URL, params={"cve": cve_id}, timeout=settings.http_timeout_seconds
        )
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:  # noqa: BLE001
        return None, None, [f"EPSS lookup failed ({type(exc).__name__})."]

    rows = payload.get("data") or []
    if not rows:
        return None, None, ["EPSS has no score for this identifier."]
    try:
        return float(rows[0].get("epss")), float(rows[0].get("percentile")), []
    except (TypeError, ValueError):
        return None, None, ["EPSS returned an unreadable score."]


def _parse_timestamp(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    for pattern in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(value.replace("Z", ""), pattern)
        except ValueError:
            continue
    return None


def _parse_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Persisted cache
# ---------------------------------------------------------------------------


def _stored_cve(db: Session, cve_id: str) -> Optional[Vulnerability]:
    return db.execute(select(Vulnerability).where(Vulnerability.cve_id == cve_id)).scalar_one_or_none()


def lookup_cve(db: Session, cve_id: str, *, refresh: bool = False) -> CveLookupOut:
    """Return NVD/KEV/EPSS context for a CVE, using the database as a cache.

    A cached row younger than ``vulnerability_cache_ttl_hours`` is returned
    as-is unless ``refresh`` is set.  When upstream services are unavailable the
    stale row (if any) is returned together with explicit warnings.
    """
    identifier = normalise_cve_id(cve_id)
    if identifier is None:
        return CveLookupOut(
            cve_id=cve_id,
            source="invalid",
            cached=False,
            warnings=["Not a valid CVE identifier (expected CVE-YYYY-NNNN)."],
        )

    stored = _stored_cve(db, identifier)
    if stored is not None and not refresh and _cache_is_fresh(stored.fetched_at):
        return _to_out(stored, cached=True, warnings=[])

    warnings: list[str] = []
    data, nvd_warnings = _nvd_lookup(identifier)
    warnings.extend(nvd_warnings)

    kev_by_cve, kev_warnings = kev_catalog()
    warnings.extend(kev_warnings)
    kev_entry = kev_by_cve.get(identifier)

    epss_score, epss_percentile, epss_warnings = _epss_lookup(identifier)
    warnings.extend(epss_warnings)

    if stored is None:
        stored = Vulnerability(cve_id=identifier, source="nvd")
        db.add(stored)

    if data:
        stored.description = data.get("description")
        stored.published_at = data.get("published_at")
        stored.last_modified_at = data.get("last_modified_at")
        stored.cvss_score = data.get("cvss_score")
        stored.cvss_severity = data.get("cvss_severity")
        stored.cvss_vector = data.get("cvss_vector")
        stored.references = data.get("references")
        stored.weaknesses = data.get("weaknesses")
    if kev_entry:
        stored.kev_listed = True
        stored.kev_due_date = _parse_date(kev_entry.get("dueDate"))
        stored.kev_required_action = kev_entry.get("requiredAction")
    if epss_score is not None:
        stored.epss_score = epss_score
        stored.epss_percentile = epss_percentile
    stored.fetched_at = utcnow()
    db.flush()

    if not data and stored.description is None:
        warnings.append(
            "No upstream record was retrieved and no cached record exists; only the identifier is stored."
        )

    return _to_out(stored, cached=False, warnings=warnings)


def _to_out(record: Vulnerability, *, cached: bool, warnings: list[str]) -> CveLookupOut:
    return CveLookupOut(
        cve_id=record.cve_id,
        source=record.source,
        cached=cached,
        description=record.description,
        published_at=record.published_at,
        cvss_score=record.cvss_score,
        cvss_severity=record.cvss_severity,
        cvss_vector=record.cvss_vector,
        epss_score=record.epss_score,
        kev_listed=record.kev_listed,
        kev_due_date=record.kev_due_date,
        kev_required_action=record.kev_required_action,
        references=record.references or [],
        weaknesses=record.weaknesses or [],
        warnings=warnings,
    )


# ---------------------------------------------------------------------------
# Offline enrichment of findings
# ---------------------------------------------------------------------------


@dataclass
class FindingIntel:
    """Everything the priority engine needs, from cached rows only."""

    cvss_score: Optional[float] = None
    cvss_severity: Optional[str] = None
    kev_listed: bool = False
    epss_score: Optional[float] = None
    vulnerability_id: Optional[int] = None
    notes: list[str] = field(default_factory=list)


def cached_intel_for(db: Session, cve_id: Optional[str]) -> FindingIntel:
    """Read enrichment from the local cache without touching the network."""
    identifier = normalise_cve_id(cve_id)
    if identifier is None:
        return FindingIntel()
    stored = _stored_cve(db, identifier)
    if stored is None:
        return FindingIntel(notes=["No cached intelligence for this CVE; run a lookup to enrich it."])
    return FindingIntel(
        cvss_score=stored.cvss_score,
        cvss_severity=stored.cvss_severity,
        kev_listed=stored.kev_listed,
        epss_score=stored.epss_score,
        vulnerability_id=stored.id,
    )


def apply_intel_to_finding(db: Session, finding: VulnerabilityFinding) -> list[str]:
    """Copy cached CVSS/KEV/EPSS values onto a finding.  Never hits the network."""
    intel = cached_intel_for(db, finding.cve_id)
    if intel.cvss_score is not None:
        finding.cvss_score = intel.cvss_score
        finding.cvss_severity = intel.cvss_severity
    if intel.vulnerability_id is not None:
        finding.vulnerability_id = intel.vulnerability_id
    return intel.notes
