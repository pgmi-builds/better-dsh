#!/usr/bin/env bash
# start-4999.sh — bring up the dashr (better-dsh) Dev/Test 1 instance (LAN-exposed).
#
# Usage:  bash test/start-4999.sh              # canonical port 4999, loopback only
#         PORT=4988 bash test/start-4999.sh    # override when 4999 is occupied
#         LAN=1 bash test/start-4999.sh        # ALSO expose the LAN IP (relay)
#
# DEFAULT = no relay (superd start-4999.sh template: plain systemd-run, loopback).
# The dsh webserver config accepts ONLY host 127.0.0.1 | 0.0.0.0 (zod union,
# packages/host/webserver/src/index.ts:126) AND startup hard-blocks 0.0.0.0
# (web-app/src/startup.ts:75, RCE safety gate) — so a direct LAN-IP bind is
# impossible; when the user asks for LAN/external access AND Caddy is not
# available, LAN=1 adds the user-space socat relay (binds the LAN IP ONLY and
# forwards to loopback; NEVER bind the relay to 0.0.0.0 — same-port collision
# with the loopback listener, EADDRINUSE). Recipe proven 2026-09-06 port 3098.
#
# Modeled on superd apps/multi-agent-ctx/test/start-4999.sh (systemd-run --user,
# DSH_HOME inside the repo, log append under .scratch/, port-conflict refusal).
# Teardown: systemctl --user stop dsh-4999-test [dashr-lan-4999-relay]  (never kill).
# (unit names carry the actual $PORT; see below)

set -euo pipefail

PORT="${PORT:-4999}"
UNIT="dsh-${PORT}-test"
RELAY="dashr-lan-${PORT}-relay"
REPO="$HOME/workspaces/dashr"
HARNESS="$REPO/upstream/deepseek-harness"
LOG="$REPO/.scratch/dsh-${PORT}.log"
NODE_BIN="$(which node)"
LAN_IP=$(hostname -I | awk '{print $1}')

mkdir -p "$REPO/.scratch"

# our own stale units first (a leftover relay holding the port would otherwise
# trip the foreign-process refusal below)
systemctl --user stop "$UNIT" "$RELAY" 2>/dev/null || true
systemctl --user reset-failed "$UNIT" "$RELAY" 2>/dev/null || true
# node holds the socket while draining (kernel teardown, session flush) — a
# fixed sleep races it into EADDRINUSE; poll until the port is truly free
for _ in $(seq 1 15); do
  ss -tln | grep -q ":${PORT} " || break
  sleep 1
done

if ss -tln | grep -q ":${PORT} "; then
  echo "refusing to start: port ${PORT} already listening (foreign process):" >&2
  ss -tlnp | grep ":${PORT} " >&2 || true
  exit 1
fi

# append-mode log: remember the pre-start size so token grep cannot capture a
# PREVIOUS boot's line
LOG_LINES=$( (wc -l < "$LOG") 2>/dev/null || echo 0)

# The dsh instance — AGENTS.md §二 canonical command: prod-aligned
# DSH_TRUSTED_HOSTS (fence + web-trust authorities, includes the LAN IP so the
# relayed Host passes the /api fence) and UnsetEnvironment for GUI env vars.
systemd-run --user --unit="$UNIT" \
  -p WorkingDirectory="$HARNESS" \
  -p Environment="DSH_HOME=$REPO/.dsh-test" \
  -p 'Environment="DSH_TRUSTED_HOSTS=test.pc.randomhash.app pc.randomhash.app 192.168.31.130"' \
  -p 'UnsetEnvironment=DISPLAY WAYLAND_DISPLAY' \
  -p StandardOutput=append:"$LOG" \
  -p StandardError=append:"$LOG" \
  "$NODE_BIN" --import tsx/esm apps/cli/src/bin.ts web --no-open --port "$PORT"

# boot can take a while (kernel venv, model discovery); poll for the loopback
# listener BEFORE starting the relay (relay binds instantly, dsh binds late)
ok=""
for _ in $(seq 1 30); do
  sleep 2
  if ss -tln | grep -q "127.0.0.1:${PORT} "; then ok=1; break; fi
  systemctl --user is-active --quiet "$UNIT" || { tail -30 "$LOG" >&2; exit 1; }
done
[ -n "$ok" ] || { echo "timeout waiting for 127.0.0.1:${PORT} to listen" >&2; exit 1; }

if [ "${LAN:-0}" = "1" ]; then
# LAN relay: ${LAN_IP}:${PORT} → 127.0.0.1:${PORT} (bind the LAN IP ONLY — a
# wildcard 0.0.0.0 same-port bind collides with the loopback listener on
# Linux). The browser's Host header (LAN_IP:PORT) passes the /api fence via
# DSH_TRUSTED_HOSTS above; the auth cookie binds host:port, consistent end to
# end. Recipe proven 2026-09-06 (port 3098).
systemd-run --user --unit="$RELAY" \
  --property=StandardOutput=append:"$LOG" \
  --property=StandardError=append:"$LOG" \
  /usr/bin/socat TCP-LISTEN:"${PORT}",fork,reuseaddr,bind="${LAN_IP}" TCP:127.0.0.1:"${PORT}"

for _ in $(seq 1 10); do
  ss -tln | grep -q "${LAN_IP}:${PORT} " && break
  sleep 1
done
ss -tln | grep -q "${LAN_IP}:${PORT} " || { echo "socat relay not listening on ${LAN_IP}:${PORT}" >&2; exit 1; }
else
  ss -tln | grep -q "0.0.0.0:${PORT} " && { echo "refusing: port ${PORT} wildcard-occupied but LAN=0" >&2; exit 1; }
fi

# THIS boot's token only (tail past the pre-start line count). The URL line
# flushes shortly AFTER the listener binds — poll for it instead of racing.
TOK=""
for _ in $(seq 1 15); do
  TOK=$( { tail -n +"$((LOG_LINES + 1))" "$LOG" | grep -o "http://127.0.0.1:${PORT}/?token=[^\" ]*" | tail -1 | grep -o 'token=.*' | cut -d= -f2; } 2>/dev/null || true)
  [ -n "$TOK" ] && break
  sleep 1
done
[ -n "$TOK" ] || { echo "no token found in $LOG (this boot)" >&2; exit 1; }

echo "unit:   $UNIT (active)$([ "${LAN:-0}" = "1" ] && echo " + $RELAY (active)")"
[ "${LAN:-0}" = "1" ] && echo "lan:    http://${LAN_IP}:${PORT}/?token=${TOK}"
echo "local:  http://127.0.0.1:${PORT}/?token=${TOK}"
