# VibeCheck Relay Box

The relay is the small appliance that makes a venue camera stream into VibeCheck.
It is a Raspberry Pi Zero 2 W (~1 W, headless) that sits on the venue's WiFi,
pulls the camera's RTSP feed over the LAN, and pushes it to **Mux** over RTMPS.
Mux handles the HLS playback that the app already plays via `src/streaming.ts`.

```
┌────────────┐  RTSP (LAN, tcp)  ┌──────────────────┐  RTMPS            ┌─────────────┐  HLS           ┌──────────────┐
│  Camera    │ ─────────────────► │  Pi Zero 2 W     │ ────────────────► │  Mux        │ ────────────► │  VibeCheck   │
│ (RTSP,     │                    │  ffmpeg -an      │  rtmps://global- │  (ingest +  │               │  app / HLS   │
│  sub-      │                    │  -c:v copy       │  live.mux.com:443│  playback)  │               │  player      │
│  stream)   │                    │  (no transcode)  │  /app/<key>      │             │               │              │
└────────────┘                    └──────────────────┘                  └─────────────┘               └──────────────┘
```

- **No audio, ever.** `-an` in the ffmpeg command (see Privacy below).
- **No transcoding.** The camera's H.264 sub-stream (~640×360) is stream-copied
  (`-c:v copy`), so the Pi's CPU stays near idle.
- **Self-healing.** systemd restarts ffmpeg 5 s after any stream drop, forever —
  the owner never touches the box.

> **Bench-testing at home?** See **[`FIRST-HOME-TEST.md`](./FIRST-HOME-TEST.md)** —
> a step-by-step, non-technical walkthrough (Tapo C210 + Pi Zero 2 W, ~$58) that
> tells you exactly how to know it worked, including verifying there's no audio
> in the feed.

---

## 1. What's in this directory

| File | Purpose |
|---|---|
| `provision.sh` | Idempotent installer: installs ffmpeg, drops config/runner/unit into place, enables + starts the service. Run with `sudo` on the Pi. |
| `relay.conf` | Config template (camera + Mux stream key + video opts). Installed to `/etc/vibecheck-relay/relay.conf` only if that file doesn't exist yet — your configured file is never overwritten. |
| `relay-run.sh` | Runner: reads `relay.conf`, builds the ffmpeg command, execs it. Logs to journald. |
| `vibecheck-relay.service` | systemd unit: `Restart=always`, `RestartSec=5`, network-online ordering. |
| `TESTING.md` | How to verify the relay without a camera (static checks + a full local RTSP→RTMP sandbox). |

## 2. Parts list

