# VibeCheck

Real-time venue vibe checking. See live camera feeds from bars and clubs before you head out.

## Stack

- **Frontend:** Vite + React 19 + TypeScript + Tailwind CSS 4
- **Backend:** Express 5 (same process, port 3000)
- **Database:** SQLite via bun:sqlite
- **Routing:** react-router-dom v7
- **Streaming:** Mux ingest + HLS playback (hls.js); WebSocket relay for dev/browser tests

## Quick Start

```bash
# Install dependencies
bun install

# Start dev server (Vite HMR + Express API + WebSocket on port 3000)
bun run dev

# Open http://localhost:3000
```

## Project Structure

```
├── server.ts          # Express server + API routes + WebSocket relay (port 3000)
├── db.ts              # SQLite setup, schema, seed data
├── relay/             # Venue relay box software (RTSP → Mux):
│   │                  #   README.md, provision.sh, relay.conf, relay-run.sh,
│   │                  #   vibecheck-relay.service, TESTING.md
├── vite.config.ts     # Vite configuration
├── index.html         # SPA entry point
├── src/
│   ├── main.tsx       # React entry + BrowserRouter
│   ├── App.tsx        # Route definitions
│   ├── index.css      # Tailwind + dark theme
│   ├── types.ts       # Shared TypeScript types
│   ├── api.ts         # Client-side API helpers
│   ├── pages/
│   │   ├── VenueGrid.tsx    # Consumer: browse venues
│   │   ├── VenueDetail.tsx  # Consumer: venue view + live feed
│   │   ├── Login.tsx        # Dashboard: auth
│   │   └── Dashboard.tsx    # Dashboard: venue management + camera connect
│   └── components/
│       ├── VenueCard.tsx    # Venue card with thumbnail
│       └── LiveFeed.tsx     # Live feed player (WebSocket + hls.js fallback)
├── publish.sh         # Build + restart production server
├── go-live.sh         # Deploy to Vercel
├── build-vercel.sh    # Vercel build script
└── vercel-entry.ts    # Vercel serverless handler
```

## Publishing (Preview)

```bash
bun run publish
```

Rebuilds the frontend and restarts the Express server on port 3000.

## Demo Accounts

**Consumer:** No login needed — browse venues at `/`

**Venue Owner Dashboard:**
- URL: `/dashboard`
- Email: `demo@vibecheck.app`
- Password: `demo123`

## Camera Setup for Venues

Three ways to get a camera feed into VibeCheck — pick the production one.

### Method 1: VibeCheck Relay Box (Production — recommended)

The **relay box** (Raspberry Pi Zero 2 W, ~1 W, headless) pulls the venue
camera's RTSP feed over the venue LAN and pushes it to **Mux** (`rtmps://
global-live.mux.com:443/app/<stream-key>`); Mux serves the HLS playback the app
already plays. It is fully unattended — the owner never touches it after
install, and it self-heals if the stream drops.

- Full build/install docs: **[`relay/README.md`](relay/README.md)** (parts,
  flashing Raspberry Pi OS Lite, `provision.sh`, config, troubleshooting)
- No-camera verification: **[`relay/TESTING.md`](relay/TESTING.md)**
- Bench-test at home (non-technical, ~$58 kit): **[`relay/FIRST-HOME-TEST.md`](relay/FIRST-HOME-TEST.md)**

**Camera options — the standard tier is relay-based.** We hold absolute control
over audio and resolution: the relay drops audio unconditionally (`-an`) and
pulls the camera's low-res sub-stream (~640×360) itself. Verified options:

| Camera | Kit cost | Notes |
|---|---|---|
| TP-Link **Tapo C210** (~$20) | ≈ **$64/venue** | Standard tier, budget. IR night vision (B&W at night). Start here. |
| **Reolink CX410W** (~$90) | ≈ **$135/venue** | Standard tier, premium. F1.0 full-color night vision for dark bars. Amazon fallback RLC-510WA $74.99. |

> **EXVIST 3MP (~$68) is PILOT-ONLY, not the standard tier.** It pushes RTMP
> natively (no relay) but fails our privacy playbook: **(1)** its microphone
> **cannot be disabled from our side** — audio drop would rely entirely on the
> vendor's app/firmware; **(2)** it only offers a 720p/1080p main stream, **no
> lower sub-stream**, so it can't hit our ~640×360 published target. It remains
> a pilot candidate (buy one at owner discretion to disprove both caveats), and
> is never the deployment default.

### Method 2: Browser Camera (Quick Test)

From the Dashboard, click **"Start Camera Test"** to broadcast directly from
your computer's webcam. This is great for testing — the stream appears on your
venue's public page in real time via the WebSocket relay.

### Method 3: OBS / any encoder (Manual Mux push)

Useful for testing Mux ingest without a relay box:

1. Open OBS → **Settings → Stream**
2. **Service:** Custom
3. **Server:** `rtmps://global-live.mux.com:443/app`
4. **Stream Key:** the key shown in your Dashboard (below)
5. **Start Streaming** — the feed appears on your venue's public page

