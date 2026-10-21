# Database layer using SQLite3 (stdlib).
# Access is protected by a master password whose Argon2 hash is stored in `.tilt_key`.
# SQLCipher encryption is planned for production deployment.

import json
import sqlite3
from pathlib import Path
from typing import Any, Optional

from passlib.context import CryptContext

# Paths
DB_PATH = Path(__file__).parent / 'tilt_data.db'
KEY_PATH = Path(__file__).parent / '.tilt_key'

# Module state
_CONN: Optional[sqlite3.Connection] = None
_IS_LOCKED: bool = True

# Argon2 password hashing context
_pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")


def get_db() -> sqlite3.Connection:
    """Get the active database connection, raising if locked."""
    if _CONN is None or _IS_LOCKED:
        raise Exception('Database is locked. Please unlock first.')
    return _CONN


def is_locked() -> bool:
    return _IS_LOCKED


def needs_password() -> bool:
    """Check if this is first-time setup (no password file exists)."""
    return not KEY_PATH.exists()


def init_db(conn: Optional[sqlite3.Connection] = None):
    """Create the schema (if needed) and seed default data."""
    if conn is None:
        conn = get_db()

    # Vendors table
    conn.execute('''
        CREATE TABLE IF NOT EXISTS vendors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            status TEXT NOT NULL,
            data_classification INTEGER,
            impact REAL NOT NULL DEFAULT 3,
            likelihood REAL NOT NULL DEFAULT 3,
            vulnerability INTEGER NOT NULL DEFAULT 100,
            weakness TEXT,
            strength TEXT,
            assessment_type TEXT,
            answers TEXT,
            cloudScores TEXT,
            osint_warnings TEXT,
            osint_urls TEXT,
            osint_acknowledged INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Questions table
    conn.execute('''
        CREATE TABLE IF NOT EXISTS questions (
            id INTEGER PRIMARY KEY,
            nist_control TEXT,
            category TEXT,
            policy_ref TEXT,
            question TEXT NOT NULL,
            weight TEXT,
            maturity_levels TEXT,
            notes TEXT
        )
    ''')

    # Cloud criteria table
    conn.execute('''
        CREATE TABLE IF NOT EXISTS cloud_criteria (
            id INTEGER PRIMARY KEY,
            category TEXT,
            criterion TEXT NOT NULL,
            description TEXT,
            criticality TEXT,
            points INTEGER,
            osint_source TEXT,
            maturity_levels TEXT,
            notes TEXT
        )
    ''')

    # Settings table
    conn.execute('''
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    ''')
    conn.commit()

    seed_default_data(conn)


def seed_default_data(conn: Optional[sqlite3.Connection] = None):
    """Seed default questions and cloud criteria from JSON files."""
    if conn is None:
        conn = get_db()

    # Questions
    if conn.execute('SELECT COUNT(*) FROM questions').fetchone()[0] == 0:
        q_path = Path(__file__).parent / 'data' / 'questions_standard.json'
        if q_path.exists():
            with open(q_path) as f:
                questions = json.load(f)
            for q in questions:
                conn.execute('''
                    INSERT INTO questions (id, nist_control, category, policy_ref, question, weight, maturity_levels)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', (
                    q['id'], q.get('nist_control'), q.get('category'),
                    q.get('policy_ref'), q['question'], q.get('weight'),
                    json.dumps(q.get('maturity_levels', {}))
                ))

    # Cloud criteria
    c_path = Path(__file__).parent / 'data' / 'questions_cloud.json'
    if c_path.exists():
        with open(c_path) as f:
            criteria = json.load(f)
        if conn.execute('SELECT COUNT(*) FROM cloud_criteria').fetchone()[0] == 0:
            for c in criteria:
                conn.execute('''
                    INSERT INTO cloud_criteria (id, category, criterion, description, criticality, points, osint_source, maturity_levels)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    c['id'], c.get('category'), c['criterion'],
                    c.get('description'), c.get('criticality'), c.get('points'),
                    c.get('osint_source'), json.dumps(c.get('maturity_levels', {}))
                ))

    # Settings
    if conn.execute('SELECT COUNT(*) FROM settings').fetchone()[0] == 0:
        conn.execute('INSERT INTO settings (key, value) VALUES (?, ?)', ('orgName', 'Your Organisation'))

    conn.commit()


def unlock_db(password: str) -> dict[str, Any]:
    """Unlock the database using the supplied password.
    On first run this creates the password; afterwards it is verified.
    """
    global _CONN, _IS_LOCKED

    if not password:
        raise ValueError('Password required')

    # Strip any surrounding whitespace from the provided password to avoid false mismatches
    password = password.strip()
    if KEY_PATH.exists():
        stored_hash = KEY_PATH.read_text().strip()
        if not _pwd_context.verify(password, stored_hash):
            raise ValueError('Invalid password')
    else:
        if len(password) < 8:
            raise ValueError('Password must be at least 8 characters')
        KEY_PATH.write_text(_pwd_context.hash(password))

    _CONN = sqlite3.connect(DB_PATH, check_same_thread=False)
    _CONN.row_factory = sqlite3.Row
    _IS_LOCKED = False
    init_db(_CONN)
    return {'success': True}


def change_password(old_password: str, new_password: str) -> dict[str, Any]:
    """Change the stored master password."""
    if _IS_LOCKED:
        raise Exception('Database must be unlocked first')
    if not old_password or not new_password:
        raise ValueError('Both old and new passwords required')
    if len(new_password) < 8:
        raise ValueError('New password must be at least 8 characters')

    if KEY_PATH.exists():
        stored_hash = KEY_PATH.read_text().strip()
        if not _pwd_context.verify(old_password, stored_hash):
            raise ValueError('Current password is incorrect')

    KEY_PATH.write_text(_pwd_context.hash(new_password))
    return {'success': True}
