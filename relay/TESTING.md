# VibeCheck Relay — Testing Guide

How to verify the relay software **without a real camera or a real Mux
account**. Three levels:

1. **Static checks** (seconds) — syntax, unit file, ffmpeg capability.
2. **Local sandbox test** (minutes, no hardware) — a fake camera on your dev
   machine feeding `relay-run.sh`, verified end-to-end through a local RTMP/HLS
   server. This exercises the real runner + config logic.
3. **Mux ingest sanity** (needs a Mux stream key) — pushes a synthetic test
   pattern to Mux itself.

A **hardware bench test** (real RTSP camera + Pi Zero 2 W + real Mux key) is
still required before field deployment — see the end.

---

## 1. Static checks

```bash
# shell syntax (must pass clean)
bash -n provision.sh relay-run.sh

# shellcheck (if installed)
shellcheck provision.sh relay-run.sh

# systemd unit file syntax (any Linux with systemd; syntax only)
systemd-analyze verify vibecheck-relay.service

# ffmpeg present + rtmps/TLS capability (the fallback decision point)
ffmpeg -version | head -n1
ffmpeg -protocols | grep rtmps        # empty output → rtmps unsupported

# runner's --check mode: prints the exact ffmpeg command from a config
cp relay.conf /tmp/test-relay.conf
VIBECHECK_RELAY_CONF=/tmp/test-relay.conf bash relay/relay-run.sh --check

# runner fails loudly when config is missing
VIBECHECK_RELAY_CONF=/tmp/does-not-exist.conf bash relay/relay-run.sh; echo "exit=$?"
#   → prints an ERROR naming the missing path, exit 1

# runner fails loudly when required fields are placeholders
VIBECHECK_RELAY_CONF=/tmp/test-relay.conf bash relay/relay-run.sh
#   → exits with "relay.conf is missing MUX_STREAM_KEY..." (placeholder value
#     is technically present; see note below)
```

> Note: `relay-run.sh --check` prints the placeholder warning but still shows
> the command (useful for inspecting a dry config). In **run** mode, placeholder
> values (`REPLACE_*`, `change-me`) are a hard error — the relay refuses to
> start rather than push a bogus stream key. For a local run, edit the conf first.

## 2. Local sandbox test (no hardware, end-to-end)

This runs the exact production pipeline shape on your dev machine:
**fake camera (RTSP) → relay-run.sh (ffmpeg) → local RTMP server → HLS**, and
confirms the stream actually arrives.

