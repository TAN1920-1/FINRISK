"""Demonstration data seeder (development and demonstration use only).

Everything created here is **synthetic**.  It is clearly labelled as such in
three places:

* the organization name says "synthetic demo" and its slug is ``finrisk-demo``;
* every row carries ``is_demo = True`` (see :class:`app.models.DemoMixin`);
* the run is written to the audit trail as ``demo_data.seeded``.

The seeder is *idempotent*: the demo organization is looked up by slug, so
running the command twice adds nothing the second time.  It refuses to run at
all when ``demo_data_enabled`` is false, which the settings layer forces in any
``production`` environment.

The purpose of this data is to make the platform's own screens, reports and
calculations demonstrable on a fresh install.  It is **not** evidence about any
real organization and it is never used to produce a statistic presented as real.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import domain
from ..audit import record_audit
from ..config import settings
from ..models import (
    Asset,
    FinancialScenario,
    Membership,
    Mitigation,
    Notification,
    Organization,
    Risk,
    User,
    VulnerabilityFinding,
    utcnow,
)
from ..security import hash_password
from .findings import recompute_priority

logger = logging.getLogger("finrisk.demo")

DEMO_ORGANIZATION_SLUG = "finrisk-demo"
DEMO_ORGANIZATION_NAME = "Northwind Financial Group (synthetic demo)"

BUSINESS_UNITS = ("Retail Banking", "Wealth Management", "Payments", "Corporate IT")

#: Demonstration colleagues.  Ownership fields (asset owner, risk owner and
#: remediation assignee) reference real accounts, so this team is created up
#: front with fixed addresses that the sample CSVs can also name in
#: ``owner_email``.  They share the administrator's password so a demonstration
#: can sign in as any of them and show role-specific views.
TEAM: tuple[dict[str, str], ...] = (
    {
        "email": "security.lead@finrisk-demo.com",
        "name": "Priya Raghavan",
        "role": domain.Role.RISK_MANAGER.value,
        "job_title": "Head of Security Risk",
    },
    {
        "email": "platform.sre@finrisk-demo.com",
        "name": "Marcus Lindqvist",
        "role": domain.Role.ANALYST.value,
        "job_title": "Platform Reliability Lead",
    },
    {
        "email": "payments.lead@finrisk-demo.com",
        "name": "Aisha Bello",
        "role": domain.Role.ANALYST.value,
        "job_title": "Payments Operations Manager",
    },
    {
        "email": "grc.analyst@finrisk-demo.com",
        "name": "Tomas Nowak",
        "role": domain.Role.ANALYST.value,
        "job_title": "Governance, Risk and Compliance Analyst",
    },
    {
        "email": "engineering.lead@finrisk-demo.com",
        "name": "Hannah Osei",
        "role": domain.Role.ANALYST.value,
        "job_title": "Engineering Manager",
    },
)

#: Assets the demo register is built around.  Deterministic, so two runs on two
#: machines produce the same register.
ASSETS: tuple[dict[str, Any], ...] = (
    {
        "ref": "AST-0001",
        "name": "Customer Banking Portal",
        "asset_type": domain.AssetType.APPLICATION.value,
        "environment": domain.Environment.PRODUCTION.value,
        "business_unit": "Retail Banking",
        "criticality": 5,
        "data_sensitivity": 5,
        "internet_exposed": True,
        "financial_importance": "4200000.00",
        "existing_controls": "WAF in blocking mode, quarterly external penetration test, MFA for staff, 24x7 SOC monitoring.",
    },
    {
        "ref": "AST-0002",
        "name": "Core Payments Switch",
        "asset_type": domain.AssetType.APPLICATION.value,
        "environment": domain.Environment.PRODUCTION.value,
        "business_unit": "Payments",
        "criticality": 5,
        "data_sensitivity": 4,
        "internet_exposed": False,
        "financial_importance": "7800000.00",
        "existing_controls": "Network segmentation, change approval board, dual control on settlement keys.",
    },
    {
        "ref": "AST-0003",
        "name": "Customer Data Warehouse",
        "asset_type": domain.AssetType.DATABASE.value,
        "environment": domain.Environment.PRODUCTION.value,
        "business_unit": "Corporate IT",
        "criticality": 5,
        "data_sensitivity": 5,
        "internet_exposed": False,
        "financial_importance": "3100000.00",
        "existing_controls": "Encryption at rest, row-level access controls, quarterly access review.",
    },
    {
        "ref": "AST-0004",
        "name": "Wealth Adviser Workspace",
        "asset_type": domain.AssetType.APPLICATION.value,
        "environment": domain.Environment.PRODUCTION.value,
        "business_unit": "Wealth Management",
        "criticality": 4,
        "data_sensitivity": 4,
        "internet_exposed": True,
        "financial_importance": "1250000.00",
        "existing_controls": "SSO with phishing-resistant MFA, device compliance checks.",
    },
    {
        "ref": "AST-0005",
        "name": "Third-Party Market Data Feed",
        "asset_type": domain.AssetType.THIRD_PARTY_SERVICE.value,
        "environment": domain.Environment.PRODUCTION.value,
        "business_unit": "Wealth Management",
        "criticality": 3,
        "data_sensitivity": 2,
        "internet_exposed": True,
        "financial_importance": "400000.00",
        "existing_controls": "Contractual SLA, annual vendor security review.",
    },
    {
        "ref": "AST-0006",
        "name": "Corporate Identity Provider",
        "asset_type": domain.AssetType.IDENTITY.value,
        "environment": domain.Environment.CORPORATE.value,
        "business_unit": "Corporate IT",
        "criticality": 5,
        "data_sensitivity": 3,
        "internet_exposed": True,
        "financial_importance": "2200000.00",
        "existing_controls": "Conditional access, privileged access workstations, break-glass accounts audited monthly.",
    },
    {
        "ref": "AST-0007",
        "name": "Branch Network Backbone",
        "asset_type": domain.AssetType.NETWORK.value,
        "environment": domain.Environment.PRODUCTION.value,
        "business_unit": "Retail Banking",
        "criticality": 4,
        "data_sensitivity": 2,
        "internet_exposed": False,
        "financial_importance": "900000.00",
        "existing_controls": "Redundant links, out-of-band management, firmware baseline monitoring.",
    },
)

#: The demo register.  ``residual`` is only set where an analyst would plausibly
#: have recorded post-mitigation values; elsewhere it stays ``None`` so that the
#: reports page can be seen refusing to invent a residual score.
RISKS: tuple[dict[str, Any], ...] = (
    {
        "ref": "RSK-0001",
        "title": "Unpatched internet-facing web tier on the customer portal",
        "category": domain.RiskCategory.CYBERSECURITY.value,
        "asset_ref": "AST-0001",
        "business_unit": "Retail Banking",
        "likelihood": 4,
        "impact": 5,
        "status": domain.RiskStatus.IN_PROGRESS.value,
        "evidence_quality": domain.EvidenceQuality.HIGH.value,
        "due_in_days": 30,
        "threat_scenario": "An attacker exploits a known remote code execution flaw in the portal's web framework to gain a foothold in the production subnet.",
        "existing_controls": "WAF rules updated monthly; vulnerability scanning weekly.",
        "mitigation_plan": "Move to a two-week patch SLA for internet-facing components and add virtual patching.",
        "financial_impact_assumptions": "Assumes 60 hours of portal downtime at peak trading and mandatory customer notification.",
        "residual": (3, 5),
    },
    {
        "ref": "RSK-0002",
        "title": "Ransomware encryption of the customer data warehouse",
        "category": domain.RiskCategory.CYBERSECURITY.value,
        "asset_ref": "AST-0003",
        "business_unit": "Corporate IT",
        "likelihood": 3,
        "impact": 5,
        "status": domain.RiskStatus.MITIGATION_PLANNED.value,
        "evidence_quality": domain.EvidenceQuality.MEDIUM.value,
        "due_in_days": 60,
        "threat_scenario": "Credential theft through phishing leads to domain-wide encryption, halting regulatory reporting.",
        "existing_controls": "Immutable nightly backups, endpoint detection and response on servers.",
        "mitigation_plan": "Extend EDR to the database estate and rehearse restore from immutable backups.",
        "financial_impact_assumptions": "Assumes four days of degraded reporting and external forensics.",
        "residual": None,
    },
    {
        "ref": "RSK-0003",
        "title": "Payment switch outage during settlement window",
        "category": domain.RiskCategory.BUSINESS_CONTINUITY.value,
        "asset_ref": "AST-0002",
        "business_unit": "Payments",
        "likelihood": 2,
        "impact": 5,
        "status": domain.RiskStatus.UNDER_ASSESSMENT.value,
        "evidence_quality": domain.EvidenceQuality.MEDIUM.value,
        "due_in_days": 90,
        "threat_scenario": "A failed change to the switch takes settlement offline beyond the recovery time objective.",
        "existing_controls": "Dual-site active/passive failover, tested quarterly.",
        "mitigation_plan": "Automate failover testing and reduce the change window.",
        "financial_impact_assumptions": "Assumes two hours of failed settlement with manual reconciliation.",
        "residual": None,
    },
    {
        "ref": "RSK-0004",
        "title": "Insider misuse of privileged identity access",
        "category": domain.RiskCategory.OPERATIONAL.value,
        "asset_ref": "AST-0006",
        "business_unit": "Corporate IT",
        "likelihood": 3,
        "impact": 4,
        "status": domain.RiskStatus.IDENTIFIED.value,
        "evidence_quality": domain.EvidenceQuality.LOW.value,
        "due_in_days": 120,
        "threat_scenario": "A departing administrator retains a break-glass credential and uses it after leaving.",
        "existing_controls": "Monthly access review; break-glass accounts audited.",
        "mitigation_plan": "Introduce just-in-time privileged access with session recording.",
        "financial_impact_assumptions": "Assumes forensic investigation and forced rotation of all privileged secrets.",
        "residual": None,
    },
    {
        "ref": "RSK-0005",
        "title": "Concentration risk in a single market-data provider",
        "category": domain.RiskCategory.THIRD_PARTY.value,
        "asset_ref": "AST-0005",
        "business_unit": "Wealth Management",
        "likelihood": 2,
        "impact": 3,
        "status": domain.RiskStatus.ACCEPTED.value,
        "evidence_quality": domain.EvidenceQuality.HIGH.value,
        "due_in_days": None,
        "threat_scenario": "The provider suffers a prolonged outage and adviser pricing becomes unavailable.",
        "existing_controls": "Manual price override procedure documented.",
        "mitigation_plan": "None planned; risk accepted by the CIO with a review in twelve months.",
        "financial_impact_assumptions": "Assumes degraded service rather than a hard outage.",
        "residual": (2, 3),
    },
    {
        "ref": "RSK-0006",
        "title": "Incomplete audit evidence for regulatory reporting",
        "category": domain.RiskCategory.REGULATORY.value,
        "asset_ref": None,
        "business_unit": "Corporate IT",
        "likelihood": 3,
        "impact": 4,
        "status": domain.RiskStatus.RESOLVED.value,
        "evidence_quality": domain.EvidenceQuality.VERIFIED.value,
        "due_in_days": None,
        "threat_scenario": "A regulator finds the control evidence incomplete and issues a remediation notice.",
        "existing_controls": "Evidence register maintained by the control office.",
        "mitigation_plan": "Automated evidence collection implemented and independently validated.",
        "financial_impact_assumptions": "Assumes regulatory fine and remediation programme cost.",
        "residual": (1, 2),
    },
    {
        "ref": "RSK-0007",
        "title": "Degraded branch connectivity during peak hours",
        "category": domain.RiskCategory.TECHNOLOGY.value,
        "asset_ref": "AST-0007",
        "business_unit": "Retail Banking",
        "likelihood": 3,
        "impact": 2,
        "status": domain.RiskStatus.IN_PROGRESS.value,
        "evidence_quality": domain.EvidenceQuality.MEDIUM.value,
        "due_in_days": 45,
        "threat_scenario": "A carrier outage leaves branches unable to reach the core banking system at peak time.",
        "existing_controls": "Secondary carrier available manually.",
        "mitigation_plan": "Automate carrier failover and add 5G backup on the highest-volume sites.",
        "financial_impact_assumptions": "Assumes limited branch transaction loss over three hours.",
        "residual": None,
    },
    {
        "ref": "RSK-0008",
        "title": "Third-party feed injection of manipulated market prices",
        "category": domain.RiskCategory.CYBERSECURITY.value,
        "asset_ref": "AST-0005",
        "business_unit": "Wealth Management",
        "likelihood": 1,
        "impact": 4,
        "status": domain.RiskStatus.IDENTIFIED.value,
        "evidence_quality": domain.EvidenceQuality.LOW.value,
        "due_in_days": 180,
        "threat_scenario": "A compromised upstream feed publishes manipulated prices that reach adviser screens.",
        "existing_controls": "Variance checks on published prices.",
        "mitigation_plan": "Add independent price reconciliation before publication.",
        "financial_impact_assumptions": "Assumes correction cost and client remediation.",
        "residual": None,
    },
    {
        "ref": "RSK-0009",
        "title": "Data residency breach in the analytics platform",
        "category": domain.RiskCategory.REGULATORY.value,
        "asset_ref": "AST-0003",
        "business_unit": "Corporate IT",
        "likelihood": 2,
        "impact": 4,
        "status": domain.RiskStatus.MITIGATION_PLANNED.value,
        "evidence_quality": domain.EvidenceQuality.MEDIUM.value,
        "due_in_days": 75,
        "threat_scenario": "Customer records are replicated to a region outside the approved residency boundary.",
        "existing_controls": "Region allow-list in the deployment pipeline.",
        "mitigation_plan": "Enforce residency policy as code with automated drift detection.",
        "financial_impact_assumptions": "Assumes contractual penalties and migration cost.",
        "residual": None,
    },
    {
        "ref": "RSK-0010",
        "title": "Phishing leading to adviser mailbox compromise",
        "category": domain.RiskCategory.CYBERSECURITY.value,
        "asset_ref": "AST-0004",
        "business_unit": "Wealth Management",
        "likelihood": 4,
        "impact": 4,
        "status": domain.RiskStatus.IN_PROGRESS.value,
        "evidence_quality": domain.EvidenceQuality.HIGH.value,
        "due_in_days": 20,
        "threat_scenario": "An adviser approves a fraudulent payment request received from a spoofed client address.",
        "existing_controls": "Phishing-resistant MFA on the workspace, payment callback procedure.",
        "mitigation_plan": "Deploy inbound domain authentication checks and refresh adviser awareness training.",
        "financial_impact_assumptions": "Assumes reimbursement of the fraudulent payment and remediation effort.",
        "residual": (2, 3),
    },
)

#: One documented loss scenario per risk that carries modelled exposure.
SCENARIOS: tuple[dict[str, Any], ...] = (
    {
        "risk_ref": "RSK-0001",
        "name": "Portal RCE exploited - base case",
        "scenario_type": domain.ScenarioType.BASE_CASE.value,
        "probability": 0.18,
        "residual_probability": 0.09,
        "time_horizon_months": 12,
        "assumptions": "60 hours of portal downtime at a blended cost of 18,000 per hour; recovery and forensics engaged.",
        "direct_loss": "250000.00",
        "revenue_loss": None,
        "downtime_hours": 60,
        "downtime_cost_per_hour": "18000.00",
        "recovery_cost": "420000.00",
        "incident_response_cost": "180000.00",
        "regulatory_cost": "90000.00",
        "other_cost": "60000.00",
        "insurance_recovery": "300000.00",
        "mitigation_cost": "160000.00",
    },
    {
        "risk_ref": "RSK-0002",
        "name": "Warehouse encryption - worst case",
        "scenario_type": domain.ScenarioType.WORST_CASE.value,
        "probability": 0.06,
        "residual_probability": 0.03,
        "time_horizon_months": 12,
        "assumptions": "Four days of degraded reporting; external forensics and accelerated restore from immutable backups.",
        "direct_loss": "150000.00",
        "revenue_loss": "400000.00",
        "downtime_hours": 96,
        "downtime_cost_per_hour": "9500.00",
        "recovery_cost": "750000.00",
        "incident_response_cost": "350000.00",
        "regulatory_cost": "200000.00",
        "other_cost": "100000.00",
        "insurance_recovery": "500000.00",
        "mitigation_cost": "240000.00",
    },
    {
        "risk_ref": "RSK-0003",
        "name": "Settlement outage - base case",
        "scenario_type": domain.ScenarioType.BASE_CASE.value,
        "probability": 0.10,
        "residual_probability": None,
        "time_horizon_months": 12,
        "assumptions": "Two hours of failed settlement; manual reconciliation for the remainder of the day.",
        "direct_loss": "120000.00",
        "revenue_loss": None,
        "downtime_hours": 2,
        "downtime_cost_per_hour": "45000.00",
        "recovery_cost": "90000.00",
        "incident_response_cost": None,
        "regulatory_cost": "50000.00",
        "other_cost": "30000.00",
        "insurance_recovery": None,
        "mitigation_cost": "85000.00",
    },
    {
        "risk_ref": "RSK-0010",
        "name": "Adviser mailbox compromise - base case",
        "scenario_type": domain.ScenarioType.BASE_CASE.value,
        "probability": 0.22,
        "residual_probability": 0.12,
        "time_horizon_months": 12,
        "assumptions": "Single fraudulent payment reimbursed in full plus investigation and client remediation.",
        "direct_loss": "260000.00",
        "revenue_loss": None,
        "downtime_hours": None,
        "downtime_cost_per_hour": None,
        "recovery_cost": "40000.00",
        "incident_response_cost": "60000.00",
        "regulatory_cost": None,
        "other_cost": "25000.00",
        "insurance_recovery": "120000.00",
        "mitigation_cost": "45000.00",
    },
    {
        "risk_ref": "RSK-0007",
        "name": "Branch outage - best case",
        "scenario_type": domain.ScenarioType.BEST_CASE.value,
        "probability": 0.30,
        "residual_probability": 0.18,
        "time_horizon_months": 12,
        "assumptions": "Three-hour carrier outage at three sites with manual failover.",
        "direct_loss": "45000.00",
        "revenue_loss": None,
        "downtime_hours": 3,
        "downtime_cost_per_hour": "7000.00",
        "recovery_cost": None,
        "incident_response_cost": None,
        "regulatory_cost": None,
        "other_cost": "10000.00",
        "insurance_recovery": None,
        "mitigation_cost": "60000.00",
    },
    {
        "risk_ref": "RSK-0004",
        "name": "Privileged insider misuse - base case",
        "scenario_type": domain.ScenarioType.BASE_CASE.value,
        "probability": 0.08,
        "residual_probability": None,
        "time_horizon_months": 12,
        "assumptions": "Forensic investigation, emergency rotation of privileged secrets and control rebuild.",
        "direct_loss": "90000.00",
        "revenue_loss": None,
        "downtime_hours": None,
        "downtime_cost_per_hour": None,
        "recovery_cost": "180000.00",
        "incident_response_cost": "150000.00",
        "regulatory_cost": "75000.00",
        "other_cost": "40000.00",
        "insurance_recovery": "100000.00",
        "mitigation_cost": "120000.00",
    },
    {
        "risk_ref": "RSK-0009",
        "name": "Residency breach - base case",
        "scenario_type": domain.ScenarioType.BASE_CASE.value,
        "probability": 0.05,
        "residual_probability": 0.02,
        "time_horizon_months": 12,
        "assumptions": "Contractual penalties plus migration of the affected data set back in region.",
        "direct_loss": "300000.00",
        "revenue_loss": None,
        "downtime_hours": None,
        "downtime_cost_per_hour": None,
        "recovery_cost": "260000.00",
        "incident_response_cost": None,
        "regulatory_cost": "180000.00",
        "other_cost": "50000.00",
        "insurance_recovery": None,
        "mitigation_cost": "90000.00",
    },
)

#: Findings recorded against the demo assets.  ``cvss_score`` is a
#: scanner-reported value on the finding itself; nothing is written to the
#: upstream ``vulnerabilities`` cache, which must only ever hold fetched records.
FINDINGS: tuple[dict[str, Any], ...] = (
    {
        "asset_ref": "AST-0001",
        "cve_id": "CVE-2024-3400",
        "title": "Command injection in the portal's edge component",
        "description": "Scanner reported a command-injection weakness in the edge device software in front of the portal.",
        "cvss_score": 10.0,
        "cvss_severity": "critical",
        "age_days": 120,
        "exploit_evidence": True,
        "internet_exposed": True,
        "remediation_status": domain.RemediationStatus.IN_PROGRESS.value,
        "compensating_controls": "WAF virtual patch applied; exploit attempts alerted on.",
        "remediation_due_in_days": 14,
    },
    {
        "asset_ref": "AST-0003",
        "cve_id": "CVE-2023-4966",
        "title": "Session token disclosure on the data warehouse gateway",
        "description": "Gateway appliance leaks session tokens under specific load conditions.",
        "cvss_score": 9.4,
        "cvss_severity": "critical",
        "age_days": 210,
        "exploit_evidence": True,
        "internet_exposed": False,
        "remediation_status": domain.RemediationStatus.OPEN.value,
        "compensating_controls": None,
        "remediation_due_in_days": -5,
    },
    {
        "asset_ref": "AST-0002",
        "cve_id": "CVE-2022-22965",
        "title": "Remote code execution in the payments framework",
        "description": "Framework version in use is affected by a widely exploited RCE flaw.",
        "cvss_score": 9.8,
        "cvss_severity": "critical",
        "age_days": 400,
        "exploit_evidence": False,
        "internet_exposed": False,
        "remediation_status": domain.RemediationStatus.REMEDIATED.value,
        "compensating_controls": "Network segmentation prevents reachability from untrusted zones.",
        "remediation_due_in_days": None,
    },
    {
        "asset_ref": "AST-0006",
        "cve_id": None,
        "title": "Weak conditional-access policy on a legacy administrative endpoint",
        "description": "Configuration review found an administrative interface reachable without device compliance.",
        "cvss_score": 7.5,
        "cvss_severity": "high",
        "age_days": 45,
        "exploit_evidence": False,
        "internet_exposed": True,
        "remediation_status": domain.RemediationStatus.OPEN.value,
        "compensating_controls": None,
        "remediation_due_in_days": 21,
    },
    {
        "asset_ref": "AST-0004",
        "cve_id": "CVE-2024-21413",
        "title": "Email client protection bypass reachable from the adviser workspace",
        "description": "Client library permits link-based bypass of the protected view.",
        "cvss_score": 9.8,
        "cvss_severity": "critical",
        "age_days": 30,
        "exploit_evidence": True,
        "internet_exposed": True,
        "remediation_status": domain.RemediationStatus.IN_PROGRESS.value,
        "compensating_controls": "Outbound mail inspection enabled.",
        "remediation_due_in_days": 7,
    },
    {
        "asset_ref": "AST-0007",
        "cve_id": "CVE-2021-34770",
        "title": "Crafted request causes a reload of the branch access device",
        "description": "Device software is affected by a denial-of-service weakness reachable from the branch LAN.",
        "cvss_score": 8.6,
        "cvss_severity": "high",
        "age_days": 600,
        "exploit_evidence": False,
        "internet_exposed": False,
        "remediation_status": domain.RemediationStatus.ACCEPTED_RISK.value,
        "compensating_controls": "Redundant links keep branches reachable during a reload.",
        "remediation_due_in_days": None,
    },
    {
        "asset_ref": "AST-0005",
        "cve_id": None,
        "title": "Feed endpoint served with an expiring certificate",
        "description": "The market-data feed presents a certificate expiring within thirty days.",
        "cvss_score": 4.3,
        "cvss_severity": "medium",
        "age_days": 10,
        "exploit_evidence": False,
        "internet_exposed": True,
        "remediation_status": domain.RemediationStatus.OPEN.value,
        "compensating_controls": None,
        "remediation_due_in_days": 30,
    },
)

#: Remediation actions.  ``status`` is set independently of the parent risk's
#: residual score on purpose: completing an action does not by itself reduce a
#: risk, and the demo data shows that behaviour.
MITIGATIONS: tuple[dict[str, Any], ...] = (
    {
        "risk_ref": "RSK-0001",
        "description": "Reduce the patch SLA for internet-facing components to fourteen days.",
        "priority": domain.Severity.CRITICAL.value,
        "status": domain.MitigationStatus.IN_PROGRESS.value,
        "due_in_days": 25,
        "estimated_cost": "160000.00",
        "expected_risk_reduction": 0.30,
    },
    {
        "risk_ref": "RSK-0001",
        "description": "Commission an independent penetration test of the portal after patching.",
        "priority": domain.Severity.HIGH.value,
        "status": domain.MitigationStatus.PLANNED.value,
        "due_in_days": 70,
        "estimated_cost": "65000.00",
        "expected_risk_reduction": 0.10,
    },
    {
        "risk_ref": "RSK-0002",
        "description": "Extend endpoint detection and response coverage to the database estate.",
        "priority": domain.Severity.CRITICAL.value,
        "status": domain.MitigationStatus.IN_PROGRESS.value,
        "due_in_days": 40,
        "estimated_cost": "240000.00",
        "expected_risk_reduction": 0.35,
    },
    {
        "risk_ref": "RSK-0002",
        "description": "Rehearse a full restore from immutable backups and record the elapsed time.",
        "priority": domain.Severity.HIGH.value,
        "status": domain.MitigationStatus.COMPLETED.value,
        "due_in_days": -12,
        "estimated_cost": "30000.00",
        "expected_risk_reduction": 0.10,
        "completion_notes": "Restore rehearsal completed in 6h 40m; the action is closed but the risk score is unchanged until post-mitigation values are recorded.",
    },
    {
        "risk_ref": "RSK-0004",
        "description": "Introduce just-in-time privileged access with session recording.",
        "priority": domain.Severity.HIGH.value,
        "status": domain.MitigationStatus.BLOCKED.value,
        "due_in_days": 90,
        "estimated_cost": "120000.00",
        "expected_risk_reduction": 0.40,
    },
    {
        "risk_ref": "RSK-0007",
        "description": "Automate carrier failover on the branch backbone.",
        "priority": domain.Severity.MEDIUM.value,
        "status": domain.MitigationStatus.PLANNED.value,
        "due_in_days": 35,
        "estimated_cost": "60000.00",
        "expected_risk_reduction": 0.25,
    },
    {
        "risk_ref": "RSK-0010",
        "description": "Refresh adviser awareness training with a payment-fraud scenario.",
        "priority": domain.Severity.HIGH.value,
        "status": domain.MitigationStatus.COMPLETED.value,
        "due_in_days": -3,
        "estimated_cost": "45000.00",
        "expected_risk_reduction": 0.20,
        "completion_notes": "Training delivered to 96% of advisers; residual probability recorded separately on the parent risk.",
    },
    {
        "risk_ref": "RSK-0010",
        "description": "Enable inbound domain authentication checks for adviser mailboxes.",
        "priority": domain.Severity.CRITICAL.value,
        "status": domain.MitigationStatus.IN_PROGRESS.value,
        "due_in_days": 15,
        "estimated_cost": "55000.00",
        "expected_risk_reduction": 0.25,
    },
    {
        "risk_ref": "RSK-0009",
        "description": "Enforce data-residency policy as code with drift detection.",
        "priority": domain.Severity.HIGH.value,
        "status": domain.MitigationStatus.PLANNED.value,
        "due_in_days": 65,
        "estimated_cost": "90000.00",
        "expected_risk_reduction": 0.30,
    },
    {
        "risk_ref": "RSK-0003",
        "description": "Automate failover testing of the payments switch.",
        "priority": domain.Severity.HIGH.value,
        "status": domain.MitigationStatus.PLANNED.value,
        "due_in_days": 80,
        "estimated_cost": "85000.00",
        "expected_risk_reduction": 0.20,
    },
)

#: A couple of inbox items so the notification centre is not empty.
NOTIFICATIONS: tuple[dict[str, str], ...] = (
    {
        "title": "Demonstration data loaded",
        "body": "This organization contains synthetic demonstration records only. Remove it before using the platform for real work.",
        "level": "warning",
        "link": "/settings",
    },
    {
        "title": "1 remediation action is overdue",
        "body": "A vulnerability finding has passed its remediation due date. Review it on the Cybersecurity page.",
        "level": "critical",
        "link": "/cybersecurity",
    },
    {
        "title": "Model not yet trained",
        "body": "No AI model is active. Train one from the AI Insights page, or continue with the documented rule-based classification.",
        "level": "info",
        "link": "/ai-insights",
    },
)


def demo_organization(db: Session) -> Optional[Organization]:
    """Return the demonstration organization if it has already been seeded."""
    return db.execute(
        select(Organization).where(Organization.slug == DEMO_ORGANIZATION_SLUG)
    ).scalar_one_or_none()


def _money(value: Optional[str]) -> Optional[Decimal]:
    """Convert a documented amount to ``Decimal``.

    ``None`` stays ``None``: an amount the scenario does not estimate must not be
    written as zero, or the loss engine would treat "not estimated" as "no loss".
    """
    return Decimal(value) if value is not None else None


def _counts(db: Session, organization_id: int) -> dict[str, int]:
    def count(model, extra=()) -> int:
        stmt = select(model.id).where(model.organization_id == organization_id)
        for condition in extra:
            stmt = stmt.where(condition)
        return len(db.execute(stmt).scalars().all())

    return {
        "assets": count(Asset),
        "risks": count(Risk),
        "scenarios": count(FinancialScenario),
        "findings": count(VulnerabilityFinding),
        "mitigations": count(Mitigation),
        "notifications": count(Notification, (Notification.user_id.is_not(None),)),
    }


def seed_demo_data(
    db: Session,
    *,
    admin_email: str,
    admin_password: str,
    admin_name: str = "Demo Administrator",
) -> dict[str, Any]:
    """Create the labelled demonstration organization.  Idempotent.

    Returns a summary describing what was created (or that nothing was, because
    the demonstration organization already exists).  Raises ``RuntimeError`` when
    demonstration data is disabled for this environment.
    """
    if not settings.demo_data_enabled:
        raise RuntimeError(
            "Demonstration data is disabled for this environment. It is always disabled in "
            "production; enable it with DEMO_DATA_ENABLED=true in a development environment."
        )

    existing = demo_organization(db)
    if existing is not None:
        return {
            "created": False,
            "reason": "already_present",
            "organization_id": existing.id,
            "organization_slug": existing.slug,
            "counts": _counts(db, existing.id),
            "note": (
                "The demonstration organization already exists, so nothing was added. "
                "This command never modifies or duplicates existing records."
            ),
        }

    today = date.today()
    organization = Organization(
        name=DEMO_ORGANIZATION_NAME,
        slug=DEMO_ORGANIZATION_SLUG,
        currency="USD",
        industry="Financial services",
        reporting_period_label="Current financial year",
        is_demo=True,
    )
    db.add(organization)
    db.flush()

    admin = User(
        email=admin_email.strip().lower(),
        full_name=admin_name,
        password_hash=hash_password(admin_password),
        is_active=True,
    )
    db.add(admin)
    db.flush()
    db.add(
        Membership(
            user_id=admin.id,
            organization_id=organization.id,
            role=domain.Role.ADMIN.value,
            job_title="Chief Information Security Officer",
        )
    )

    team: list[User] = []
    for member in TEAM:
        user = User(
            email=member["email"],
            full_name=member["name"],
            password_hash=hash_password(admin_password),
            is_active=True,
        )
        db.add(user)
        db.flush()
        db.add(
            Membership(
                user_id=user.id,
                organization_id=organization.id,
                role=member["role"],
                job_title=member["job_title"],
            )
        )
        team.append(user)
    db.flush()

    #: Owners cycle through the administrator and the team so the ownership
    #: fields are populated rather than every record belonging to one person.
    owners: list[User] = [admin, *team]

    assets: dict[str, Asset] = {}
    for index, spec in enumerate(ASSETS):
        asset = Asset(
            organization_id=organization.id,
            asset_ref=spec["ref"],
            name=spec["name"],
            description=f"Synthetic demonstration record for {spec['name']}.",
            asset_type=spec["asset_type"],
            environment=spec["environment"],
            business_unit=spec["business_unit"],
            owner_id=owners[index % len(owners)].id,
            criticality=spec["criticality"],
            data_sensitivity=spec["data_sensitivity"],
            internet_exposed=spec["internet_exposed"],
            financial_importance=Decimal(spec["financial_importance"]),
            currency=organization.currency,
            existing_controls=spec["existing_controls"],
            last_assessed_at=utcnow(),
            is_demo=True,
        )
        db.add(asset)
        assets[spec["ref"]] = asset
    db.flush()

    risks: dict[str, Risk] = {}
    for index, spec in enumerate(RISKS):
        residual = spec["residual"]
        risk = Risk(
            organization_id=organization.id,
            risk_ref=spec["ref"],
            title=spec["title"],
            description=f"Synthetic demonstration record: {spec['title']}.",
            category=spec["category"],
            source="Demonstration seeder",
            asset_id=assets[spec["asset_ref"]].id if spec["asset_ref"] else None,
            business_unit=spec["business_unit"],
            owner_id=owners[index % len(owners)].id,
            threat_scenario=spec["threat_scenario"],
            likelihood=spec["likelihood"],
            impact=spec["impact"],
            financial_impact_assumptions=spec["financial_impact_assumptions"],
            existing_controls=spec["existing_controls"],
            mitigation_plan=spec["mitigation_plan"],
            residual_likelihood=residual[0] if residual else None,
            residual_impact=residual[1] if residual else None,
            status=spec["status"],
            evidence_quality=spec["evidence_quality"],
            due_date=today + timedelta(days=spec["due_in_days"]) if spec["due_in_days"] else None,
            is_demo=True,
        )
        if spec["status"] in (domain.RiskStatus.RESOLVED.value, domain.RiskStatus.CLOSED.value):
            risk.closed_at = utcnow()
        db.add(risk)
        risks[spec["ref"]] = risk
    db.flush()

    for spec in SCENARIOS:
        risk = risks[spec["risk_ref"]]
        db.add(
            FinancialScenario(
                organization_id=organization.id,
                risk_id=risk.id,
                asset_id=risk.asset_id,
                created_by_id=admin.id,
                name=spec["name"],
                scenario_type=spec["scenario_type"],
                description=f"Synthetic demonstration scenario for {risk.risk_ref}.",
                assumptions=spec["assumptions"],
                currency=organization.currency,
                time_horizon_months=spec["time_horizon_months"],
                probability=spec["probability"],
                residual_probability=spec["residual_probability"],
                direct_loss=_money(spec["direct_loss"]),
                revenue_loss=_money(spec["revenue_loss"]),
                downtime_hours=spec["downtime_hours"],
                downtime_cost_per_hour=_money(spec["downtime_cost_per_hour"]),
                recovery_cost=_money(spec["recovery_cost"]),
                incident_response_cost=_money(spec["incident_response_cost"]),
                regulatory_cost=_money(spec["regulatory_cost"]),
                other_cost=_money(spec["other_cost"]),
                insurance_recovery=_money(spec["insurance_recovery"]),
                mitigation_cost=_money(spec["mitigation_cost"]),
                is_demo=True,
            )
        )

    for spec in FINDINGS:
        asset = assets[spec["asset_ref"]]
        due = spec["remediation_due_in_days"]
        finding = VulnerabilityFinding(
            organization_id=organization.id,
            asset_id=asset.id,
            created_by_id=admin.id,
            cve_id=spec["cve_id"],
            title=spec["title"],
            description=spec["description"],
            cvss_score=spec["cvss_score"],
            cvss_severity=spec["cvss_severity"],
            detected_at=utcnow() - timedelta(days=spec["age_days"]),
            vulnerability_age_days=spec["age_days"],
            exploit_evidence=spec["exploit_evidence"],
            internet_exposed=spec["internet_exposed"],
            remediation_status=spec["remediation_status"],
            remediation_due_date=today + timedelta(days=due) if due is not None else None,
            compensating_controls=spec["compensating_controls"],
            notes="Synthetic demonstration finding.",
            is_demo=True,
        )
        db.add(finding)
        db.flush()
        # Scored by the same context-aware engine the API uses.
        recompute_priority(db, finding, asset)

    for index, spec in enumerate(MITIGATIONS, start=1):
        risk = risks[spec["risk_ref"]]
        due = spec["due_in_days"]
        status = spec["status"]
        mitigation = Mitigation(
            organization_id=organization.id,
            risk_id=risk.id,
            action_ref=f"MIT-{index:04d}",
            description=spec["description"],
            priority=spec["priority"],
            assigned_user_id=owners[index % len(owners)].id,
            due_date=today + timedelta(days=due) if due is not None else None,
            estimated_cost=Decimal(spec["estimated_cost"]),
            currency=organization.currency,
            status=status,
            expected_risk_reduction=spec["expected_risk_reduction"],
            completion_notes=spec.get("completion_notes"),
            completed_at=utcnow() if status == domain.MitigationStatus.COMPLETED.value else None,
            is_demo=True,
        )
        db.add(mitigation)

    for spec in NOTIFICATIONS:
        db.add(
            Notification(
                organization_id=organization.id,
                user_id=admin.id,
                title=spec["title"],
                body=spec["body"],
                level=spec["level"],
                link=spec["link"],
            )
        )

    db.flush()

    counts = _counts(db, organization.id)
    record_audit(
        db,
        action=domain.AuditAction.DEMO_DATA_SEEDED.value,
        user=admin,
        organization_id=organization.id,
        entity_type="organization",
        entity_id=organization.id,
        detail={"counts": counts, "synthetic": True, "organization_slug": organization.slug},
        ip_address=None,
    )
    db.commit()

    return {
        "created": True,
        "reason": "created",
        "organization_id": organization.id,
        "organization_slug": organization.slug,
        "administrator_email": admin.email,
        "team_emails": [member["email"] for member in TEAM],
        "counts": counts,
        "note": (
            "All rows created by this command are synthetic demonstration data and are "
            "flagged is_demo=True. They are not evidence about any real organization."
        ),
    }
