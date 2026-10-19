# FinRisk AI — Linux Setup Guide

Linux specifics for running FinRisk AI. The authoritative run and deploy instructions
live in [../README.md](../README.md); this file covers only the Linux details.

## Prerequisites

- **Python 3.12+** — `python3 --version`
- **Node.js 20+ and npm** — `node --version`
- Tested on Ubuntu/Debian; other distributions should work.
- On Debian/Ubuntu the virtual environment module is a separate package:

  ```bash
  sudo apt-get install -y python3-venv
  ```

## Quick start

```bash
./run.sh
```

The script creates `backend/venv` if it is missing, installs both dependency sets, and
starts:

- the API on <http://127.0.0.1:8000>
- the frontend dev server on <http://localhost:5173>

Press `Ctrl+C` in that terminal to stop both.

## Manual setup

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

`app.main:app` must be run from inside `backend/`. Database migrations are applied
automatically on startup, so there is no separate migrate step.

### Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

The dev server proxies `/api` to `http://127.0.0.1:8000`, so the browser only ever talks
to one origin. Set `VITE_DEV_API_TARGET` to point the proxy somewhere else.

### First account

Open <http://localhost:5173> and register. The first account becomes the administrator.
There is no default password.

## Tests

```bash
# Backend
cd backend
source venv/bin/activate
pip install -r requirements-dev.txt
pytest

# Frontend
cd frontend
npm run test
npm run typecheck
```

## Deployment

See [../README.md §8](../README.md#8-deployment). In short: `npm run build` emits
`frontend/dist/`, and the API runs behind a process manager or the supplied
`backend/Dockerfile`. Set `ENVIRONMENT=production` and an explicit `SECRET_KEY`, and
never commit `backend/.finrisk_secret`, `.env` or the database file.

## Troubleshooting

### Port already in use

The frontend dev server uses `strictPort`, so it fails rather than silently moving to
another port.

- **Backend:** choose another `--port`.
- **Frontend:** change `server.port` in `frontend/vite.config.ts`, or free port 5173.

### `ModuleNotFoundError: No module named 'app'`

Uvicorn was started from the repository root instead of `backend/`. Either `cd backend`
first or pass `--app-dir backend`.

### `sqlite3.OperationalError: database is locked`

Only one process may hold the SQLite file at a time. Stop other running instances. The
file lives at `backend/finrisk.db` by default; override it with `DATABASE_URL`. Delete it
to start from an empty schema — migrations re-run on the next start.

### Sessions drop on every restart

The development signing key is stored in `backend/.finrisk_secret`. If that file is not
writable, a new key is generated on each start and every existing token becomes invalid.
Supply a fixed `SECRET_KEY` instead.

### `SECRET_KEY must be provided explicitly when ENVIRONMENT=production`

Intentional. Production never auto-generates a signing key. Provide one:

```bash
export SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
```

### CORS errors in the browser

Add the exact frontend origin (scheme, host and port) to `CORS_ORIGINS`, which is a
comma-separated list.