**Prereqs:** `ffmpeg`, and the [MediaMTX](https://github.com/bluenviron/mediamtx)
single binary (`wget` the linux-amd64 release, `chmod +x`). MediaMTX provides a
local RTSP server (for the fake camera), an RTMP server (for the relay to push
to), and HLS output — no camera or internet needed.

```bash
# terminal 1 — start MediaMTX (defaults: RTSP :8554, RTMP :1935, HLS :8888)
./mediamtx

# terminal 2 — fake camera: publish a test pattern over RTSP to MediaMTX
# -g 10 is IMPORTANT: the FLV/RTMP muxer buffers until the first H.264
# keyframe; the x264 default (one keyframe / 250 frames ≈ 25 s at 10 fps)
# would make the relay appear idle for ~25 s, or report "Output file is
# empty" if killed before then. With -g 10 a keyframe arrives every second.
ffmpeg -re -f lavfi -i testsrc=size=640x360:rate=10 \
  -pix_fmt yuv420p -c:v libx264 -preset veryfast -tune zerolatency -g 10 \
  -f rtsp -rtsp_transport tcp rtsp://127.0.0.1:8554/camera
# (wait ~2 s for the test pattern to be publishing before going on)

# terminal 3 — point the relay at the fake camera and the LOCAL rtmp sink
# (do NOT touch /etc/vibecheck-relay/relay.conf if this is the real Pi —
#  use a scratch copy). CAMERA_PASS is replaced too: the template's
# change-me is a placeholder and relay-run.sh now refuses placeholders.
sed -e 's/^CAMERA_IP=.*/CAMERA_IP=127.0.0.1/' \
    -e 's/^CAMERA_RTSP_PORT=.*/CAMERA_RTSP_PORT=8554/' \
    -e 's/^CAMERA_CHANNEL=.*/CAMERA_CHANNEL=\/camera/' \
    -e 's/^CAMERA_PASS=.*/CAMERA_PASS=test/' \
    -e 's/^MUX_INGEST_PROTOCOL=.*/MUX_INGEST_PROTOCOL=rtmp/' \
    -e 's/^MUX_INGEST_HOST=.*/MUX_INGEST_HOST=127.0.0.1/' \
    -e 's/^MUX_INGEST_PORT=.*/MUX_INGEST_PORT=1935/' \
    -e 's/^MUX_INGEST_APP=.*/MUX_INGEST_APP=live/' \
    -e 's/^MUX_STREAM_KEY=.*/MUX_STREAM_KEY=test/' \
    relay/relay.conf > /tmp/relay-test.conf
# run it in the BACKGROUND — it blocks by design, it IS the service:
nohup env VIBECHECK_RELAY_CONF=/tmp/relay-test.conf bash relay/relay-run.sh \
  > /tmp/relay-test.log 2>&1 &
#   CHECK 1 — head -5 /tmp/relay-test.log shows:
#     "VibeCheck relay: 127.0.0.1 → rtmp://127.0.0.1:1935 (no audio, stream copy)"
#     "Camera : rtsp://admin:***@127.0.0.1:8554/camera (transport=tcp)"
#   CHECK 2 — within ~2 s ffmpeg is connected; MediaMTX logs
#     "is publishing to path 'live/test', 1 track (H264)"

# terminal 4 — verify the pushed stream arrives (success checkpoints):
curl -s -o /dev/null -w '%{http_code}\n' \
  http://127.0.0.1:8888/live/test/index.m3u8          # → 200, NOT 404
curl -s http://127.0.0.1:8888/live/test/index.m3u8 | head -8
#   → starts with #EXTM3U and has #EXT-X-STREAM-INF:...RESOLUTION=640x360
ffprobe -v error -show_entries stream=codec_type \
  rtmp://127.0.0.1:1935/live/test                     # → only "video" lines
```

Green = HLS playlist returns `200` while the relay runs, the playlist shows
`RESOLUTION=640x360`, and ffprobe reports **video only** (any "audio" line
means the `-an` drop is broken). When done: `kill %1` (relay), then stop the
fake camera with Ctrl-C in its terminal.

Stop the fake camera and watch `relay-run.sh` exit (nonzero); start it again —
this is exactly the failure the systemd unit's `Restart=always` handles on the
Pi. To exercise the unit itself on a systemd machine, install the files as
`provision.sh` does and repeat with the local-RTMP conf.

> **Why did I ever see "Output file is empty, nothing was encoded"?**
> That is an ffmpeg shutdown message, not a relay bug. The FLV/RTMP muxer in
> `-c:v copy` mode buffers silently until the first H.264 keyframe arrives (an
> FLV H.264 stream must start on a keyframe). With a fake camera at x264's
> default GOP — one keyframe per 250 frames ≈ 25 s at 10 fps — and the relay
> killed by a `timeout`/Ctrl-C before that mark, ffmpeg exits having written
> only the FLV header: hence "Output file is empty". The relay command itself
> is correct — run against the short-GOP source above (`-g 10`) it pushes the
> stream within ~2 s (verified). Real Tapo/Reolink cameras emit keyframes every
> ≤5 s, so on first connect the relay just waits a moment before the first
> chunk reaches Mux.

## 3. Mux ingest sanity (needs a real Mux stream key)

With a venue's Mux stream key (from the Dashboard → Connect Camera), push a
synthetic pattern straight to Mux from the dev machine:

```bash
ffmpeg -re -f lavfi -i testsrc=size=640x360:rate=10 \
  -pix_fmt yuv420p -c:v libx264 -preset veryfast -tune zerolatency \
  -an -f flv rtmps://global-live.mux.com:443/app/<MUX_STREAM_KEY>
```

Then confirm in the **Mux dashboard** that the live stream goes **Active**, and
that `https://stream.mux.com/<playback_id>.m3u8` plays (e.g. in the VibeCheck
app during business hours). This validates the exact endpoint/protocol the
relay uses. (If rtmps fails here too, it's the local ffmpeg build — retry with
`rtmp://global-live.mux.com:5222/app/<key>` and use the `rtmp` fallback config
on the relay.)

## 4. What still needs a hardware bench test (not yet done)

Static + sandbox checks above are green. The following remain **untested until
a bench rig exists** (real camera + Pi Zero 2 W + real Mux key):

- RTSP auth against a real Reolink/Tapo camera, including sub-stream paths.
- Camera 401 lockout behavior and recovery timing.
- rtmps TLS handshake from the Pi's actual ffmpeg build.
- Real-world latency (camera → Mux → HLS) and sustained stability (24 h+).
- systemd restart behavior on the Pi under camera power-cycles.

Bench checklist: flash Lite (relay/README.md §3) → `provision.sh` → real
credentials in `relay.conf` → `journalctl -u vibecheck-relay -f` shows the
push → Mux stream Active → venue page live in-app within business hours →
power-cycle the camera and confirm the relay recovers in ~10 s.
