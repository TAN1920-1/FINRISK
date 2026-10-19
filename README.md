# FinRisk AI

A financial and cyber risk intelligence platform. It keeps a risk register, models
financial loss scenarios, tracks vulnerability findings and remediation, assesses
third-party vendors with the inherited TILT questionnaire set, exports reports, and
offers an optional machine-learning model over the register.

The platform is multi-tenant: every record belongs to an organization, and every
request is scoped to one. Nothing is shared between organizations.

> **Honesty rules the code enforces.** Money is carried as a decimal string plus an
> ISO-4217 currency code and is never converted or added across currencies. An absent
> value renders as an em dash, never as `0`, because "not estimated" and "no loss" are
> different statements. Every score, band and model output is accompanied by the rule
> that produced it and a statement of what it does not mean. Demonstration rows are
> flagged synthetic and are never presented as evidence about a real organization.

---

## 1. Architecture

| Component | Technology | Role |
| :--- | :--- | :--- |
| Backend | Python 3.12, FastAPI, SQLAlchemy 2, Pydantic v2 | REST API, scoring, authorization, audit trail |
| Frontend | React 18, TypeScript 5.7, Vite 5, Tailwind 3 | Dashboard and data-entry UI |
| Database | SQLite by default | Persistence; PostgreSQL supported in principle (see §8) |
| Auth | JWT (HS256, PyJWT) + Argon2id password hashing | Sessions, tenant scoping, roles |
| ML (optional) | scikit-learn / joblib | Risk prioritisation model; degrades to a rule-based baseline |

The frontend talks to the API over HTTP. In development the Vite dev server proxies
`/api` to the backend, so the browser only ever sees one origin. The API origin is a
build-time setting (`VITE_API_BASE_URL`), never a hard-coded hostname.

---

## 2. Prerequisites

* **Python 3.12+**
* **Node.js 20+** and npm

---

## 3. Run it locally

Two terminals. The backend must be started from inside `backend/` so that
`app.main` resolves.

### Backend

```bash
cd backend
python -m venv venv
# Windows:        venv\Scripts\activate
# macOS / Linux:  source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

* API: <http://127.0.0.1:8000>
* Interactive docs: <http://127.0.0.1:8000/docs>
* Health and applied schema revisions: <http://127.0.0.1:8000/api/health>

Database migrations are applied automatically on startup (the FastAPI lifespan
handler). There is no separate migrate step; migrations are an ordered, append-only
list recorded in the `schema_migrations` table.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

* App: <http://localhost:5173>

The dev server proxies `/api` to `http://127.0.0.1:8000`. Point it elsewhere with
`VITE_DEV_API_TARGET` if the backend runs on a different port.

### Or use the wrapper scripts

`./run.sh` (macOS / Linux) and `.\run.ps1` (Windows) create the virtual environment,
install both dependency sets, and start both servers in the configuration above. They
are convenience wrappers — the manual commands are the source of truth.

---

## 4. Bootstrapping the first administrator

There is no default account and no seeded password.

1. Start both servers.
2. Open <http://localhost:5173> and choose **Register**.
3. The **first** account created becomes the administrator of a new organization, and
   may always be created even when self-registration is closed. Every later
   registration joins its own new organization as its administrator.

Additional members are added from **Settings → Members** by an administrator or risk
manager. Self-registration is disabled automatically when `ENVIRONMENT=production`,
so a production deployment is provisioned through the bootstrap account only.

### Optional: synthetic demonstration data

```bash
cd backend
python -m app.cli seed-demo --email you@example.com
```

This creates a clearly labelled demonstration organization with assets, risks, loss
scenarios, findings and remediation actions. It prints a generated administrator
password once if you do not supply `--password`. **All rows it creates are synthetic
demonstration data** (`is_demo=true`); they are not evidence about any real
organization and must not be used for real risk decisions. The command is idempotent.

`python -m app.cli status` prints the environment, database URL, migration state and
whether demonstration data is enabled.

---

## 5. Configuration

Every setting has a safe default, so the app runs with no configuration at all. Values
are read from real environment variables first, then from a `.env` file in the
repository root or in `backend/`.

Variable names are the upper-cased field names from
[`backend/app/config.py`](backend/app/config.py) with **no prefix** —

```
ENVIRONMENT=production   DATABASE_URL=...   SECRET_KEY=...   CORS_ORIGINS=...
DEMO_DATA_ENABLED=false  ALLOW_OPEN_REGISTRATION=false      OSINT_LIVE_CHECKS=false
```

