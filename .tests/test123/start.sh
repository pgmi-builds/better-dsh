#!/usr/bin/env bash
# start.sh — bring up the plugin-add test rig (test123): a CLEAN harness
# checkout serving a profile whose plugins are PHYSICAL installs (tarball via
# `dsh plugin add`), never workspace symlinks.
#
# Usage:  bash .tests/test123/start.sh                 # default port 4999
#         PORT=4988 bash .tests/test123/start.sh       # override
#         LAN=0 bash .tests/test123/start.sh           # skip the LAN relay (default on)
#
# Shape (see README.md): DSH_HOME=.tests/test123/home, profile `web`.
# The home's profiles/node_modules is the ③-layer symlink farm into the
# upstream checkout (regenerate: node better-dsh/scripts/link-upstream.mjs
# --target <home>/profiles/node_modules). The profile's own node_modules holds
# only what `plugin add` put there.
set -euo pipefail

PORT="${PORT:-4999}"
LAN="${LAN:-1}"
UNIT="dsh-${PORT}-test123"
RELAY="test123-lan-${PORT}-relay"
REPO="$HOME/workspaces/dashr"
HARNESS="$REPO/upstream/deepseek-harness"
HOME_DIR="$REPO/.tests/test123/home"
LOG="$REPO/.scratch/dsh-${PORT}-test123.log"
NODE_BIN="$(which node)"
LAN_IP=$(hostname -I | awk '{print $1}')

mkdir -p "$REPO/.scratch"

if [ ! -f "$HOME_DIR/profiles/web/package.json" ]; then
  echo "profile $HOME_DIR/profiles/web not initialized — run the README setup (plugin add initializes it)" >&2
  exit 1
fi

systemctl --user stop "$UNIT" "$RELAY" 2>/dev/null || true
systemctl --user reset-failed "$UNIT" "$RELAY" 2>/dev/null || true
for _ in $(seq 1 15); do
  ss -tln | grep -q ":${PORT} " || break
  sleep 1
done
if ss -tln | grep -q ":${PORT} "; then
  echo "refusing to start: port ${PORT} already listening (foreign process):" >&2
  ss -tlnp | grep ":${PORT} " >&2 || true
  exit 1
fi

LOG_LINES=$( (wc -l < "$LOG") 2>/dev/null || echo 0)

HARNESS_LIB_BIN="$HARNESS/apps/cli/lib/bin.js"
if [ ! -f "$HARNESS_LIB_BIN" ]; then
  echo "missing $HARNESS_LIB_BIN — run \`pnpm run build\` in the harness checkout first" >&2
  exit 1
fi
systemd-run --user --unit="$UNIT" \
  -p WorkingDirectory="$HARNESS" \
  -p Environment="DSH_HOME=$HOME_DIR" \
  -p "Environment=\"DSH_TRUSTED_HOSTS=test.pc.randomhash.app pc.randomhash.app ${LAN_IP}\"" \
  -p 'UnsetEnvironment=DISPLAY WAYLAND_DISPLAY' \
  -p StandardOutput=append:"$LOG" \
  -p StandardError=append:"$LOG" \
  "$NODE_BIN" "$HARNESS_LIB_BIN" web --no-open --port "$PORT"

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

echo "unit:   $UNIT ($([ "$LAN" = 1 ] && echo "+ $RELAY"))"
[ "$LAN" = "1" ] && echo "lan:    http://${LAN_IP}:${PORT}/?token=${TOK}"
echo "local:  http://127.0.0.1:${PORT}/?token=${TOK}"
