import cors from "cors";
import express from "express";
import crypto from "crypto";
import http from "http";
import net from "net";
import tls from "tls";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import webpush from "web-push";
import { getDb, generateStreamKey, generateCheckInCode } from "./db.ts";
import type { VenueRow } from "./db.ts";
import { getVapidKeys } from "./src/vapid.ts";
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
// Behind a single reverse proxy (the platform's host): honor X-Forwarded-For so
// req.ip (used by the auth rate limiter) is the real client IP, not the proxy's.
app.set("trust proxy", 1);

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
// Password hashes use node:crypto scrypt with a per-user random salt, stored
// self-describing as "scrypt$N$r$p$salt$hash". Legacy accounts (plain 64-hex
// SHA-256, no prefix) are verified against the old scheme and transparently
// re-hashed with scrypt on their next successful login.
const scryptAsync = (password: string, salt: string, keylen: number, N: number, r: number, p: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, { N, r, p }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const LEGACY_SHA256_RE = /^[0-9a-f]{64}$/;

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await scryptAsync(password, salt, SCRYPT_KEYLEN, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derived.toString("hex")}`;
}

function isLegacySha256Hash(stored: string): boolean {
  return LEGACY_SHA256_RE.test(stored);
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored) return false;
  if (isLegacySha256Hash(stored)) {
    const digest = crypto.createHash("sha256").update(password).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(digest, "hex"), Buffer.from(stored, "hex"));
  }
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, salt, hashHex] = parts;
  const N = parseInt(nStr, 10);
  const r = parseInt(rStr, 10);
  const p = parseInt(pStr, 10);
  if (!N || !r || !p || !salt) return false;
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length === 0) return false;
  try {
    const derived = await scryptAsync(password, salt, expected.length, N, r, p);
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

// ─── Rate limiting (tiny in-memory, per-IP) ───────────────────
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 10;
const rateHits = new Map<string, number[]>();

function rateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const recent = (rateHits.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    rateHits.set(ip, recent);
    res.status(429).json({ error: "Too many attempts. Please wait a few minutes and try again." });
    return;
  }
  recent.push(now);
  rateHits.set(ip, recent);
  // Opportunistic cleanup so the map can't grow unbounded.
  if (rateHits.size > 2000) {
    for (const [k, v] of rateHits) {
      if (v.length === 0 || now - v[v.length - 1] > RATE_LIMIT_WINDOW_MS) rateHits.delete(k);
    }
  }
  next();
}

// ─── Password reset email delivery ────────────────────────────
// SMTP is optional: if SMTP_HOST is set we send via nodemailer when it happens
// to be installed, otherwise a tiny no-dependency SMTP client (node:net/tls).
// With no SMTP provider configured the reset link is logged server-side so the
// dev loop still works end to end. The API response never reveals whether an
// account exists, either way.
function sendSmtp(opts: {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
  to: string;
  subject: string;
  text: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    let socket: net.Socket | tls.TLSSocket;
    let buffer = "";
    let stage = 0;
    let awaitingDataReply = false;
    let done = false;

    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(v);
    };

    const body =
      `From: ${opts.from}\r\nTo: ${opts.to}\r\nSubject: ${opts.subject}\r\n` +
      "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n" +
      `\r\n${opts.text}\r\n.\r\n`;

    const sendCmd = (line: string) => socket.write(line + "\r\n", "utf8");

    const runStage = () => {
      switch (stage) {
        case 0:
          sendCmd("EHLO vibecheck.local");
          break;
        case 1:
          sendCmd("STARTTLS");
          break;
        case 2:
          sendCmd("EHLO vibecheck.local");
          break;
        case 3:
          if (opts.user) {
            const auth = Buffer.from(`\0${opts.user}\0${opts.pass || ""}`).toString("base64");
            sendCmd(`AUTH PLAIN ${auth}`);
          } else {
            stage = 4;
            runStage();
          }
          break;
        case 4:
          sendCmd(`MAIL FROM:<${opts.from}>`);
          break;
        case 5:
          sendCmd(`RCPT TO:<${opts.to}>`);
          break;
        case 6:
          sendCmd("DATA");
          break;
        case 7:
          sendCmd("QUIT");
          break;
        default:
          finish(true);
      }
    };

    const handleFinalLine = (line: string) => {
      const code = parseInt(line.slice(0, 3), 10);
      if (code >= 400) {
        finish(false);
        return;
      }
      if (awaitingDataReply) {
        awaitingDataReply = false;
        if (code === 250) {
          stage = 7;
          runStage();
        } else {
          finish(false);
        }
        return;
      }
      switch (stage) {
        case 0:
          if (code === 250) {
            stage = 1;
            runStage();
          } else finish(false);
          break;
        case 1:
          if (code !== 220) {
            finish(false);
            return;
          }
          // Upgrade to TLS (STARTTLS)
          try {
            const secured = tls.connect({ socket: socket as net.Socket, servername: opts.host });
            secured.on("secureConnect", () => {
              socket = secured;
              buffer = "";
              stage = 2;
              runStage();
            });
            secured.on("data", onData);
            secured.on("error", () => finish(false));
            secured.on("close", () => finish(false));
          } catch {
            finish(false);
          }
          break;
        case 2:
          if (code === 250) {
            stage = 3;
            runStage();
          } else finish(false);
          break;
        case 3:
          if (code === 235) {
            stage = 4;
            runStage();
          } else finish(false);
          break;
        case 4:
          if (code === 250) {
            stage = 5;
            runStage();
          } else finish(false);
          break;
        case 5:
          if (code === 250 || code === 251) {
            stage = 6;
            runStage();
          } else finish(false);
          break;
        case 6:
          if (code === 354) {
            awaitingDataReply = true;
            socket.write(body);
          } else finish(false);
          break;
        case 7:
          finish(code === 221);
          break;
        default:
          finish(false);
      }
    };

    function onData(chunk: Buffer) {
      buffer += chunk.toString("utf8");
      let idx: number;
      while ((idx = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (line.length >= 4 && line[3] === "-") continue; // multiline continuation
        if (/^\d{3}/.test(line)) handleFinalLine(line);
      }
    }

    if (opts.port === 465) {
      // Immediate TLS (SMTPS)
      socket = tls.connect({ host: opts.host, port: opts.port });
      socket.on("secureConnect", () => {
        buffer = "";
        runStage();
      });
    } else {
      // Plain TCP, upgrade via STARTTLS in stage 1
      socket = net.connect(opts.port, opts.host);
      socket.on("connect", () => runStage());
    }
    socket.on("data", onData);
    socket.on("error", () => finish(false));
    socket.on("close", () => finish(false));
    setTimeout(() => finish(false), 15000);
  });
}

async function sendResetEmail(to: string, resetUrl: string): Promise<boolean> {
  const host = process.env.SMTP_HOST;
  if (!host) return false;
  const port = parseInt(process.env.SMTP_PORT || "587", 10) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user || `no-reply@${host}`;
  const subject = "Reset your VibeCheck password";
  const text =
    `We received a request to reset your VibeCheck password.\n\n` +
    `Open this link to choose a new one. It expires in 20 minutes:\n\n${resetUrl}\n\n` +
    `If you didn't ask for this, you can safely ignore this email.\n\n— VibeCheck`;
  try {
    // nodemailer may not be installed — resolve at runtime, fall back to the
    // tiny built-in SMTP client. `as string` keeps TS from type-checking a
    // module we intentionally don't depend on.
    let nodemailer: any = null;
    try {
      nodemailer = (await import("nodemailer" as string)).default;
    } catch {
      nodemailer = null;
    }
    if (nodemailer && typeof nodemailer.createTransport === "function") {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: user ? { user, pass } : undefined,
      });
      await transporter.sendMail({ from, to, subject, text });
      return true;
    }
    return await sendSmtp({ host, port, user, pass, from, to, subject, text });
  } catch (err) {
    console.error("Failed to send password reset email:", err);
    return false;
  }
}

