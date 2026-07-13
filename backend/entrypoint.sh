#!/bin/sh
set -e

if [ ! -f "$DB_PATH" ]; then
  echo "No existing database at $DB_PATH -- building from seed CSVs..."
  python build_db.py
else
  echo "Using existing database at $DB_PATH (decisions preserved across restarts)."
fi

exec uvicorn app:app --host 0.0.0.0 --port 8000
