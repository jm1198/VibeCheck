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
    name: "Bassline Club",
    location: "Gaslamp Quarter, San Diego, CA",
    description: "High-energy nightclub with world-class sound system, EDM nights, and a packed dance floor every weekend.",
    category: "club",
    thumbnail_url: "/api/thumbnail/1",
    is_live: 1,
    viewer_count: 87,
    owner_email: "owner@bassline.com",
    business_hours: "{}",
    latitude: 32.7115,
    longitude: -117.1587,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  },
  {
    id: 2,
    name: "Neon Dragon",
    location: "Gaslamp Quarter, San Diego, CA",
    description: "Underground cocktail bar with live DJs and dragon-themed neon decor.",
    category: "bar",
    thumbnail_url: "/api/thumbnail/2",
    is_live: 1,
    viewer_count: 42,
    owner_email: "owner@neondragon.com",
    business_hours: "{}",
    latitude: 32.7120,
    longitude: -117.1595,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  },
  {
    id: 3,
    name: "The Velvet Room",
    location: "North Park, San Diego, CA",
    description: "Upscale lounge with velvet interiors and jazz nights.",
    category: "lounge",
    thumbnail_url: "/api/thumbnail/3",
    is_live: 1,
    viewer_count: 18,
    owner_email: "owner@velvetroom.com",
    business_hours: "{}",
    latitude: 32.7457,
    longitude: -117.1295,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  },
  {
    id: 4,
    name: "The Hideaway",
    location: "Pacific Beach, San Diego, CA",
    description: "Cozy speakeasy hidden behind a bookshelf.",
    category: "bar",
    thumbnail_url: "/api/thumbnail/4",
    is_live: 0,
    viewer_count: 0,
    owner_email: "owner@hideaway.com",
    business_hours: "{}",
    latitude: 32.7952,
    longitude: -117.2547,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  },
  {
    id: 5,
    name: "Skybar Rooftop",
    location: "Gaslamp Quarter, San Diego, CA",
    description: "Rooftop bar with panoramic city views.",
    category: "bar",
    thumbnail_url: "/api/thumbnail/5",
    is_live: 0,
    viewer_count: 0,
    owner_email: "owner@skybar.com",
    business_hours: "{}",
    latitude: 32.7110,
    longitude: -117.1575,
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

// In-memory view tracking for analytics
interface ViewRecord {
  user_id: number;
  venue_id: number;
  last_viewed_at: string;
  duration_watched: number;
}
const viewRecords: ViewRecord[] = [];

// In-memory density records
interface DensityRecord {
  venue_id: number;
  people_count: number;
  density_score: number;
  analyzed_at: string;
}
const densityRecords: DensityRecord[] = [];

function getDensityLabel(score: number): string {
  if (score <= 2) return "Empty";
  if (score <= 4) return "Quiet";
  if (score <= 6) return "Moderate";
  if (score <= 8) return "Busy";
  return "Packed";
}

function peopleCountToScore(count: number): number {
  if (count === 0) return 1;
  if (count <= 3) return 2;
  if (count <= 8) return 3;
  if (count <= 15) return 4;
  if (count <= 25) return 5;
  if (count <= 35) return 6;
  if (count <= 50) return 7;
  if (count <= 65) return 8;
  if (count <= 80) return 9;
  return 10;
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
        if (body.email !== demoUser.email || hash !== demoUser.password_hash) {
          return json(res, 401, { error: "Invalid credentials" });
        }
        const token = crypto.randomBytes(32).toString("hex");
        return json(res, 200, { token, venue_id: demoUser.venue_id, email: demoUser.email });
      }

      // GET /api/auth/me
      if (pathname === "/api/auth/me" && req.method === "GET") {
        return json(res, 200, { id: demoUser.id, email: demoUser.email, venue_id: demoUser.venue_id });
      }

      // GET /api/venues/:id/analytics
      const analyticsMatch = pathname.match(/^\/api\/venues\/(\d+)\/analytics$/);
      if (analyticsMatch && req.method === "GET") {
        const venueId = parseInt(analyticsMatch[1]);
        const period = url.searchParams.get("period") || "week";

        let dateFilter: (r: ViewRecord) => boolean;
        if (period === "week") {
          const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
          dateFilter = (r) => r.last_viewed_at >= weekAgo;
        } else if (period === "month") {
          const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
          dateFilter = (r) => r.last_viewed_at >= monthAgo;
        } else {
          dateFilter = () => true;
        }

        const rows = viewRecords
          .filter((r) => r.venue_id === venueId && dateFilter(r))
          .sort((a, b) => a.last_viewed_at.localeCompare(b.last_viewed_at));

        if (rows.length === 0) {
          return json(res, 200, {
            total_views: 0, unique_viewers: 0, views_by_day: [], views_by_hour: [],
            avg_view_duration: 0, repeat_viewer_rate: 0, peak_day: null, peak_hour: null,
          });
        }

        const totalViews = rows.length;
        const uniqueViewers = new Set(rows.map((r) => r.user_id)).size;

        const dayMap = new Map<string, number>();
        for (const r of rows) {
          const day = r.last_viewed_at.slice(0, 10);
          dayMap.set(day, (dayMap.get(day) || 0) + 1);
        }
        const viewsByDay = Array.from(dayMap.entries())
          .map(([date, count]) => ({ date, count }))
          .sort((a, b) => a.date.localeCompare(b.date));

        const hourCounts = new Array(24).fill(0);
        for (const r of rows) {
          const hour = parseInt(r.last_viewed_at.slice(11, 13), 10);
          if (!isNaN(hour) && hour >= 0 && hour < 24) hourCounts[hour]++;
        }
        const viewsByHour = hourCounts.map((count, hour) => ({ hour, count }));
        const peakHour = hourCounts.indexOf(Math.max(...hourCounts));

        let peakDay: string | null = null;
        let peakDayCount = 0;
        for (const [day, count] of dayMap) {
          if (count > peakDayCount) { peakDayCount = count; peakDay = day; }
        }

        const durations = rows.filter((r) => r.duration_watched > 0).map((r) => r.duration_watched);
        const avgViewDuration = durations.length > 0
          ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

        const userViewCounts = new Map<number, number>();
        for (const r of rows) userViewCounts.set(r.user_id, (userViewCounts.get(r.user_id) || 0) + 1);
        let repeatCount = 0;
        for (const c of userViewCounts.values()) if (c > 1) repeatCount++;
        const repeatViewerRate = uniqueViewers > 0 ? Math.round((repeatCount / uniqueViewers) * 100) : 0;

        return json(res, 200, {
          total_views: totalViews, unique_viewers: uniqueViewers, views_by_day: viewsByDay,
          views_by_hour: viewsByHour, avg_view_duration: avgViewDuration,
          repeat_viewer_rate: repeatViewerRate, peak_day: peakDay, peak_hour: peakHour,
        });
      }

      // POST /api/venues/:id/view/complete
      const viewCompleteMatch = pathname.match(/^\/api\/venues\/(\d+)\/view\/complete$/);
      if (viewCompleteMatch && req.method === "POST") {
        const venueId = parseInt(viewCompleteMatch[1]);
        const body = await readBody(req);
        const duration_watched = body.duration_watched;
        if (typeof duration_watched !== "number" || duration_watched < 0) {
          return json(res, 400, { error: "duration_watched must be a non-negative number" });
        }
        viewRecords.push({
          user_id: demoUser.id,
          venue_id: venueId,
          last_viewed_at: new Date().toISOString(),
          duration_watched,
        });
        return json(res, 200, { success: true });
      }

      // GET /api/venues/:id/density
      const densityMatch = pathname.match(/^\/api\/venues\/(\d+)\/density\/?$/);
      if (densityMatch && req.method === "GET") {
        const venueId = parseInt(densityMatch[1]);
        const latest = densityRecords
          .filter((r) => r.venue_id === venueId)
          .sort((a, b) => b.analyzed_at.localeCompare(a.analyzed_at))[0];

        if (!latest) {
          return json(res, 200, null);
        }
        return json(res, 200, {
          venue_id: latest.venue_id,
          people_count: latest.people_count,
          density_score: latest.density_score,
          analyzed_at: latest.analyzed_at,
          label: getDensityLabel(latest.density_score),
        });
      }

      // POST /api/venues/:id/density/refresh
      const densityRefreshMatch = pathname.match(/^\/api\/venues\/(\d+)\/density\/refresh\/?$/);
      if (densityRefreshMatch && req.method === "POST") {
        const venueId = parseInt(densityRefreshMatch[1]);
        const v = venues.find((v) => v.id === venueId);
        if (!v) return json(res, 404, { error: "Venue not found" });

        // In serverless, simulate density with a pseudo-random score based on
        // the venue's viewer count (a reasonable proxy when we can't run TF.js).
        // This keeps the API contract working in production/Vercel.
        const viewerCount = v.viewer_count || 0;
        const baseCount = viewerCount > 0 ? Math.floor(viewerCount * 0.6 + Math.random() * 5) : Math.floor(Math.random() * 10);
        const densityScore = peopleCountToScore(baseCount);
        const analyzedAt = new Date().toISOString();

        const record: DensityRecord = {
          venue_id: venueId,
          people_count: baseCount,
          density_score: densityScore,
          analyzed_at: analyzedAt,
        };
        densityRecords.push(record);

        return json(res, 200, {
          venue_id: venueId,
          people_count: baseCount,
          density_score: densityScore,
          analyzed_at: analyzedAt,
          label: getDensityLabel(densityScore),
        });
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