function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function getSessionUser(req: express.Request): { userId: number; venueId: number | null; role: string } | null {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return null;
  const db = getDb();
  const session = db
    .prepare("SELECT s.user_id, s.venue_id, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > datetime('now')")
    .get(token) as { user_id: number; venue_id: number | null; role: string } | undefined;
  if (!session) return null;
  return { userId: session.user_id, venueId: session.venue_id, role: session.role };
}

// ─── Admin helpers ─────────────────────────────────────────────
// Admin is a manual designation for the owner (you). Configure the owner's
// account email(s) via the ADMIN_EMAILS env var (comma-separated). If unset,
// the admin endpoints are disabled for safety — the CLI (`bun run set-premium`)
// is always available regardless of this.
function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function isAdmin(req: express.Request): boolean {
  const emails = getAdminEmails();
  if (emails.length === 0) return false;
  const session = getSessionUser(req);
  if (!session) return false;
  const db = getDb();
  const user = db.prepare("SELECT email FROM users WHERE id = ?").get(session.userId) as
    | { email: string }
    | undefined;
  return !!user && emails.includes(user.email.toLowerCase());
}

// ─── API Routes ────────────────────────────────────────────────

// Premium perks derive from the venue's plan, server-side. A venue is "featured"
// (pinned to the top + badged) iff it is on the premium plan, and only premium
// venues may surface a promo overlay. We shape every venue we return so these
// perks can't be spoofed or leaked from the client, and so flipping the plan
// (via `bun run set-premium`) is the single control that toggles both.
type VenueResponse = VenueRow & { featured: boolean };
function withPremiumFeatures(venue: VenueRow): VenueResponse {
  const premium = venue.plan === "premium";
  return {
    ...venue,
    featured: premium,
    // Promo overlay is a premium perk — never expose promo_text to base venues,
    // even if a leftover value survives from a previous premium tier.
    promo_text: premium ? venue.promo_text : null,
  };
}

