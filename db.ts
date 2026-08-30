import { Database } from "bun:sqlite";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "vibecheck.db");

let db: Database;

export function getDb(): Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.run("PRAGMA journal_mode = WAL");
    initSchema();
    seedIfEmpty();
  }
  return db;
}

function initSchema() {
  const d = db;
  d.run(`
    CREATE TABLE IF NOT EXISTS venues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      location TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'bar',
      thumbnail_url TEXT NOT NULL DEFAULT '',
      is_live INTEGER NOT NULL DEFAULT 0,
      viewer_count INTEGER NOT NULL DEFAULT 0,
      owner_email TEXT,
      business_hours TEXT NOT NULL DEFAULT '{"monday":{"open":"17:00","close":"02:00"},"tuesday":{"open":"17:00","close":"02:00"},"wednesday":{"open":"17:00","close":"02:00"},"thursday":{"open":"17:00","close":"02:00"},"friday":{"open":"16:00","close":"03:00"},"saturday":{"open":"16:00","close":"03:00"},"sunday":{"open":"17:00","close":"00:00"}}',
      stream_key TEXT,
      latitude REAL,
      longitude REAL,
      plan TEXT NOT NULL DEFAULT 'base',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Migration: add missing columns for existing DBs
  const cols = d.prepare("PRAGMA table_info(venues)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "stream_key")) {
    d.run("ALTER TABLE venues ADD COLUMN stream_key TEXT");
  }
  if (!cols.some((c) => c.name === "latitude")) {
    d.run("ALTER TABLE venues ADD COLUMN latitude REAL");
  }
  if (!cols.some((c) => c.name === "longitude")) {
    d.run("ALTER TABLE venues ADD COLUMN longitude REAL");
  }
  if (!cols.some((c) => c.name === "plan")) {
    d.run("ALTER TABLE venues ADD COLUMN plan TEXT NOT NULL DEFAULT 'base'");
  }

  d.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      venue_id INTEGER,
      role TEXT NOT NULL DEFAULT 'consumer',
      google_id TEXT,
      privacy_accepted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (venue_id) REFERENCES venues(id)
    )
  `);

  // Migration: add role column if missing
  const userCols = d.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  if (!userCols.some((c) => c.name === "role")) {
    d.run("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'consumer'");
  }
  if (!userCols.some((c) => c.name === "google_id")) {
    d.run("ALTER TABLE users ADD COLUMN google_id TEXT");
  }
  if (!userCols.some((c) => c.name === "privacy_accepted_at")) {
    d.run("ALTER TABLE users ADD COLUMN privacy_accepted_at TEXT");
  }

  // Migration: set role='venue_owner' for existing users who have a venue
  d.run("UPDATE users SET role = 'venue_owner' WHERE venue_id IS NOT NULL AND role = 'consumer'");

  d.run(`
    CREATE TABLE IF NOT EXISTS view_cooldowns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      venue_id INTEGER NOT NULL,
      last_viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (venue_id) REFERENCES venues(id),
      UNIQUE(user_id, venue_id)
    )
  `);

  d.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      venue_id INTEGER,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (venue_id) REFERENCES venues(id)
    )
  `);

  d.run(`
    CREATE TABLE IF NOT EXISTS view_cooldowns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      venue_id INTEGER NOT NULL,
      last_viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
      duration_watched INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (venue_id) REFERENCES venues(id)
    )
  `);

  // Migration: add duration_watched column if missing (for existing DBs)
  const vcCols = d.prepare("PRAGMA table_info(view_cooldowns)").all() as { name: string }[];
  if (vcCols.length > 0 && !vcCols.some((c) => c.name === "duration_watched")) {
    d.run("ALTER TABLE view_cooldowns ADD COLUMN duration_watched INTEGER NOT NULL DEFAULT 0");
  }

  // ── Crowd density tables ──────────────────────────────────────
  d.run(`
    CREATE TABLE IF NOT EXISTS crowd_density (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venue_id INTEGER NOT NULL,
      people_count INTEGER NOT NULL DEFAULT 0,
      density_score INTEGER NOT NULL DEFAULT 0,
      analyzed_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (venue_id) REFERENCES venues(id)
    )
  `);

  // Migration: add crowd_density and density_updated_at columns to venues
  const venueCols = d.prepare("PRAGMA table_info(venues)").all() as { name: string }[];
  if (!venueCols.some((c) => c.name === "crowd_density")) {
    d.run("ALTER TABLE venues ADD COLUMN crowd_density INTEGER");
  }
  if (!venueCols.some((c) => c.name === "density_updated_at")) {
    d.run("ALTER TABLE venues ADD COLUMN density_updated_at TEXT");
  }
  if (!venueCols.some((c) => c.name === "promo_text")) {
    d.run("ALTER TABLE venues ADD COLUMN promo_text TEXT");
  }
  if (!venueCols.some((c) => c.name === "check_in_code")) {
    d.run("ALTER TABLE venues ADD COLUMN check_in_code TEXT");
  }

  // ── Favorites table ──────────────────────────────────────────
  d.run(`
    CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      venue_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (venue_id) REFERENCES venues(id),
      UNIQUE(user_id, venue_id)
    )
  `);

  // ── Push subscriptions table ─────────────────────────────────
  d.run(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // ── Check-ins table ──────────────────────────────────────────
  d.run(`
    CREATE TABLE IF NOT EXISTS check_ins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venue_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      code TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (venue_id) REFERENCES venues(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
}

