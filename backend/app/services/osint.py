"""Open-source-intelligence checks for third-party (TILT) vendor assessments.

Ported from the legacy top-level ``osint_service`` module so the logic lives
inside the new ``app`` package.  Three best-effort checks are performed:

* ransomware leak-site membership against the public Ransomwatch JSON feed,
* SSL/TLS certificate inspection (grade and days remaining), and
* a DMARC DNS TXT-record check that walks parent domains as a fallback.

Every outbound call (HTTP or DNS) is wrapped defensively: a failure is turned
into a human-readable entry on :attr:`OsintScanResult.notes` instead of being
raised, so the module both imports and runs cleanly without network access.
When :data:`app.config.settings.osint_live_checks` is disabled (or ``live=False``
is passed explicitly) no network or DNS call is made at all.
"""

from __future__ import annotations

import socket
import ssl
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

try:  # pragma: no cover - import guard keeps the module importable everywhere
    import requests
except ImportError:  # pragma: no cover
    requests = None  # type: ignore[assignment]

try:  # pragma: no cover - dnspython is an optional runtime dependency
    import dns.resolver
except ImportError:  # pragma: no cover
    dns = None  # type: ignore[assignment]

from ..config import settings

#: Public Ransomwatch leak-site feed (same source as the legacy implementation).
RANSOMWARE_FEED_URL = "https://raw.githubusercontent.com/joshhighet/ransomwatch/main/posts.json"
#: Ransomware feed is cached for 24 hours to avoid hammering the upstream service.
RANSOMWARE_CACHE_TTL_SECONDS = 24 * 3600
#: Short-lived cache for the per-domain SSL / DMARC lookups.
CHECK_CACHE_TTL_SECONDS = 300
#: Minimum delay between outbound calls (simple rate limiting).
RATE_LIMIT_DELAY_SECONDS = 0.5

_USER_AGENT = "FinRisk-AI/2.0 (TILT OSINT)"

#: Module-level in-memory cache: ``key -> (value, monotonic_timestamp)``.
_CACHE: dict[str, tuple[Any, float]] = {}
#: Monotonic timestamp of the last outbound call, used for rate limiting.
_LAST_CALL_AT: float = 0.0


@dataclass(slots=True)
class OsintScanResult:
    """Structured outcome of a single vendor scan."""

    warnings: list[dict] = field(default_factory=list)
    urls: dict = field(default_factory=dict)
    results: dict = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)
    live_checks_enabled: bool = True


# ---------------------------------------------------------------------------
# Cache and rate limiting
# ---------------------------------------------------------------------------


def _cache_get(key: str, ttl_seconds: int) -> Optional[Any]:
    entry = _CACHE.get(key)
    if entry is None:
        return None
    value, timestamp = entry
    if time.monotonic() - timestamp < ttl_seconds:
        return value
    _CACHE.pop(key, None)
    return None


def _cache_set(key: str, value: Any) -> None:
    _CACHE[key] = (value, time.monotonic())


def _throttle() -> None:
    """Block until at least :data:`RATE_LIMIT_DELAY_SECONDS` has elapsed."""
    global _LAST_CALL_AT
    elapsed = time.monotonic() - _LAST_CALL_AT
    if elapsed < RATE_LIMIT_DELAY_SECONDS:
        time.sleep(RATE_LIMIT_DELAY_SECONDS - elapsed)
    _LAST_CALL_AT = time.monotonic()


# ---------------------------------------------------------------------------
# Ransomware leak-site check
# ---------------------------------------------------------------------------


def _fetch_ransomware_feed(notes: list[str]) -> list[dict]:
    """Return the Ransomwatch feed (24h in-memory cache); never raises."""
    cached = _cache_get("ransomware_feed", RANSOMWARE_CACHE_TTL_SECONDS)
    if cached is not None:
        return cached

    if requests is None:
        notes.append("Ransomware feed check skipped: the 'requests' library is not installed.")
        return []

    try:
        _throttle()
        response = requests.get(
            RANSOMWARE_FEED_URL,
            timeout=settings.http_timeout_seconds,
            headers={"User-Agent": _USER_AGENT},
        )
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, list):
            raise ValueError("unexpected payload shape (expected a JSON array)")
        _cache_set("ransomware_feed", data)
        return data
    except Exception as exc:  # noqa: BLE001 - any failure must degrade gracefully
        notes.append(f"Ransomware feed could not be retrieved: {exc}")
        return []