### Getting Your Stream Key

1. Log in at `/dashboard`
2. Your stream key is shown in the **"Connect Camera"** section (Mux live
   stream, created via the Mux API on first view)
3. Click **🔄 Regenerate** if you need a new key (e.g., if compromised) —
   then update `MUX_STREAM_KEY` in the relay's `/etc/vibecheck-relay/relay.conf`
   and restart the relay

> **Superseded:** earlier guidance pointed cameras/encoders at a self-hosted
> RTMP server (`rtmp://vibecheck.live`, nginx-rtmp/node-media-server). That is
> **no longer the architecture** — production ingest is Mux (above). The
> WebSocket relay remains only as the dev/quick-test path (Method 2).

## Streaming Architecture

### Production Path (current)
**RTSP camera → relay box → Mux → HLS in the app.**

```
Camera (RTSP, LAN) ──► relay box (Pi Zero 2 W: ffmpeg -an -c:v copy)
                    ──► rtmps://global-live.mux.com:443/app/<stream-key> (Mux)
                    ──► HLS (https://stream.mux.com/<playback_id>.m3u8)
                    ──► LiveFeed component plays via hls.js
```

- Mux live streams are created per-venue via `src/streaming.ts` (Mux API);
  stream key + playback ID are stored on the venue record and surfaced in the
  Dashboard ("Connect Camera").
- The relay is built and documented in **[`relay/`](relay/README.md)** — parts,
  provisioning (`provision.sh`), config, systemd service, and testing.
- Privacy is enforced at the relay: `-an` (no audio, ever), stream-copy of the
  low-res sub-stream (no transcoding), no recording anywhere.

### Dev / Quick-Test Path (WebSocket relay)
The **WebSocket relay** on port 3000 is still available for development and
browser-camera tests: the Dashboard broadcasts via `getUserMedia`, consumers
view via MediaSource Extensions (`/ws/stream`). This is **not** the production
ingest path.

### Superseded (removed guidance)
The old self-hosted RTMP server plan (**nginx-rtmp / node-media-server** at
`rtmp://vibecheck.live`) is **no longer the architecture** and should not be
used — Mux ingest replaced it. The `rtmp://vibecheck.live` references were
removed from the app and docs.

## Business Hours Integration

The live feed only shows as "live" when the venue is within configured business hours:
- Venue sets daily open/close times in the Dashboard
- The `/api/venues/:id/hours-check` endpoint checks current time against hours
- Handles overnight hours (e.g., 17:00–02:00)
- If outside hours or feed manually paused, consumers see "Feed Offline — Venue Closed"

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/venues` | — | List all venues |
| GET | `/api/venues/:id` | — | Get single venue |
| PATCH | `/api/venues/:id` | Bearer | Update venue (owner) |
| GET | `/api/venues/:id/stream-key` | Bearer | Get Mux stream key + ingest URL (auto-creates Mux live stream on first call) |
| POST | `/api/venues/:id/stream-key` | Bearer | Regenerate stream key |
| GET | `/api/venues/:id/hours-check` | — | Check if venue is within business hours |
| POST | `/api/auth/signup` | — | Create account |
| POST | `/api/auth/login` | — | Login, returns token |
| GET | `/api/auth/me` | Bearer | Get current user |
| GET | `/api/thumbnail/:id` | — | SVG venue thumbnail |

### WebSocket Endpoint

| Path | Params | Description |
|------|--------|-------------|
| `/ws/stream` | `?venue=<id>&role=viewer` | View live stream for a venue |
| `/ws/stream` | `?venue=<id>&role=broadcaster` | Broadcast camera feed to viewers |

## Theme

Dark nightlife theme with neon purple (#8b5cf6) and cyan (#06b6d4) accents throughout.
