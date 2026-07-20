# VibeCheck

Real-time venue vibe checking. See live camera feeds from bars and clubs before you head out.

## Stack

- **Frontend:** Vite + React 19 + TypeScript + Tailwind CSS 4
- **Backend:** Express 5 (same process, port 3000)
- **Database:** SQLite via bun:sqlite
- **Routing:** react-router-dom v7
- **Streaming:** WebSocket relay + hls.js (HLS-aware for production RTMP pipeline)

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

VibeCheck supports two camera connection methods:

### Method 1: Browser Camera (Quick Test)

From the Dashboard, click **"Start Camera Test"** to broadcast directly from your computer's webcam. This is great for testing — the stream appears on your venue's public page in real time via WebSocket.

### Method 2: OBS Studio (Recommended for Production)

1. Download and install [OBS Studio](https://obsproject.com/)
2. Open OBS and add your camera as a video source
3. Go to **Settings → Stream**
4. Set **Service** to "Custom..."
5. Set **Server** to `rtmp://vibecheck.live/live`
6. Set **Stream Key** to the key shown in your Dashboard
7. Click **Start Streaming**

Your stream will be available on your venue's public page.

### Method 3: IP Camera / Hardware Encoder

Configure your device's RTMP publish URL to:
```
rtmp://vibecheck.live/live/<your-stream-key>
```

### Getting Your Stream Key

1. Log in at `/dashboard`
2. Your stream key is shown in the **"Connect Camera"** section
3. Click **🔄 Regenerate** if you need a new key (e.g., if compromised)

## Streaming Architecture

### Current (MVP)
- **WebSocket relay** on port 3000 — the venue dashboard broadcasts via browser camera, consumers view via MediaSource Extensions
- **hls.js fallback** — when an RTMP→HLS pipeline is present (production), hls.js provides adaptive bitrate playback

### Production Path
For a real RTMP pipeline, point an RTMP server (e.g., nginx-rtmp, node-media-server) at `rtmp://vibecheck.live/live`. The server transmuxes RTMP to HLS, and the LiveFeed component plays it via hls.js.

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
| GET | `/api/venues/:id/stream-key` | Bearer | Get stream key + RTMP URL (auto-generates on first call) |
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
