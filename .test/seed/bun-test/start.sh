#!/usr/bin/env bash
# start.sh — bun distro artifact rig (bun-test): boots the COMPILED dashr binary.
#
# Unlike test123 (source-level rig), the artifact set here is FIXED per build:
# a single self-contained executable from dashr/dist/. No symlink farms, no
# plugin installs, no seed regeneration — the rig is just a HOME path.
# Discipline (user 2026-09-24): ALWAYS clean profile > start new — the home is
# wiped before every boot (the artifact is the variable under test, not the
# data). CLEAN=0 escape exists only for restart-persistence experiments.
#
# Usage:  bash .test/seed/bun-test/start.sh                 # default port 4996
#         PORT=4986 bash .test/seed/bun-test/start.sh       # override
#         BIN=dashr/dist/dashr-<ver>-linux-x64 bash …       # pin a binary
#         CLEAN=0 bash …                                    # keep home (resume test)
set -euo pipefail

PORT="${PORT:-4996}"
LAN="${LAN:-1}"
CLEAN="${CLEAN:-1}"   # 1 = wipe home before boot (default, user discipline)
UNIT="dsh-${PORT}-bun-test"
RELAY="bun-test-lan-${PORT}-relay"
REPO="$HOME/workspaces/dashr"
HOME_DIR="$REPO/.test/home/bun-test"
LOG="$REPO/.scratch/dsh-${PORT}-bun-test.log"
LAN_IP=$(hostname -I | awk '{print $1}')

mkdir -p "$REPO/.scratch"

# pick the newest compiled artifact unless BIN= pins one
BIN="${BIN:-$(ls -t "$REPO"/dashr/dist/dashr-*-linux-x64 2>/dev/null | head -1 || true)}"
if [ -z "${BIN:-}" ] || [ ! -x "$BIN" ]; then
  echo "no executable dashr/dist/dashr-*-linux-x64 (or BIN=$BIN not executable) — build first: bash dashr/scripts/dashr/build.sh" >&2
  exit 1
fi

if [ "$CLEAN" = "1" ]; then
  # Credentials are user-entered config, not test data: carry .env across the
  # wipe (sibling file survives the rm). Sessions/profiles/storages stay
  # disposable per the clean-boot discipline.
  [ -f "$HOME_DIR/.env" ] && cp "$HOME_DIR/.env" "$HOME_DIR.env.keep"
  rm -rf "$HOME_DIR"
  [ -f "$HOME_DIR.env.keep" ] && mv "$HOME_DIR.env.keep" "$HOME_DIR/.env"
fi
mkdir -p "$HOME_DIR"
[ -f "$HOME_DIR/.env" ] || cp ~/.dsh/.env "$HOME_DIR/.env" 2>/dev/null || true

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

systemd-run --user --unit="$UNIT" \
  -p WorkingDirectory="$REPO" \
  -p Environment="DSH_HOME=$HOME_DIR" \
  -p Environment="DSH_BUN_COMPILED=1" \
  -p "Environment=\"DSH_TRUSTED_HOSTS=test.pc.randomhash.app pc.randomhash.app ${LAN_IP}\"" \
  -p 'UnsetEnvironment=DISPLAY WAYLAND_DISPLAY' \
  -p StandardOutput=append:"$LOG" \
  -p StandardError=append:"$LOG" \
  "$BIN" web --no-open --port "$PORT" --trusted-host "$LAN_IP"

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

echo "binary: $BIN"
echo "unit:   $UNIT ($([ "$LAN" = 1 ] && echo "+ $RELAY"))"
[ "$LAN" = "1" ] && echo "lan:    http://${LAN_IP}:${PORT}/?token=${TOK}"
echo "local:  http://127.0.0.1:${PORT}/?token=${TOK}"
