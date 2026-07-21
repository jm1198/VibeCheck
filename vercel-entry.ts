// Vercel serverless entrypoint — plain Node.js handler (no Express).
// Serves static files from Vite build and handles API routes.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = join(fileURLToPath(import.meta.url), "..");

// index.html is copied alongside this function at build time.
// The path is relative to the bundled .mjs file in .vercel/output/functions/render.func/
const INDEX_HTML_PATH = join(__dirname, "index.html");
const INDEX_HTML = existsSync(INDEX_HTML_PATH) ? readFileSync(INDEX_HTML_PATH, "utf-8") : null;

// In-memory demo venues
const venues = [
  {
    id: 1,
    name: "Neon Dragon",
    location: "242 E 14th St, New York, NY",
    description: "Underground cocktail bar with live DJs and dragon-themed neon decor.",
    category: "bar",
    thumbnail_url: "/api/thumbnail/1",
    is_live: 1,
    viewer_count: 42,
    owner_email: "owner@neondragon.com",
    business_hours: "{}",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  },
  {
    id: 2,
    name: "The Velvet Room",
    location: "88 King St, San Francisco, CA",
    description: "Upscale lounge with velvet interiors and jazz nights.",
    category: "lounge",
    thumbnail_url: "/api/thumbnail/2",
    is_live: 1,
    viewer_count: 18,
    owner_email: "owner@velvetroom.com",
    business_hours: "{}",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  },
  {
    id: 3,
    name: "Bassline Club",
    location: "15 Rave Ave, Miami, FL",
    description: "High-energy nightclub with world-class sound system.",
    category: "club",
    thumbnail_url: "/api/thumbnail/3",
    is_live: 1,
    viewer_count: 87,
    owner_email: "owner@bassline.com",
    business_hours: "{}",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  },
  {
    id: 4,
    name: "The Hideaway",
    location: "420 Bryant St, Austin, TX",
    description: "Cozy speakeasy hidden behind a bookshelf.",
    category: "bar",
    thumbnail_url: "/api/thumbnail/4",
    is_live: 0,
    viewer_count: 0,
    owner_email: "owner@hideaway.com",
    business_hours: "{}",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  },
  {
    id: 5,
    name: "Skybar Rooftop",
    location: "1200 Sunset Blvd, Los Angeles, CA",
    description: "Rooftop bar with panoramic city views.",
    category: "bar",
    thumbnail_url: "/api/thumbnail/5",
    is_live: 0,
    viewer_count: 0,
    owner_email: "owner@skybar.com",
    business_hours: "{}",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  },
];

const demoUser = {
  id: 1,
  email: "demo@vibecheck.app",
  password_hash: crypto.createHash("sha256").update("demo123").digest("hex"),
  venue_id: 1,
};

// ─── In-memory state for serverless (no SQLite) ──────────────────
const users = [demoUser];
const sessions: { id: string; userId: number; venueId: number | null; expiresAt: string }[] = [];
const venueStreamKeys = new Map<number, string>();
// Viewer sessions for viewing-limit enforcement
const viewerSessions: { anonymousId: string; venueId: number; viewStartedAt: string; viewExpiresAt: string }[] = [];
let nextUserId = 2;
let nextVenueId = 6;

const VIEW_DURATION_SEC = 15;
const COOLDOWN_SEC = 30 * 60; // 30 minutes

function getClientIdServerless(req: any): string {
  // Prefer client-provided anonymous_id from body
  if (req.body?.anonymous_id && typeof req.body.anonymous_id === "string") return req.body.anonymous_id;
  // Query param fallback
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const queryId = url.searchParams.get("anonymous_id");
  if (queryId) return queryId;
  // IP fallback
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
  return `ip:${ip}`;
}

function generateStreamKey(): string {
  return `vibe_${crypto.randomBytes(16).toString("hex")}`;
}

function getSessionUser(token: string): { userId: number; venueId: number | null } | null {
  if (!token) return null;
  const session = sessions.find(
    (s) => s.id === token && new Date(s.expiresAt) > new Date()
  );
  if (!session) return null;
  return { userId: session.userId, venueId: session.venueId };
}

