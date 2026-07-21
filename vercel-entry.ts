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
    promo_text: null,
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
    promo_text: null,
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
    promo_text: null,
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
    promo_text: null,
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
    promo_text: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  },
];

const demoUser = {
  id: 1,
  email: "demo@vibecheck.app",
  password_hash: crypto.createHash("sha256").update("demo123").digest("hex"),
  venue_id: 1,
  role: "venue_owner",
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

// ── Favorites (in-memory for serverless) ──
interface FavoriteRecord {
  user_id: number;
  venue_id: number;
  created_at: string;
}
const favorites: FavoriteRecord[] = [];

// ── Push subscriptions (in-memory for serverless) ──
interface PushSub {
  id?: number;
  user_id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
}
const pushSubscriptions: PushSub[] = [];

// ── VAPID keys (in-memory, regenerated per cold start) ──
let vapidKeys: { publicKey: string; privateKey: string } | null = null;

function getVapidKeysForServerless(): { publicKey: string; privateKey: string } {
  if (vapidKeys) return vapidKeys;
  try {
    // Dynamic import — web-push is bundled
    const webpush = require("web-push");
    vapidKeys = webpush.generateVAPIDKeys();
  } catch {
    // Fallback: generate locally using crypto
    const { generateKeyPairSync } = require("node:crypto");
    const { publicKey, privateKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
      publicKeyEncoding: { type: "spki", format: "der" },
      privateKeyEncoding: { type: "pkcs8", format: "der" },
    });
    vapidKeys = {
      publicKey: Buffer.from(publicKey).toString("base64url"),
      privateKey: Buffer.from(privateKey).toString("base64url"),
    };
  }
  return vapidKeys;
}

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

// In-memory session store for demo (Vercel serverless)
const sessions = new Map<string, { userId: number; venueId: number | null; role: string; expiresAt: number }>();

function getSessionUser(req: any): { userId: number; venueId: number | null; role: string } | null {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (session) sessions.delete(token);
    return null;
  }
  return { userId: session.userId, venueId: session.venueId, role: session.role };
}

