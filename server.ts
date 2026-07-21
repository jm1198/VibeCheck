import cors from "cors";
import express from "express";
import crypto from "crypto";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import { getDb, generateStreamKey } from "./db.ts";
import type { VenueRow } from "./db.ts";
import {
  isConfigured,
  getPlaybackUrl,
  getStreamKey,
  getRtmpUrl,
  getOrCreateLiveStream,
  createLiveStream,
} from "./src/streaming.ts";
import {
  analyzeVenue,
  getDensityLabel,
  startBackgroundAnalyzer,
} from "./src/density.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.argv.includes("--dev");

const app = express();
app.use(cors());
app.use(express.json());

// ─── Thumbnail generator ───────────────────────────────────────
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
    const r = 4 + (i * 3);
    const alpha = 0.15 + (i * 0.05);
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="white" opacity="${alpha.toFixed(2)}" />`;
  }).join("");

  const text = ["BAR", "LOUNGE", "CLUB", "PUB", "ROOFTOP"][(id - 1) % 5];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="225" viewBox="0 0 400 225">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${c1}"/>
        <stop offset="100%" stop-color="${c2}"/>
      </linearGradient>
    </defs>
    <rect width="400" height="225" fill="url(#bg)"/>
    ${circles}
    <rect x="150" y="90" width="100" height="45" rx="8" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
    <text x="200" y="118" text-anchor="middle" fill="white" font-family="system-ui,sans-serif" font-size="14" font-weight="600" opacity="0.9">${text}</text>
    <rect x="10" y="10" width="46" height="22" rx="11" fill="#ef4444"/>
    <text x="33" y="25" text-anchor="middle" fill="white" font-family="system-ui,sans-serif" font-size="10" font-weight="700">● LIVE</text>
  </svg>`;
}

app.get("/api/thumbnail/:id", (req, res) => {
  const id = parseInt(req.params.id, 10) || 1;
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(generateThumbnail(id));
});

// ─── Auth helpers ──────────────────────────────────────────────
function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function getSessionUser(req: express.Request): { userId: number; venueId: number | null } | null {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return null;
  const db = getDb();
  const session = db
    .prepare("SELECT user_id, venue_id FROM sessions WHERE id = ? AND expires_at > datetime('now')")
    .get(token) as { user_id: number; venue_id: number | null } | undefined;
  if (!session) return null;
  return { userId: session.user_id, venueId: session.venue_id };
}

// ─── API Routes ────────────────────────────────────────────────

// Public: list venues
app.get("/api/venues", (_req, res) => {
  const db = getDb();
  const venues = db.prepare("SELECT * FROM venues ORDER BY is_live DESC, viewer_count DESC").all() as VenueRow[];
  res.json(venues);
});

// Public: single venue
app.get("/api/venues/:id", (req, res) => {
  const db = getDb();
  const venue = db.prepare("SELECT * FROM venues WHERE id = ?").get(parseInt(req.params.id)) as VenueRow | undefined;
  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }
  res.json(venue);
});

// Auth: signup
app.post("/api/auth/signup", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }
  const db = getDb();
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }
  const hash = hashPassword(password);
  db.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)").run(email, hash);
  res.json({ success: true });
});