function generateThumbnail(id: number): string {
  const colors = [
    ["#6C1C8A", "#1A0533"],
    ["#1A4B8C", "#051533"],
    ["#8C1A4B", "#33051A"],
    ["#1A8C6C", "#05331A"],
    ["#8C6C1A", "#332205"],
  ];
  const [c1, c2] = colors[(id - 1) % colors.length];
  const seed = id * 137;
  const circles = Array.from({ length: 6 }, (_, i) => {
    const cx = 30 + ((seed * (i + 1) * 17) % 40);
    const cy = 30 + ((seed * (i + 1) * 23) % 40);
    const r = 4 + i * 3;
    const alpha = 0.15 + i * 0.05;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="white" opacity="${alpha.toFixed(2)}" />`;
  }).join("");
  const text = ["BAR", "LOUNGE", "CLUB", "PUB", "ROOFTOP"][(id - 1) % 5];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="225" viewBox="0 0 400 225">
    <defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>
    </linearGradient></defs>
    <rect width="400" height="225" fill="url(#bg)"/>${circles}
    <rect x="150" y="90" width="100" height="45" rx="8" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
    <text x="200" y="118" text-anchor="middle" fill="white" font-family="system-ui,sans-serif" font-size="14" font-weight="600" opacity="0.9">${text}</text>
    <rect x="10" y="10" width="46" height="22" rx="11" fill="#ef4444"/>
    <text x="33" y="25" text-anchor="middle" fill="white" font-family="system-ui,sans-serif" font-size="10" font-weight="700">● LIVE</text>
  </svg>`;
}

function json(res: any, status: number, data: any) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function readBody(req: any): Promise<any> {
  return new Promise((resolve) => {
    if (req.body) return resolve(req.body);
    let data = "";
    req.on("data", (chunk: string) => { data += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
  });
}

// Main request handler
export default async function handler(req: any, res: any) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    // API routes
    if (pathname.startsWith("/api/")) {
      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
      }

      // GET /api/venues
      if (pathname === "/api/venues" && req.method === "GET") {
        return json(res, 200, venues);
      }

      // GET /api/venues/:id
      const venueMatch = pathname.match(/^\/api\/venues\/(\d+)$/);
      if (venueMatch && req.method === "GET") {
        const v = venues.find((v) => v.id === parseInt(venueMatch[1]));
        if (!v) return json(res, 404, { error: "Venue not found" });
        return json(res, 200, v);
      }

      // PATCH /api/venues/:id
      if (venueMatch && req.method === "PATCH") {
        const v = venues.find((v) => v.id === parseInt(venueMatch[1]));
        if (!v) return json(res, 404, { error: "Venue not found" });
        const body = await readBody(req);
        if (body.is_live !== undefined) v.is_live = body.is_live ? 1 : 0;
        if (body.description) v.description = body.description;
        return json(res, 200, v);
      }

      // GET /api/thumbnail/:id
      const thumbMatch = pathname.match(/^\/api\/thumbnail\/(\d+)$/);
      if (thumbMatch && req.method === "GET") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "image/svg+xml");
        res.setHeader("Cache-Control", "public, max-age=3600");
        res.end(generateThumbnail(parseInt(thumbMatch[1])));
        return;
      }

      // POST /api/auth/login
      if (pathname === "/api/auth/login" && req.method === "POST") {
        const body = await readBody(req);
        const hash = crypto.createHash("sha256").update(body.password || "").digest("hex");
        const user = users.find((u) => u.email === body.email && u.password_hash === hash);
        if (!user) {
          return json(res, 401, { error: "Invalid credentials" });
        }
        const token = crypto.randomBytes(32).toString("hex");
        sessions.push({
          id: token,
          userId: user.id,
          venueId: user.venue_id,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        });
        return json(res, 200, { token, venue_id: user.venue_id, email: user.email });
      }

      // GET /api/auth/me
      if (pathname === "/api/auth/me" && req.method === "GET") {
        return json(res, 200, { id: demoUser.id, email: demoUser.email, venue_id: demoUser.venue_id });
      }

      // ─── NEW: Auth & Venue Management Endpoints ─────────────────

      // POST /api/auth/signup
      if (pathname === "/api/auth/signup" && req.method === "POST") {
        const body = await readBody(req);
        if (!body.email || !body.password) {
          return json(res, 400, { error: "Email and password required" });
        }
        if (users.find((u) => u.email === body.email)) {
          return json(res, 409, { error: "Email already registered" });
        }
        const user = {
          id: nextUserId++,
          email: body.email,
          password_hash: crypto.createHash("sha256").update(body.password).digest("hex"),
          venue_id: null,
        };
        users.push(user);
        return json(res, 201, { success: true });
      }

      // POST /api/venues — create a venue (auth required)
      if (pathname === "/api/venues" && req.method === "POST") {
        const authHeader = req.headers.authorization || "";
        const token = authHeader.replace("Bearer ", "");
        const session = getSessionUser(token);
        if (!session) return json(res, 401, { error: "Unauthorized" });

        const body = await readBody(req);
        if (!body.name || !body.location) {
          return json(res, 400, { error: "Name and location are required" });
        }

        const user = users.find((u) => u.id === session.userId);
        if (!user) return json(res, 401, { error: "User not found" });
        if (user.venue_id !== null) {
          return json(res, 409, { error: "You already have a venue" });
        }

        const defaultHours = JSON.stringify({
          monday: { open: "17:00", close: "02:00" },
          tuesday: { open: "17:00", close: "02:00" },
          wednesday: { open: "17:00", close: "02:00" },
          thursday: { open: "17:00", close: "02:00" },
          friday: { open: "16:00", close: "03:00" },
          saturday: { open: "16:00", close: "03:00" },
          sunday: { open: "17:00", close: "00:00" },
        });

        const id = nextVenueId++;
        const key = generateStreamKey();
        const venue = {
          id,
          name: body.name,
          location: body.location,
          description: body.description || "",
          category: body.category || "bar",
          thumbnail_url: `/api/thumbnail/${id}`,
          is_live: 0,
          viewer_count: 0,
          owner_email: user.email,
          business_hours: body.business_hours || defaultHours,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        venues.push(venue);
        venueStreamKeys.set(id, key);
        user.venue_id = id;

        // Update any existing sessions for this user
        for (const s of sessions) {
          if (s.userId === user.id) s.venueId = id;
        }

        // Attempt Mux stream creation if configured
        let streamInfo = null;
        const muxId = process.env.MUX_TOKEN_ID || "";
        const muxSecret = process.env.MUX_TOKEN_SECRET || "";
        if (muxId && muxSecret) {
          try {
            const encoded = btoa(`${muxId}:${muxSecret}`);
            const muxRes = await fetch("https://api.mux.com/video/v1/live-streams", {
              method: "POST",
              headers: {
                Authorization: `Basic ${encoded}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                playback_policy: ["public"],
                new_asset_settings: { playback_policy: ["public"] },
              }),
            });
            if (muxRes.ok) {
              const muxJson = await muxRes.json();
              const data = muxJson.data as {
                id: string;
                stream_key: string;
                playback_ids: { id: string; policy: string }[];
              };
              streamInfo = {
                stream_id: data.id,
                stream_key: data.stream_key,
                playback_id: data.playback_ids?.[0]?.id ?? "",
                playback_url: `https://stream.mux.com/${data.playback_ids?.[0]?.id ?? ""}.m3u8`,
              };
            }
          } catch (err) {
            console.error("Mux stream creation failed:", err);
          }
        }

        return json(res, 201, { ...venue, stream_info: streamInfo });
      }

      // GET /api/venues/:id/stream-key — get stream key + RTMP URL
      {
        const streamKeyMatch = pathname.match(/^\/api\/venues\/(\d+)\/stream-key$/);
        if (streamKeyMatch && req.method === "GET") {
          const authHeader = req.headers.authorization || "";
          const token = authHeader.replace("Bearer ", "");
          const session = getSessionUser(token);
          if (!session) return json(res, 401, { error: "Unauthorized" });

          const vid = parseInt(streamKeyMatch[1]);
          const v = venues.find((v) => v.id === vid);
          if (!v) return json(res, 404, { error: "Venue not found" });
          if (session.venueId !== vid) return json(res, 403, { error: "Forbidden" });

          // Check Mux
          const muxId = process.env.MUX_TOKEN_ID || "";
          const muxSecret = process.env.MUX_TOKEN_SECRET || "";
          if (muxId && muxSecret) {
            try {
              const encoded = btoa(`${muxId}:${muxSecret}`);
              const muxRes = await fetch("https://api.mux.com/video/v1/live-streams", {
                method: "POST",
                headers: {
                  Authorization: `Basic ${encoded}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  playback_policy: ["public"],
                  new_asset_settings: { playback_policy: ["public"] },
                }),
              });
              if (muxRes.ok) {
                const muxJson = await muxRes.json();
                const data = muxJson.data as {
                  id: string;
                  stream_key: string;
                  playback_ids: { id: string; policy: string }[];
                };
                return json(res, 200, {
                  stream_key: data.stream_key,
                  rtmp_url: `rtmp://live.mux.com/app/${data.stream_key}`,
                  stream_url: `https://stream.mux.com/${data.playback_ids?.[0]?.id ?? ""}.m3u8`,
                  instructions: {
                    obs: `1. Open OBS Studio\n2. Go to Settings → Stream\n3. Service: Custom\n4. Server: rtmp://live.mux.com/app\n5. Stream Key: ${data.stream_key}\n6. Click Start Streaming`,
                    ip_camera: `Set your IP camera's RTMP publish URL to: rtmp://live.mux.com/app/${data.stream_key}`,
                  },
                });
              }
            } catch (err) {
              return json(res, 500, {
                error: "Failed to create Mux live stream",
                detail: err instanceof Error ? err.message : "Unknown error",
              });
            }
          }

          // Fallback: local stream key
          let key = venueStreamKeys.get(vid);
          if (!key) {
            key = generateStreamKey();
            venueStreamKeys.set(vid, key);
          }

          return json(res, 200, {
            stream_key: key,
            rtmp_url: "rtmp://vibecheck.live/live",
            stream_url: `/api/venues/${vid}/stream`,
            instructions: {
              obs: `1. Open OBS Studio\n2. Go to Settings → Stream\n3. Service: Custom\n4. Server: rtmp://vibecheck.live/live\n5. Stream Key: ${key}\n6. Click Start Streaming`,
              ip_camera: `Set your IP camera's RTMP publish URL to: rtmp://vibecheck.live/live/${key}`,
            },
          });
        }
      }

      // GET /api/venues/:id/stream-url — get HLS playback URL
      {
        const streamUrlMatch = pathname.match(/^\/api\/venues\/(\d+)\/stream-url$/);
        if (streamUrlMatch && req.method === "GET") {
          const vid = parseInt(streamUrlMatch[1]);
          const v = venues.find((v) => v.id === vid);
          if (!v) return json(res, 404, { error: "Venue not found" });

          const muxId = process.env.MUX_TOKEN_ID || "";
          const muxSecret = process.env.MUX_TOKEN_SECRET || "";
          if (muxId && muxSecret) {
            // In serverless, we can't persist Mux state, but we can attempt
            // a fresh create. For a proper deployment with Mux, the stream
            // would need to be created during venue setup.
            return json(res, 200, {
              url: null,
              source: "mux",
              message: "Stream playback URL available after stream is started via /api/venues/:id/stream-key",
            });
          }

          return json(res, 200, {
            url: null,
            source: "none",
            message: "Set MUX_TOKEN_ID and MUX_TOKEN_SECRET to enable live streaming",
          });
        }
      }

      // GET /api/venues/:id/hours-check — compare current time vs business hours
      {
        const hoursMatch = pathname.match(/^\/api\/venues\/(\d+)\/hours-check$/);
        if (hoursMatch && req.method === "GET") {
          const vid = parseInt(hoursMatch[1]);
          const v = venues.find((v) => v.id === vid);
          if (!v) return json(res, 404, { error: "Venue not found" });

          let hours: Record<string, { open: string; close: string }>;
          try {
            hours = JSON.parse(v.business_hours);
          } catch {
            return json(res, 200, { is_open: true, reason: "no_hours_set" });
          }

          if (!v.is_live) {
            return json(res, 200, { is_open: false, reason: "feed_offline" });
          }

          const now = new Date();
          const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
          const today = dayNames[now.getDay()];
          const todayHours = hours[today];

          if (!todayHours || !todayHours.open || !todayHours.close) {
            return json(res, 200, { is_open: false, reason: "no_hours_for_today" });
          }

          const currentMinutes = now.getHours() * 60 + now.getMinutes();
          const [openH, openM] = todayHours.open.split(":").map(Number);
          const [closeH, closeM] = todayHours.close.split(":").map(Number);
          const openMinutes = openH * 60 + openM;
          let closeMinutes = closeH * 60 + closeM;

          const isOvernight = closeMinutes <= openMinutes;
          let isOpen: boolean;
          if (isOvernight) {
            isOpen = currentMinutes >= openMinutes || currentMinutes < closeMinutes;
          } else {
            isOpen = currentMinutes >= openMinutes && currentMinutes < closeMinutes;
          }

          return json(res, 200, {
            is_open: isOpen,
            reason: isOpen ? "within_hours" : "outside_hours",
            today,
            hours: todayHours,
            current_time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
          });
        }
      }

      // POST /api/venues/:id/stream-key — regenerate stream key
      {
        const regenMatch = pathname.match(/^\/api\/venues\/(\d+)\/stream-key$/);
        if (regenMatch && req.method === "POST") {
          const authHeader = req.headers.authorization || "";
          const token = authHeader.replace("Bearer ", "");
          const session = getSessionUser(token);
          if (!session) return json(res, 401, { error: "Unauthorized" });

          const vid = parseInt(regenMatch[1]);
          const v = venues.find((v) => v.id === vid);
          if (!v) return json(res, 404, { error: "Venue not found" });
          if (session.venueId !== vid) return json(res, 403, { error: "Forbidden" });

          // Check Mux
          const muxId = process.env.MUX_TOKEN_ID || "";
          const muxSecret = process.env.MUX_TOKEN_SECRET || "";
          if (muxId && muxSecret) {
            try {
              const encoded = btoa(`${muxId}:${muxSecret}`);
              const muxRes = await fetch("https://api.mux.com/video/v1/live-streams", {
                method: "POST",
                headers: {
                  Authorization: `Basic ${encoded}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  playback_policy: ["public"],
                  new_asset_settings: { playback_policy: ["public"] },
                }),
              });
              if (muxRes.ok) {
                const muxJson = await muxRes.json();
                const data = muxJson.data as {
                  id: string;
                  stream_key: string;
                  playback_ids: { id: string; policy: string }[];
                };
                return json(res, 200, {
                  stream_key: data.stream_key,
                  rtmp_url: `rtmp://live.mux.com/app/${data.stream_key}`,
                  message: "Stream key regenerated successfully. Update your encoder with the new key.",
                });
              }
              return json(res, 500, { error: "Mux stream key regeneration failed" });
            } catch (err) {
              return json(res, 500, {
                error: "Failed to regenerate Mux stream key",
                detail: err instanceof Error ? err.message : "Unknown error",
              });
            }
          }

          // Fallback: local regeneration
          const newKey = generateStreamKey();
          venueStreamKeys.set(vid, newKey);

          return json(res, 200, {
            stream_key: newKey,
            rtmp_url: "rtmp://vibecheck.live/live",
            message: "Stream key regenerated successfully. Update your encoder with the new key.",
          });
        }
      }

      // POST /api/venues/:id/view — view permission + session tracking
      {
        const viewMatch = pathname.match(/^\/api\/venues\/(\d+)\/view$/);
        if (viewMatch && req.method === "POST") {
          const vid = parseInt(viewMatch[1]);
          const v = venues.find((v) => v.id === vid);
          if (!v) return json(res, 404, { error: "Venue not found" });

          // Parse body so req.body is populated for getClientIdServerless
          await readBody(req);

          const clientId = getClientIdServerless(req);
          const now = new Date();
          const session = viewerSessions
            .filter((s) => s.anonymousId === clientId && s.venueId === vid)
            .sort((a, b) => new Date(b.viewStartedAt).getTime() - new Date(a.viewStartedAt).getTime())[0];

          if (session) {
            const expiresAt = new Date(session.viewExpiresAt);
            const startedAt = new Date(session.viewStartedAt);
            const cooldownUntil = new Date(startedAt.getTime() + COOLDOWN_SEC * 1000);

            if (now < expiresAt) {
              const remaining = Math.ceil((expiresAt.getTime() - now.getTime()) / 1000);
              return json(res, 200, { allowed: true, time_remaining: Math.max(0, remaining) });
            }
            if (now < cooldownUntil) {
              const cr = Math.ceil((cooldownUntil.getTime() - now.getTime()) / 1000);
              return json(res, 200, { allowed: false, cooldown_remaining: Math.max(1, cr) });
            }
          }

          // Create new session
          const started = now.toISOString();
          const expires = new Date(now.getTime() + VIEW_DURATION_SEC * 1000).toISOString();
          viewerSessions.push({ anonymousId: clientId, venueId: vid, viewStartedAt: started, viewExpiresAt: expires });
          return json(res, 200, { allowed: true, time_remaining: VIEW_DURATION_SEC });
        }
      }

      // GET /api/venues/:id/view-status
      {
        const statusMatch = pathname.match(/^\/api\/venues\/(\d+)\/view-status$/);
        if (statusMatch && req.method === "GET") {
          const vid = parseInt(statusMatch[1]);
          const v = venues.find((v) => v.id === vid);
          if (!v) return json(res, 404, { error: "Venue not found" });

          const clientId = getClientIdServerless(req);
          const now = new Date();
          const session = viewerSessions
            .filter((s) => s.anonymousId === clientId && s.venueId === vid)
            .sort((a, b) => new Date(b.viewStartedAt).getTime() - new Date(a.viewStartedAt).getTime())[0];

          if (!session) {
            return json(res, 200, { allowed: true, time_remaining: VIEW_DURATION_SEC });
          }

          const expiresAt = new Date(session.viewExpiresAt);
          const startedAt = new Date(session.viewStartedAt);
          const cooldownUntil = new Date(startedAt.getTime() + COOLDOWN_SEC * 1000);

          if (now < expiresAt) {
            const remaining = Math.ceil((expiresAt.getTime() - now.getTime()) / 1000);
            return json(res, 200, { allowed: true, time_remaining: Math.max(0, remaining) });
          }
          if (now < cooldownUntil) {
            const cr = Math.ceil((cooldownUntil.getTime() - now.getTime()) / 1000);
            return json(res, 200, { allowed: false, cooldown_remaining: Math.max(1, cr) });
          }
          return json(res, 200, { allowed: true, time_remaining: VIEW_DURATION_SEC });
        }
      }

      // Fallback for unknown API routes
      return json(res, 404, { error: "Not found" });
    }

    // SPA fallback: serve index.html for any non-API route.
    // Static assets (JS, CSS, images) are handled by Vercel's filesystem handler
    // before reaching this function, so only client-side routes land here.
    if (INDEX_HTML) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(INDEX_HTML);
      return;
    }

    res.statusCode = 404;
    res.end("Not Found");
  } catch (err: any) {
    console.error("Handler error:", err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Internal Server Error", message: err.message }));
  }
}
