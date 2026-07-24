#!/usr/bin/env bash
# Spin up a throwaway PostgreSQL cluster (unix socket only, no TCP), load a DDL
# file with ON_ERROR_STOP, then tear everything down. Exit code = psql's, so any
# rejected statement fails the script.
# Usage: nix-shell -p postgresql --run "bash scripts/livedb/pg.sh <ddl.sql>"
set -uo pipefail
tmp=$(mktemp -d)
cleanup() {
  pg_ctl -D "$tmp/data" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

initdb -D "$tmp/data" -U postgres -A trust >/dev/null 2>&1 || exit 90
pg_ctl -D "$tmp/data" -o "-k $tmp -c listen_addresses=''" -l "$tmp/log" -w start >/dev/null 2>&1 || exit 91
createdb -h "$tmp" -U postgres testdb >/dev/null 2>&1 || exit 92
psql -h "$tmp" -U postgres -d testdb -v ON_ERROR_STOP=1 -q -f "$1"