def _check_ransomware(vendor_name: str, domain: Optional[str], feed: list[dict]) -> bool:
    """Return True when the vendor appears in the ransomware leak list."""
    name = (vendor_name or "").strip().lower()
    host = (domain or "").strip().lower()
    if not name and not host:
        return False

    words = [word for word in name.split() if len(word) > 3]
    for post in feed:
        title = str(post.get("post_title") or "").lower()
        if not title:
            continue
        if name and name in title:
            return True
        if host and host in title:
            return True
        for word in words:
            if word in title:
                return True
    return False


# ---------------------------------------------------------------------------
# DMARC check
# ---------------------------------------------------------------------------


def _dmarc_candidates(domain: str) -> list[str]:
    """Return the domain and its parent domains (sub-domain fallbacks)."""
    labels = [part for part in (domain or "").strip().lower().strip(".").split(".") if part]
    candidates: list[str] = []
    while len(labels) >= 2:
        candidates.append(".".join(labels))
        labels = labels[1:]
    return candidates


def _lookup_dmarc(candidate: str, notes: list[str]) -> dict:
    """Resolve ``_dmarc.<candidate>`` and classify the published policy."""
    cache_key = f"dmarc::{candidate}"
    cached = _cache_get(cache_key, CHECK_CACHE_TTL_SECONDS)
    if cached is not None:
        return cached

    result = {"has_dmarc": False, "policy": None, "domain": candidate}
    if dns is None:
        notes.append("DMARC check skipped: the 'dnspython' library is not installed.")
        return result

    try:
        _throttle()
        answers = dns.resolver.resolve(f"_dmarc.{candidate}", "TXT")
    except Exception:
        # DNS failures (NXDOMAIN, timeout, no record) simply mean "no DMARC".
        _cache_set(cache_key, result)
        return result

    try:
        for record in answers:
            txt = "".join(str(part) for part in record.strings)
            if txt.lower().startswith("v=dmarc1"):
                lowered = txt.lower()
                if "p=reject" in lowered:
                    policy = "reject"
                elif "p=quarantine" in lowered:
                    policy = "quarantine"
                elif "p=none" in lowered:
                    policy = "none"
                else:
                    policy = "none"
                result = {"has_dmarc": True, "policy": policy, "domain": candidate}
                _cache_set(cache_key, result)
                return result
    except Exception as exc:  # noqa: BLE001
        notes.append(f"DMARC record for {candidate} could not be parsed: {exc}")

    _cache_set(cache_key, result)
    return result


def _check_dmarc(domain: str, notes: list[str]) -> dict:
    """Check DMARC for ``domain``, falling back to parent domains."""
    candidates = _dmarc_candidates(domain)
    if not candidates:
        return {"has_dmarc": False, "policy": None, "domain": domain, "checked_domains": []}

    checked: list[str] = []
    last = {"has_dmarc": False, "policy": None, "domain": domain}
    for candidate in candidates:
        checked.append(candidate)
        last = _lookup_dmarc(candidate, notes)
        if last["has_dmarc"]:
            break

    return {
        "has_dmarc": last["has_dmarc"],
        "policy": last["policy"],
        "domain": last["domain"] if last["has_dmarc"] else domain,
        "checked_domains": checked,
    }


# ---------------------------------------------------------------------------
# SSL/TLS certificate check
# ---------------------------------------------------------------------------


