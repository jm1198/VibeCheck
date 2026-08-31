import { useEffect, useRef, useState, useCallback } from "react";
import Hls from "hls.js";
import type { Venue, HoursCheck } from "../types";
import { checkHours, completeView } from "../api";

interface LiveFeedProps {
  venue: Venue;
}

interface StreamUrlInfo {
  url: string | null;
  source: string;
  message?: string;
}

type FeedState = "loading" | "live" | "offline" | "closed" | "error";

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

  // ─── Promo overlay visibility cycling ───────────────────────
  const [showPromo, setShowPromo] = useState(false);
  // Promo overlay is a PREMIUM-only perk — only premium venues surface it.
  // The server also nulls promo_text for base venues, but we guard here too.
  const promoText = venue.plan === "premium" ? venue.promo_text : null;

  useEffect(() => {
    if (state !== "live" || !promoText) {
      setShowPromo(false);
      return;
    }
    // Show for 5s, hide for 10s, repeat
    let timeout: ReturnType<typeof setTimeout>;
    let visible = true;
    setShowPromo(true);

    function cycle() {
      visible = !visible;
      setShowPromo(visible);
      timeout = setTimeout(cycle, visible ? 5000 : 10000);
    }

    timeout = setTimeout(cycle, 5000);

    return () => clearTimeout(timeout);
  }, [state, promoText]);

  // View duration tracking
  const viewStartRef = useRef<number | null>(null);
  const reportedDurationRef = useRef<number>(0);

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
  const isEffectivelyLive = venue.is_live === 1 && (!hoursInfo || hoursInfo.is_open || hoursInfo.reason === "no_hours_set");

  // ─── HLS stream starter (Mux or other HLS URL) ──────────

  const startHlsStream = useCallback((hlsUrl: string) => {
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
  }, []);

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
        // Try common WebM codec; the broadcaster sends WebM via MediaRecorder
        const codec = 'video/webm; codecs="vp8,opus"';
        if (!MediaSource.isTypeSupported(codec)) {
          // Fallback: try vp9
          const codec2 = 'video/webm; codecs="vp9,opus"';
          if (MediaSource.isTypeSupported(codec2)) {
            const sb = mediaSource.addSourceBuffer(codec2);
            sourceBufferRef.current = sb;
            sb.addEventListener("updateend", () => {
              // Flush pending chunks
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

      // Binary video data
      if (sourceBufferRef.current && !sourceBufferRef.current.updating) {
        try {
          sourceBufferRef.current.appendBuffer(new Uint8Array(event.data as ArrayBuffer));
        } catch {
          // Buffer full or invalid — queue it
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
  }, [venue.id]);

  // ─── Main stream orchestration ────────────────────────────────

  useEffect(() => {
    if (!isEffectivelyLive) {
      setState("closed");
      return;
    }

    setState("loading");

    // First, check if Mux stream URL is available
    fetch(`/api/venues/${venue.id}/stream-url`)
      .then((res) => res.json())
      .then((data: StreamUrlInfo) => {
        if (data.url) {
          // Use Mux HLS stream
          startHlsStream(data.url);
        } else {
          // Fall back to WebSocket demo behavior
          setupWebSocketStream();
        }
      })
      .catch(() => {
        // If stream-url endpoint fails, fall back to WebSocket
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
  }, [venue.id, isEffectivelyLive, startHlsStream, setupWebSocketStream]);

  // ─── View duration tracking & completion ────────────────────

  // Start tracking when stream goes live
  useEffect(() => {
    if (state === "live") {
      viewStartRef.current = Date.now();
      reportedDurationRef.current = 0;
    }
  }, [state]);

  // Send view completion on unmount or when leaving live state
  useEffect(() => {
    return () => {
      if (viewStartRef.current !== null) {
        const totalDuration = Math.floor((Date.now() - viewStartRef.current) / 1000);
        const unreported = totalDuration - reportedDurationRef.current;
        if (unreported > 0 && venue.id) {
          // Fire-and-forget — don't block unmount
          completeView(venue.id, unreported).catch(() => {});
        }
        viewStartRef.current = null;
      }
    };
  }, [venue.id]);

  // ─── Render states ───────────────────────────────────────────

  // Loading
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

  // Closed (outside business hours or feed offline)
  if (state === "closed") {
    const reason = hoursInfo?.reason === "feed_offline"
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

  // Error
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

  // Offline (was live but stream ended)
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

  // LIVE — video player (dark area is correct here for video content)
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

      {/* Promo overlay bar */}
      {promoText && (
        <div
          className={`absolute bottom-0 left-0 right-0 z-20 transition-all duration-500 ease-out ${
            showPromo
              ? "translate-y-0 opacity-100"
              : "translate-y-full opacity-0 pointer-events-none"
          }`}
        >
          <div className="bg-black/40 backdrop-blur-sm text-white rounded-b-xl py-2 px-4 mx-0">
            <p className="text-sm font-medium text-center font-['DM_Sans']">{promoText}</p>
          </div>
        </div>
      )}
    </div>
  );
}