// Auth: create venue (owner only — must be authenticated and have no venue)
app.post("/api/venues", async (req, res) => {
  const session = getSessionUser(req);
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const db = getDb();
  const user = db.prepare("SELECT id, venue_id FROM users WHERE id = ?").get(session.userId) as
    | { id: number; venue_id: number | null }
    | undefined;
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  if (user.venue_id) {
    res.status(409).json({ error: "You already have a venue" });
    return;
  }

  const { name, location, description, category, business_hours } = req.body;
  if (!name || !location) {
    res.status(400).json({ error: "Name and location are required" });
    return;
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

  const hours = business_hours || defaultHours;
  const desc = description || "";
  const cat = category || "bar";
  const thumb = `/api/thumbnail/${Date.now()}`;

  const result = db.prepare(
    "INSERT INTO venues (name, location, description, category, thumbnail_url, business_hours, owner_email) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(name, location, desc, cat, thumb, hours, user.id.toString());

  const venueId = result.lastInsertRowid as number;

  // Link venue to user
  db.prepare("UPDATE users SET venue_id = ? WHERE id = ?").run(venueId, user.id);

  // Update all user's sessions with venue_id
  db.prepare("UPDATE sessions SET venue_id = ? WHERE user_id = ?").run(venueId, user.id);

  // Auto-create Mux live stream if configured
  let streamInfo = null;
  if (isConfigured()) {
    try {
      streamInfo = await createLiveStream(venueId);
    } catch (err) {
      console.error("Failed to create Mux stream for new venue:", err);
      // Non-fatal — venue was created, stream can be set up later
    }
  }

  const venue = db.prepare("SELECT * FROM venues WHERE id = ?").get(venueId);
  res.status(201).json({ ...(venue as object), stream_info: streamInfo });
});

// Auth: login
app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }
  const db = getDb();
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as
    | { id: number; email: string; password_hash: string; venue_id: number | null }
    | undefined;
  if (!user || user.password_hash !== hashPassword(password)) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare("INSERT INTO sessions (id, user_id, venue_id, expires_at) VALUES (?, ?, ?, ?)").run(
    token,
    user.id,
    user.venue_id,
    expiresAt
  );
  res.json({ token, venue_id: user.venue_id, email: user.email });
});

// Auth: me
app.get("/api/auth/me", (req, res) => {
  const session = getSessionUser(req);
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const db = getDb();
  const user = db.prepare("SELECT id, email, venue_id FROM users WHERE id = ?").get(session.userId) as
    | { id: number; email: string; venue_id: number | null }
    | undefined;
  res.json(user);
});

// Venue owner: update venue
app.patch("/api/venues/:id", (req, res) => {
  const session = getSessionUser(req);
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const venueId = parseInt(req.params.id);
  const db = getDb();
  const venue = db.prepare("SELECT * FROM venues WHERE id = ?").get(venueId) as VenueRow | undefined;
  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }
  if (session.venueId !== venueId && venue.owner_email !== null) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const { is_live, business_hours, description, name, location } = req.body;
  const updates: string[] = [];
  const values: unknown[] = [];

  if (is_live !== undefined) {
    updates.push("is_live = ?");
    values.push(is_live ? 1 : 0);
  }
  if (business_hours !== undefined) {
    updates.push("business_hours = ?");
    values.push(typeof business_hours === "string" ? business_hours : JSON.stringify(business_hours));
  }
  if (description !== undefined) {
    updates.push("description = ?");
    values.push(description);
  }
  if (name !== undefined) {
    updates.push("name = ?");
    values.push(name);
  }
  if (location !== undefined) {
    updates.push("location = ?");
    values.push(location);
  }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    values.push(venueId);
    db.prepare(`UPDATE venues SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  }

  const updated = db.prepare("SELECT * FROM venues WHERE id = ?").get(venueId);
  res.json(updated);
});

// ─── Stream Key Management ─────────────────────────────────────

// GET stream key for a venue (owner only)
app.get("/api/venues/:id/stream-key", async (req, res) => {
  const session = getSessionUser(req);
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const venueId = parseInt(req.params.id);
  const db = getDb();
  const venue = db.prepare("SELECT id, owner_email, stream_key FROM venues WHERE id = ?").get(venueId) as
    | { id: number; owner_email: string | null; stream_key: string | null }
    | undefined;

  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }
  if (session.venueId !== venueId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Mux path: get or create a live stream via Mux API
  if (isConfigured()) {
    try {
      const stream = await getOrCreateLiveStream(venueId);
      res.json({
        stream_key: stream.streamKey,
        rtmp_url: `rtmp://live.mux.com/app/${stream.streamKey}`,
        stream_url: stream.playbackUrl,
        instructions: {
          obs: `1. Open OBS Studio\n2. Go to Settings → Stream\n3. Service: Custom\n4. Server: rtmp://live.mux.com/app\n5. Stream Key: ${stream.streamKey}\n6. Click Start Streaming`,
          ip_camera: `Set your IP camera's RTMP publish URL to: rtmp://live.mux.com/app/${stream.streamKey}`,
        },
      });
      return;
    } catch (err) {
      res.status(500).json({
        error: "Failed to create Mux live stream",
        detail: err instanceof Error ? err.message : "Unknown error",
      });
      return;
    }
  }

  // Fallback: local stream key (WebSocket demo mode)
  let key = venue.stream_key;
  if (!key) {
    key = generateStreamKey();
    db.prepare("UPDATE venues SET stream_key = ? WHERE id = ?").run(key, venueId);
  }

  res.json({
    stream_key: key,
    rtmp_url: `rtmp://vibecheck.live/live`,
    stream_url: `/api/venues/${venueId}/stream`,
    instructions: {
      obs: `1. Open OBS Studio\n2. Go to Settings → Stream\n3. Service: Custom\n4. Server: rtmp://vibecheck.live/live\n5. Stream Key: ${key}\n6. Click Start Streaming`,
      ip_camera: `Set your IP camera's RTMP publish URL to: rtmp://vibecheck.live/live/${key}`,
    },
  });
});