// Public: list venues — premium venues are featured (pinned to the top of the
// feed with a badge). Ordering + featured state are decided server-side from plan.
app.get("/api/venues", (_req, res) => {
  const db = getDb();
  const venues = db.prepare(`
    SELECT * FROM venues
    ORDER BY CASE WHEN plan = 'premium' THEN 0 ELSE 1 END, is_live DESC, viewer_count DESC
  `).all() as VenueRow[];
  res.json(venues.map(withPremiumFeatures));
});

// Get user's favorited venues (auth required) — must be before :id
app.get("/api/venues/favorites", (req, res) => {
  const session = getSessionUser(req);
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const db = getDb();
  const favorites = db.prepare(`
    SELECT v.*, f.created_at as favorited_at
    FROM favorites f
    JOIN venues v ON v.id = f.venue_id
    WHERE f.user_id = ?
    ORDER BY f.created_at DESC
  `).all(session.userId) as (VenueRow & { favorited_at: string })[];
  res.json(favorites.map((f) => ({ ...withPremiumFeatures(f), favorited_at: f.favorited_at })));
});

// Public: single venue — NOTE: must come after /api/venues/favorites
app.get("/api/venues/:id", (req, res) => {
  const db = getDb();
  const venue = db.prepare("SELECT * FROM venues WHERE id = ?").get(parseInt(req.params.id)) as VenueRow | undefined;
  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }
  res.json(withPremiumFeatures(venue));
});

// Auth: signup
app.post("/api/auth/signup", rateLimit, async (req, res) => {
  const { email, password, role, privacyAccepted } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }
  if (privacyAccepted !== true) {
    res.status(400).json({ error: "You must accept the Privacy Policy to create an account" });
    return;
  }
  const emailNorm = String(email).trim().toLowerCase();
  const db = getDb();
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(emailNorm);
  if (existing) {
    res.status(409).json({
      error: "This email is already registered — log in, or use 'Forgot password?'.",
    });
    return;
  }
  const hash = await hashPassword(password);
  const userRole = role === "venue_owner" ? "venue_owner" : "consumer";
  db.prepare("INSERT INTO users (email, password_hash, role, privacy_accepted_at) VALUES (?, ?, ?, datetime('now'))").run(emailNorm, hash, userRole);
  res.json({ success: true, role: userRole });
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

  const { name, location, description, category, business_hours, latitude, longitude } = req.body;
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
    "INSERT INTO venues (name, location, description, category, thumbnail_url, business_hours, owner_email, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(name, location, desc, cat, thumb, hours, user.id.toString(), latitude ?? null, longitude ?? null);

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
app.post("/api/auth/login", rateLimit, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }
  const emailNorm = String(email).trim().toLowerCase();
  const db = getDb();
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(emailNorm) as
    | { id: number; email: string; password_hash: string; venue_id: number | null; role: string }
    | undefined;
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    res.status(401).json({ error: "Incorrect email or password" });
    return;
  }
  // Transparently migrate legacy SHA-256 hashes to scrypt on successful login.
  if (isLegacySha256Hash(user.password_hash)) {
    const newHash = await hashPassword(password);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newHash, user.id);
  }
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare("INSERT INTO sessions (id, user_id, venue_id, expires_at) VALUES (?, ?, ?, ?)").run(
    token,
    user.id,
    user.venue_id,
    expiresAt
  );
  res.json({ token, venue_id: user.venue_id, email: user.email, role: user.role });
});