def _get_certificate_stats(domain: str, notes: list[str]) -> dict:
    """Inspect the leaf certificate and grade it A/B/C/F (legacy thresholds)."""
    cache_key = f"ssl::{domain}"
    cached = _cache_get(cache_key, CHECK_CACHE_TTL_SECONDS)
    if cached is not None:
        return cached

    fallback = {"valid": False, "daysRemaining": 0, "grade": "F"}
    try:
        _throttle()
        context = ssl.create_default_context()
        with socket.create_connection((domain, 443), timeout=settings.http_timeout_seconds) as sock:
            with context.wrap_socket(sock, server_hostname=domain) as secure_sock:
                cert = secure_sock.getpeercert()

        exp_str = cert.get("notAfter")
        if not exp_str:
            notes.append(f"SSL certificate for {domain} did not expose an expiry date.")
            _cache_set(cache_key, fallback)
            return fallback

        exp_date = datetime.strptime(exp_str, "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
        days_remaining = (exp_date - datetime.now(timezone.utc)).days

        if days_remaining < 7:
            grade = "F"
        elif days_remaining < 30:
            grade = "C"
        elif days_remaining < 60:
            grade = "B"
        else:
            grade = "A"

        result = {"valid": days_remaining > 0, "daysRemaining": days_remaining, "grade": grade}
        _cache_set(cache_key, result)
        return result
    except Exception as exc:  # noqa: BLE001
        notes.append(f"SSL certificate for {domain} could not be inspected: {exc}")
        _cache_set(cache_key, fallback)
        return fallback


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def scan_vendor(
    vendor_name: str,
    primary_domain: Optional[str],
    *,
    live: Optional[bool] = None,
) -> OsintScanResult:
    """Run the full OSINT scan for one vendor.

    ``live`` defaults to :data:`app.config.settings.osint_live_checks`.  When
    it resolves to ``False`` no network or DNS calls are made and the scan
    returns empty results plus an explanatory note.
    """
    live_enabled = settings.osint_live_checks if live is None else bool(live)
    urls: dict[str, Any] = {
        "vendor_name": vendor_name or "",
        "primary_domain": primary_domain or "",
    }
    results: dict[str, Any] = {"ransomware": None, "ssl": None, "dmarc": None}
    warnings: list[dict] = []
    notes: list[str] = []

    if not live_enabled:
        notes.append(
            "Live OSINT checks are disabled (OSINT_LIVE_CHECKS is false); "
            "no network or DNS calls were made."
        )
        return OsintScanResult(
            warnings=warnings,
            urls=urls,
            results=results,
            notes=notes,
            live_checks_enabled=False,
        )

    # --- ransomware leak-site membership ---------------------------------
    if vendor_name or primary_domain:
        feed = _fetch_ransomware_feed(notes)
        found = _check_ransomware(vendor_name, primary_domain, feed) if feed else False
        results["ransomware"] = found
        if found:
            warnings.append(
                {
                    "type": "ransomware",
                    "level": "critical",
                    "title": "Vendor listed in ransomware leak database",
                    "detail": (
                        f'"{vendor_name}" (domain: {primary_domain or "n/a"}) appears in the '
                        "Ransomwatch ransomware leak-site feed."
                    ),
                    "source": "Ransomwatch ransomware feed",
                }
            )

    # --- SSL/TLS certificate ---------------------------------------------
    if primary_domain:
        ssl_stats = _get_certificate_stats(primary_domain, notes)
        results["ssl"] = ssl_stats["grade"]
        results["ssl_days_remaining"] = ssl_stats["daysRemaining"]
        grade = ssl_stats["grade"]
        if grade == "F":
            warnings.append(
                {
                    "type": "ssl",
                    "level": "high",
                    "title": "SSL/TLS certificate invalid or expiring imminently",
                    "detail": (
                        f"The certificate for {primary_domain} has "
                        f"{ssl_stats['daysRemaining']} day(s) remaining (grade F)."
                    ),
                    "source": "Certificate validation",
                }
            )
        elif grade == "C":
            warnings.append(
                {
                    "type": "ssl",
                    "level": "medium",
                    "title": "SSL/TLS certificate expiring soon",
                    "detail": (
                        f"The certificate for {primary_domain} expires in "
                        f"{ssl_stats['daysRemaining']} day(s) (grade C)."
                    ),
                    "source": "Certificate validation",
                }
            )

    # --- DMARC ------------------------------------------------------------
    if primary_domain:
        dmarc = _check_dmarc(primary_domain, notes)
        results["dmarc"] = dmarc["has_dmarc"]
        results["dmarc_policy"] = dmarc.get("policy")
        urls["dmarc_checked_domains"] = dmarc.get("checked_domains", [])
        if not dmarc["has_dmarc"]:
            checked = ", ".join(dmarc.get("checked_domains") or [primary_domain])
            warnings.append(
                {
                    "type": "dmarc",
                    "level": "medium",
                    "title": "No DMARC record found",
                    "detail": (
                        f"No DMARC (anti-spoofing) TXT record was found for {primary_domain} "
                        f"(checked: {checked})."
                    ),
                    "source": "DNS TXT record check",
                }
            )

    if results["ransomware"] is None and results["ssl"] is None and results["dmarc"] is None:
        notes.append("No checks were applicable (no vendor name or primary domain supplied).")

    return OsintScanResult(
        warnings=warnings,
        urls=urls,
        results=results,
        notes=notes,
        live_checks_enabled=True,
    )
