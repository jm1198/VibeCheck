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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Migration: add stream_key column if missing (for existing DBs)
  const cols = d.prepare("PRAGMA table_info(venues)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "stream_key")) {
    d.run("ALTER TABLE venues ADD COLUMN stream_key TEXT");
  }

  d.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      venue_id INTEGER,
      role TEXT NOT NULL DEFAULT 'consumer',
      google_id TEXT,
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
}

function seedIfEmpty() {
  const row = db.query("SELECT COUNT(*) as c FROM venues").get() as {
    c: number;
  };
  if (row.c > 0) return;

  const insert = db.prepare(`
    INSERT INTO venues (name, location, description, category, thumbnail_url, is_live, viewer_count, owner_email)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const venues = [
    {
      name: "Neon Dragon",
      location: "242 E 14th St, New York, NY",
      description:
        "Underground cocktail bar with live DJs and dragon-themed neon decor. Known for craft cocktails and an electric Friday night crowd.",
      category: "bar",
      thumbnail: "/api/thumbnail/1",
      is_live: 1,
      viewers: 42,
      email: "owner@neondragon.com",
    },
    {
      name: "The Velvet Room",
      location: "88 King St, San Francisco, CA",
      description:
        "Upscale lounge with velvet interiors, jazz nights, and a curated wine list. Perfect for a sophisticated night out.",
      category: "lounge",
      thumbnail: "/api/thumbnail/2",
      is_live: 1,
      viewers: 18,
      email: "owner@velvetroom.com",
    },
    {
      name: "Bassline Club",
      location: "15 Rave Ave, Miami, FL",
      description:
        "High-energy nightclub with world-class sound system, EDM nights, and a packed dance floor every weekend.",
      category: "club",
      thumbnail: "/api/thumbnail/3",
      is_live: 1,
      viewers: 87,
      email: "owner@bassline.com",
    },
    {
      name: "The Hideaway",
      location: "420 Bryant St, Austin, TX",
      description:
        "Cozy speakeasy hidden behind a bookshelf. Live acoustic sets, craft beers, and the best quiet vibe in town.",
      category: "bar",
      thumbnail: "/api/thumbnail/4",
      is_live: 0,
      viewers: 0,
      email: "owner@hideaway.com",
    },
    {
      name: "Skybar Rooftop",
      location: "1200 Sunset Blvd, Los Angeles, CA",
      description:
        "Rooftop bar with panoramic city views, poolside cabanas, and sunset happy hours. LA's hottest open-air venue.",
      category: "bar",
      thumbnail: "/api/thumbnail/5",
      is_live: 0,
      viewers: 0,
      email: "owner@skybar.com",
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
        v.email
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
  created_at: string;
  updated_at: string;
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
