// Vercel serverless entrypoint — plain Node.js handler (no Express).
// Serves static files from Vite build and handles API routes.

import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = join(fileURLToPath(import.meta.url), "..");

// Resolve STATIC_DIR: try multiple paths since Vercel may restructure the layout
function findStaticDir(): string {
  const candidates = [
    join(__dirname, "..", "..", "static"),       // .vercel/output/static (Build Output API v3)
    join(__dirname, "..", "static"),              // .vercel/output/functions/static
    join(process.cwd(), "static"),                // cwd/static
    join(process.cwd(), "..", "static"),          // parent/static
    join(process.cwd(), "..", "..", "static"),    // grandparent/static
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "index.html"))) return dir;
  }
  return candidates[0]; // fallback to first
}

const STATIC_DIR = findStaticDir();

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

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function json(res: any, status: number, data: any) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function sendFile(res: any, filePath: string) {
  try {
    const data = readFileSync(filePath);
    const ext = extname(filePath).toLowerCase();
    res.statusCode = 200;
    res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end("Not Found");
  }
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

      // Fallback for unknown API routes
      return json(res, 404, { error: "Not found" });
    }

    // Serve static files — try the file directly, then fall back to index.html (SPA)
    const cleanPath = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
    const fullPath = join(STATIC_DIR, cleanPath);
    
    // Only serve if it's a real file under STATIC_DIR (not the SPA fallback yet)
    if (cleanPath !== "index.html" && existsSync(fullPath)) {
      return sendFile(res, fullPath);
    }

    // SPA fallback: serve index.html for any unmatched route
    const indexPath = join(STATIC_DIR, "index.html");
    if (existsSync(indexPath)) {
      const data = readFileSync(indexPath);
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(data);
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