| Variable | Default | Notes |
| :--- | :--- | :--- |
| `ENVIRONMENT` | `development` | `production` enables the guard rails below |
| `DATABASE_URL` | `sqlite:///<backend>/finrisk.db` | SQLAlchemy URL |
| `SECRET_KEY` | generated | **Required** when `ENVIRONMENT=production` |
| `CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173` | Comma-separated |
| `ALLOW_OPEN_REGISTRATION` | `true` | Forced off in production |
| `DEMO_DATA_ENABLED` | `true` | Forced off in production |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `720` | |
| `LOGIN_RATE_LIMIT_ATTEMPTS` / `_WINDOW_SECONDS` | `8` / `300` | Per email + client IP |
| `MIN_PASSWORD_LENGTH` | `10` | Plus a mixed-character and distinct-character rule |
| `OSINT_LIVE_CHECKS` | `true` | When false, vendor scanning makes no network or DNS calls |
| `NVD_API_KEY` | empty | Optional; raises the NVD rate limit |

In development the JWT signing key is generated once and written to
`backend/.finrisk_secret` (git-ignored) so restarts do not invalidate sessions. In
production a key is never auto-generated — startup fails with a clear error instead.

Frontend variables (`frontend/.env`): `VITE_API_BASE_URL` (empty means "same origin")
and `VITE_DEV_API_TARGET`. Only `VITE_`-prefixed values reach the browser bundle, so
no secret belongs in that file.

---

## 6. Roles and permissions

Enforced server-side on every request. The same list drives which buttons the UI hides;
hiding a button is presentation, not security.

| Role | Rank | Capabilities |
| :--- | :--- | :--- |
| `admin` | 4 | Everything, including `audit:read`, `org:manage`, `user:manage`, `ai:train` |
| `risk_manager` | 3 | Write risk, asset, financial, vulnerability and mitigation records; export reports; manage organization and users; train models |
| `analyst` | 2 | Write risk, asset, financial, vulnerability and mitigation records; export reports |
| `viewer` | 1 | Read-only across all registers |

Only `admin` can read the audit trail. Tenant scoping is independent of role: a
superuser naming an organization they do not belong to in `X-Organization-Id` still
receives `403`.

---

## 7. Tests

**Backend** — 66 tests covering auth, tenancy isolation, the risk register, the
financial engine, the TILT module, reports, the audit trail and the system endpoints.
They set their own environment, use a throwaway SQLite file, and reset the schema per
test.

```bash
cd backend
pip install -r requirements-dev.txt
pytest
```

**Frontend** — 77 Vitest tests over the presentation helpers (the money and missing-value
rules), the URL-backed list state and the core UI primitives.

```bash
cd frontend
npm run test        # vitest run
npm run typecheck   # tsc --noEmit
npm run build       # typecheck + production build
```

---

## 8. Deployment

### Frontend

```bash
cd frontend
npm run build
```

This typechecks first, then emits a static bundle to `frontend/dist/`. Serve it from any
static host. Set `VITE_API_BASE_URL` at build time if the API is not on the same origin;
leave it empty and reverse-proxy `/api` to the backend if it is.

### Backend

```bash
cd backend
ENVIRONMENT=production \
SECRET_KEY="<48+ random bytes>" \
CORS_ORIGINS="https://your-frontend.example.com" \
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

Or with the supplied image (built from the **repository root**, since the build context
must contain both the requirements file and the backend source):

```bash
docker build -f backend/Dockerfile -t finrisk-api .
docker run --rm -p 8000:8000 \
  -e ENVIRONMENT=production \
  -e SECRET_KEY="..." \
  -e CORS_ORIGINS="https://your-frontend.example.com" \
  -v finrisk-data:/data \
  finrisk-api
