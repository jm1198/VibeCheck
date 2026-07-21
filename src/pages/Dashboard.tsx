import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { getMe, updateVenue, getVenue, getStreamKey, regenerateStreamKey, getAnalytics, getDensity, refreshDensity, setPromo, getPromo } from "../api";
import type { User, Venue, BusinessHours, StreamKeyInfo, AnalyticsResponse, CrowdDensity } from "../types";
import { DAYS } from "../types";

type TabKey = "camera" | "analytics";

export default function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [venue, setVenue] = useState<Venue | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [hours, setHours] = useState<BusinessHours>({});
  const [activeTab, setActiveTab] = useState<TabKey>("camera");

  // Stream key state
  const [streamKey, setStreamKey] = useState<string | null>(null);
  const [streamKeyLoading, setStreamKeyLoading] = useState(false);
  const [streamKeyInfo, setStreamKeyInfo] = useState<StreamKeyInfo | null>(null);

  // Broadcast state
  const [broadcasting, setBroadcasting] = useState(false);
  const broadcastWsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  // Analytics state
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsPeriod, setAnalyticsPeriod] = useState<"week" | "month" | "all">("week");

  // Density state
  const [density, setDensity] = useState<CrowdDensity | null>(null);
  const [densityLoading, setDensityLoading] = useState(false);

  // Promo state
  const [promoText, setPromoText] = useState("");
  const [promoLoading, setPromoLoading] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("vibecheck_token");
    if (!token) {
      navigate("/dashboard");
      return;
    }
    getMe()
      .then((u) => {
        setUser(u);
        if (u.venue_id) {
          return getVenue(u.venue_id);
        }
        return null;
      })
      .then((v) => {
        if (v) {
          setVenue(v);
          try {
            setHours(JSON.parse(v.business_hours));
          } catch {
            setHours({});
          }
          return getStreamKey(v.id).then((info) => {
            setStreamKey(info.stream_key);
            setStreamKeyInfo(info);
            // Fetch density
            return getDensity(v.id).then(setDensity).catch(() => {});
          })
          .then(() => {
            // Fetch promo text
            if (v && v.id) {
              return getPromo(v.id).then((p) => setPromoText(p.promo_text || "")).catch(() => {});
            }
          });
        }
      })
      .catch(() => {
        localStorage.removeItem("vibecheck_token");
        navigate("/dashboard");
      })
      .finally(() => setLoading(false));

    // Cleanup broadcast on unmount
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (broadcastWsRef.current) {
        broadcastWsRef.current.close();
      }
    };
  }, [navigate]);

  // Fetch analytics when tab changes or period changes
  useEffect(() => {
    if (activeTab === "analytics" && venue) {
      setAnalyticsLoading(true);
      getAnalytics(venue.id, analyticsPeriod)
        .then((a) => setAnalytics(a))
        .catch((err) => setMessage("❌ " + (err instanceof Error ? err.message : "Failed to load analytics")))
        .finally(() => setAnalyticsLoading(false));
    }
  }, [activeTab, analyticsPeriod, venue?.id]);

  async function toggleLive() {
    if (!venue) return;
    setSaving(true);
    setMessage("");
    try {
      const updated = await updateVenue(venue.id, {
        is_live: venue.is_live ? 0 : 1,
      });
      setVenue(updated);
      setMessage(updated.is_live ? "📡 Feed is now LIVE" : "⏸ Feed paused");
    } catch (err) {
      setMessage("❌ " + (err instanceof Error ? err.message : "Failed to update"));
    } finally {
      setSaving(false);
    }
  }

  async function saveHours() {
    if (!venue) return;
    setSaving(true);
    setMessage("");
    try {
      const updated = await updateVenue(venue.id, {
        business_hours: JSON.stringify(hours),
      });
      setVenue(updated);
      setMessage("✅ Business hours saved");
    } catch (err) {
      setMessage("❌ " + (err instanceof Error ? err.message : "Failed to save"));
    } finally {
      setSaving(false);
    }
  }

  function updateDay(day: string, field: "open" | "close", value: string) {
    setHours((prev) => ({
      ...prev,
      [day]: { ...(prev[day] || { open: "17:00", close: "02:00" }), [field]: value },
    }));
  }

  function logout() {
    localStorage.removeItem("vibecheck_token");
    navigate("/dashboard");
  }

  async function fetchStreamKey() {
    if (!venue) return;
    setStreamKeyLoading(true);
    try {
      const info = await getStreamKey(venue.id);
      setStreamKey(info.stream_key);
      setStreamKeyInfo(info);
    } catch (err) {
      setMessage("❌ " + (err instanceof Error ? err.message : "Failed to fetch stream key"));
    } finally {
      setStreamKeyLoading(false);
    }
  }

  async function handleRegenerateKey() {
    if (!venue) return;
    setStreamKeyLoading(true);
    setMessage("");
    try {
      const result = await regenerateStreamKey(venue.id);
      setStreamKey(result.stream_key);
      setStreamKeyInfo((prev) =>
        prev ? { ...prev, stream_key: result.stream_key } : null
      );
      setMessage("✅ Stream key regenerated. Update your encoder now.");
    } catch (err) {
      setMessage("❌ " + (err instanceof Error ? err.message : "Failed to regenerate key"));
    } finally {
      setStreamKeyLoading(false);
    }
  }

  async function handleRefreshDensity() {
    if (!venue) return;
    setDensityLoading(true);
    setMessage("");
    try {
      const result = await refreshDensity(venue.id);
      setDensity(result);
      setMessage("✅ Density analysis refreshed");
    } catch (err) {
      setMessage("❌ " + (err instanceof Error ? err.message : "Failed to refresh density"));
    } finally {
      setDensityLoading(false);
    }
  }

  async function startBroadcast() {
    if (!venue) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;

      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = stream;
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws/stream?venue=${venue.id}&role=broadcaster`;
      const ws = new WebSocket(wsUrl);
      broadcastWsRef.current = ws;

      ws.onopen = () => {
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
            ? "video/webm;codecs=vp8,opus"
            : "video/webm",
          videoBitsPerSecond: 1500000,
        });
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
            ws.send(event.data);
          }
        };

        mediaRecorder.start(500);
        setBroadcasting(true);
        setMessage("📡 Broadcasting live from your camera!");
      };

      ws.onerror = () => {
        setMessage("❌ WebSocket connection failed. Is the server running?");
        stopBroadcast();
      };

      ws.onclose = () => {
        stopBroadcast();
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setMessage("❌ Camera access denied. Please allow camera permissions.");
      } else {
        setMessage("❌ Failed to start camera: " + (err instanceof Error ? err.message : "Unknown error"));
      }
    }
  }

  function stopBroadcast() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (broadcastWsRef.current && broadcastWsRef.current.readyState === WebSocket.OPEN) {
      broadcastWsRef.current.close();
    }
    broadcastWsRef.current = null;

    if (previewVideoRef.current) {
      previewVideoRef.current.srcObject = null;
    }

    setBroadcasting(false);
  }

  // ─── Analytics chart helpers ──────────────────────────────

  function renderBarChart() {
    if (!analytics || analytics.views_by_day.length === 0) return null;
    const days = analytics.views_by_day;
    const maxVal = Math.max(...days.map((d) => d.count), 1);
    const chartH = 160;
    const barW = Math.max(8, Math.min(32, Math.floor(600 / days.length) - 4));

    // Format date label
    function fmtDate(d: string): string {
      const date = new Date(d + "T00:00:00");
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }

    return (
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${days.length * (barW + 4) + 8} ${chartH + 32}`}
          className="w-full"
          style={{ minWidth: `${days.length * 28}px`, height: `${chartH + 32}px` }}
        >
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
            const y = chartH - frac * chartH;
            return (
              <g key={frac}>
                <line x1={0} y1={y} x2={days.length * (barW + 4) + 8} y2={y} stroke="#e5e5e5" strokeWidth={0.5} />
                <text x={0} y={y - 4} fill="#9a9a9a" fontSize={10} textAnchor="start">
                  {Math.round(frac * maxVal)}
                </text>
              </g>
            );
          })}
          {/* Bars */}
          {days.map((d, i) => {
            const barH = maxVal > 0 ? (d.count / maxVal) * chartH : 0;
            const x = i * (barW + 4) + 4;
            return (
              <g key={d.date}>
                <rect
                  x={x}
                  y={chartH - barH}
                  width={barW}
                  height={barH}
                  rx={3}
                  fill="#8b5cf6"
                  opacity={0.85}
                />
                <text
                  x={x + barW / 2}
                  y={chartH + 16}
                  fill="#6b6b6b"
                  fontSize={10}
                  textAnchor="middle"
                >
                  {analyticsPeriod === "week" || days.length <= 14
                    ? fmtDate(d.date)
                    : d.date.slice(5)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    );
  }

  function renderHeatmap() {
    if (!analytics) return null;
    const hours = analytics.views_by_hour;
    const maxVal = Math.max(...hours.map((h) => h.count), 1);

    function intensity(count: number): string {
      const ratio = count / maxVal;
      if (ratio === 0) return "bg-gray-100";
      if (ratio < 0.2) return "bg-purple-100";
      if (ratio < 0.4) return "bg-purple-200";
      if (ratio < 0.6) return "bg-purple-400";
      if (ratio < 0.8) return "bg-purple-500";
      return "bg-purple-600";
    }

    function formatHour(h: number): string {
      if (h === 0) return "12a";
      if (h < 12) return `${h}a`;
      if (h === 12) return "12p";
      return `${h - 12}p`;
    }

    return (
      <div>
        <div className="flex gap-0.5 flex-wrap">
          {hours.map((h) => (
            <div
              key={h.hour}
              className={`flex-1 min-w-[14px] h-8 rounded ${intensity(h.count)}`}
              title={`${formatHour(h.hour)}: ${h.count} view${h.count !== 1 ? "s" : ""}`}
            />
          ))}
        </div>
        <div className="flex justify-between mt-1.5 text-[10px] text-vibe-muted-dim px-0.5">
          {[0, 4, 8, 12, 16, 20].map((h) => (
            <span key={h}>{formatHour(h)}</span>
          ))}
          <span>{formatHour(23)}</span>
        </div>
      </div>
    );
  }

  // ─── Loading & empty states ───────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-vibe-bg flex items-center justify-center">
        <div className="shimmer rounded-2xl w-96 h-72" />
      </div>
    );
  }

  if (!venue) {
    return (
      <div className="min-h-screen bg-vibe-bg flex items-center justify-center px-4">
        <div className="text-center animate-fade-up">
          <p className="text-6xl mb-5">🏢</p>
          <p className="text-vibe-text text-xl font-semibold">No venue linked to this account</p>
          <p className="text-vibe-muted mt-2 text-sm">Contact VibeCheck to set up your venue.</p>
          <button onClick={logout} className="mt-6 text-vibe-accent hover:underline font-medium">
            Log out
          </button>
        </div>
      </div>
    );
  }

  // ─── Main render ──────────────────────────────────────────

  return (
    <div className="min-h-screen bg-vibe-bg">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-vibe-text tracking-tight">{venue.name}</h1>
            <p className="text-vibe-muted text-sm mt-0.5">Venue Dashboard</p>
          </div>
          <div className="flex gap-3 items-center">
            <a
              href={`/venue/${venue.id}`}
              className="text-sm text-vibe-accent hover:underline font-medium"
              target="_blank"
              rel="noreferrer"
            >
              View public page →
            </a>
            <button
              onClick={logout}
              className="text-sm text-vibe-muted hover:text-vibe-text border border-vibe-border hover:border-vibe-border-dark rounded-xl px-3 py-1.5 transition-all"
            >
              Log out
            </button>
          </div>
        </div>

        {message && (
          <div
            className={`mb-6 p-4 rounded-xl text-sm font-medium animate-fade-up ${
              message.startsWith("❌")
                ? "bg-red-50 text-red-600 border border-red-200"
                : message.startsWith("✅") || message.startsWith("📡")
                  ? "bg-vibe-accent/8 text-vibe-accent border border-vibe-accent/20"
                  : "bg-vibe-surface text-vibe-text-secondary border border-vibe-border"
            }`}
          >
            {message}
          </div>
        )}

        {/* ═══ Tab Navigation ═══ */}
        <div className="flex border-b border-vibe-border mb-8">
          <button
            onClick={() => setActiveTab("camera")}
            className={`px-6 py-3 text-sm font-semibold transition-all border-b-2 -mb-px ${
              activeTab === "camera"
                ? "border-vibe-accent text-vibe-accent"
                : "border-transparent text-vibe-muted hover:text-vibe-text"
            }`}
          >
            📡 Camera Setup
          </button>
          <button
            onClick={() => setActiveTab("analytics")}
            className={`px-6 py-3 text-sm font-semibold transition-all border-b-2 -mb-px ${
              activeTab === "analytics"
                ? "border-vibe-accent text-vibe-accent"
                : "border-transparent text-vibe-muted hover:text-vibe-text"
            }`}
          >
            📊 Analytics
          </button>
        </div>

        {/* ═══ Tab Content: Camera Setup ═══ */}
        {activeTab === "camera" && (
          <>
            {/* ═══ section: Camera Feed ═══ */}
            <div className="mb-10">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-vibe-accent/10 flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-vibe-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-vibe-text">Camera Setup</h2>
                  <p className="text-vibe-muted text-sm">Control your live feed visibility</p>
                </div>
              </div>

              <div className="bg-vibe-card border border-vibe-border rounded-2xl p-6 shadow-card">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-vibe-text">Camera Feed</h3>
                    <p className="text-vibe-muted text-sm mt-1">
                      {venue.is_live
                        ? `Streaming live — ${venue.viewer_count} viewers watching`
                        : "Feed is currently offline"}
                    </p>
                  </div>
                  <button
                    onClick={toggleLive}
                    disabled={saving}
                    className={`px-6 py-3 rounded-full font-semibold transition-all press-scale ${
                      venue.is_live
                        ? "bg-red-600 hover:bg-red-700 text-white shadow-md"
                        : "bg-vibe-accent hover:bg-vibe-accent-glow text-white shadow-md"
                    } disabled:opacity-50`}
                  >
                    {venue.is_live ? "⏸ Stop Streaming" : "📡 Go Live"}
                  </button>
                </div>
                {/* Live indicator */}
                <div className="mt-5 flex items-center gap-3">
                  <div
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold ${
                      venue.is_live
                        ? "bg-vibe-live/10 text-vibe-live border border-vibe-live/25"
                        : "bg-vibe-surface text-vibe-muted border border-vibe-border"
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        venue.is_live ? "bg-vibe-live live-pulse" : "bg-gray-400"
                      }`}
                    />
                    {venue.is_live ? "LIVE" : "Offline"}
                  </div>
                  <span className="text-vibe-muted-dim text-sm">
                    {venue.viewer_count} viewer{venue.viewer_count !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>

              {/* Density Analysis */}
              <div className="bg-vibe-card border border-vibe-border rounded-2xl p-6 mb-6 mt-6 shadow-card">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-vibe-text">Crowd Density</h3>
                    <p className="text-vibe-muted text-sm mt-1">
                      {density
                        ? `Right now: ${density.label} (${density.density_score}/10) · ${density.people_count} people detected`
                        : "No density data yet. Refresh to analyze your feed."}
                    </p>
                  </div>
                  <button
                    onClick={handleRefreshDensity}
                    disabled={densityLoading}
                    className="px-5 py-2.5 rounded-full font-semibold transition-all press-scale bg-vibe-accent hover:bg-vibe-accent-glow text-white shadow-md text-sm disabled:opacity-50"
                  >
                    {densityLoading ? "Analyzing..." : "🔄 Refresh"}
                  </button>
                </div>
                {density && (
                  <div className="mt-4 flex items-center gap-3">
                    {(() => {
                      const colorMap: Record<number, string> = {
                        1: "text-blue-600 bg-blue-100", 2: "text-blue-600 bg-blue-100",
                        3: "text-green-600 bg-green-100", 4: "text-green-600 bg-green-100",
                        5: "text-yellow-600 bg-yellow-100", 6: "text-yellow-600 bg-yellow-100",
                        7: "text-orange-600 bg-orange-100", 8: "text-orange-600 bg-orange-100",
                        9: "text-red-600 bg-red-100", 10: "text-red-600 bg-red-100",
                      };
                      const c = colorMap[density.density_score] || "text-vibe-accent bg-vibe-accent/10";
                      const secondsAgo = Math.floor((Date.now() - new Date(density.analyzed_at).getTime()) / 1000);
                      const timeAgo = secondsAgo < 60 ? `${secondsAgo}s ago`
                        : secondsAgo < 3600 ? `${Math.floor(secondsAgo / 60)}m ago`
                        : `${Math.floor(secondsAgo / 3600)}h ago`;
                      return (
                        <>
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${c}`}>
                            <span className="w-2 h-2 rounded-full bg-current" />
                            {density.density_score}/10
                          </span>
                          <span className="text-vibe-muted-dim text-sm">
                            Analyzed {timeAgo}
                          </span>
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* Connect Camera — Stream Key & Broadcast */}
              <div className="bg-vibe-card border border-vibe-border rounded-2xl p-6 mb-6 mt-6 shadow-card">
                <h2 className="text-lg font-semibold text-vibe-text mb-4">Connect Camera</h2>

                {/* Stream Key */}
                <div className="mb-5">
                  <label className="text-sm text-vibe-muted block mb-2">Your Stream Key</label>
                  <div className="flex gap-2 items-start">
                    <code className="flex-1 bg-vibe-surface border border-vibe-border rounded-xl px-4 py-3 text-sm text-vibe-accent font-mono break-all select-all">
                      {streamKey || (streamKeyLoading ? "Loading..." : "Not generated yet")}
                    </code>
                    <button
                      onClick={handleRegenerateKey}
                      disabled={streamKeyLoading}
                      className="text-xs text-vibe-muted hover:text-red-500 border border-vibe-border rounded-xl px-3 py-3 transition-colors disabled:opacity-50 shrink-0 hover:border-red-300"
                      title="Regenerate stream key"
                    >
                      🔄
                    </button>
                  </div>
                  {streamKeyInfo && (
                    <p className="text-vibe-muted-dim text-xs mt-2">
                      RTMP Server:{" "}
                      <code className="text-vibe-accent font-mono bg-vibe-surface px-1.5 py-0.5 rounded text-xs border border-vibe-border">
                        {streamKeyInfo.rtmp_url}
                      </code>
                    </p>
                  )}
                </div>

                {/* OBS Instructions */}
                <details className="mb-4 group">
                  <summary className="text-sm text-vibe-muted cursor-pointer hover:text-vibe-text transition-colors select-none">
                    📋 OBS Studio Setup Instructions
                  </summary>
                  <pre className="mt-3 bg-vibe-surface border border-vibe-border rounded-xl p-4 text-xs text-vibe-text-secondary whitespace-pre-wrap overflow-x-auto leading-relaxed">
                    {streamKeyInfo?.instructions.obs || "Generate a stream key first."}
                  </pre>
                </details>

                {/* IP Camera Instructions */}
                <details className="mb-4 group">
                  <summary className="text-sm text-vibe-muted cursor-pointer hover:text-vibe-text transition-colors select-none">
                    📷 IP Camera Setup
                  </summary>
                  <pre className="mt-3 bg-vibe-surface border border-vibe-border rounded-xl p-4 text-xs text-vibe-text-secondary whitespace-pre-wrap overflow-x-auto leading-relaxed">
                    {streamKeyInfo?.instructions.ip_camera || "Generate a stream key first."}
                  </pre>
                </details>

                {/* Browser Camera Test */}
                <div className="border-t border-vibe-border pt-5 mt-5">
                  <div className="flex items-center gap-2 mb-3">
                    <h3 className="text-sm font-semibold text-vibe-text">Test Camera</h3>
                    <span className="text-[10px] text-vibe-muted-dim bg-vibe-surface px-2 py-0.5 rounded-full border border-vibe-border">
                      Browser Preview
                    </span>
                  </div>
                  <p className="text-vibe-muted text-xs mb-4 leading-relaxed">
                    Use your device camera to broadcast a test stream directly from this dashboard.
                    The stream will appear on your venue's public page.
                  </p>

                  {broadcasting && (
                    <div className="mb-4 relative aspect-video bg-black rounded-xl overflow-hidden border-2 border-vibe-accent/30 shadow-md">
                      <video
                        ref={previewVideoRef}
                        className="w-full h-full object-cover"
                        autoPlay
                        muted
                        playsInline
                      />
                      <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/60 backdrop-blur-md rounded-full px-3 py-1.5 border border-white/10">
                        <span className="w-2 h-2 rounded-full bg-vibe-live live-pulse" />
                        <span className="text-white text-xs font-bold tracking-wide">LIVE PREVIEW</span>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-3">
                    {!broadcasting ? (
                      <button
                        onClick={startBroadcast}
                        className="bg-vibe-accent hover:bg-vibe-accent-glow text-white font-semibold rounded-full px-5 py-2.5 transition-all text-sm shadow-md press-scale"
                      >
                        🎥 Start Camera Test
                      </button>
                    ) : (
                      <button
                        onClick={stopBroadcast}
                        className="bg-red-600 hover:bg-red-700 text-white font-semibold rounded-full px-5 py-2.5 transition-all text-sm shadow-md press-scale"
                      >
                        ⏹ Stop Broadcasting
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* ═══ section: Business Hours ═══ */}
            <div className="mb-10">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-vibe-text">Business Hours</h2>
                  <p className="text-vibe-muted text-sm">Set when your venue is open for streaming</p>
                </div>
              </div>

              <div className="bg-vibe-card border border-vibe-border rounded-2xl p-6 shadow-card">
                <div className="space-y-3">
                  {DAYS.map((day) => (
                    <div key={day} className="flex items-center gap-3">
                      <span className="w-24 text-sm text-vibe-muted capitalize font-medium">{day}</span>
                      <input
                        type="time"
                        value={hours[day]?.open || "17:00"}
                        onChange={(e) => updateDay(day, "open", e.target.value)}
                        className="bg-vibe-bg border border-vibe-border rounded-xl px-3 py-2 text-vibe-text text-sm focus:outline-none focus:border-vibe-accent focus:ring-1 focus:ring-vibe-accent/20 transition-colors"
                      />
                      <span className="text-vibe-muted-dim text-sm">to</span>
                      <input
                        type="time"
                        value={hours[day]?.close || "02:00"}
                        onChange={(e) => updateDay(day, "close", e.target.value)}
                        className="bg-vibe-bg border border-vibe-border rounded-xl px-3 py-2 text-vibe-text text-sm focus:outline-none focus:border-vibe-accent focus:ring-1 focus:ring-vibe-accent/20 transition-colors"
                      />
                    </div>
                  ))}
                </div>
                <button
                  onClick={saveHours}
                  disabled={saving}
                  className="mt-5 bg-vibe-accent hover:bg-vibe-accent-glow text-white font-semibold rounded-full px-5 py-2.5 transition-all text-sm shadow-md disabled:opacity-50 press-scale"
                >
                  {saving ? "Saving..." : "Save Hours"}
                </button>
              </div>
            </div>

            {/* ═══ section: Promo Overlay ═══ */}
            <div className="mb-10">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-pink-50 flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-pink-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-vibe-text">Promo Overlay</h2>
                  <p className="text-vibe-muted text-sm">Add promotional text to your live feed</p>
                </div>
              </div>

              <div className="bg-vibe-card border border-vibe-border rounded-2xl p-6 shadow-card">
                <div className="mb-4">
                  <label className="text-sm font-semibold text-vibe-text block mb-2">
                    Promo Message
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={promoText}
                      onChange={(e) => {
                        if (e.target.value.length <= 80) setPromoText(e.target.value);
                      }}
                      placeholder='e.g. "Happy hour until 7pm!"'
                      maxLength={80}
                      className="w-full bg-vibe-bg border border-vibe-border rounded-xl px-4 py-3 text-vibe-text text-sm pr-16 focus:outline-none focus:border-vibe-accent focus:ring-1 focus:ring-vibe-accent/20 transition-colors"
                    />
                    <span
                      className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium tabular-nums ${
                        promoText.length > 70 ? "text-amber-600" : "text-vibe-muted-dim"
                      }`}
                    >
                      {promoText.length}/80
                    </span>
                  </div>
                  <p className="text-vibe-muted-dim text-xs mt-2">
                    Appears at the bottom of your live feed. Max 80 characters.
                  </p>
                </div>

                {/* Preview */}
                {promoText && (
                  <div className="mb-4">
                    <p className="text-xs font-semibold text-vibe-muted uppercase tracking-wider mb-2">Preview</p>
                    <div className="relative aspect-video bg-black rounded-xl overflow-hidden">
                      {/* Simulated video area */}
                      <div className="absolute inset-0 bg-gradient-to-br from-gray-900 to-gray-800 flex items-center justify-center">
                        <p className="text-white/20 text-sm">Live Feed Preview</p>
                      </div>
                      {/* Simulated promo bar */}
                      <div className="absolute bottom-0 left-0 right-0">
                        <div className="bg-black/40 backdrop-blur-sm text-white rounded-b-xl py-2 px-4">
                          <p className="text-sm font-medium text-center">{promoText}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Buttons */}
                <div className="flex gap-3">
                  <button
                    onClick={async () => {
                      if (!venue) return;
                      setPromoLoading(true);
                      setMessage("");
                      try {
                        const result = await setPromo(venue.id, promoText || null);
                        setPromoText(result.promo_text || "");
                        setMessage(result.promo_text ? "✅ Promo overlay saved" : "✅ Promo overlay cleared");
                      } catch (err) {
                        setMessage("❌ " + (err instanceof Error ? err.message : "Failed to save promo"));
                      } finally {
                        setPromoLoading(false);
                      }
                    }}
                    disabled={promoLoading}
                    className="bg-vibe-accent hover:bg-vibe-accent-glow text-white font-semibold rounded-full px-5 py-2.5 transition-all text-sm shadow-md disabled:opacity-50 press-scale"
                  >
                    {promoLoading ? "Saving..." : "Save"}
                  </button>
                  <button
                    onClick={async () => {
                      if (!venue) return;
                      setPromoLoading(true);
                      setMessage("");
                      try {
                        await setPromo(venue.id, null);
                        setPromoText("");
                        setMessage("✅ Promo overlay cleared");
                      } catch (err) {
                        setMessage("❌ " + (err instanceof Error ? err.message : "Failed to clear promo"));
                      } finally {
                        setPromoLoading(false);
                      }
                    }}
                    disabled={promoLoading || !promoText}
                    className="text-sm text-vibe-muted hover:text-red-500 border border-vibe-border hover:border-red-300 rounded-full px-5 py-2.5 transition-all disabled:opacity-30"
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>

            {/* ═══ section: Venue Settings ═══ */}
            <div className="mb-10">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-cyan-50 flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-vibe-cyan" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-vibe-text">Venue Settings</h2>
                  <p className="text-vibe-muted text-sm">Your venue information</p>
                </div>
              </div>

              <div className="bg-vibe-card border border-vibe-border rounded-2xl p-6 shadow-card">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-vibe-muted-dim text-xs uppercase tracking-wider mb-1">Name</p>
                    <p className="text-vibe-text font-medium">{venue.name}</p>
                  </div>
                  <div>
                    <p className="text-vibe-muted-dim text-xs uppercase tracking-wider mb-1">Category</p>
                    <p className="text-vibe-text font-medium capitalize">{venue.category}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-vibe-muted-dim text-xs uppercase tracking-wider mb-1">Location</p>
                    <p className="text-vibe-text font-medium">{venue.location}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-vibe-muted-dim text-xs uppercase tracking-wider mb-1">Description</p>
                    <p className="text-vibe-text font-medium">{venue.description}</p>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ═══ Tab Content: Analytics ═══ */}
        {activeTab === "analytics" && (
          <div className="animate-fade-up">
            {/* Period Selector */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-vibe-text">Analytics</h2>
                <p className="text-vibe-muted text-sm">Track your venue's viewership</p>
              </div>
              <div className="flex bg-vibe-surface border border-vibe-border rounded-xl p-1 gap-0.5">
                {(["week", "month", "all"] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setAnalyticsPeriod(p)}
                    className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      analyticsPeriod === p
                        ? "bg-white text-vibe-text shadow-sm"
                        : "text-vibe-muted hover:text-vibe-text"
                    }`}
                  >
                    {p === "week" ? "Week" : p === "month" ? "Month" : "All Time"}
                  </button>
                ))}
              </div>
            </div>

            {analyticsLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="shimmer rounded-2xl h-32" />
                ))}
              </div>
            ) : analytics && analytics.total_views === 0 ? (
              /* Empty state */
              <div className="bg-vibe-card border border-vibe-border rounded-2xl p-12 text-center shadow-card">
                <div className="text-5xl mb-4">📊</div>
                <h3 className="text-lg font-semibold text-vibe-text mb-2">No views yet</h3>
                <p className="text-vibe-muted text-sm max-w-sm mx-auto">
                  Views will appear here once your feed goes live and people start tuning in.
                </p>
              </div>
            ) : analytics ? (
              <>
                {/* Hero stat cards */}
                <div className="grid grid-cols-3 gap-4 mb-8">
                  <div className="bg-vibe-card border border-vibe-border rounded-2xl p-5 shadow-card text-center">
                    <p className="text-vibe-muted-dim text-xs uppercase tracking-wider mb-2">Total Views</p>
                    <p className="text-4xl font-bold text-vibe-accent font-[Playfair_Display]">{analytics.total_views}</p>
                  </div>
                  <div className="bg-vibe-card border border-vibe-border rounded-2xl p-5 shadow-card text-center">
                    <p className="text-vibe-muted-dim text-xs uppercase tracking-wider mb-2">Unique Viewers</p>
                    <p className="text-4xl font-bold text-vibe-accent font-[Playfair_Display]">{analytics.unique_viewers}</p>
                  </div>
                  <div className="bg-vibe-card border border-vibe-border rounded-2xl p-5 shadow-card text-center">
                    <p className="text-vibe-muted-dim text-xs uppercase tracking-wider mb-2">Repeat Rate</p>
                    <p className="text-4xl font-bold text-vibe-accent font-[Playfair_Display]">{analytics.repeat_viewer_rate}%</p>
                  </div>
                </div>

                {/* Sub-stats row */}
                <div className="flex gap-6 mb-8 text-sm">
                  <div>
                    <span className="text-vibe-muted-dim">Avg. watch time: </span>
                    <span className="text-vibe-text font-semibold">
                      {analytics.avg_view_duration > 0
                        ? `${Math.floor(analytics.avg_view_duration / 60)}m ${analytics.avg_view_duration % 60}s`
                        : "—"}
                    </span>
                  </div>
                  {analytics.peak_day && (
                    <div>
                      <span className="text-vibe-muted-dim">Peak day: </span>
                      <span className="text-vibe-text font-semibold">
                        {new Date(analytics.peak_day + "T00:00:00").toLocaleDateString("en-US", {
                          weekday: "long",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </div>
                  )}
                  {analytics.peak_hour !== null && (
                    <div>
                      <span className="text-vibe-muted-dim">Peak hour: </span>
                      <span className="text-vibe-text font-semibold">
                        {(() => {
                          const h = analytics.peak_hour;
                          if (h === 0) return "12 AM";
                          if (h < 12) return `${h} AM`;
                          if (h === 12) return "12 PM";
                          return `${h - 12} PM`;
                        })()}
                      </span>
                    </div>
                  )}
                </div>

                {/* Views over time chart */}
                <div className="bg-vibe-card border border-vibe-border rounded-2xl p-6 shadow-card mb-6">
                  <h3 className="text-base font-semibold text-vibe-text mb-4">Views Over Time</h3>
                  {analytics.views_by_day.length > 0 ? (
                    renderBarChart()
                  ) : (
                    <p className="text-vibe-muted text-sm text-center py-8">No daily data for this period yet.</p>
                  )}
                </div>

                {/* Peak hours heatmap */}
                <div className="bg-vibe-card border border-vibe-border rounded-2xl p-6 shadow-card mb-6">
                  <h3 className="text-base font-semibold text-vibe-text mb-4">Peak Hours (UTC)</h3>
                  {renderHeatmap()}
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