// POST regenerate stream key (owner only)
app.post("/api/venues/:id/stream-key", async (req, res) => {
  const session = getSessionUser(req);
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const venueId = parseInt(req.params.id);
  const db = getDb();
  const venue = db.prepare("SELECT id, owner_email FROM venues WHERE id = ?").get(venueId) as
    | { id: number; owner_email: string | null }
    | undefined;

  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }
  if (session.venueId !== venueId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Mux path: create a new live stream
  if (isConfigured()) {
    try {
      const stream = await createLiveStream(venueId);
      res.json({
        stream_key: stream.streamKey,
        rtmp_url: `rtmp://live.mux.com/app/${stream.streamKey}`,
        message: "Stream key regenerated successfully. Update your encoder with the new key.",
      });
      return;
    } catch (err) {
      res.status(500).json({
        error: "Failed to regenerate Mux stream key",
        detail: err instanceof Error ? err.message : "Unknown error",
      });
      return;
    }
  }

  // Fallback: local regeneration
  const newKey = generateStreamKey();
  db.prepare("UPDATE venues SET stream_key = ? WHERE id = ?").run(newKey, venueId);

  res.json({
    stream_key: newKey,
    rtmp_url: `rtmp://vibecheck.live/live`,
    message: "Stream key regenerated successfully. Update your encoder with the new key.",
  });
});

// ─── Business Hours Check ──────────────────────────────────────

app.get("/api/venues/:id/hours-check", (req, res) => {
  const venueId = parseInt(req.params.id);
  const db = getDb();
  const venue = db.prepare("SELECT business_hours, is_live FROM venues WHERE id = ?").get(venueId) as
    | { business_hours: string; is_live: number }
    | undefined;

  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }

  let hours: Record<string, { open: string; close: string }>;
  try {
    hours = JSON.parse(venue.business_hours);
  } catch {
    res.json({ is_open: true, reason: "no_hours_set" });
    return;
  }

  if (!venue.is_live) {
    res.json({ is_open: false, reason: "feed_offline" });
    return;
  }

  const now = new Date();
  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const today = dayNames[now.getDay()];
  const todayHours = hours[today];

  if (!todayHours || !todayHours.open || !todayHours.close) {
    res.json({ is_open: false, reason: "no_hours_for_today" });
    return;
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [openH, openM] = todayHours.open.split(":").map(Number);
  const [closeH, closeM] = todayHours.close.split(":").map(Number);
  const openMinutes = openH * 60 + openM;
  let closeMinutes = closeH * 60 + closeM;

  // Handle overnight hours (closing time is on the next day)
  const isOvernight = closeMinutes <= openMinutes;
  let isOpen: boolean;
  if (isOvernight) {
    // e.g., 17:00 - 02:00: open if current time >= 17:00 OR current time < 02:00
    isOpen = currentMinutes >= openMinutes || currentMinutes < closeMinutes;
  } else {
    isOpen = currentMinutes >= openMinutes && currentMinutes < closeMinutes;
  }

  res.json({
    is_open: isOpen,
    reason: isOpen ? "within_hours" : "outside_hours",
    today,
    hours: todayHours,
    current_time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
  });
});

