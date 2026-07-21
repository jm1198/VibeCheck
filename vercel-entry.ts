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
      const viewMatch = venueMatch && pathname.endsWith("/view");
      if (venueMatch && !viewMatch && req.method === "GET") {
        const v = venues.find((v) => v.id === parseInt(venueMatch[1]));
        if (!v) return json(res, 404, { error: "Venue not found" });
        return json(res, 200, v);
      }

      // PATCH /api/venues/:id
      if (venueMatch && !viewMatch && req.method === "PATCH") {
        const v = venues.find((v) => v.id === parseInt(venueMatch[1]));
        if (!v) return json(res, 404, { error: "Venue not found" });
        const body = await readBody(req);
        if (body.is_live !== undefined) v.is_live = body.is_live ? 1 : 0;
        if (body.description) v.description = body.description;
        return json(res, 200, v);
      }

      // POST /api/venues/:id/view — auth-required view with cooldown
      if (venueMatch && pathname.endsWith("/view") && req.method === "POST") {
        const session = getSessionUser(req);
        if (!session) {
          return json(res, 401, { error: "Sign in required to watch live feeds" });
        }
        const vId = parseInt(venueMatch[1]);
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
