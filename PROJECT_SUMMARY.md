# FinRisk AI — Feature and API Inventory

Companion to [README.md](README.md), which covers how to run and deploy the platform.
This file is the feature and endpoint inventory.

---

## 1. Feature areas

| Area | What it does |
| :--- | :--- |
| **Risk register** | Risks with a 5×5 likelihood × impact inherent score, residual scoring, lifecycle status, owner assignment, reassessment history and evidence records. |
| **Assets** | Business assets with criticality and classification; each asset links to the risks that touch it, so exposure can be rolled up per asset. |
| **Financial exposure** | Loss scenarios built from explicit assumptions (frequency, per-event loss, insurance, controls) that compute gross, net, expected and residual loss in one currency, with the formula shown next to every figure. |
| **Vulnerability findings** | Findings with upstream CVSS values *and* the platform's own priority score, CSV import, and linkage to assets and mitigating actions. |
| **Mitigation plans** | Remediation actions with status, owner and due date, linked back to the risk or finding they address. |
| **Third-party (TILT) module** | Vendor assessments using the preserved TILT standard questionnaire (25 questions, max 100) and cloud scorecard (11 criteria, max 55), with a knockout rule for missed critical criteria, plus optional OSINT scanning. |
| **Reports** | Eight document types rendered to CSV or PDF, previewable before export, with an export history. |
| **Dashboard** | Aggregated counts, severity mix, remediation status and modelled exposure. Reports an explicit empty state rather than zeros when there is no data. |
| **AI / ML (optional)** | Model status, training, per-risk prediction with feature attributions, and deterministic (non-model) insights. Falls back to a documented rule-based baseline. |
| **Audit trail** | Append-only, organization-scoped record of changes, written on the same transaction as the change it describes. Administrator-only. |
| **Notifications** | Per-user in-app notification inbox. |
| **Organizations & membership** | Tenant records, membership with roles, organization switching, member invitations, role changes. |

---

## 2. Roles

| Role | Rank | Summary |
| :--- | :--- | :--- |
| `admin` | 4 | Full access; the only role with `audit:read` |
| `risk_manager` | 3 | Full write access to registers; manages organization, users and model training |
| `analyst` | 2 | Full write access to registers; no user or organization management |
| `viewer` | 1 | Read-only |

Capability strings (`risk:read`, `risk:write`, `asset:read`, `asset:write`,
`financial:read`, `financial:write`, `vulnerability:read`, `vulnerability:write`,
`mitigation:read`, `mitigation:write`, `ai:read`, `ai:train`, `report:read`,
`report:export`, `audit:read`, `org:manage`, `user:manage`) are returned by
`GET /api/auth/me` so the UI can hide actions. They are presentation-level only —
every endpoint re-checks the caller's role and organization on the server.

---

## 3. Scoring rules

**Inherent risk score.** `score = clamp(likelihood, 1, 5) × clamp(impact, 1, 5)`, an
integer from 1 to 25. Severity bands:

| Band | Score range |
| :--- | :--- |
| critical | 20–25 |
| high | 12–19 |
| medium | 5–11 |
| low | 1–4 |

**Financial scenario.** From the entered assumptions the engine computes gross loss,
net loss after insurance (insurance recovery is capped at the gross loss), expected loss
(gross × probability), and residual loss after controls. If no residual probability is
supplied the residual figure equals the expected figure and the response says so
explicitly. Amounts are decimal strings with an ISO-4217 code and are never converted.

**TILT standard assessment.** Vulnerability is the importance-weighted mean of the
inverted maturity answers, scaled to 0–100 (Critical weight 3×, High 2×, otherwise 1×).
With no answers scored the result is 0 and the verdict is REJECT.

**TILT cloud scorecard.** Total out of 55. A Critical criterion scored 0 forces
rejection regardless of the total.

Full derivations are in [docs/RISK_MATRIX_ALGORITHM.txt](docs/RISK_MATRIX_ALGORITHM.txt).

---

## 4. API surface

All routes are mounted under `/api`. Every route is organization-scoped; the caller's
organization is taken from the `X-Organization-Id` header, falling back to the `org`
claim in the token and then to the caller's first membership.

### System

