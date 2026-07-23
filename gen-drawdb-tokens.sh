#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
OUT="${OUT:-$SCRIPT_DIR/drawdb-tokens.yaml}"
SECRET_KEY="${SECRET_KEY:-drawdb-tokens}"

# Distinct, readable cursor colours; cycles if there are more people than colours.
PALETTE=("#2563eb" "#dc2626" "#16a34a" "#d97706" "#7c3aed" "#0891b2" "#db2777" "#65a30d")

die() { printf '%s\n' "$*" >&2; exit 1; }

[ $# -gt 0 ] || die "usage: $0 <userid[:display name[:#colour]]> ...

  $0 ann bob carol
  $0 \"ann:Ann Smith:#2563eb\" bob"

for cmd in jq openssl; do
  command -v "$cmd" >/dev/null || die "missing required command: $cmd"
done

if [ -e "$OUT" ] && [ "${FORCE:-0}" != "1" ]; then
  die "refusing to overwrite existing $OUT (set FORCE=1 to replace).
Existing token maps are not recoverable once overwritten."
fi

json='{}'
i=0
declare -a REPORT=()
declare -a SEEN=()

for spec in "$@"; do
  IFS=':' read -r uid display colour <<<"$spec"

  [ -n "$uid" ] || die "empty userid in argument: '$spec'"
  for prev in ${SEEN[@]+"${SEEN[@]}"}; do
    [ "$prev" != "$uid" ] || die "duplicate userid: '$uid'"
  done
  SEEN+=("$uid")

  display="${display:-$uid}"
  colour="${colour:-${PALETTE[$(( i % ${#PALETTE[@]} ))]}}"

  case "$colour" in
    '#'[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]) ;;
    '#'[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]) ;;
    *) die "colour must be #rgb or #rrggbb, got '$colour' (from '$spec')" ;;
  esac

  token="$(openssl rand -hex 32)"

  json="$(jq -n --argjson acc "$json" --arg t "$token" --arg u "$uid" \
                --arg d "$display" --arg c "$colour" \
          '$acc + {($t): {userId: $u, displayName: $d, color: $c}}')"

  REPORT+=("$(printf '%-14s %-22s %-9s %s' "$uid" "$display" "$colour" "$token")")
  i=$(( i + 1 ))
done

# Enforce what the server actually requires. server/auth.js SILENTLY SKIPS any
# entry lacking a string userId or displayName — that user simply cannot log in,
# with no error and nothing in the log. Catch it here instead.
bad="$(jq -r '
  to_entries[]
  | select((.value.userId|type) != "string" or (.value.displayName|type) != "string")
  | .key' <<<"$json")"
[ -z "$bad" ] || die "internal error: entries missing userId/displayName"

# Credentials: create with restrictive permissions from the outset, never
# world-readable even briefly.
umask 077
{
  printf '%s: |\n' "$SECRET_KEY"
  jq . <<<"$json" | sed 's/^/  /'
} > "$OUT"
chmod 600 "$OUT"

# Round-trip check: the file must be valid YAML whose value is valid JSON.
if command -v python3 >/dev/null; then
  python3 - "$OUT" "$SECRET_KEY" <<'PY' || die "generated file failed validation"
import json, sys
try:
    import yaml
except ImportError:
    sys.exit(0)  # pyyaml unavailable; skip rather than fail
doc = yaml.safe_load(open(sys.argv[1]))
inner = json.loads(doc[sys.argv[2]])
assert inner, "empty token map"
for tok, ident in inner.items():
    assert isinstance(ident.get("userId"), str)
    assert isinstance(ident.get("displayName"), str)
PY
fi

count="$(jq 'length' <<<"$json")"

echo
echo "Wrote $OUT  ($count token$([ "$count" = 1 ] || echo s), mode 600)"
echo
echo "!! PLAINTEXT CREDENTIALS. Encrypt it, then delete the plaintext."
echo

# A live credential file sitting untracked in a git repo is easy to commit by
# accident. Warn if it is not ignored.
if git -C "$SCRIPT_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  if ! git -C "$SCRIPT_DIR" check-ignore -q "$OUT" 2>/dev/null; then
    echo "WARNING: $(basename "$OUT") is NOT gitignored in this repository."
    echo "         Add it to .gitignore before you commit anything:"
    echo "             echo '$(basename "$OUT")' >> $(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)/.gitignore"
    echo
  fi
fi

printf '%-14s %-22s %-9s %s\n' "USERID" "DISPLAY NAME" "COLOUR" "TOKEN"
printf '%s\n' "${REPORT[@]}"
echo
echo "Distribute each token privately (password manager, Signal) — not email or"
echo "archived chat. They are not recoverable once the plaintext is deleted."
echo
echo "Next, for example with sops:"
echo "    sops --encrypt --filename-override secrets/system/drawdb.enc.yaml \\"
echo "         --input-type yaml --output-type yaml \\"
echo "         '$OUT' > /path/to/secrets/system/drawdb.enc.yaml"
echo "    shred -u '$OUT'"