// Auth: forgot password — always answers success so accounts can't be enumerated.
// If the account exists a single-use reset link (valid 20 minutes) is created and
// delivered by email when SMTP is configured, otherwise logged server-side.
app.post("/api/auth/forgot-password", rateLimit, async (req, res) => {
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: "Email required" });
    return;
  }
  const emailNorm = String(email).trim().toLowerCase();
  const db = getDb();
  const user = db.prepare("SELECT id, email FROM users WHERE email = ?").get(emailNorm) as
    | { id: number; email: string }
    | undefined;
  if (user) {
    const token = crypto.randomBytes(32).toString("hex");
    // Store expiry in SQLite time format so `expires_at > datetime('now')` compares correctly.
    db.prepare("INSERT INTO password_resets (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+20 minutes'))").run(
      token,
      user.id
    );
    const baseUrl =
      process.env.PUBLIC_BASE_URL ||
      `${req.protocol}://${req.get("host")}`;
    const resetUrl = `${baseUrl}/reset?token=${token}`;
    const sent = await sendResetEmail(user.email, resetUrl);
    if (!sent) {
      console.log(`[password-reset] reset link for ${user.email}: ${resetUrl}`);
    }
  }
  // Always the same generic response — no user enumeration.
  res.json({ success: true });
});

// Auth: reset password with a single-use token. Invalidates the token and every
// session the user has so a leaked/reset password kicks out stale logins.
app.post("/api/auth/reset-password", rateLimit, async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    res.status(400).json({ error: "Token and new password required" });
    return;
  }
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM password_resets WHERE token = ?")
    .get(String(token)) as
    | { token: string; user_id: number; expires_at: string; used_at: string | null }
    | undefined;
  if (!row) {
    res.status(400).json({ error: "This reset link is invalid. Please request a new one." });
    return;
  }
  if (row.used_at) {
    res.status(400).json({ error: "This reset link has already been used. Please request a new one." });
    return;
  }
  const nowRow = db.query("SELECT datetime('now') as now").get() as { now: string };
  if (row.expires_at < nowRow.now) {
    res.status(400).json({ error: "This reset link has expired. Please request a new one." });
    return;
  }
  const newHash = await hashPassword(password);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newHash, row.user_id);
  db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE token = ?").run(row.token);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.user_id);
  res.json({ success: true });
});

// Auth: Google OAuth login/signup
app.post("/api/auth/google", async (req, res) => {
  const { credential } = req.body;
  if (!credential) {
    res.status(400).json({ error: "Google credential required" });
    return;
  }

  // Verify the Google ID token
  let googleUser: { sub: string; email: string; name: string; picture?: string };
  try {
    const verifyRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
    );
    if (!verifyRes.ok) {
      res.status(401).json({ error: "Invalid Google credential" });
      return;
    }
    googleUser = await verifyRes.json() as { sub: string; email: string; name: string; picture?: string };
  } catch {
    res.status(401).json({ error: "Failed to verify Google credential" });
    return;
  }

  const db = getDb();

  // Find existing user by google_id or email
  let user = db.prepare("SELECT * FROM users WHERE google_id = ?").get(googleUser.sub) as
    | { id: number; email: string; venue_id: number | null; role: string }
    | undefined;

  if (!user) {
    user = db.prepare("SELECT * FROM users WHERE email = ?").get(googleUser.email) as
      | { id: number; email: string; venue_id: number | null; role: string }
      | undefined;
    if (user) {
      // Link Google ID to existing account
      db.prepare("UPDATE users SET google_id = ? WHERE id = ?").run(googleUser.sub, user.id);
    }
  }

  if (!user) {
    // Create new consumer account
    db.prepare(
      "INSERT INTO users (email, password_hash, role, google_id) VALUES (?, ?, ?, ?)"
    ).run(googleUser.email, "", "consumer", googleUser.sub);
    user = db.prepare("SELECT * FROM users WHERE google_id = ?").get(googleUser.sub) as
      | { id: number; email: string; venue_id: number | null; role: string }
      | undefined;
  }

  if (!user) {
    res.status(500).json({ error: "Failed to create user" });
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
  res.json({ token, venue_id: user.venue_id, email: user.email, role: user.role });
});

