/**
 * Crowd Density Analyzer for VibeCheck.
 *
 * Periodically fetches Mux thumbnails for live venues, runs them through
 * TensorFlow.js COCO-SSD to count people, and computes a density score (1-10).
 *
 * Works in both server.ts (with SQLite + background interval) and
 * vercel-entry.ts (in-memory, on-demand).
 */

// ── Types ───────────────────────────────────────────────────────

export interface DensityResult {
  venue_id: number;
  people_count: number;
  density_score: number;
  analyzed_at: string;
  label: string;
}

export function getDensityLabel(score: number): string {
  if (score <= 2) return "Empty";
  if (score <= 4) return "Quiet";
  if (score <= 6) return "Moderate";
  if (score <= 8) return "Busy";
  return "Packed";
}

export function getDensityColor(score: number): string {
  if (score <= 2) return "blue";
  if (score <= 4) return "green";
  if (score <= 6) return "yellow";
  if (score <= 8) return "orange";
  return "red";
}

// ── Density computation ─────────────────────────────────────────

/**
 * Convert a raw people count to a 1-10 density score.
 * Calibrated for typical bar/club spaces:
 *   0 people   → 1 ("Empty")
 *   1-3        → 2
 *   4-8        → 3
 *   9-15       → 4
 *   16-25      → 5
 *   26-35      → 6
 *   36-50      → 7
 *   51-65      → 8
 *   66-80      → 9
 *   81+        → 10 ("Packed")
 */
export function peopleCountToScore(count: number): number {
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

// ── TensorFlow.js powered people detection ──────────────────────

let modelPromise: Promise<any> | null = null;
let tf: any = null;

async function getTf(): Promise<any> {
  if (!tf) {
    tf = await import("@tensorflow/tfjs");
  }
  return tf;
}

async function getModel(): Promise<any> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const cocoSsd = await import("@tensorflow-models/coco-ssd");
      // Use lite model for faster loading and lower memory
      return cocoSsd.load({ base: "lite_mobilenet_v2" });
    })();
  }
  return modelPromise;
}

/**
 * Run people detection on an image buffer using TF.js COCO-SSD.
 * Returns the count of detected people.
 */
export async function detectPeople(imageBuffer: ArrayBuffer): Promise<number> {
  try {
    const tfModule = await getTf();

    // Decode image to tensor
    const imageTensor = tfModule.node.decodeImage(new Uint8Array(imageBuffer), 3);

    // Run COCO-SSD
    const model = await getModel();
    const predictions = await model.detect(imageTensor);

    // Clean up tensor
    imageTensor.dispose();

    // Count predictions labeled as "person"
    const peopleCount = predictions.filter(
      (p: any) => p.class === "person" && p.score > 0.3
    ).length;

    return peopleCount;
  } catch (err) {
    console.error("TF.js people detection failed:", err);
    return -1; // Sentinel: analysis failed
  }
}

// ── Mux thumbnail fetching ──────────────────────────────────────

/**
 * Fetch a thumbnail frame from Mux for a given playback ID.
 * Uses the image API with a small time offset to grab a frame near the live edge.
 */
export async function fetchMuxThumbnail(playbackId: string): Promise<ArrayBuffer | null> {
  const url = `https://image.mux.com/${playbackId}/thumbnail.jpg?time=0&width=640`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      console.error(`Mux thumbnail fetch failed for ${playbackId}: ${res.status}`);
      return null;
    }
    return res.arrayBuffer();
  } catch (err) {
    console.error(`Mux thumbnail fetch error for ${playbackId}:`, err);
    return null;
  }
}

// ── Full analysis pipeline ──────────────────────────────────────

/**
 * Full analysis: fetch thumbnail → detect people → compute score.
 * Returns a DensityResult or null if any step failed.
 */
export async function analyzeVenue(
  venueId: number,
  playbackId: string
): Promise<DensityResult | null> {
  const imageBuffer = await fetchMuxThumbnail(playbackId);
  if (!imageBuffer) return null;

  const peopleCount = await detectPeople(imageBuffer);

  if (peopleCount < 0) return null; // TF.js error

  const densityScore = peopleCountToScore(peopleCount);
  const label = getDensityLabel(densityScore);

  return {
    venue_id: venueId,
    people_count: peopleCount,
    density_score: densityScore,
    analyzed_at: new Date().toISOString(),
    label,
  };
}

// ── Background analyzer (for server.ts) ─────────────────────────

type StoreFn = (
  venueId: number,
  result: DensityResult
) => void | Promise<void>;

type GetLiveVenuesFn = () => {
  id: number;
  playback_id: string | null;
}[] | Promise<{ id: number; playback_id: string | null }[]>;

let analyzerInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start a background analyzer that runs every ~60 seconds.
 * Requires callbacks for DB storage and live-venue lookup.
 */
export function startBackgroundAnalyzer(
  getLiveVenues: GetLiveVenuesFn,
  storeResult: StoreFn
): void {
  if (analyzerInterval) return;

  const tick = async () => {
    try {
      const venues = await getLiveVenues();
      for (const v of venues) {
        if (!v.playback_id) continue;
        try {
          const result = await analyzeVenue(v.id, v.playback_id);
          if (result) {
            await storeResult(v.id, result);
          }
        } catch (err) {
          console.error(`Density analysis failed for venue ${v.id}:`, err);
        }
      }
    } catch (err) {
      console.error("Background density analyzer error:", err);
    }
  };

  // Run immediately, then every 60 seconds
  tick();
  analyzerInterval = setInterval(tick, 60_000);
}

export function stopBackgroundAnalyzer(): void {
  if (analyzerInterval) {
    clearInterval(analyzerInterval);
    analyzerInterval = null;
  }
}
