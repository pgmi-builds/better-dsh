#!/usr/bin/env bash
# start.sh — bring up the plugin-add test rig (test123): a CLEAN harness
# checkout serving a profile whose plugins are PHYSICAL installs (tarball via
# `dsh plugin add`), never workspace symlinks.
#
# Usage:  bash .test/seed/test123/start.sh                 # default port 4999
#         PORT=4988 bash .test/seed/test123/start.sh       # override
#         LAN=0 bash .test/seed/test123/start.sh           # skip the LAN relay (default on)
#         RIG_HOME=clean bash .test/seed/test123/start.sh  # boot the disposable clean home
#         TRUSTED_HOSTS='' bash .test/seed/test123/start.sh # omit the CLI allowlist for authentication-only mode
#
# Shape (see README.md): DSH_HOME=.test/home/${RIG_HOME:-compat}, profile `web`.
# compat = the long-lived default home (user data is a test asset — sessions,
# storages and .credentials.yaml survive profile rebuilds); RIG_HOME=clean
# points at a disposable home for first-boot checks (delete it afterwards).
# Resolution = 0.1.7 installation interception (installation scope = the
# upstream checkout); the profile's own node_modules holds only what
# `plugin add` put there. The legacy profiles/node_modules symlink farm was
# abolished 2026-09-26 (interception supplies all harness packages).
#
# 2026-09-27 user rulings baked in below:
#   • ports are UNOWNED test ports (4999 included): this rig stops test-owned
#     occupant units and takes the port; only a non-test listener refuses.
#   • the auth seed persists in the home's .credentials.yaml — browser cookies
#     stay valid across restarts (30-day window); the ?token= in each boot's
#     log is a per-process launch token for FIRST mint only.
set -euo pipefail

PORT="${PORT:-4999}"
LAN="${LAN:-1}"
RIG_HOME="${RIG_HOME:-compat}"   # compat | clean (guide §3.3 pairing)
UNIT="dsh-${PORT}-test123"
RELAY="test123-lan-${PORT}-relay"
REPO="$HOME/workspaces/dashr"
HARNESS="$REPO/upstream/deepseek-harness"
HOME_DIR="$REPO/.test/home/$RIG_HOME"
LOG="$REPO/.scratch/dsh-${PORT}-test123.log"
NODE_BIN="$(which node)"
LAN_IP=$(hostname -I | awk '{print $1}')
# Native/clean rigs still need an allowlist. Authentication-only profiles can
# explicitly leave it empty; listening and the LAN relay do not change.
read -r -a TRUST_HOSTS <<< "${TRUSTED_HOSTS-127.0.0.1 $LAN_IP test.pc.randomhash.app pc.randomhash.app}"
TRUST_ARGS=()
if [ "${#TRUST_HOSTS[@]}" -gt 0 ]; then
  TRUST_ARGS=(--trusted-host "${TRUST_HOSTS[@]}")
fi

mkdir -p "$REPO/.scratch"

if [ ! -f "$HOME_DIR/profiles/web/package.json" ]; then
  echo "profile $HOME_DIR/profiles/web not initialized — run the README setup (plugin add initializes it)" >&2
  exit 1
fi

systemctl --user stop "$UNIT" "$RELAY" 2>/dev/null || true
systemctl --user reset-failed "$UNIT" "$RELAY" 2>/dev/null || true
# Map the port's listener pid to its user unit via /proc/<pid>/cgroup; a
# test-owned occupant is stopped and the port taken over (2026-09-27 ruling:
# test ports are unowned — 4999 included). Only a non-test listener refuses.
test_unit_on_port() {
  local pid unit
  pid=$(ss -tlnp 2>/dev/null | grep ":${PORT} " | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)
  [ -n "$pid" ] || return 1
  unit=$(sed -n 's#^.*/\([^/]*\.service\)$#\1#p' "/proc/${pid}/cgroup" 2>/dev/null | head -1)
  [ -n "$unit" ] || return 1
  case "$unit" in
    dsh-*|test123-*|bun-test-*|superd-*|*-test|*-relay) printf '%s' "$unit" ;;
    *) return 1 ;;
  esac
}
for _ in $(seq 1 15); do
  ss -tln | grep -q ":${PORT} " || break
  sleep 1
done
if ss -tln | grep -q ":${PORT} "; then
  if OCCUPANT=$(test_unit_on_port); then
    echo "--- port ${PORT} held by test unit ${OCCUPANT}: stopping (ports are unowned test infra)"
    systemctl --user stop "$OCCUPANT"
    for _ in $(seq 1 15); do ss -tln | grep -q ":${PORT} " || break; sleep 1; done
  fi
fi
if ss -tln | grep -q ":${PORT} "; then
  echo "refusing to start: port ${PORT} held by a non-test listener:" >&2
  ss -tlnp | grep ":${PORT} " >&2 || true
  echo "  pick another port: PORT=<free> bash .test/seed/test123/start.sh" >&2
  exit 1
fi

LOG_LINES=$( (wc -l < "$LOG") 2>/dev/null || echo 0)
# ONE credential seed for every test rig on this machine (2026-10-04 user
# ruling): the browser cookie is HMAC-signed with the secret inside the
# credentials document and named after the AUTHORITY, and both repos' rigs are
# reached through the same test.pc.randomhash.app — so a per-home seed makes
# every port takeover from the other repo invalidate the cookie the user just
# minted. superd's launcher points the upstream `credentials` row at the same
# shared file, so the two repos (and every port either one boots) agree.
# The file is seeded from this home's own document on first use, so adopting
# the convention never invalidates a cookie already held. compat keeps its own
# copy untouched — the row override is what makes it irrelevant.
SHARED_CREDENTIALS="${DSH_TEST_CREDENTIALS:-$(dirname "$REPO")/.dsh-test-credentials.yaml}"
SHARED_CREDENTIALS="$(cd "$(dirname "$SHARED_CREDENTIALS")" && pwd)/$(basename "$SHARED_CREDENTIALS")"
if [ ! -f "$SHARED_CREDENTIALS" ] && [ -f "$HOME_DIR/.credentials.yaml" ]; then
  install -m 600 "$HOME_DIR/.credentials.yaml" "$SHARED_CREDENTIALS"
