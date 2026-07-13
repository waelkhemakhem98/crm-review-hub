"""SQLite connection + schema for the shared review-app backend.

Two kinds of tables live in one file:
  - Reference tables (inactive_candidates, account_index, duplicate_clusters,
    duplicate_cluster_members): rebuilt from the pipeline CSVs any time the
    data refreshes. build_db.py DROPs and re-INSERTs only these.
  - Decision tables (inactive_decisions, duplicate_decisions,
    duplicate_primary_choices): the shared mutable state multiple reviewers
    read/write concurrently. Never touched by a reference-data rebuild --
    this is what must persist on the Docker volume across image rebuilds.
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

DB_PATH = Path(os.environ.get("DB_PATH", Path(__file__).resolve().parent / "data" / "app.db"))

REFERENCE_SCHEMA = """
CREATE TABLE IF NOT EXISTS inactive_candidates (
  accountid TEXT PRIMARY KEY,
  name TEXT,
  statecode_label TEXT,
  statuscode INTEGER,
  industrycode TEXT,
  websiteurl TEXT,
  active_contact_count INTEGER,
  open_opportunity_count INTEGER,
  opendeals INTEGER,
  openrevenue REAL,
  last_activity_date TEXT,
  last_activity_source TEXT,
  createdon TEXT,
  modifiedon TEXT,
  new_strategicaccount INTEGER,
  dormancy_tier INTEGER,
  flag_reasons TEXT,
  possible_duplicate_of TEXT
);

CREATE TABLE IF NOT EXISTS account_index (
  accountid TEXT PRIMARY KEY,
  name TEXT,
  statecode_label TEXT
);

CREATE TABLE IF NOT EXISTS duplicate_clusters (
  cluster_id TEXT PRIMARY KEY,
  signals TEXT,
  confidence TEXT,
  cluster_size INTEGER,
  pending_count INTEGER
);

CREATE TABLE IF NOT EXISTS account_contacts (
  accountid TEXT,
  contactid TEXT,
  fullname TEXT,
  email TEXT
);
CREATE INDEX IF NOT EXISTS idx_account_contacts_accountid ON account_contacts (accountid);

CREATE TABLE IF NOT EXISTS duplicate_cluster_members (
  cluster_id TEXT,
  accountid TEXT,
  name TEXT,
  statecode_label TEXT,
  is_already_merged_away INTEGER,
  existing_masterid TEXT,
  existing_masterid_name TEXT,
  masterid_outside_cluster INTEGER,
  is_suggested_primary INTEGER,
  active_contact_count INTEGER,
  open_opportunity_count INTEGER,
  websiteurl TEXT,
  address1_line1 TEXT,
  address1_city TEXT,
  address1_stateorprovince TEXT,
  address1_postalcode TEXT,
  address1_country TEXT,
  telephone1 TEXT,
  statuscode INTEGER,
  modifiedon TEXT,
  industrycode TEXT,
  opendeals INTEGER,
  openrevenue REAL,
  createdon TEXT,
  PRIMARY KEY (cluster_id, accountid)
);
"""

# Reference tables are rebuilt from CSVs (build_db.py). Listed here so the
# loader can DROP them before re-creating -- CREATE TABLE IF NOT EXISTS won't
# pick up added columns on an existing DB otherwise. Decision tables are never
# in this list, so a rebuild never touches reviewer state.
REFERENCE_TABLES = [
    "inactive_candidates",
    "account_index",
    "account_contacts",
    "duplicate_clusters",
    "duplicate_cluster_members",
]

DECISION_SCHEMA = """
CREATE TABLE IF NOT EXISTS inactive_decisions (
  accountid TEXT PRIMARY KEY,
  decision TEXT,
  merge_target_accountid TEXT,
  merge_target_name TEXT,
  note TEXT,
  reviewer TEXT,
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS duplicate_decisions (
  accountid TEXT PRIMARY KEY,
  decision TEXT,
  note TEXT,
  reviewer TEXT,
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS duplicate_primary_choices (
  cluster_id TEXT PRIMARY KEY,
  accountid TEXT,
  reviewer TEXT,
  decided_at TEXT
);
"""


def get_connection() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=OFF")
    conn.row_factory = sqlite3.Row
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(REFERENCE_SCHEMA)
    conn.executescript(DECISION_SCHEMA)
    conn.commit()


def drop_reference_tables(conn: sqlite3.Connection) -> None:
    """Drop only the CSV-derived reference tables so a rebuild picks up schema
    changes. Decision tables (reviewer state) are deliberately never dropped."""
    for table in REFERENCE_TABLES:
        conn.execute(f"DROP TABLE IF EXISTS {table}")
    conn.commit()


def db_exists() -> bool:
    return DB_PATH.exists()
