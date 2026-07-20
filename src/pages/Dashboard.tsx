import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { getMe, updateVenue, getVenue, getStreamKey, regenerateStreamKey } from "../api";
import type { User, Venue, BusinessHours, StreamKeyInfo } from "../types";
import { DAYS } from "../types";

export default function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [venue, setVenue] = useState<Venue | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [hours, setHours] = useState<BusinessHours>({});

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
          // Fetch stream key
          return getStreamKey(v.id).then((info) => {
            setStreamKey(info.stream_key);
            setStreamKeyInfo(info);
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

  async function startBroadcast() {
    if (!venue) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;

      // Show preview in the hidden video element
      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = stream;
      }

      // Connect WebSocket as broadcaster
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws/stream?venue=${venue.id}&role=broadcaster`;
      const ws = new WebSocket(wsUrl);
      broadcastWsRef.current = ws;

      ws.onopen = () => {
        // Start recording + sending
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

        // Send chunks every 500ms for lower latency
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

  return (
    <div className="min-h-screen bg-vibe-bg">
      <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
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

      {/* Connect Camera — Stream Key & Broadcast */}
      <div className="bg-vibe-card border border-vibe-border rounded-2xl p-6 mb-6 shadow-card">
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
      </div>
    </div>
  );
}