fi
SEED_EXISTED=""
[ -f "$SHARED_CREDENTIALS" ] && SEED_EXISTED=1

# Ensure the profile patch routes the credentials row at the shared file
# (idempotent: `dsh plugin add` owns this file, so it is ensured, not written).
PATCH="$HOME_DIR/profiles/web/cordis.patch.yml"
if [ -f "$PATCH" ] && grep -q "^- id: credentials" "$PATCH"; then
  if ! grep -q "path: ${SHARED_CREDENTIALS}" "$PATCH"; then
    awk -v path="$SHARED_CREDENTIALS" '
      /^- id: credentials/ { skip = 1; next }
      skip && /^- id:/ { skip = 0 }
      skip { next }
      { print }
      END {
        print "";
        print "# One credential seed for every test rig on this machine (2026-10-04 ruling):";
        print "# a per-home seed makes each cross-repo port takeover invalidate the browser";
        print "# cookie (same test.pc.randomhash.app authority, different signing secret).";
        print "- id: credentials";
        print "  config:";
        print "    path: " path;
      }' "$PATCH" > "$PATCH.tmp" && mv "$PATCH.tmp" "$PATCH"
  fi
elif [ -f "$PATCH" ]; then
  cat >> "$PATCH" <<EOF

# One credential seed for every test rig on this machine (2026-10-04 ruling):
# a per-home seed makes each cross-repo port takeover invalidate the browser
# cookie (same test.pc.randomhash.app authority, different signing secret).
- id: credentials
  config:
    path: ${SHARED_CREDENTIALS}
EOF
fi
HARNESS_LIB_BIN="$HARNESS/apps/cli/lib/bin.js"
if [ ! -f "$HARNESS_LIB_BIN" ]; then
  echo "missing $HARNESS_LIB_BIN — run \`pnpm run build\` in the harness checkout first" >&2
  exit 1
fi
systemd-run --user --unit="$UNIT" \
  -p WorkingDirectory="$HARNESS" \
  -p Environment="DSH_HOME=$HOME_DIR" \
  -p 'UnsetEnvironment=DISPLAY WAYLAND_DISPLAY DSH_TRUSTED_HOSTS' \
  -p StandardOutput=append:"$LOG" \
  -p StandardError=append:"$LOG" \
  "$NODE_BIN" "$HARNESS_LIB_BIN" web --no-open --port "$PORT" "${TRUST_ARGS[@]}"

ok=""
for _ in $(seq 1 30); do
  sleep 2
  if ss -tln | grep -q "127.0.0.1:${PORT} "; then ok=1; break; fi
  systemctl --user is-active --quiet "$UNIT" || { tail -30 "$LOG" >&2; exit 1; }
done
[ -n "$ok" ] || { echo "timeout waiting for 127.0.0.1:${PORT} to listen" >&2; exit 1; }

if [ "$LAN" = "1" ]; then
systemd-run --user --unit="$RELAY" \
  --property=StandardOutput=append:"$LOG" \
  --property=StandardError=append:"$LOG" \
  /usr/bin/socat TCP-LISTEN:"${PORT}",fork,reuseaddr,bind="${LAN_IP}" TCP:127.0.0.1:"${PORT}"
for _ in $(seq 1 10); do
  ss -tln | grep -q "${LAN_IP}:${PORT} " && break
  sleep 1
done
ss -tln | grep -q "${LAN_IP}:${PORT} " || { echo "socat relay not listening on ${LAN_IP}:${PORT}" >&2; exit 1; }
fi

TOK=""
for _ in $(seq 1 15); do
  TOK=$( { tail -n +"$((LOG_LINES + 1))" "$LOG" | grep -o "http://127.0.0.1:${PORT}/?token=[^\" ]*" | tail -1 | grep -o 'token=.*' | cut -d= -f2; } 2>/dev/null || true)
  [ -n "$TOK" ] && break
  sleep 2
done
[ -n "$TOK" ] || { echo "could not find this boot's token in $LOG" >&2; exit 1; }

if [ -n "$SEED_EXISTED" ]; then
  echo "seed:   persisted — existing browser cookies stay valid (≤30d), no re-injection needed;"
  echo "        token URLs below are for first mint / new clients only"
else
  echo "seed:   NEW home — mint your cookie once via a token URL (valid 30d per authority)"
fi
echo "unit:   $UNIT ($([ "$LAN" = 1 ] && echo "+ $RELAY"))"
[ "$LAN" = "1" ] && echo "lan:    http://${LAN_IP}:${PORT}/?token=${TOK}"
echo "local:  http://127.0.0.1:${PORT}/?token=${TOK}"
echo "test.pc: https://test.pc.randomhash.app/?token=${TOK}"
# The token is a ONE-TIME mint per browser/access-domain: the dsh-auth-* cookie
# it sets is signed by the durable secret in $HOME_DIR/.credentials.yaml
# (client-connection:browser-session, 30-day lifetime), so it stays valid across
# restarts of this rig — afterwards just open the clean URL
# https://test.pc.randomhash.app/ directly. Only a new browser/domain, a home
# reset, or cookie expiry needs the token again.