```

Checklist before exposing an instance:

* [ ] `ENVIRONMENT=production` and an explicit `SECRET_KEY`.
* [ ] `CORS_ORIGINS` names only your real frontend origins.
* [ ] The API is behind TLS (tokens travel in the `Authorization` header).
* [ ] `backend/.finrisk_secret`, any `.env` and the database file are **not** in version
      control — the repository `.gitignore` covers all three.
* [ ] `/api/health` reports the schema revisions you expect.

### PostgreSQL

`DATABASE_URL` accepts any SQLAlchemy URL, and the schema is portable, but **no
PostgreSQL driver is installed by default**. Add one before switching:

```bash
pip install "psycopg[binary]"
```

`backend/Dockerfile` installs `libpq5` so only the Python driver is missing.

---

## 9. Project structure

```
FINRISK/
├── backend/
│   ├── app/
│   │   ├── main.py               FastAPI app factory, routers, error envelope
│   │   ├── config.py             Environment-driven settings
│   │   ├── db.py                 Engine, sessions, ordered migration runner
│   │   ├── models.py             SQLAlchemy ORM models
│   │   ├── schemas.py            Pydantic request/response models
│   │   ├── domain.py             Roles, permissions, severity bands, audit actions
│   │   ├── deps.py               Auth, role, tenant and paging dependencies
│   │   ├── security.py           Password hashing, JWT, rate limiting
│   │   ├── cli.py                seed-demo and status commands
│   │   ├── routers/              One module per API area
│   │   ├── services/             Reports, OSINT, scenarios, demo data, exports
│   │   ├── scoring/              Risk and financial scoring rules
│   │   └── ml/                   Optional model training and inference
│   ├── data/                     TILT questionnaire templates (seeded by migration)
│   ├── tests/                    pytest suite
│   └── requirements*.txt
├── frontend/
│   ├── src/
│   │   ├── app/                  Providers, router, navigation
│   │   ├── components/           UI primitives and layout shell
│   │   ├── hooks/                URL-backed list state
│   │   ├── lib/                  API client, formatting rules, query client
│   │   ├── pages/                One module per screen
│   │   └── types/                Shared API types
│   └── vite.config.ts            Dev proxy and Vitest configuration
├── docs/                         Algorithms, OSINT notes, Linux setup
├── run.sh / run.ps1              Dev convenience wrappers
└── README.md
```

---

## 10. Known limitations

These are deliberate, documented boundaries — not outstanding bugs.

**Data and model honesty**
* Scores are a convention, not objective truth. The 5×5 likelihood × impact score
  encodes an analyst-defined scale; the same is true of severity bands and of the
  model's target, which is that band.
* The ML model reproduces the organization's own scoring convention. Predicted
  probabilities are **model scores and are not calibrated real-world probabilities**,
  and feature attributions describe model behaviour only — they are not causal claims.
* With fewer than `RETRAIN_MIN_ROWS` (default 60) stored rows the model cannot be
  trained; the API reports a rule-based fallback state instead of a number.
* Demonstration and synthetic rows carry no information about any real organization.
* Financial figures depend entirely on the assumptions entered. They are scenario
  arithmetic, not forecasts, and no currency is ever converted.

**Output formats**
* Server-side report rendering produces CSV and PDF. The API also accepts `json` for
  programmatic callers, but `json` is rejected on the export endpoint, which records
  report history.
* PDF layout is fixed: no custom branding, templating or pagination control.

**External intelligence**
* With `OSINT_LIVE_CHECKS=false` no network or DNS calls are made at all; vendor scans
  return an explicit "checks are disabled" note. With checks enabled, results depend on
  third-party services (NVD, CISA KEV, public DNS, Ransomwatch) and are only as current
  and as complete as those sources. Findings are advisory.
* There is no scheduled background scanning; scans run on request.

**Deployment and operations**
* No email delivery: notifications are in-app only, and there is no password-reset flow.
  An administrator must set a new password.
* SQLite is the default and is fine for a single instance. A multi-worker or multi-host
  deployment should move to PostgreSQL **and install a driver** (see §8).
* Rate limiting is in-process (a sliding window held in memory), so it is per-worker and
  resets on restart. A reverse proxy or shared store should enforce the real limit at
  the edge.
* The audit trail is append-only and organization-scoped; it is not shipped anywhere and
  has no retention policy.
* The frontend ships as a single JavaScript bundle (~1.1 MB, ~300 KB gzipped). There is
  no route-level code splitting yet, so the first load fetches the whole application.
* Vulnerability findings can be imported from a CSV file. The upload is capped by
  `MAX_UPLOAD_MB` (default 5) and is parsed in memory; there is no virus scanning and no
  asynchronous job queue for very large files.

**Legacy material**
* `backend/main.py`, `backend/database.py`, `backend/risk_calculator.py`,
  `backend/osint_service.py` and `backend/ransom_cache.json` are the superseded
  single-tenant TILT application. They are **not** imported by `app.main` and are kept
  only for reference. The current TILT vendor module lives in
  [`backend/app/routers/tilt.py`](backend/app/routers/tilt.py) and
  [`backend/app/services/legacy_calculator.py`](backend/app/services/legacy_calculator.py).
  Migration `0003_import_legacy_tilt` opens an existing `tilt_data.db` read-only and
  imports its vendors; it never mutates the legacy file.

---

## 11. Further documentation

* [`docs/RISK_MATRIX_ALGORITHM.txt`](docs/RISK_MATRIX_ALGORITHM.txt) — TILT risk matrix and scoring
* [`docs/OSINT_CHECKS_DOCUMENTATION.txt`](docs/OSINT_CHECKS_DOCUMENTATION.txt) — OSINT checks and their impact
* [`docs/LINUX_SETUP.md`](docs/LINUX_SETUP.md) — Linux setup notes
* [`PROJECT_SUMMARY.md`](PROJECT_SUMMARY.md) — feature and API inventory
