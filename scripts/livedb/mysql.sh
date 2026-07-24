#!/usr/bin/env bash
# Spin up a throwaway MySQL/MariaDB server (unix socket only, grants skipped),
# load a DDL file, tear down. Works for both engines: the binaries differ
# (mariadbd/mysqld, mariadb/mysql), so we detect whatever nix put on PATH.
# The mysql client runs in batch mode, which stops at the first SQL error and
# exits non-zero, so a rejected statement fails the script.
# Usage: nix-shell -p mariadb --run "bash scripts/livedb/mysql.sh <ddl.sql>"
#        nix-shell -p mysql84 --run "bash scripts/livedb/mysql.sh <ddl.sql>"
set -uo pipefail
tmp=$(mktemp -d)
sock="$tmp/d.sock"
SERVER=$(command -v mariadbd || command -v mysqld || true)
CLIENT=$(command -v mariadb || command -v mysql || true)
INSTALL=$(command -v mariadb-install-db || command -v mysql_install_db || true)
[ -n "$SERVER" ] && [ -n "$CLIENT" ] || exit 90

pid=""
cleanup() {
  [ -n "$pid" ] && kill "$pid" 2>/dev/null
  [ -n "$pid" ] && wait "$pid" 2>/dev/null
  rm -rf "$tmp"
}
trap cleanup EXIT

# Init the data dir. MariaDB uses *-install-db; MySQL 8 uses --initialize-insecure.
if [ -n "$INSTALL" ]; then
  "$INSTALL" --datadir="$tmp/data" --auth-root-authentication-method=normal >/dev/null 2>&1 \
    || "$INSTALL" --datadir="$tmp/data" >/dev/null 2>&1 || exit 91
else
  "$SERVER" --no-defaults --initialize-insecure --datadir="$tmp/data" >/dev/null 2>&1 || exit 91
fi

"$SERVER" --no-defaults --datadir="$tmp/data" --socket="$sock" \
  --skip-networking --skip-grant-tables --pid-file="$tmp/pid" >/dev/null 2>&1 &
pid=$!

for _ in $(seq 1 120); do
  [ -S "$sock" ] && break
  kill -0 "$pid" 2>/dev/null || exit 92
  sleep 0.5
done
[ -S "$sock" ] || exit 93

"$CLIENT" --no-defaults --socket="$sock" -u root -e "CREATE DATABASE testdb;" >/dev/null 2>&1 || exit 94
"$CLIENT" --no-defaults --socket="$sock" -u root testdb < "$1"