function seedIfEmpty() {
  const row = db.query("SELECT COUNT(*) as c FROM venues").get() as {
    c: number;
  };
  if (row.c > 0) return;

  const insert = db.prepare(`
  INSERT INTO venues (name, location, description, category, thumbnail_url, is_live, viewer_count, owner_email, latitude, longitude, check_in_code)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const venues = [
    {
      name: "Bassline Club",
      location: "Gaslamp Quarter, San Diego, CA",
      description:
        "High-energy nightclub with world-class sound system, EDM nights, and a packed dance floor every weekend.",
      category: "club",
      thumbnail: "/api/thumbnail/1",
      is_live: 1,
      viewers: 87,
      email: "owner@bassline.com",
      lat: 32.7115,
      lng: -117.1587,
    },
    {
      name: "Neon Dragon",
      location: "Gaslamp Quarter, San Diego, CA",
      description:
        "Underground cocktail bar with live DJs and dragon-themed neon decor. Known for craft cocktails and an electric Friday night crowd.",
      category: "bar",
      thumbnail: "/api/thumbnail/2",
      is_live: 1,
      viewers: 42,
      email: "owner@neondragon.com",
      lat: 32.7120,
      lng: -117.1595,
    },
    {
      name: "The Velvet Room",
      location: "North Park, San Diego, CA",
      description:
        "Upscale lounge with velvet interiors, jazz nights, and a curated wine list. Perfect for a sophisticated night out.",
      category: "lounge",
      thumbnail: "/api/thumbnail/3",
      is_live: 1,
      viewers: 18,
      email: "owner@velvetroom.com",
      lat: 32.7457,
      lng: -117.1295,
    },
    {
      name: "The Hideaway",
      location: "Pacific Beach, San Diego, CA",
      description:
        "Cozy speakeasy hidden behind a bookshelf. Live acoustic sets, craft beers, and the best quiet vibe in town.",
      category: "bar",
      thumbnail: "/api/thumbnail/4",
      is_live: 0,
      viewers: 0,
      email: "owner@hideaway.com",
      lat: 32.7952,
      lng: -117.2547,
    },
    {
      name: "Skybar Rooftop",
      location: "Gaslamp Quarter, San Diego, CA",
      description:
        "Rooftop bar with panoramic city views, poolside cabanas, and sunset happy hours. San Diego's hottest open-air venue.",
      category: "bar",
      thumbnail: "/api/thumbnail/5",
      is_live: 0,
      viewers: 0,
      email: "owner@skybar.com",
      lat: 32.7110,
      lng: -117.1575,
    },
  ];

  const insertAll = db.transaction(() => {
    for (const v of venues) {
      insert.run(
        v.name,
        v.location,
        v.description,
        v.category,
        v.thumbnail,
        v.is_live,
        v.viewers,
        v.email,
        v.lat,
        v.lng,
        generateCheckInCode()
      );
    }
  });
  insertAll();

  // Seed a demo user for dashboard login
  const hash = crypto
    .createHash("sha256")
    .update("demo123")
    .digest("hex");
  db.prepare(
    "INSERT OR IGNORE INTO users (email, password_hash, venue_id, role) VALUES (?, ?, ?, ?)"
  ).run("demo@vibecheck.app", hash, 1, "venue_owner");

  console.log("Seeded 5 demo venues + 1 demo user (demo@vibecheck.app / demo123)");
}

export function generateStreamKey(): string {
  return `vibe_${crypto.randomBytes(16).toString("hex")}`;
}

export function generateCheckInCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export interface VenueRow {
  id: number;
  name: string;
  location: string;
  description: string;
  category: string;
  thumbnail_url: string;
  is_live: number;
  viewer_count: number;
  owner_email: string;
  business_hours: string;
  stream_key: string | null;
  latitude: number | null;
  longitude: number | null;
  crowd_density: number | null;
  density_updated_at: string | null;
  promo_text: string | null;
  check_in_code: string | null;
  plan: string;
  created_at: string;
  updated_at: string;
}

export interface CrowdDensityRow {
  id: number;
  venue_id: number;
  people_count: number;
  density_score: number;
  analyzed_at: string;
}

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  venue_id: number | null;
  role: string;
  google_id: string | null;
  created_at: string;
}