// View cooldown: record a view and enforce 30min cooldown (auth required)
app.post("/api/venues/:id/view", (req, res) => {
  const session = getSessionUser(req);
  if (!session) {
    res.status(401).json({ error: "Sign in required to watch live feeds" });
    return;
  }

  const venueId = parseInt(req.params.id);
  const db = getDb();

  // Check if venue exists
  const venue = db.prepare("SELECT id FROM venues WHERE id = ?").get(venueId);
  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }

  // Check cooldown: 30 minutes between view starts
  const cooldown = db.prepare(
    "SELECT last_viewed_at FROM view_cooldowns WHERE user_id = ? AND venue_id = ?"
  ).get(session.userId, venueId) as { last_viewed_at: string } | undefined;

  const now = new Date();
  if (cooldown) {
    const lastViewed = new Date(cooldown.last_viewed_at + "Z");
    const elapsed = (now.getTime() - lastViewed.getTime()) / 1000; // seconds
    if (elapsed < 30 * 60) {
      const remaining = Math.ceil(30 * 60 - elapsed);
      res.status(429).json({
        error: "Cooldown active",
        remaining_seconds: remaining,
        message: `You can watch again in ${Math.ceil(remaining / 60)} minutes`,
      });
      return;
    }
  }

  // Record/update the view
  db.prepare(
    "INSERT INTO view_cooldowns (user_id, venue_id, last_viewed_at) VALUES (?, ?, datetime('now')) ON CONFLICT(user_id, venue_id) DO UPDATE SET last_viewed_at = datetime('now')"
  ).run(session.userId, venueId);

  // Return the stream access with a 15-second view window
  const viewToken = crypto.randomBytes(16).toString("hex");
  res.json({
    view_token: viewToken,
    view_window_seconds: 15,
    cooldown_minutes: 30,
    message: "Stream access granted for 15 seconds",
  });
});

