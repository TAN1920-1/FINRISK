"""FinRisk AI backend application package.

The package is organised as a small, layered FastAPI application:

* ``config``   - environment-driven settings
* ``db``       - SQLAlchemy engine, session handling and ordered migrations
* ``models``   - ORM entities (single source of truth for the relational schema)
* ``schemas``  - Pydantic request/response contracts
* ``security`` - password hashing, JWT issuing/validation, rate limiting
* ``deps``     - reusable FastAPI dependencies (auth, roles, org scoping, paging)
* ``scoring``  - deterministic, unit-tested business rules (risk + financial)
* ``ml``       - training pipeline, persisted model metadata and inference
* ``services`` - external integrations and report rendering
* ``routers``  - HTTP layer only
"""

__all__ = ["__version__"]

__version__ = "2.0.0"
