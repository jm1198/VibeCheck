import { useEffect, useRef, useState, useCallback } from "react";
import Hls from "hls.js";
import type { Venue, HoursCheck } from "../types";
import { checkHours, requestView, getViewerId } from "../api";

interface LiveFeedProps {
  venue: Venue;
}

interface StreamUrlInfo {
  url: string | null;
  source: string;
  message?: string;
}

type FeedState = "loading" | "live" | "offline" | "closed" | "error";
type ViewLimitState = "checking" | "authorized" | "cooldown" | "ready";

const VIEW_DURATION = 15;
const COOLDOWN_DURATION = 30 * 60; // 1800 seconds

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function LiveFeed({ venue }: LiveFeedProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const pendingChunksRef = useRef<Uint8Array[]>([]);
  const hlsRef = useRef<Hls | null>(null);

  const [state, setState] = useState<FeedState>("loading");
  const [hoursInfo, setHoursInfo] = useState<HoursCheck | null>(null);
  const [viewerCount, setViewerCount] = useState(venue.viewer_count);
  const [errorMsg, setErrorMsg] = useState("");

  // Viewing limit state
  const [viewLimit, setViewLimit] = useState<ViewLimitState>("checking");
  const [timeRemaining, setTimeRemaining] = useState(VIEW_DURATION);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const viewerIdRef = useRef<string>("");

  // Stop all streaming — called when view timer expires
  const stopStreaming = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (mediaSourceRef.current && mediaSourceRef.current.readyState === "open") {
      try {
        const sb = sourceBufferRef.current;
        if (sb && mediaSourceRef.current.activeSourceBuffers.length > 0) {
          mediaSourceRef.current.removeSourceBuffer(sb);
        }
      } catch { /* ignore */ }
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.src = "";
      videoRef.current.load();
    }
  }, []);

  // ─── Cleanup on unmount ──────────────────────────────────────
  useEffect(() => {
    return () => {
      stopStreaming();
    };
  }, [stopStreaming]);

  // Check business hours
  useEffect(() => {
    let cancelled = false;
    checkHours(venue.id)
      .then((h) => {
        if (!cancelled) setHoursInfo(h);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [venue.id]);

  // Determine effective liveness: venue.is_live AND within business hours
  const isEffectivelyLive =
    venue.is_live === 1 &&
    (!hoursInfo || hoursInfo.is_open || hoursInfo.reason === "no_hours_set");

  // ─── View permission gate ────────────────────────────────────

  useEffect(() => {
    if (!isEffectivelyLive) {
      setViewLimit("checking");
      return;
    }

    // Get or create anonymous viewer ID
    const vid = getViewerId();
    viewerIdRef.current = vid;

    let cancelled = false;
    setViewLimit("checking");
    setState("loading");

    requestView(venue.id, vid)
      .then((status) => {
        if (cancelled) return;
        if (status.allowed) {
          setTimeRemaining(status.time_remaining ?? VIEW_DURATION);
          setViewLimit("authorized");
        } else {
          setCooldownRemaining(status.cooldown_remaining ?? COOLDOWN_DURATION);
          setViewLimit("cooldown");
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("View permission check failed:", err);
          // Fail open — let the user see the stream
          setTimeRemaining(VIEW_DURATION);
          setViewLimit("authorized");
        }
      });

    return () => { cancelled = true; };
  }, [venue.id, isEffectivelyLive]);

  // ─── Countdown timer ─────────────────────────────────────────

  useEffect(() => {
    if (viewLimit !== "authorized" || timeRemaining <= 0) return;

    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          // Time's up — stop stream, begin cooldown
          stopStreaming();
          setState("offline");
          setViewLimit("cooldown");
          setCooldownRemaining(COOLDOWN_DURATION);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [viewLimit, timeRemaining, stopStreaming]);

  // ─── Cooldown countdown ──────────────────────────────────────

  useEffect(() => {
    if (viewLimit !== "cooldown" || cooldownRemaining <= 0) return;

    const interval = setInterval(() => {
      setCooldownRemaining((prev) => {
        const next = prev - 1;
        if (next <= 0) {
          setViewLimit("ready");
          return 0;
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [viewLimit, cooldownRemaining]);

  // ─── HLS stream starter (Mux or other HLS URL) ──────────

  const startHlsStream = useCallback(
    (hlsUrl: string) => {
      if (!videoRef.current) return;

      // Clean up any existing WebSocket
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: false,
          lowLatencyMode: true,
          backBufferLength: 90,
        });
        hlsRef.current = hls;
        hls.loadSource(hlsUrl);
        hls.attachMedia(videoRef.current!);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setState("live");
          videoRef.current?.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            setState("error");
            setErrorMsg("Stream unavailable. The venue may not have started their camera yet.");
            hls.destroy();
          }
        });
      } else if (videoRef.current!.canPlayType("application/vnd.apple.mpegurl")) {
        // Safari native HLS
        videoRef.current!.src = hlsUrl;
        videoRef.current!.play().catch(() => {});
        setState("live");
      } else {
        setState("error");
        setErrorMsg("Your browser does not support live streaming.");
      }
    },
    []
  );

  // ─── WebSocket streaming with MediaSource (demo/fallback) ─────

  const setupWebSocketStream = useCallback(() => {
    if (!videoRef.current) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/stream?venue=${venue.id}&role=viewer`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.binaryType = "arraybuffer";

    const mediaSource = new MediaSource();
    mediaSourceRef.current = mediaSource;
    videoRef.current.src = URL.createObjectURL(mediaSource);

    mediaSource.addEventListener("sourceopen", () => {
      try {
        const codec = 'video/webm; codecs="vp8,opus"';
        if (!MediaSource.isTypeSupported(codec)) {
          const codec2 = 'video/webm; codecs="vp9,opus"';
          if (MediaSource.isTypeSupported(codec2)) {
            const sb = mediaSource.addSourceBuffer(codec2);
            sourceBufferRef.current = sb;
            sb.addEventListener("updateend", () => {
              while (pendingChunksRef.current.length > 0 && !sb.updating) {
                const chunk = pendingChunksRef.current.shift();
                if (chunk) {
                  try { sb.appendBuffer(chunk); } catch { /* skip */ }
                }
              }
            });
          } else {
            setState("error");
            setErrorMsg("Browser does not support required video codec");
            return;
          }
        } else {
          const sb = mediaSource.addSourceBuffer(codec);
          sourceBufferRef.current = sb;
          sb.addEventListener("updateend", () => {
            while (pendingChunksRef.current.length > 0 && !sb.updating) {
              const chunk = pendingChunksRef.current.shift();
              if (chunk) {
                try { sb.appendBuffer(chunk); } catch { /* skip */ }
              }
            }
          });
        }
      } catch {
        setState("error");
        setErrorMsg("Failed to initialize video player");
      }
    });

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "connected") {
            setState("live");
          } else if (msg.type === "stream_ended") {
            setState("offline");
          }
        } catch { /* ignore */ }
        return;
      }

      if (sourceBufferRef.current && !sourceBufferRef.current.updating) {
        try {
          sourceBufferRef.current.appendBuffer(new Uint8Array(event.data as ArrayBuffer));
        } catch {
          pendingChunksRef.current.push(new Uint8Array(event.data as ArrayBuffer));
        }
      } else {
        pendingChunksRef.current.push(new Uint8Array(event.data as ArrayBuffer));
      }
    };

    ws.onerror = () => {
      setState("error");
      setErrorMsg("WebSocket connection failed. The venue may not be streaming.");
    };

    ws.onclose = () => {
      if (state === "live") setState("offline");
    };
  }, [venue.id, state]);

  // ─── Main stream orchestration (gated behind view permission) ─

  useEffect(() => {
    // Only load the stream once view is authorized
    if (viewLimit !== "authorized") return;
    if (!isEffectivelyLive) {
      setState("closed");
      return;
    }

    setState("loading");

    fetch(`/api/venues/${venue.id}/stream-url`)
      .then((res) => res.json())
      .then((data: StreamUrlInfo) => {
        if (data.url) {
          startHlsStream(data.url);
        } else {
          setupWebSocketStream();
        }
      })
      .catch(() => {
        setupWebSocketStream();
      });

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (mediaSourceRef.current && mediaSourceRef.current.readyState === "open") {
        try {
          const sb = sourceBufferRef.current;
          if (sb && mediaSourceRef.current.activeSourceBuffers.length > 0) {
            mediaSourceRef.current.removeSourceBuffer(sb);
          }
        } catch { /* ignore */ }
      }
    };
  }, [venue.id, isEffectivelyLive, viewLimit, startHlsStream, setupWebSocketStream]);

  // ─── "Watch again" handler ───────────────────────────────────

  const handleWatchAgain = useCallback(() => {
    const vid = viewerIdRef.current;
    requestView(venue.id, vid)
      .then((status) => {
        if (status.allowed) {
          setTimeRemaining(status.time_remaining ?? VIEW_DURATION);
          setViewLimit("authorized");
        } else {
          setCooldownRemaining(status.cooldown_remaining ?? COOLDOWN_DURATION);
          setViewLimit("cooldown");
        }
      })
      .catch(() => {
        setTimeRemaining(VIEW_DURATION);
        setViewLimit("authorized");
      });
  }, [venue.id]);

  // ════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════

  // ── View-permission checking ────────────────────────────────

  if (viewLimit === "checking") {
    return (
      <div className="relative aspect-video bg-vibe-surface border border-vibe-border flex items-center justify-center overflow-hidden">
        <div className="text-center">
          <div className="shimmer rounded-full w-14 h-14 mx-auto mb-4" />
          <p className="text-vibe-muted text-base font-medium">Checking preview...</p>
          <p className="text-vibe-muted-dim text-xs mt-2">Verifying access to {venue.name}</p>
        </div>
      </div>
    );
  }

  // ── Closed (outside business hours or feed offline) ─────────
  if (!isEffectivelyLive) {
    const reason =
      hoursInfo?.reason === "feed_offline"
        ? `${venue.name} has paused their feed.`
        : hoursInfo?.reason === "outside_hours"
          ? `${venue.name} is currently closed.`
          : `${venue.name} is not streaming right now.`;

    return (
      <div className="relative aspect-video bg-vibe-surface border border-vibe-border flex items-center justify-center overflow-hidden">
        <div className="text-center px-6">
          <div className="text-5xl mb-4">
            {hoursInfo?.reason === "feed_offline" ? "⏸️" : "🌙"}
          </div>
          <p className="text-vibe-text text-base font-semibold">
            {hoursInfo?.reason === "feed_offline" ? "Feed Paused" : "Venue Closed"}
          </p>
          <p className="text-vibe-muted text-sm mt-2">{reason}</p>
          {hoursInfo?.hours && (
            <p className="text-vibe-muted-dim text-xs mt-2">
              Today's hours: {hoursInfo.hours.open} — {hoursInfo.hours.close}
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Cooldown / Ready overlay ────────────────────────────────

  if (viewLimit === "cooldown" || viewLimit === "ready") {
    return (
      <div className="relative aspect-video bg-black overflow-hidden">
        {/* Dim background with venue name */}
        <div className="absolute inset-0 bg-gradient-to-br from-vibe-accent/20 via-black/90 to-black flex items-center justify-center">
          <div className="text-center px-6">
            {viewLimit === "cooldown" ? (
              <>
                <div className="text-6xl mb-5">⏳</div>
                <h3 className="text-white text-xl font-bold mb-2">Preview ended</h3>
                <p className="text-gray-400 text-sm mb-4">
                  Next view available in
                </p>
                <p className="text-white text-4xl font-bold tabular-nums tracking-wider mb-6">
                  {formatTime(cooldownRemaining)}
                </p>
                <p className="text-gray-500 text-xs">
                  Free previews are limited to {VIEW_DURATION} seconds per venue every 30 minutes
                </p>
              </>
            ) : (
              <>
                <div className="text-6xl mb-5">🎬</div>
                <h3 className="text-white text-xl font-bold mb-2">Ready for another look</h3>
                <p className="text-gray-400 text-sm mb-6">
                  Your preview has reset — you can watch {venue.name} again
                </p>
                <button
                  onClick={handleWatchAgain}
                  className="press-scale inline-flex items-center gap-2 px-6 py-3 bg-vibe-accent hover:bg-vibe-accent-glow text-white font-semibold rounded-xl transition-all shadow-glow hover:shadow-glow-strong"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Watch again
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Error ───────────────────────────────────────────────────

  if (state === "error") {
    return (
      <div className="relative aspect-video bg-red-50 border border-red-200 flex items-center justify-center overflow-hidden">
        <div className="text-center px-6">
          <div className="text-5xl mb-4">⚠️</div>
          <p className="text-red-600 text-base font-semibold">Stream Unavailable</p>
          <p className="text-vibe-muted-dim text-sm mt-2">{errorMsg}</p>
        </div>
      </div>
    );
  }

  // ── Loading ─────────────────────────────────────────────────

  if (state === "loading") {
    return (
      <div className="relative aspect-video bg-vibe-surface border border-vibe-border flex items-center justify-center overflow-hidden">
        <div className="text-center">
          <div className="shimmer rounded-full w-14 h-14 mx-auto mb-4" />
          <p className="text-vibe-muted text-base font-medium">Connecting to stream...</p>
          <p className="text-vibe-muted-dim text-xs mt-2">Establishing live feed from {venue.name}</p>
        </div>
      </div>
    );
  }

  // ── Offline ─────────────────────────────────────────────────

  if (state === "offline") {
    return (
      <div className="relative aspect-video bg-vibe-surface border border-vibe-border flex items-center justify-center overflow-hidden">
        <div className="text-center px-6">
          <div className="text-5xl mb-4">📴</div>
          <p className="text-vibe-text text-base font-semibold">Stream Ended</p>
          <p className="text-vibe-muted text-sm mt-2">
            The live feed from {venue.name} has ended.
          </p>
        </div>
      </div>
    );
  }

  // ── LIVE with countdown timer ───────────────────────────────

  return (
    <div className="relative aspect-video bg-black overflow-hidden group">
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        autoPlay
        muted
        playsInline
        loop={false}
      />

      {/* Live overlay — glassmorphism */}
      <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/60 backdrop-blur-md rounded-full px-3 py-1.5 border border-white/10 z-10">
        <span className="w-2 h-2 rounded-full bg-vibe-live live-pulse" />
        <span className="text-white font-bold text-xs tracking-wide uppercase">LIVE</span>
      </div>

      {/* Countdown timer — top center */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-md rounded-full px-3 py-1.5 border border-white/10 z-10">
        <span className="text-white font-bold text-xs tabular-nums tracking-wider">
          {timeRemaining}s
        </span>
      </div>

      {/* Viewer count + venue name */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-black/60 backdrop-blur-md rounded-full px-3 py-1.5 border border-white/10 z-10">
        <svg className="w-3.5 h-3.5 text-white/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
        <span className="text-white text-xs font-semibold tabular-nums">{viewerCount}</span>
      </div>

      {/* Bottom bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 z-10">
        <div className="flex items-center justify-between">
          <span className="text-white font-semibold text-sm">{venue.name}</span>
          <span className="text-gray-400 text-[11px] font-semibold tracking-wider uppercase">{venue.category}</span>
        </div>
      </div>

      {/* Preview timer bar — thin progress at bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/20 z-20">
        <div
          className="h-full bg-vibe-accent transition-all duration-1000 ease-linear"
          style={{ width: `${(timeRemaining / VIEW_DURATION) * 100}%` }}
        />
      </div>
    </div>
  );
}