// Auth: me
app.get("/api/auth/me", (req, res) => {
  const session = getSessionUser(req);
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const db = getDb();
  const user = db.prepare("SELECT id, email, venue_id, role FROM users WHERE id = ?").get(session.userId) as
    | { id: number; email: string; venue_id: number | null; role: string }
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
  const { is_live, business_hours, description, name, location, latitude, longitude } = req.body;
  const updates: string[] = [];
  const values: unknown[] = [];

  const wasLive = venue.is_live === 1;
  const goingLive = is_live === true || is_live === 1;

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
  if (latitude !== undefined) {
    updates.push("latitude = ?");
    values.push(latitude);
  }
  if (longitude !== undefined) {
    updates.push("longitude = ?");
    values.push(longitude);
  }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    values.push(venueId);
    db.prepare(`UPDATE venues SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  }

  const updated = db.prepare("SELECT * FROM venues WHERE id = ?").get(venueId) as VenueRow;
  res.json(updated);

  // ── Push notifications: venue just went live ──
  if (!wasLive && goingLive) {
    sendLiveNotifications(venueId, updated.name).catch((err) =>
      console.error("Failed to send live push notifications:", err)
    );
  }
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
        rtmp_url: `rtmps://global-live.mux.com:443/app/${stream.streamKey}`,
        stream_url: stream.playbackUrl,
        instructions: {
          obs: `1. Open OBS Studio\n2. Go to Settings → Stream\n3. Service: Custom\n4. Server: rtmps://global-live.mux.com:443/app\n5. Stream Key: ${stream.streamKey}\n6. Click Start Streaming`,
          ip_camera: `Production path: the VibeCheck relay box does this automatically (camera RTSP → relay → Mux). See relay/README.md. Manual ingest URL: rtmps://global-live.mux.com:443/app/${stream.streamKey}`,
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

  // Fallback: local stream key (WebSocket demo mode — no Mux configured)
  let key = venue.stream_key;
  if (!key) {
    key = generateStreamKey();
    db.prepare("UPDATE venues SET stream_key = ? WHERE id = ?").run(key, venueId);
  }

  res.json({
    stream_key: key,
    rtmp_url: "",
    stream_url: `/api/venues/${venueId}/stream`,
    instructions: {
      obs: `Demo mode (WebSocket relay): Mux is not configured (set MUX_TOKEN_ID/MUX_TOKEN_SECRET to enable production streaming). Use the "Test Camera" browser broadcast below for a quick demo.`,
      ip_camera: `Production path: the VibeCheck relay box pushes the camera to Mux (camera RTSP → relay → Mux). See relay/README.md. No self-hosted RTMP server is used.`,
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
        rtmp_url: `rtmps://global-live.mux.com:443/app/${stream.streamKey}`,
        message: "Stream key regenerated successfully. Update the relay's relay.conf (MUX_STREAM_KEY) with the new key.",
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
    rtmp_url: "",
    message: "Demo-mode stream key regenerated. Production streaming requires Mux (set MUX_TOKEN_ID/MUX_TOKEN_SECRET); see relay/README.md.",
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

// ─── Promo Overlay ────────────────────────────────────────────

// GET promo text for a venue (public)
app.get("/api/venues/:id/promo", (req, res) => {
  const venueId = parseInt(req.params.id);
  const db = getDb();
  const venue = db.prepare("SELECT promo_text, plan FROM venues WHERE id = ?").get(venueId) as
    | { promo_text: string | null; plan: string }
    | undefined;
  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }
  // Promo overlay is a PREMIUM-only perk — base venues never receive promo text,
  // even if a leftover value survives from a previous premium tier.
  const promo_text = venue.plan === "premium" ? venue.promo_text : null;
  res.json({ promo_text });
});

// PATCH promo text (auth-gated to venue owner, premium-only)
app.patch("/api/venues/:id/promo", (req, res) => {
  const session = getSessionUser(req);
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const venueId = parseInt(req.params.id);
  if (session.venueId !== venueId) {
    res.status(403).json({ error: "Forbidden — you can only update your own venue" });
    return;
  }

  const { promo_text } = req.body;
  const db = getDb();

  const venue = db.prepare("SELECT id, plan FROM venues WHERE id = ?").get(venueId) as
    | { id: number; plan: string }
    | undefined;
  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }
  // Promo overlay is a PREMIUM-only feature — enforced server-side, applies to
  // the venue owner too. Base venues get a premium-required response regardless
  // of whether they own the venue.
  if (venue.plan !== "premium") {
    res.status(403).json({
      code: "PREMIUM_REQUIRED",
      error: "Promotional overlays are a VibeCheck Premium feature. This venue is on the base plan — contact VibeCheck to upgrade.",
    });
    return;
  }

  if (promo_text !== undefined && promo_text !== null && promo_text !== "") {
    if (typeof promo_text !== "string" || promo_text.length > 80) {
      res.status(400).json({ error: "promo_text must be a string of 80 characters or fewer" });
      return;
    }
    db.prepare("UPDATE venues SET promo_text = ?, updated_at = datetime('now') WHERE id = ?").run(promo_text, venueId);
  } else {
    // Clear the promo text
    db.prepare("UPDATE venues SET promo_text = NULL, updated_at = datetime('now') WHERE id = ?").run(venueId);
  }

  const updated = db.prepare("SELECT promo_text FROM venues WHERE id = ?").get(venueId) as
    | { promo_text: string | null }
    | undefined;
  res.json({ promo_text: updated?.promo_text ?? null });
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
  const venue = db.prepare("SELECT plan FROM venues WHERE id = ?").get(venueId) as
    | { plan: string }
    | undefined;
  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }
  // Analytics is a PREMIUM-only feature — enforced server-side, applies to the
  // venue owner too. Base venues get a premium-required response regardless of
  // whether they own the venue.
  if (venue.plan !== "premium") {
    res.status(403).json({
      code: "PREMIUM_REQUIRED",
      error: "Analytics is a VibeCheck Premium feature. This venue is on the base plan — contact VibeCheck to upgrade.",
    });
    return;
  }

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

  // Check-ins this week
  const checkInsThisWeek = (db.prepare(
    "SELECT COUNT(*) as c FROM check_ins WHERE venue_id = ? AND created_at >= datetime('now', '-7 days')"
  ).get(venueId) as { c: number }).c;

  res.json({
    total_views: totalViews,
    unique_viewers: uniqueViewers,
    views_by_day: viewsByDay,
    views_by_hour: viewsByHour,
    avg_view_duration: avgViewDuration,
    repeat_viewer_rate: repeatViewerRate,
    peak_day: peakDay,
    peak_hour: peakHour,
    check_ins_this_week: checkInsThisWeek,
  });
});

// ─── Admin: manual plan designation (owner-only) ─────────────
// List all venues with their plan. Requires an admin session (ADMIN_EMAILS).
app.get("/api/admin/venues/plans", (req, res) => {
  if (!isAdmin(req)) {
    res.status(403).json({ error: "Forbidden — admin access required" });
    return;
  }
  const db = getDb();
  const venues = db
    .prepare(
      "SELECT id, name, location, plan, owner_email FROM venues ORDER BY id ASC"
    )
    .all() as { id: number; name: string; location: string; plan: string; owner_email: string | null }[];
  res.json({ venues });
});

// Flip a venue's plan between base and premium. Requires an admin session.
app.post("/api/admin/venues/:id/plan", (req, res) => {
  if (!isAdmin(req)) {
    res.status(403).json({ error: "Forbidden — admin access required" });
    return;
  }
  const venueId = parseInt(req.params.id);
  const plan = (req.body?.plan as string) || "";
  if (plan !== "base" && plan !== "premium") {
    res.status(400).json({ error: 'plan must be "base" or "premium"' });
    return;
  }
  const db = getDb();
  const venue = db.prepare("SELECT id, name FROM venues WHERE id = ?").get(venueId) as
    | { id: number; name: string }
    | undefined;
  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }
  db.prepare("UPDATE venues SET plan = ?, updated_at = datetime('now') WHERE id = ?").run(plan, venueId);
  res.json({ id: venueId, name: venue.name, plan });
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

// ─── Favorites ─────────────────────────────────────────────────

// Toggle favorite for a venue (auth required)
app.post("/api/venues/:id/favorite", (req, res) => {
  const session = getSessionUser(req);
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const venueId = parseInt(req.params.id);
  const db = getDb();

  // Check venue exists
  const venue = db.prepare("SELECT id FROM venues WHERE id = ?").get(venueId);
  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }

  const existing = db.prepare(
    "SELECT id FROM favorites WHERE user_id = ? AND venue_id = ?"
  ).get(session.userId, venueId);

  if (existing) {
    // Unfavorite
    db.prepare("DELETE FROM favorites WHERE user_id = ? AND venue_id = ?").run(session.userId, venueId);
    res.json({ favorited: false });
  } else {
    // Favorite
    db.prepare("INSERT INTO favorites (user_id, venue_id) VALUES (?, ?)").run(session.userId, venueId);
    res.json({ favorited: true });
  }
});

// ─── Push Notifications ────────────────────────────────────────

// Get VAPID public key (public, needed by service worker registration)
app.get("/api/push/vapid-public-key", (_req, res) => {
  const keys = getVapidKeys();
  res.json({ publicKey: keys.publicKey });
});

// Subscribe to push notifications (auth required)
app.post("/api/push/subscribe", (req, res) => {
  const session = getSessionUser(req);
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    res.status(400).json({ error: "endpoint, keys.p256dh, and keys.auth are required" });
    return;
  }

  const db = getDb();

  // Upsert: avoid duplicate subscriptions for the same endpoint
  const existing = db.prepare(
    "SELECT id FROM push_subscriptions WHERE endpoint = ?"
  ).get(endpoint);

  if (existing) {
    db.prepare(
      "UPDATE push_subscriptions SET user_id = ?, p256dh = ?, auth = ? WHERE endpoint = ?"
    ).run(session.userId, keys.p256dh, keys.auth, endpoint);
  } else {
    db.prepare(
      "INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)"
    ).run(session.userId, endpoint, keys.p256dh, keys.auth);
  }

  res.json({ success: true });
});

// Unsubscribe from push notifications (auth required)
app.post("/api/push/unsubscribe", (req, res) => {
  const session = getSessionUser(req);
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const { endpoint } = req.body;
  if (!endpoint) {
    res.status(400).json({ error: "endpoint is required" });
    return;
  }

  const db = getDb();
  db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").run(endpoint, session.userId);
  res.json({ success: true });
});

// Helper: send push notifications to all users who favorited a venue
async function sendLiveNotifications(venueId: number, venueName: string) {
  const db = getDb();
  const keys = getVapidKeys();

  webpush.setVapidDetails(
    "mailto:notifications@vibecheck.app",
    keys.publicKey,
    keys.privateKey
  );

  // Find all push subscriptions for users who favorited this venue
  const subs = db.prepare(`
    SELECT ps.endpoint, ps.p256dh, ps.auth
    FROM push_subscriptions ps
    JOIN favorites f ON f.user_id = ps.user_id
    WHERE f.venue_id = ?
  `).all(venueId) as { endpoint: string; p256dh: string; auth: string }[];

  if (subs.length === 0) {
    console.log(`No push subscribers for venue ${venueId}`);
    return;
  }

  const payload = JSON.stringify({
    title: `🔴 ${venueName} is now live`,
    body: "Tap to check the vibe",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: {
      url: `/venue/${venueId}`,
      venueId,
    },
  });

  const results = await Promise.allSettled(
    subs.map((sub) =>
      webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        payload
      )
    )
  );

  let sent = 0;
  let failed = 0;
  for (const result of results) {
    if (result.status === "fulfilled") {
      sent++;
    } else {
      failed++;
      // If subscription is gone (410) or invalid, remove it
      const err = result.reason;
      if (err?.statusCode === 410 || err?.statusCode === 404) {
        const sub = subs[results.indexOf(result as any)];
        if (sub) {
          db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(sub.endpoint);
        }
      }
    }
  }

  console.log(`Push notifications for venue "${venueName}": ${sent} sent, ${failed} failed`);
}

// ─── Check-Ins ──────────────────────────────────────────────────

// GET check-in code (venue owner only)
app.get("/api/venues/:id/check-in-code", (req, res) => {
  const session = getSessionUser(req);
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const venueId = parseInt(req.params.id);
  if (session.venueId !== venueId) {
    res.status(403).json({ error: "Forbidden — you can only access your own venue's check-in code" });
    return;
  }

  const db = getDb();
  const venue = db.prepare("SELECT check_in_code, name FROM venues WHERE id = ?").get(venueId) as
    | { check_in_code: string | null; name: string }
    | undefined;

  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }

  // Generate a code if none exists
  let code = venue.check_in_code;
  if (!code) {
    code = generateCheckInCode();
    db.prepare("UPDATE venues SET check_in_code = ? WHERE id = ?").run(code, venueId);
  }

  res.json({
    check_in_code: code,
    offer: "10% off your first drink",
  });
});

// POST check-in (any authenticated user)
app.post("/api/check-in/:code", (req, res) => {
  const session = getSessionUser(req);
  if (!session) {
    res.status(401).json({ error: "Sign in required to check in" });
    return;
  }

  const code = req.params.code;
  const db = getDb();

  const venue = db.prepare("SELECT id, name FROM venues WHERE check_in_code = ?").get(code) as
    | { id: number; name: string }
    | undefined;

  if (!venue) {
    res.status(404).json({ error: "Invalid check-in code. This venue may not exist." });
    return;
  }

  // Check if user already checked in today
  const today = new Date().toISOString().slice(0, 10);
  const existing = db.prepare(
    "SELECT id FROM check_ins WHERE venue_id = ? AND user_id = ? AND date(created_at) = ?"
  ).get(venue.id, session.userId, today) as { id: number } | undefined;

  const alreadyCheckedIn = !!existing;

  if (!alreadyCheckedIn) {
    db.prepare(
      "INSERT INTO check_ins (venue_id, user_id, code) VALUES (?, ?, ?)"
    ).run(venue.id, session.userId, code);
  }

  res.json({
    venue_name: venue.name,
    offer: "10% off your first drink",
    already_checked_in: alreadyCheckedIn,
  });
});

// GET check-in stats (venue owner only)
app.get("/api/venues/:id/check-ins", (req, res) => {
  const session = getSessionUser(req);
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const venueId = parseInt(req.params.id);
  if (session.venueId !== venueId) {
    res.status(403).json({ error: "Forbidden — you can only access your own venue's check-in stats" });
    return;
  }

  const db = getDb();
  const venue = db.prepare("SELECT check_in_code FROM venues WHERE id = ?").get(venueId) as
    | { check_in_code: string | null }
    | undefined;

  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }

  const checkInsThisWeek = (db.prepare(
    "SELECT COUNT(*) as c FROM check_ins WHERE venue_id = ? AND created_at >= datetime('now', '-7 days')"
  ).get(venueId) as { c: number }).c;

  const totalCheckIns = (db.prepare(
    "SELECT COUNT(*) as c FROM check_ins WHERE venue_id = ?"
  ).get(venueId) as { c: number }).c;

  res.json({
    code: venue.check_in_code || "",
    offer: "10% off your first drink",
    check_ins_this_week: checkInsThisWeek,
    total_check_ins: totalCheckIns,
  });
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
