# FinRisk AI backend image.
#
# Build from the repository root so the context contains both the backend
# source and its requirements file:
#
#     docker build -f backend/Dockerfile -t finrisk-api .
#     docker run --rm -p 8000:8000 \
#       -e ENVIRONMENT=production \
#       -e SECRET_KEY="$(python -c 'import secrets;print(secrets.token_urlsafe(48))')" \
#       -e CORS_ORIGINS=https://your-frontend.example.com \
#       -v finrisk-data:/data \
#       finrisk-api
#
# Only the runtime dependencies are installed.  The optional machine-learning
# stack (backend/requirements-ml.txt) is much larger and is not required: the
# API reports a documented rule-based fallback when it is absent.

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# libpq is kept so a PostgreSQL DATABASE_URL can be used without a rebuild.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./

# Keep the SQLite database on a mounted volume so it survives a restart when
# PostgreSQL is not in use.  In production always pass SECRET_KEY explicitly
# (as in the example above); otherwise a development key is generated inside
# the container and is lost on every replacement, invalidating all sessions.
ENV DATABASE_URL=sqlite:////data/finrisk.db
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8000

# Migrations run automatically on startup (see the app lifespan handler).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