| Part | Cost | Notes |
|---|---|---|
| Raspberry Pi Zero 2 W board | **$17.25** | [PiShop.us](https://www.pishop.us/product/raspberry-pi-zero-2-w/) — bare board; don't buy $80–110 Amazon kits |
| microSD card (16 GB min) | ~$5 | flashed with Raspberry Pi OS Lite (below) |
| Micro-USB PSU (5 V / 2.5 A) | ~$8 | the Pi Zero 2 W needs a real 2.5 A supply |
| Case | ~$7 | any Pi Zero case |
| **Relay kit total** | **~$38** | one relay serves up to **2 cameras** in multi-room venues |

The camera itself is separate — see the team's `VENUE-SETUP-GUIDE.md` for options.
In short, the **standard tier is a relay-based camera** (we control audio-drop and
pull the low-res sub-stream ourselves):

| Camera | Kit | Role |
|---|---|---|
| TP-Link **Tapo C210** (~$20) | relay + Tapo ≈ **$64** | **Standard tier, budget.** IR night vision (B&W at night). Recommended first home test. |
| **Reolink CX410W** (~$90) | relay + Reolink ≈ **$135** | **Standard tier, premium.** F1.0 full-color night vision — best for dark bars. (Amazon fallback RLC-510WA $74.99.) |
| **EXVIST 3MP** (~$68) | **no relay** ≈ $85 | **PILOT-ONLY.** See caveats below — NOT the standard tier. |

> **Why EXVIST is PILOT-ONLY (not the standard tier):** it pushes RTMP natively
> so it needs no relay, but it can't satisfy our privacy/bandwidth playbook:
> 1. **Its microphone CANNOT be disabled from our side** — dropping audio would
>    rely on the vendor's app/firmware alone, and we'd lose the relay's
>    unconditional `-an`.  Too risky to trust.
> 2. **It only offers a 720p/1080p main stream — no lower sub-stream**, so it
>    can't hit our ~640×360 resolution/bandwidth target for the published feed.
>
> Net: EXVIST stays a **pilot candidate** only (a ~$68 unit to test at our
> discretion and disprove the two caveats). It is **not** the deployment
> default; the standard tier is a relay-based Tapo/Reolink where the relay runs
> `-an` and pulls the sub-stream itself.

## 3. Flash Raspberry Pi OS Lite (headless, with SSH + WiFi pre-configured)

Use the official **Raspberry Pi Imager** (raspberrypi.com/software) on any computer:

1. Insert the microSD card into a card reader.
2. Open Raspberry Pi Imager → **Choose OS** → *Raspberry Pi OS (other)* →
   **Raspberry Pi OS Lite (64-bit)**. (Lite = no desktop, less to go wrong.)
3. **Choose Storage** → your SD card.
4. Click the **gear icon** (⚙) and pre-configure before writing:
   - ☑ **Enable SSH** → *Allow public-key authentication only* (or password auth — then set a strong password).
   - **Set username & password** — e.g. user `relay`, a long random password.
   - ☑ **Configure wireless LAN** — the venue's 2.4 GHz SSID + password, country code.
   - ☑ **Set locale settings** — timezone matching the venue (affects log timestamps only).
   - *Optional:* in the OS settings "Advanced" tab set hostname to `vibecheck-relay`.
5. **Write.** When Imager asks about applying customization, say **Yes**.
6. Eject, put the card in the Pi, plug in power. The Pi boots headless, joins the
   venue WiFi automatically, and starts `sshd`.

> The Pi Zero 2 W is WiFi-only (2.4 GHz). Venue WiFi must cover the camera mount
> point; add a mesh node only if the signal is weak there.

## 4. First boot + SSH in

```bash
# find the Pi on the LAN (hostname depends on what you set in Imager)
ping vibecheck-relay.local        # or: nmap/arp-scan the subnet
ssh relay@vibecheck-relay.local   # or the Pi's IP
```

First login as your `relay` user, then allow passwordless sudo for provisioning:

```bash
sudo apt-get update && sudo apt-get install -y sudo   # preinstalled on Lite
echo "relay ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/relay
```

## 5. Install the relay software

Copy the `relay/` directory from the repo to the Pi (either way works):

```bash
# from a laptop, in the repo root:
scp -r relay relay@vibecheck-relay.local:~
# or: put the relay/ folder on a USB stick and copy it over
```

Then on the Pi:

```bash
cd ~/relay
sudo bash provision.sh
```

What it does (all safe to re-run):

1. Installs `ffmpeg` if missing (`apt-get install -y ffmpeg`) and checks it
   supports `rtmps` (TLS ingest).
2. Creates `/etc/vibecheck-relay/relay.conf` **only if it doesn't exist** —
   never overwrites a configured file.
3. Installs `/usr/local/bin/vibecheck-relay-run.sh` and
   `/etc/systemd/system/vibecheck-relay.service`.
4. `systemctl enable` + starts the service.

Now edit the config with your camera and stream key:

```bash
sudo nano /etc/vibecheck-relay/relay.conf
#    CAMERA_IP / CAMERA_USER / CAMERA_PASS / CAMERA_CHANNEL  ← camera
#    MUX_STREAM_KEY                                          ← from Dashboard
sudo systemctl restart vibecheck-relay
systemctl status vibecheck-relay
journalctl -u vibecheck-relay -f      # watch the relay come up
```

## 6. Getting the Mux stream key (Dashboard)

The venue's Mux live stream is created in-app via the existing Mux API
integration (`src/streaming.ts`):

1. Owner logs in at the venue Dashboard (`/dashboard`).
2. **Connect Camera** section shows **Your Stream Key** (auto-created on first
   view) and the ingest server `rtmps://global-live.mux.com:443/app`.
3. Paste that stream key into `MUX_STREAM_KEY` in `relay.conf`.

The ingest endpoint the relay pushes to is:

```
rtmps://global-live.mux.com:443/app/<MUX_STREAM_KEY>
```

Mux's plain-RTMP fallback (only if the ffmpeg build lacks TLS) is
`rtmp://global-live.mux.com:5222/app/<MUX_STREAM_KEY>` — set
`MUX_INGEST_PROTOCOL=rtmp` and `MUX_INGEST_PORT=5222` in `relay.conf`.

## 7. Config reference (`/etc/vibecheck-relay/relay.conf`)

| Field | Default | Meaning |
|---|---|---|
| `CAMERA_IP` | — (required) | Camera's LAN IP as seen from the relay |
| `CAMERA_RTSP_PORT` | `554` | RTSP port |
| `CAMERA_USER` / `CAMERA_PASS` | — (required) | Camera's own account (not WiFi password) |
| `CAMERA_CHANNEL` | `/h264Preview_01_sub` | RTSP path. **Reolink:** `/h264Preview_01_sub` (sub) or `/h264Preview_01_main`. **Tapo C200/C210/C220/C225:** `/stream1` (main) or `/stream2` (sub) — enable RTSP first in the Tapo app (Settings → Camera Account). **Amcrest:** `/cam/realmonitor?channel=1&subtype=1` |
| `RTSP_TRANSPORT` | `tcp` | `tcp` (reliable over WiFi) or `udp` |
| `MUX_STREAM_KEY` | — (required) | Venue's Mux stream key from the Dashboard |
| `MUX_INGEST_PROTOCOL` | `rtmps` | `rtmps` (TLS, recommended) or `rtmp` (no-TLS fallback) |
| `MUX_INGEST_HOST` | `global-live.mux.com` | Mux ingest host |
| `MUX_INGEST_PORT` | `443` | `443` for rtmps; `5222` for plain rtmp |
| `MUX_INGEST_APP` | `app` | Mux ingest app path component |
| `VIDEO_OPTS` | `"-an -c:v copy"` | **Keep `-an` (privacy).** `-c:v copy` = no transcoding. |
| `EXTRA_FFMPEG_ARGS` | `"-loglevel warning"` | Extra ffmpeg flags, space-separated, quoted |

Values with spaces **must stay double-quoted** — the file is read by both systemd
(`EnvironmentFile=`) and bash (the runner sources it).

## 8. How the systemd service works

`vibecheck-relay.service` (`/etc/systemd/system/vibecheck-relay.service`):

- `Wants=network-online.target` + `After=network-online.target` — boots the
  relay only after the network is up (WiFi can take 30–60 s on boot).
- `EnvironmentFile=/etc/vibecheck-relay/relay.conf` — config loaded by systemd
  (the runner also sources the same file; harmless duplication).
- `ExecStart=/usr/local/bin/vibecheck-relay-run.sh` — the runner **execs**
  ffmpeg, so systemd tracks the ffmpeg process directly.
- `Restart=always` + `RestartSec=5` — whenever ffmpeg exits (camera powered off,
  WiFi blip, Mux hiccup, RTSP drop), it is restarted after 5 s.
- `StartLimitIntervalSec=0` — deliberately disables the start-rate limiter so a
  camera that is off for the night never flips the unit into `failed`; the relay
  retries forever and comes back on its own when the camera returns.
- Hardening flags (`ProtectSystem=full`, `PrivateTmp`, …) — the relay only reads
  config and writes to the network.

**Reconnect behavior:** ffmpeg itself does not reconnect — it exits and systemd
restarts it. On restart, ffmpeg opens a fresh RTSP session (TCP), so a stale
RTSP session on the camera can't block a reconnect.

## 9. Verify it's working

```bash
systemctl status vibecheck-relay        # active (running)
journalctl -u vibecheck-relay -n 50     # startup lines, no fatal errors
```

Then in the **Mux dashboard** the live stream shows **Active** while streaming,
and the venue's page in the VibeCheck app shows the live feed during business
hours (the feed is gated by the venue's business hours + manual pause, platform
side).

See `TESTING.md` for a full verification procedure, including a no-camera
sandbox test that exercises the runner end-to-end on any Linux machine.

## 10. Troubleshooting

**Relay starts, then immediately exits — nothing in the app.**
Check `journalctl -u vibecheck-relay -n 50`. Common causes:
- **RTSP 401 / auth failure.** Wrong camera user/pass. Note: many cameras lock
  the RTSP account after several failed attempts (e.g. Reolink locks for 15 min
  after 5 failures). Wait it out or clear the lock in the camera's app, then fix
  the credentials in `relay.conf`. **Deliberate repeated 401s can extend the
  lockout** — don't just hammer restart.
- **Wrong RTSP path.** `CAMERA_CHANNEL` is camera-dependent (Reolink vs Tapo vs
  Amcrest — see the table). Test the URL directly:
  `ffplay -rtsp_transport tcp "rtsp://user:pass@IP:554/path"`.
- **"codec not supported" / black frames.** The sub-stream isn't H.264. Switch
  `CAMERA_CHANNEL` to the main stream or add `-c:v libx264` transcoding to
  `VIDEO_OPTS` (costs CPU but the Pi Zero 2 W handles 640×360).
- **Camera unreachable at all.** `ping <CAMERA_IP>` from the Pi; confirm both on
  the same network/VLAN; check the camera's IP hasn't changed (set a DHCP
  reservation in the router).

**No stream in the app even though the relay logs look fine.**
- The feed only shows live **within the venue's business hours** (and not while
  manually paused) — that's platform behavior, not a relay fault.
