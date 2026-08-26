#!/usr/bin/env bash
# ============================================================================
# VibeCheck relay runner
#
# Turns /etc/vibecheck-relay/relay.conf into a live ffmpeg push:
#
#     Camera RTSP (venue LAN) ──► ffmpeg ──► Mux RTMPS ingest ──► HLS in the app
#
# Runs as the ExecStart of vibecheck-relay.service. All logging goes to
# journald:  journalctl -u vibecheck-relay -f
#
# Usage:
#   vibecheck-relay-run.sh            run the relay (blocks; execs ffmpeg)
#   vibecheck-relay-run.sh --check    print the exact ffmpeg command and exit
#   vibecheck-relay-run.sh --help     this message
#
# Override the config path for testing:  VIBECHECK_RELAY_CONF=/path/to/conf
# ============================================================================
set -euo pipefail

CONF="${VIBECHECK_RELAY_CONF:-/etc/vibecheck-relay/relay.conf}"

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then usage; fi

# --- load configuration ------------------------------------------------------
if [[ ! -r "$CONF" ]]; then
  echo "ERROR: relay config not found or not readable: $CONF" >&2
  echo "Run 'sudo bash provision.sh' (relay/provision.sh in the repo), or copy" >&2
  echo "relay/relay.conf to $CONF and edit it." >&2
  exit 1
fi

# shellcheck source=/dev/null
source "$CONF"

# --- defaults for optional fields -------------------------------------------
CAMERA_RTSP_PORT="${CAMERA_RTSP_PORT:-554}"
CAMERA_CHANNEL="${CAMERA_CHANNEL:-/h264Preview_01_sub}"
RTSP_TRANSPORT="${RTSP_TRANSPORT:-tcp}"
MUX_INGEST_PROTOCOL="${MUX_INGEST_PROTOCOL:-rtmps}"
MUX_INGEST_HOST="${MUX_INGEST_HOST:-global-live.mux.com}"
MUX_INGEST_PORT="${MUX_INGEST_PORT:-443}"
MUX_INGEST_APP="${MUX_INGEST_APP:-app}"
VIDEO_OPTS="${VIDEO_OPTS:--an -c:v copy}"
EXTRA_FFMPEG_ARGS="${EXTRA_FFMPEG_ARGS:--loglevel warning}"

# --- required fields (fail loudly, never silently) --------------------------
: "${CAMERA_IP:?relay.conf is missing CAMERA_IP (camera LAN IP)}"
: "${CAMERA_USER:?relay.conf is missing CAMERA_USER (camera account)}"
: "${CAMERA_PASS:?relay.conf is missing CAMERA_PASS (camera password)}"
: "${MUX_STREAM_KEY:?relay.conf is missing MUX_STREAM_KEY (Dashboard → Connect Camera)}"
# --- placeholder guard: never start with template values --------------------
PLACEHOLDER_FIELDS=()
[[ "$CAMERA_IP" == *REPLACE_* ]] && PLACEHOLDER_FIELDS+=(CAMERA_IP)
[[ "$CAMERA_USER" == *REPLACE_* ]] && PLACEHOLDER_FIELDS+=(CAMERA_USER)
[[ "$CAMERA_PASS" == *change-me* ]] && PLACEHOLDER_FIELDS+=(CAMERA_PASS)
[[ "$MUX_STREAM_KEY" == *REPLACE_* ]] && PLACEHOLDER_FIELDS+=(MUX_STREAM_KEY)
if [[ ${#PLACEHOLDER_FIELDS[@]} -gt 0 ]]; then
  echo "WARNING: relay.conf still holds template placeholders: ${PLACEHOLDER_FIELDS[*]}" >&2
  if [[ "${1:-}" != "--check" ]]; then
    echo "ERROR: refusing to start the relay with placeholder values. Edit $CONF first." >&2
    exit 1
  fi
fi

# --- assemble ffmpeg command -------------------------------------------------
RTSP_URL="rtsp://${CAMERA_USER}:${CAMERA_PASS}@${CAMERA_IP}:${CAMERA_RTSP_PORT}${CAMERA_CHANNEL}"
INGEST_URL="${MUX_INGEST_PROTOCOL}://${MUX_INGEST_HOST}:${MUX_INGEST_PORT}/${MUX_INGEST_APP}/${MUX_STREAM_KEY}"

# Split the (quoted, space-separated) option strings into argv words.
read -r -a VIDEO_OPTS_ARRAY <<< "$VIDEO_OPTS"
read -r -a EXTRA_ARGS_ARRAY <<< "$EXTRA_FFMPEG_ARGS"

if [[ "${1:-}" == "--check" ]]; then
  CAMERA_DISPLAY_URL="rtsp://${CAMERA_USER}:***@${CAMERA_IP}:${CAMERA_RTSP_PORT}${CAMERA_CHANNEL}"
  INGEST_DISPLAY_URL="${MUX_INGEST_PROTOCOL}://${MUX_INGEST_HOST}:${MUX_INGEST_PORT}/${MUX_INGEST_APP}/<stream-key-hidden>"
  echo "VibeCheck relay --check (config: $CONF)"
  echo "  camera : $CAMERA_DISPLAY_URL (transport=$RTSP_TRANSPORT)"
  echo "  ingest : $INGEST_DISPLAY_URL"
  echo
  echo "ffmpeg -hide_banner -nostdin ${EXTRA_ARGS_ARRAY[*]} -rtsp_transport $RTSP_TRANSPORT \\"
  echo "  -i \"$CAMERA_DISPLAY_URL\" \\"
  echo "  ${VIDEO_OPTS_ARRAY[*]} \\"
  echo "  -f flv \"$INGEST_DISPLAY_URL\""
  exit 0
fi

# --- run ----------------------------------------------------------------------
echo "VibeCheck relay: ${CAMERA_IP} → ${MUX_INGEST_PROTOCOL}://${MUX_INGEST_HOST}:${MUX_INGEST_PORT} (no audio, stream copy)"
echo "Camera : rtsp://${CAMERA_USER}:***@${CAMERA_IP}:${CAMERA_RTSP_PORT}${CAMERA_CHANNEL} (transport=$RTSP_TRANSPORT)"
echo "Ingest : ${MUX_INGEST_PROTOCOL}://${MUX_INGEST_HOST}:${MUX_INGEST_PORT}/${MUX_INGEST_APP}/<stream-key-hidden>"

# exec replaces this shell, so systemd tracks ffmpeg directly (Restart=always
# restarts it whenever the stream drops).
exec ffmpeg -hide_banner -nostdin \
  "${EXTRA_ARGS_ARRAY[@]}" \
  -rtsp_transport "$RTSP_TRANSPORT" \
  -i "$RTSP_URL" \
  "${VIDEO_OPTS_ARRAY[@]}" \
  -f flv "$INGEST_URL"
