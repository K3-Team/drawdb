#!/usr/bin/env bash
# Load a DDL file into a throwaway in-memory SQLite DB. Exit non-zero on any
# SQL error (-bail stops at the first error and sets the exit code).
# Usage: nix-shell -p sqlite --run "bash scripts/livedb/sqlite.sh <ddl.sql>"
set -euo pipefail
sqlite3 -bail ":memory:" < "$1" >/dev/null