- Confirm the Mux stream is **Active** in the Mux dashboard and that
  `MUX_STREAM_KEY` in `relay.conf` matches the venue's key in the Dashboard.
  If the key was regenerated in-app, update `relay.conf` and restart.

**rtmps errors (TLS).**
If journald shows TLS/handshake errors, the ffmpeg build lacks rtmps. Fall back:
`MUX_INGEST_PROTOCOL=rtmp`, `MUX_INGEST_PORT=5222` in `relay.conf`.

**WiFi drops overnight.**
The relay retries forever (see §8) and recovers when WiFi returns. For persistent
issues, check the venue's router (2.4 GHz channel congestion) and PSU quality.

**Where are the logs?**
Everything goes to journald — there is no log file:
`journalctl -u vibecheck-relay -f` (follow), `journalctl -u vibecheck-relay -n 100`.

## 11. Privacy guarantees (the playbook, enforced in the relay)

- **No audio.** `-an` in the ffmpeg command is the relay's layer of a three-layer
  drop (camera mic disabled at provisioning → `-an` in the relay → Mux pipeline).
  The RTSP URL never carries audio into the relay.
- **No recording.** The camera's SD slot is left **empty**, the relay has no
  storage beyond the OS, and the app's Mux live streams are created with
  recording off (they are ephemeral — nothing is stored as an asset).
- **Low resolution.** Only the ~640×360 sub-stream is published — enough to see
  busy vs. chill, not enough for facial identification.
- **Signage.** The venue must post the VibeCheck door sign ("live crowd cam in
  use — no audio, no face-level recording") at every entrance; opt-out zones
  keep camera-free areas available. Full playbook: see the business plan's
  Privacy & Trust section.

## 12. Updating / re-provisioning

```bash
# pull the latest relay/ files onto the Pi, then:
cd ~/relay && sudo bash provision.sh
```

provision.sh re-installs the runner and unit (code), leaves your
`relay.conf` untouched (config), and restarts the service. The relay is
stateless otherwise — a microSD re-flash + provision is a full rebuild.

## 13. Security notes

- `relay.conf` is installed mode `600` (root-only) — it contains the camera
  password and the Mux stream key.
- The stream key is baked into the box's config; **on churn, regenerate the key
  in the Dashboard** so a returned relay is useless. Wipe/reflash the microSD
  before redeploying a returned box.
- The Pi runs only the relay service: no desktop, no extra packages, SSH for
  admin only. Do not expose the Pi's SSH port to the public internet.