// ─── Stream URL (Mux integration) ─────────────────────────

app.get("/api/venues/:id/stream-url", (req, res) => {
  const venueId = parseInt(req.params.id);
  if (isConfigured()) {
    const url = getPlaybackUrl(venueId);
    res.json({ url, source: "mux" });
  } else {
    res.json({
      url: null,
      source: "none",
      message: "Set MUX_TOKEN_ID and MUX_TOKEN_SECRET to enable live streaming",
    });
  }
});

// ─── Analytics ─────────────────────────────────────────────────

app.get("/api/venues/:id/analytics", (req, res) => {
  const session = getSessionUser(req);
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const venueId = parseInt(req.params.id);
  if (session.venueId !== venueId) {
    res.status(403).json({ error: "Forbidden — you can only view analytics for your own venue" });
    return;
  }

  const db = getDb();
  const period = (req.query.period as string) || "week";

  // Build date filter
  let dateFilter = "";
  if (period === "week") {
    dateFilter = "AND last_viewed_at >= datetime('now', '-7 days')";
  } else if (period === "month") {
    dateFilter = "AND last_viewed_at >= datetime('now', '-30 days')";
  }
  // "all" has no filter

  const rows = db
    .prepare(
      `SELECT user_id, last_viewed_at, duration_watched
       FROM view_cooldowns
       WHERE venue_id = ? ${dateFilter}
       ORDER BY last_viewed_at ASC`
    )
    .all(venueId) as { user_id: number; last_viewed_at: string; duration_watched: number }[];

  if (rows.length === 0) {
    res.json({
      total_views: 0,
      unique_viewers: 0,
      views_by_day: [],
      views_by_hour: [],
      avg_view_duration: 0,
      repeat_viewer_rate: 0,
      peak_day: null,
      peak_hour: null,
    });
    return;
  }

  // Total views
  const totalViews = rows.length;

  // Unique viewers
  const uniqueUsers = new Set(rows.map((r) => r.user_id));
  const uniqueViewers = uniqueUsers.size;

  // Views by day
  const dayMap = new Map<string, number>();
  for (const r of rows) {
    const day = r.last_viewed_at.slice(0, 10); // YYYY-MM-DD
    dayMap.set(day, (dayMap.get(day) || 0) + 1);
  }
  const viewsByDay = Array.from(dayMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Views by hour (0-23)
  const hourCounts = new Array(24).fill(0);
  for (const r of rows) {
    const hour = parseInt(r.last_viewed_at.slice(11, 13), 10);
    if (!isNaN(hour) && hour >= 0 && hour < 24) {
      hourCounts[hour]++;
    }
  }
  const viewsByHour = hourCounts.map((count, hour) => ({ hour, count }));
  const peakHour = hourCounts.indexOf(Math.max(...hourCounts));

  // Peak day
  let peakDay: string | null = null;
  let peakDayCount = 0;
  for (const [day, count] of dayMap) {
    if (count > peakDayCount) {
      peakDayCount = count;
      peakDay = day;
    }
  }

  // Average view duration (only rows with duration > 0)
  const durations = rows.filter((r) => r.duration_watched > 0).map((r) => r.duration_watched);
  const avgViewDuration = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  // Repeat viewer rate: % of users who viewed more than once
  const userViewCounts = new Map<number, number>();
  for (const r of rows) {
    userViewCounts.set(r.user_id, (userViewCounts.get(r.user_id) || 0) + 1);
  }
  let repeatCount = 0;
  for (const count of userViewCounts.values()) {
    if (count > 1) repeatCount++;
  }
  const repeatViewerRate = uniqueViewers > 0
    ? Math.round((repeatCount / uniqueViewers) * 100)
    : 0;

  res.json({
    total_views: totalViews,
    unique_viewers: uniqueViewers,
    views_by_day: viewsByDay,
    views_by_hour: viewsByHour,
    avg_view_duration: avgViewDuration,
    repeat_viewer_rate: repeatViewerRate,
    peak_day: peakDay,
    peak_hour: peakHour,
  });
});

// POST view completion — records duration a user actually watched
app.post("/api/venues/:id/view/complete", (req, res) => {
  const session = getSessionUser(req);
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const venueId = parseInt(req.params.id);
  const db = getDb();
  const { duration_watched } = req.body;

  if (typeof duration_watched !== "number" || duration_watched < 0) {
    res.status(400).json({ error: "duration_watched must be a non-negative number" });
    return;
  }

  // Upsert: update existing or insert new row
  const existing = db
    .prepare("SELECT id, duration_watched FROM view_cooldowns WHERE user_id = ? AND venue_id = ?")
    .get(session.userId, venueId) as { id: number; duration_watched: number } | undefined;

  if (existing) {
    // Add to existing duration (cumulative for the session)
    db.prepare(
      "UPDATE view_cooldowns SET duration_watched = duration_watched + ?, last_viewed_at = datetime('now') WHERE id = ?"
    ).run(duration_watched, existing.id);
  } else {
    db.prepare(
      "INSERT INTO view_cooldowns (user_id, venue_id, duration_watched, last_viewed_at) VALUES (?, ?, ?, datetime('now'))"
    ).run(session.userId, venueId, duration_watched);
  }

  res.json({ success: true });
});

// ─── Crowd Density ──────────────────────────────────────────────

// GET latest density for a venue (public)
app.get("/api/venues/:id/density", (req, res) => {
  const venueId = parseInt(req.params.id);
  const db = getDb();

  // Check cached value on venues table first
  const venue = db.prepare("SELECT crowd_density, density_updated_at FROM venues WHERE id = ?").get(venueId) as
    | { crowd_density: number | null; density_updated_at: string | null }
    | undefined;

  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }

  if (venue.crowd_density === null) {
    res.json(null);
    return;
  }

  // Get the latest full record for people_count/label
  const latest = db
    .prepare("SELECT * FROM crowd_density WHERE venue_id = ? ORDER BY analyzed_at DESC LIMIT 1")
    .get(venueId) as {
      id: number; venue_id: number; people_count: number;
      density_score: number; analyzed_at: string;
    } | undefined;

  if (!latest) {
    res.json(null);
    return;
  }

  res.json({
    venue_id: venueId,
    people_count: latest.people_count,
    density_score: latest.density_score,
    analyzed_at: latest.analyzed_at,
    label: getDensityLabel(latest.density_score),
  });
});

