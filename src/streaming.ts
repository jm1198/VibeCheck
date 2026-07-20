/**
 * Mux integration for VibeCheck.
 *
 * Manages live stream lifecycle: create, retrieve playback URLs,
 * and store stream IDs in SQLite.
 *
 * Gracefully degrades when MUX_TOKEN_ID / MUX_TOKEN_SECRET are not configured.
 */

import { getDb } from "../db.ts";

const MUX_BASE = "https://api.mux.com/video/v1";

function getMuxCredentials(): { tokenId: string; tokenSecret: string } | null {
  const tokenId = process.env.MUX_TOKEN_ID || "";
  const tokenSecret = process.env.MUX_TOKEN_SECRET || "";
  if (!tokenId || !tokenSecret) return null;
  return { tokenId, tokenSecret };
}

export const isConfigured = (): boolean => {
  return getMuxCredentials() !== null;
};

function getAuthHeader(): string {
  const creds = getMuxCredentials();
  if (!creds) throw new Error("Mux is not configured. Set MUX_TOKEN_ID and MUX_TOKEN_SECRET.");
  const encoded = btoa(`${creds.tokenId}:${creds.tokenSecret}`);
  return `Basic ${encoded}`;
}

/** Ensure Mux columns exist on the venues table (lazy migration). */
function ensureMuxColumns(): void {
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info(venues)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "mux_stream_id")) {
    db.run("ALTER TABLE venues ADD COLUMN mux_stream_id TEXT");
  }
  if (!cols.some((c) => c.name === "mux_stream_key")) {
    db.run("ALTER TABLE venues ADD COLUMN mux_stream_key TEXT");
  }
  if (!cols.some((c) => c.name === "mux_playback_id")) {
    db.run("ALTER TABLE venues ADD COLUMN mux_playback_id TEXT");
  }
}

export interface LiveStreamResult {
  streamId: string;
  streamKey: string;
  playbackId: string;
  playbackUrl: string;
}

/** Load a stored Mux live stream from DB without hitting the API. */
export function getStoredStream(venueId: number): LiveStreamResult | null {
  ensureMuxColumns();
  const db = getDb();
  const row = db
    .prepare("SELECT mux_stream_id, mux_stream_key, mux_playback_id FROM venues WHERE id = ?")
    .get(venueId) as { mux_stream_id: string | null; mux_stream_key: string | null; mux_playback_id: string | null } | undefined;

  if (!row?.mux_stream_id || !row?.mux_stream_key || !row?.mux_playback_id) return null;

  return {
    streamId: row.mux_stream_id,
    streamKey: row.mux_stream_key,
    playbackId: row.mux_playback_id,
    playbackUrl: `https://stream.mux.com/${row.mux_playback_id}.m3u8`,
  };
}

/**
 * Create a new live stream for a venue via Mux.
 * Stores the resulting stream ID, stream key, and playback ID in the venues table.
 */
export async function createLiveStream(venueId: number): Promise<LiveStreamResult> {
  const creds = getMuxCredentials();
  if (!creds) {
    throw new Error("Mux is not configured. Set MUX_TOKEN_ID and MUX_TOKEN_SECRET.");
  }

  ensureMuxColumns();

  const body = JSON.stringify({
    playback_policy: ["public"],
    new_asset_settings: { playback_policy: ["public"] },
  });

  const res = await fetch(`${MUX_BASE}/live-streams`, {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
    },
    body,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "unknown error");
    throw new Error(`Mux create stream failed: ${res.status} ${errText}`);
  }

  const json = await res.json();
  const data = json.data as {
    id: string;
    stream_key: string;
    playback_ids: { id: string; policy: string }[];
  };

  const streamId: string = data.id;
  const streamKey: string = data.stream_key;
  const playbackId: string = data.playback_ids?.[0]?.id ?? "";
  const playbackUrl = `https://stream.mux.com/${playbackId}.m3u8`;

  // Store in DB
  const db = getDb();
  db.prepare(
    "UPDATE venues SET mux_stream_id = ?, mux_stream_key = ?, mux_playback_id = ? WHERE id = ?"
  ).run(streamId, streamKey, playbackId, venueId);

  return { streamId, streamKey, playbackId, playbackUrl };
}

/**
 * Get or create a Mux live stream for a venue.
 * Returns the stored stream if it exists, otherwise creates a new one.
 */
export async function getOrCreateLiveStream(venueId: number): Promise<LiveStreamResult> {
  const stored = getStoredStream(venueId);
  if (stored) return stored;
  return createLiveStream(venueId);
}

/**
 * Get the HLS playback URL for a venue's live stream.
 * Returns null if the venue has no Mux stream configured.
 */
export function getPlaybackUrl(venueId: number): string | null {
  const stored = getStoredStream(venueId);
  return stored?.playbackUrl ?? null;
}

/**
 * Get the RTMP stream key for a venue.
 * Returns null if the venue has no Mux stream configured.
 */
export function getStreamKey(venueId: number): string | null {
  ensureMuxColumns();
  const db = getDb();
  const row = db
    .prepare("SELECT mux_stream_key FROM venues WHERE id = ?")
    .get(venueId) as { mux_stream_key: string | null } | undefined;
  return row?.mux_stream_key || null;
}

/**
 * Get the full RTMP ingest URL for a venue.
 * Returns null if the venue has no stream key.
 */
export function getRtmpUrl(venueId: number): string | null {
  const key = getStreamKey(venueId);
  if (!key) return null;
  return `rtmp://live.mux.com/app/${key}`;
}

/**
 * Get the stored Mux stream ID for a venue.
 */
export function getStreamId(venueId: number): string | null {
  ensureMuxColumns();
  const db = getDb();
  const row = db
    .prepare("SELECT mux_stream_id FROM venues WHERE id = ?")
    .get(venueId) as { mux_stream_id: string | null } | undefined;
  return row?.mux_stream_id || null;
}