| Method | Path | Notes |
| :--- | :--- | :--- |
| GET | `/` | Service card |
| GET | `/api/health` | Liveness plus the schema revisions the process believes are applied |

### Authentication and membership — `/api/auth`

`POST /register`, `POST /login`, `GET /me`, `POST /switch-organization/{id}`,
`POST /password`, `POST /logout`, `GET /members`, `POST /members`, `PATCH /members/{id}`
(role change), `GET /roles`.

### Registers

| Area | Endpoints |
| :--- | :--- |
| Risks | `/api/risks` list, create, detail, update, delete; `/options`, `/meta`, `/export`, `/{id}/status`, `/{id}/owner`, `/{id}/assessments`, `/{id}/evidence` |
| Assets | `/api/assets` list, create, detail, update, delete; `/options`, `/{id}/risks` |
| Vulnerabilities | `/api/vulnerabilities/findings` list, create, detail, update, delete; `/findings/export`, `/imports`, CSV import, `/meta`, `/cve/{cve_id}` |
| Mitigations | `/api/mitigations` list, create, detail, update, delete; `/meta` |
| Financial scenarios | `/api/financial-scenarios` list, create, detail, update, delete; `/preview`, `/compare`, `/meta`, `/export`, `/{id}/calculate` |

### Reporting, governance and platform

| Area | Endpoints |
| :--- | :--- |
| Reports | `/api/reports/catalog`, `/api/reports` (history), `/preview`, `/export` |
| Dashboard | `GET /api/dashboard` |
| Audit trail | `/api/audit-logs`, `/api/audit-logs/meta`, `/api/audit-logs/export` (admin only) |
| Notifications | `/api/notifications`, `/summary`, `/{id}/read`, `/read-all`, `/meta` |
| AI / ML | `/api/ai/status`, `/models`, `/train`, `/predict`, `/insights` |
| Organizations | `/api/organizations`, `/current`, `/current/summary`, `/current/check-access/{id}` |
| TILT | `/api/tilt/templates/{kind}` CRUD, `/api/tilt/vendors` CRUD, `/vendors/{id}/calculate`, `/vendors/{id}/osint-scan`, `/vendors/{id}/acknowledge` |

### Report types

`executive_summary`, `risk_register`, `financial_exposure`, `vulnerability_assessment`,
`asset_risk`, `mitigation_progress`, `model_evaluation`, `scenario_comparison`.

`GET /api/reports/catalog` returns this list with titles and descriptions so the UI never
hardcodes it.

### Conventions

* **Paging**: `page` (≥1), `page_size` (1–200, default 25), `sort`, `order` (`asc`/`desc`).
  Responses use a `Page[T]` envelope of `{items, total, page, page_size, pages}`.
* **Errors**: a single envelope — `{detail, errors?, request_id}`. Validation failures
  return 422 with a list of `{location, message, type}`. Permission failures return the
  backend's own message verbatim so the UI can explain which role is required.
* **Request correlation**: every response carries `X-Request-Id`, echoing a supplied one
  or minting a new one.
* **Timestamps**: UTC, serialised with an explicit offset. A timestamp without an offset
  is read as UTC, not as local time.

---

## 5. Data model

Organizations own everything. Tables created by migration `0001_initial_schema`:

`organizations`, `users`, `organization_memberships`, `assets`, `risks`,
`risk_assessments`, `evidence_records`, `financial_scenarios`, `vulnerabilities`,
`vulnerability_findings`, `import_batches`, `mitigations`, `model_versions`,
`model_predictions`, `notifications`, `audit_logs`, `generated_reports`,
`questionnaire_templates`, `vendor_assessments`, `schema_migrations`.

Migration `0002_questionnaire_templates` seeds the TILT questionnaire templates from
`backend/data/`. Migration `0003_import_legacy_tilt` imports vendors from an existing
legacy `tilt_data.db` if one is present, opening it read-only.

Demonstration rows are flagged `is_demo=true` throughout.

---

## 6. Repository layout

See [README.md §9](README.md#9-project-structure). In short: `backend/app` is the API
(routers → services → models), `backend/tests` is the pytest suite, `frontend/src` is the
React application (pages → components → lib), and `docs/` holds the algorithm and OSINT
notes carried over from the TILT framework.

Limitations and boundaries are listed in [README.md §10](README.md#10-known-limitations).