function createSession(userId: number, venueId: number | null, role: string): string {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { userId, venueId, role, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
  return token;
}

// In-memory cooldown store for demo
const cooldowns = new Map<string, number>(); // key: "userId:venueId", value: timestamp

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
      const viewMatch = pathname.match(/^\/api\/venues\/(\d+)\/view$/);
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
        const wasLive = v.is_live === 1;
        if (body.is_live !== undefined) v.is_live = body.is_live ? 1 : 0;
        if (body.description) v.description = body.description;
        if (body.promo_text !== undefined) {
          const pt = body.promo_text;
          if (pt !== null && pt !== "" && (typeof pt !== "string" || pt.length > 80)) {
            return json(res, 400, { error: "promo_text must be a string of 80 characters or fewer" });
          }
          (v as any).promo_text = pt || null;
        }
        // Note: push notifications for go-live are handled in server.ts (Express)
        // Vercel serverless doesn't persist subscriptions between cold starts
        if (!wasLive && v.is_live === 1) {
          console.log(`Venue "${v.name}" went live — push notifications would fire in dev mode`);
        }
        return json(res, 200, v);
      }

      // POST /api/venues/:id/view — auth-required view with cooldown
      if (viewMatch && req.method === "POST") {
        const session = getSessionUser(req);
        if (!session) {
          return json(res, 401, { error: "Sign in required to watch live feeds" });
        }
        const vId = parseInt(viewMatch[1]);
        const v = venues.find((v) => v.id === vId);
        if (!v) return json(res, 404, { error: "Venue not found" });

        const cooldownKey = `${session.userId}:${vId}`;
        const lastViewed = cooldowns.get(cooldownKey);
        const now = Date.now();
        if (lastViewed) {
          const elapsed = (now - lastViewed) / 1000;
          if (elapsed < 30 * 60) {
            const remaining = Math.ceil(30 * 60 - elapsed);
            return json(res, 429, {
              error: "Cooldown active",
              remaining_seconds: remaining,
              message: `You can watch again in ${Math.ceil(remaining / 60)} minutes`,
            });
          }
        }
        cooldowns.set(cooldownKey, now);
        return json(res, 200, {
          view_token: crypto.randomBytes(16).toString("hex"),
          view_window_seconds: 15,
          cooldown_minutes: 30,
          message: "Stream access granted for 15 seconds",
        });
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
        const token = createSession(demoUser.id, demoUser.venue_id, demoUser.role);
        return json(res, 200, { token, venue_id: demoUser.venue_id, email: demoUser.email, role: demoUser.role });
      }

      // POST /api/auth/signup
      if (pathname === "/api/auth/signup" && req.method === "POST") {
        const body = await readBody(req);
        if (!body.email || !body.password) {
          return json(res, 400, { error: "Email and password required" });
        }
        if (body.email === demoUser.email) {
          return json(res, 409, { error: "Email already registered" });
        }
        const userRole = body.role === "venue_owner" ? "venue_owner" : "consumer";
        return json(res, 200, { success: true, role: userRole });
      }

      // POST /api/auth/google
      if (pathname === "/api/auth/google" && req.method === "POST") {
        const body = await readBody(req);
        if (!body.credential) {
          return json(res, 400, { error: "Google credential required" });
        }

        // Verify token with Google
        let googleUser: { sub: string; email: string; name: string };
        try {
          const verifyRes = await fetch(
            `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(body.credential)}`
          );
          if (!verifyRes.ok) {
            return json(res, 401, { error: "Invalid Google credential" });
          }
          googleUser = await verifyRes.json() as { sub: string; email: string; name: string };
        } catch {
          return json(res, 401, { error: "Failed to verify Google credential" });
        }

        // For the demo, create a simple session (in production, this would use the DB)
        // Use a deterministic fake ID based on the Google sub
        const fakeId = Math.abs(hashCode(googleUser.sub)) % 10000 + 100;
        const token = createSession(fakeId, null, "consumer");
        return json(res, 200, {
          token,
          venue_id: null,
          email: googleUser.email,
          role: "consumer",
        });
      }

      // GET /api/auth/me
      if (pathname === "/api/auth/me" && req.method === "GET") {
        const session = getSessionUser(req);
        if (!session) {
          return json(res, 401, { error: "Unauthorized" });
        }
        if (session.userId === demoUser.id) {
          return json(res, 200, { id: demoUser.id, email: demoUser.email, venue_id: demoUser.venue_id, role: demoUser.role });
        }
        return json(res, 200, { id: session.userId, email: "", venue_id: session.venueId, role: session.role });
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

      // GET /api/venues/:id/promo
      const promoMatch = pathname.match(/^\/api\/venues\/(\d+)\/promo$/);
      if (promoMatch && req.method === "GET") {
        const v = venues.find((v) => v.id === parseInt(promoMatch[1]));
        if (!v) return json(res, 404, { error: "Venue not found" });
        return json(res, 200, { promo_text: (v as any).promo_text ?? null });
      }

      // PATCH /api/venues/:id/promo — auth-gated to venue owner
      if (promoMatch && req.method === "PATCH") {
        const session = getSessionUser(req);
        if (!session) return json(res, 401, { error: "Unauthorized" });
        const venueId = parseInt(promoMatch[1]);
        if (session.venueId !== venueId) {
          return json(res, 403, { error: "Forbidden — you can only update your own venue" });
        }
        const v = venues.find((v) => v.id === venueId);
        if (!v) return json(res, 404, { error: "Venue not found" });
        const body = await readBody(req);
        const pt = body.promo_text;
        if (pt !== undefined && pt !== null && pt !== "") {
          if (typeof pt !== "string" || pt.length > 80) {
            return json(res, 400, { error: "promo_text must be a string of 80 characters or fewer" });
          }
          (v as any).promo_text = pt;
        } else {
          (v as any).promo_text = null;
        }
        return json(res, 200, { promo_text: (v as any).promo_text ?? null });
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

      // ── Favorites ──

      // POST /api/venues/:id/favorite — toggle favorite
      const favoriteMatch = pathname.match(/^\/api\/venues\/(\d+)\/favorite$/);
      if (favoriteMatch && req.method === "POST") {
        const session = getSessionUser(req);
        if (!session) return json(res, 401, { error: "Unauthorized" });
        const venueId = parseInt(favoriteMatch[1]);
        const v = venues.find((v) => v.id === venueId);
        if (!v) return json(res, 404, { error: "Venue not found" });

        const idx = favorites.findIndex((f) => f.user_id === session.userId && f.venue_id === venueId);
        if (idx >= 0) {
          favorites.splice(idx, 1);
          return json(res, 200, { favorited: false });
        } else {
          favorites.push({ user_id: session.userId, venue_id: venueId, created_at: new Date().toISOString() });
          return json(res, 200, { favorited: true });
        }
      }

      // GET /api/venues/favorites
      if (pathname === "/api/venues/favorites" && req.method === "GET") {
        const session = getSessionUser(req);
        if (!session) return json(res, 401, { error: "Unauthorized" });
        const userFavs = favorites
          .filter((f) => f.user_id === session.userId)
          .sort((a, b) => b.created_at.localeCompare(a.created_at));
        const favVenues = userFavs
          .map((f) => {
            const v = venues.find((v) => v.id === f.venue_id);
            return v ? { ...v, favorited_at: f.created_at } : null;
          })
          .filter(Boolean);
        return json(res, 200, favVenues);
      }

      // ── Push Notifications ──

      // GET /api/push/vapid-public-key
      if (pathname === "/api/push/vapid-public-key" && req.method === "GET") {
        const keys = getVapidKeysForServerless();
        return json(res, 200, { publicKey: keys.publicKey });
      }

      // POST /api/push/subscribe
      if (pathname === "/api/push/subscribe" && req.method === "POST") {
        const session = getSessionUser(req);
        if (!session) return json(res, 401, { error: "Unauthorized" });
        const body = await readBody(req);
        if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
          return json(res, 400, { error: "endpoint, keys.p256dh, and keys.auth are required" });
        }
        const idx = pushSubscriptions.findIndex((s) => s.endpoint === body.endpoint);
        if (idx >= 0) {
          pushSubscriptions[idx] = {
            user_id: session.userId,
            endpoint: body.endpoint,
            p256dh: body.keys.p256dh,
            auth: body.keys.auth,
            created_at: new Date().toISOString(),
          };
        } else {
          pushSubscriptions.push({
            user_id: session.userId,
            endpoint: body.endpoint,
            p256dh: body.keys.p256dh,
            auth: body.keys.auth,
            created_at: new Date().toISOString(),
          });
        }
        return json(res, 200, { success: true });
      }

      // POST /api/push/unsubscribe
      if (pathname === "/api/push/unsubscribe" && req.method === "POST") {
        const session = getSessionUser(req);
        if (!session) return json(res, 401, { error: "Unauthorized" });
        const body = await readBody(req);
        if (!body.endpoint) return json(res, 400, { error: "endpoint is required" });
        const idx = pushSubscriptions.findIndex(
          (s) => s.endpoint === body.endpoint && s.user_id === session.userId
        );
        if (idx >= 0) pushSubscriptions.splice(idx, 1);
        return json(res, 200, { success: true });
      }

      // Fallback for unknown API routes
      return json(res, 404, { error: "Not found" });
    }

    // SPA fallback: serve index.html for any non-API route.
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

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash;
}
