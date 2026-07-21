import webpush from "web-push";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = join(fileURLToPath(import.meta.url), "..");
const VAPID_FILE = join(__dirname, "..", ".vapid.json");

let cachedKeys: { publicKey: string; privateKey: string } | null = null;

export function getVapidKeys(): { publicKey: string; privateKey: string } {
  if (cachedKeys) return cachedKeys;

  // 1. Check environment variables (for Vercel/production)
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    cachedKeys = {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
    };
    return cachedKeys;
  }

  // 2. Load from local file (for dev persistence)
  if (existsSync(VAPID_FILE)) {
    try {
      cachedKeys = JSON.parse(readFileSync(VAPID_FILE, "utf-8"));
      return cachedKeys;
    } catch {
      // Corrupted file; regenerate
    }
  }

  // 3. Generate new keys and persist
  const keys = webpush.generateVAPIDKeys();
  cachedKeys = { publicKey: keys.publicKey, privateKey: keys.privateKey };

  try {
    writeFileSync(VAPID_FILE, JSON.stringify(cachedKeys, null, 2), "utf-8");
  } catch {
    console.warn("Could not persist VAPID keys to file; keys will change on next restart");
  }

  return cachedKeys;
}