// POST trigger refresh (auth-gated to venue owner)
app.post("/api/venues/:id/density/refresh", async (req, res) => {
  const session = getSessionUser(req);
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const venueId = parseInt(req.params.id);
  if (session.venueId !== venueId) {
    res.status(403).json({ error: "Forbidden — you can only refresh your own venue" });
    return;
  }

  const db = getDb();
  const venue = db.prepare("SELECT id, mux_playback_id FROM venues WHERE id = ?").get(venueId) as
    | { id: number; mux_playback_id: string | null }
    | undefined;

  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }

  if (!venue.mux_playback_id) {
    res.status(400).json({ error: "No Mux stream configured for this venue. Set up streaming first." });
    return;
  }

  try {
    const result = await analyzeVenue(venueId, venue.mux_playback_id);
    if (!result) {
      res.status(500).json({ error: "Density analysis failed — could not process the thumbnail" });
      return;
    }

    // Store in crowd_density table
    db.prepare(
      "INSERT INTO crowd_density (venue_id, people_count, density_score, analyzed_at) VALUES (?, ?, ?, ?)"
    ).run(venueId, result.people_count, result.density_score, result.analyzed_at);

    // Update cached values on venues table
    db.prepare(
      "UPDATE venues SET crowd_density = ?, density_updated_at = ? WHERE id = ?"
    ).run(result.density_score, result.analyzed_at, venueId);

    res.json(result);
  } catch (err) {
    console.error("Density refresh error:", err);
    res.status(500).json({ error: "Density analysis failed", detail: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── Static files & SPA fallback ───────────────────────────────

async function startServer() {
  if (isDev) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.use((_req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  // Create HTTP server and attach WebSocket
  const server = http.createServer(app);

  // ─── WebSocket Streaming Relay ────────────────────────────────
  // Maps venueId -> Set of viewer WebSockets
  const streams = new Map<number, Set<WebSocket>>();

  const wss = new WebSocketServer({ server, path: "/ws/stream" });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const venueId = parseInt(url.searchParams.get("venue") || "0");
    const role = url.searchParams.get("role") || "viewer"; // "broadcaster" or "viewer"

    if (!venueId) {
      ws.close(4000, "Missing venue ID");
      return;
    }

    if (role === "broadcaster") {
      // Broadcaster: relay incoming binary data to all viewers
      console.log(`📡 Broadcaster connected for venue ${venueId}`);

      ws.on("message", (data) => {
        const viewers = streams.get(venueId);
        if (viewers) {
          const buf = data instanceof Buffer ? data : Buffer.from(data as ArrayBuffer);
          for (const viewer of viewers) {
            if (viewer.readyState === WebSocket.OPEN) {
              viewer.send(buf);
            }
          }
        }
      });

      ws.on("close", () => {
        console.log(`📡 Broadcaster disconnected for venue ${venueId}`);
        // Notify viewers the stream ended
        const viewers = streams.get(venueId);
        if (viewers) {
          for (const viewer of viewers) {
            if (viewer.readyState === WebSocket.OPEN) {
              viewer.send(JSON.stringify({ type: "stream_ended" }));
            }
          }
        }
      });
    } else {
      // Viewer: receive stream data
      if (!streams.has(venueId)) {
        streams.set(venueId, new Set());
      }
      streams.get(venueId)!.add(ws);
      console.log(`👁 Viewer connected for venue ${venueId} (${streams.get(venueId)!.size} total)`);

      ws.on("close", () => {
        const viewers = streams.get(venueId);
        if (viewers) {
          viewers.delete(ws);
          if (viewers.size === 0) streams.delete(venueId);
        }
      });

      // Send an init message so the client knows the connection is ready
      ws.send(JSON.stringify({ type: "connected", venueId }));
    }
  });

  server.listen(3000, "0.0.0.0", () => {
    console.log("📡 VibeCheck running on http://0.0.0.0:3000");
    if (isDev) console.log("   (dev mode — HMR + WebSocket enabled)");
  });

  // ─── Background Density Analyzer ────────────────────────────
  startBackgroundAnalyzer(
    () => {
      const db = getDb();
      // Find venues that are live, within business hours, and have a Mux playback ID
      const venues = db.prepare(
        "SELECT id, mux_playback_id as playback_id FROM venues WHERE is_live = 1 AND mux_playback_id IS NOT NULL"
      ).all() as { id: number; playback_id: string | null }[];
      return venues;
    },
    (venueId, result) => {
      const db = getDb();
      db.prepare(
        "INSERT INTO crowd_density (venue_id, people_count, density_score, analyzed_at) VALUES (?, ?, ?, ?)"
      ).run(venueId, result.people_count, result.density_score, result.analyzed_at);
      db.prepare(
        "UPDATE venues SET crowd_density = ?, density_updated_at = ? WHERE id = ?"
      ).run(result.density_score, result.analyzed_at, venueId);
    }
  );
  console.log("🔍 Background density analyzer started");
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
