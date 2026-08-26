#!/usr/bin/env bash
# ============================================================================
# VibeCheck relay — provisioning script (run on the Raspberry Pi)
#
# Turns a fresh Raspberry Pi OS Lite (headless) Pi Zero 2 W into a VibeCheck
# relay box: installs ffmpeg, installs the config/runner/systemd unit, and
# starts the relay service.
#
# Usage (on the Pi, from the directory containing this repo's relay/ files):
#     sudo bash provision.sh
#
# Idempotent — safe to re-run at any time:
#   * ffmpeg        installed only if missing
#   * relay.conf    created from the template ONLY if it doesn't exist
#                   (an existing configured file is NEVER overwritten)
#   * runner + unit always re-installed (they are code, config is not)
#   * service       enabled, then started or restarted
#
# Cross-tooling note: no Pi required to review/test this. relay-run.sh can be
# exercised on any Linux box (see relay/TESTING.md). To install without this
# script, copy the files manually:
#     install -m 0755 relay/relay-run.sh /usr/local/bin/vibecheck-relay-run.sh
#     install -m 0644 relay/vibecheck-relay.service /etc/systemd/system/
#     install -m 0600 relay/relay.conf /etc/vibecheck-relay/relay.conf
#     systemctl daemon-reload && systemctl enable --now vibecheck-relay
# ============================================================================
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: provision.sh must run as root:  sudo bash provision.sh" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF_TEMPLATE="$SCRIPT_DIR/relay.conf"
RUN_SOURCE="$SCRIPT_DIR/relay-run.sh"
UNIT_SOURCE="$SCRIPT_DIR/vibecheck-relay.service"

RELAY_DIR="/etc/vibecheck-relay"
RELAY_CONF="$RELAY_DIR/relay.conf"
RUN_INSTALL="/usr/local/bin/vibecheck-relay-run.sh"
UNIT_INSTALL="/etc/systemd/system/vibecheck-relay.service"
SERVICE="vibecheck-relay"

echo "==> VibeCheck relay provisioning (files from $SCRIPT_DIR)"

# --- sanity: required files must sit next to this script --------------------
for f in "$CONF_TEMPLATE" "$RUN_SOURCE" "$UNIT_SOURCE"; do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: missing file next to provision.sh: $f" >&2
    echo "Run this from the repo's relay/ directory." >&2
    exit 1
  fi
done

# --- 1. ffmpeg ---------------------------------------------------------------
if command -v ffmpeg >/dev/null 2>&1; then
  echo "==> ffmpeg already installed: $(ffmpeg -version 2>/dev/null | head -n1)"
else
  echo "==> Installing ffmpeg (apt-get install -y ffmpeg) — this can take a few minutes..."
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y ffmpeg
fi

# rtmps (TLS) capability check — Raspberry Pi OS Lite's ffmpeg supports it.
if ffmpeg -protocols 2>/dev/null | grep -qw rtmps; then
  echo "==> ffmpeg supports rtmps (TLS ingest) ✓"
else
  echo "==> WARNING: this ffmpeg build lacks rtmps. Edit relay.conf and set"
  echo "    MUX_INGEST_PROTOCOL=rtmp and MUX_INGEST_PORT=5222 (Mux plain-RTMP"
  echo "    ingest) before the relay can push to Mux."
fi

# --- 2. config (never overwrite an existing configured file) -----------------
mkdir -p "$RELAY_DIR"
if [[ -f "$RELAY_CONF" ]]; then
  echo "==> $RELAY_CONF already exists — leaving it untouched (not overwriting)."
else
  cp "$CONF_TEMPLATE" "$RELAY_CONF"
  chmod 600 "$RELAY_CONF"
  echo "==> Created $RELAY_CONF from template (mode 600, secrets)."
  echo "    >>> EDIT IT NOW: camera IP/user/pass + the venue's Mux stream key."
fi

# --- 3. runner script ---------------------------------------------------------
install -m 0755 "$RUN_SOURCE" "$RUN_INSTALL"
echo "==> Installed $RUN_INSTALL"

# --- 4. systemd unit -----------------------------------------------------------
install -m 0644 "$UNIT_SOURCE" "$UNIT_INSTALL"
systemctl daemon-reload
systemctl enable "$SERVICE"
echo "==> Installed + enabled $UNIT_INSTALL"

# --- 5. start / restart ---------------------------------------------------------
if systemctl is-active --quiet "$SERVICE"; then
  systemctl restart "$SERVICE"
  echo "==> $SERVICE restarted."
else
  if systemctl start "$SERVICE"; then
    echo "==> $SERVICE started."
  else
    echo "==> WARNING: $SERVICE failed to start. Fix relay.conf then run:"
    echo "    sudo systemctl restart $SERVICE"
  fi
fi

# --- 6. summary -----------------------------------------------------------------
echo
echo "──────────────────────────────────────────────────────────────"
echo " VibeCheck relay installed."
echo "   Config (edit + restart):  sudo nano $RELAY_CONF"
echo "   Restart service:          sudo systemctl restart $SERVICE"
echo "   Status:                   systemctl status $SERVICE"
echo "   Logs:                     journalctl -u $SERVICE -f"
echo "   Ingest:                   rtmps://global-live.mux.com:443/app/<MUX_STREAM_KEY>"
echo "   Privacy:                  no audio (-an), stream copy, no recording"
echo "──────────────────────────────────────────────────────────────"

# --- 7. placeholder check ------------------------------------------------------
if grep -q 'REPLACE_' "$RELAY_CONF"; then
  echo "⚠️  relay.conf still contains placeholder values. Fields to fill:"
  grep -n 'REPLACE_' "$RELAY_CONF" | sed 's/^/      /'
  echo "   Get the Mux stream key from the VibeCheck Dashboard"
  echo "   (owner login → 'Connect Camera' section), then:"
  echo "   sudo systemctl restart $SERVICE"
else
  echo "✓ relay.conf looks configured (no placeholders)."
fi
