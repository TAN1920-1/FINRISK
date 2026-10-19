"""Management commands for FinRisk AI.

Run from the ``backend`` directory::

    python -m app.cli seed-demo --email you@example.com

Only explicitly requested, development-oriented operations live here.  The API
server itself is started with ``uvicorn app.main:app``.
"""

from __future__ import annotations

import argparse
import json
import secrets
import sys
from typing import Optional, Sequence

from .config import settings
from .db import applied_migrations, run_migrations, session_scope
from .security import PasswordPolicyError, validate_password_strength
from .services.demo_data import DEMO_ORGANIZATION_SLUG, seed_demo_data


def _cmd_seed_demo(args: argparse.Namespace) -> int:
    """Create the labelled synthetic demonstration organization."""
    if not settings.demo_data_enabled:
        print(
            "Demonstration data is disabled for this environment "
            f"(ENVIRONMENT={settings.environment}). Nothing was changed.",
            file=sys.stderr,
        )
        return 1

    password: Optional[str] = args.password
    generated = False
    if not password:
        # Never ship a fixed default credential: a predictable demo password is
        # exactly the thing that ends up in a public deployment.
        password = secrets.token_urlsafe(18)
        generated = True

    try:
        validate_password_strength(password)
    except PasswordPolicyError as exc:
        print(f"The supplied password does not meet the policy: {exc}", file=sys.stderr)
        return 1

    print("Applying pending migrations ...")
    for revision in run_migrations():
        print(f"  applied {revision}")
    print(f"Schema revisions present: {', '.join(applied_migrations()) or 'none'}")

    with session_scope() as db:
        summary = seed_demo_data(
            db,
            admin_email=args.email,
            admin_password=password,
            admin_name=args.name,
        )

    print(json.dumps(summary, indent=2))
    if summary.get("created"):
        print(
            "\nWARNING: all rows created by this command are SYNTHETIC demonstration data.\n"
            "They are flagged is_demo=True and are not evidence about any real organization.\n"
            "The demonstration organization must not be used for real risk decisions."
        )
        if generated:
            print(f"\nGenerated administrator password (shown once): {password}")
    return 0


def _cmd_status(_args: argparse.Namespace) -> int:
    """Report the environment and the schema revisions recorded in the database."""
    print(f"Application : {settings.app_name} {settings.app_version}")
    print(f"Environment : {settings.environment}")
    print(f"Database    : {settings.database_url}")
    print(f"Demo data   : {'enabled' if settings.demo_data_enabled else 'disabled'}")
    print(f"Migrations  : {', '.join(applied_migrations()) or 'none applied'}")
    print(f"Demo org slug: {DEMO_ORGANIZATION_SLUG}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description=__doc__)
    subcommands = parser.add_subparsers(dest="command", required=True)

    seed = subcommands.add_parser(
        "seed-demo",
        help="Create the synthetic demonstration organization (development only).",
        description=(
            "Create a clearly-labelled, synthetic demonstration organization with assets, "
            "risks, loss scenarios, vulnerability findings and remediation actions. The "
            "command is idempotent: if the demonstration organization already exists it "
            "reports that and changes nothing."
        ),
    )
    seed.add_argument("--email", required=True, help="Email for the demonstration administrator.")
    seed.add_argument(
        "--password",
        default=None,
        help="Password for the demonstration administrator. Generated and printed once if omitted.",
    )
    seed.add_argument("--name", default="Demo Administrator", help="Full name of the administrator.")
    seed.set_defaults(func=_cmd_seed_demo)

    status = subcommands.add_parser("status", help="Show environment and migration status.")
    status.set_defaults(func=_cmd_status)

    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    raise SystemExit(main())
