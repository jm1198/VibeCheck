import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getVenues } from "../api";
import type { Venue } from "../types";

// Fix Leaflet default marker icon paths (broken by bundlers)
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

// ── Custom colored circle markers ────────────────────────────────
function createCircleMarker(color: string, isLive: boolean) {
  const size = isLive ? 16 : 12;
  const pulseClass = isLive ? "live-marker-pulse" : "";
  return L.divIcon({
    className: `custom-marker ${pulseClass}`,
    html: `<div style="
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border: 3px solid white;
      border-radius: 50%;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [size + 6, size + 6],
    iconAnchor: [(size + 6) / 2, (size + 6) / 2],
    popupAnchor: [0, -((size + 6) / 2)],
  });
}

// ── Auto-center map ──────────────────────────────────────────────
function AutoCenter({ venues }: { venues: Venue[] }) {
  const map = useMap();
  useEffect(() => {
    if (venues.length > 0) {
      const bounds = L.latLngBounds(
        venues
          .filter((v) => v.latitude != null && v.longitude != null)
          .map((v) => [v.latitude!, v.longitude!] as [number, number])
      );
      if (bounds.isValid()) {
        map.fitBounds(bounds.pad(0.15));
      }
    }
  }, [venues, map]);
  return null;
}

// ── Density helpers ──────────────────────────────────────────────
function getDensityLabel(score: number | null | undefined): string {
  if (score == null) return "Unknown";
  if (score <= 2) return "Empty";
  if (score <= 4) return "Quiet";
  if (score <= 6) return "Moderate";
  if (score <= 8) return "Busy";
  return "Packed";
}

function getDensityColor(score: number | null | undefined): string {
  if (score == null) return "text-vibe-muted";
  if (score <= 2) return "text-blue-600";
  if (score <= 4) return "text-green-600";
  if (score <= 6) return "text-yellow-600";
  if (score <= 8) return "text-orange-600";
  return "text-red-600";
}

// ══════════════════════════════════════════════════════════════════
export default function VibeMap() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    getVenues()
      .then(setVenues)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const sdCenter: [number, number] = [32.7157, -117.1611];

  return (
    <div className="flex flex-col h-screen bg-vibe-bg">
      {/* ═══ TOP NAV BAR ═══ */}
      <nav className="z-50 bg-white/90 backdrop-blur-xl border-b border-vibe-border shrink-0">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-vibe-accent flex items-center justify-center shadow-md">
              <span className="text-white font-extrabold text-lg">V</span>
            </div>
            <span
              className="text-vibe-text font-bold text-lg tracking-tight hidden sm:block"
              style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
            >
              VibeCheck
            </span>
          </Link>
          <div className="flex items-center gap-2 bg-vibe-surface rounded-2xl p-1 border border-vibe-border">
            <Link
              to="/"
              className="px-4 py-2 rounded-xl text-sm font-medium text-vibe-muted hover:text-vibe-text transition-all"
            >
              Browse
            </Link>
            <Link
              to="/map"
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-vibe-accent text-white shadow-md transition-all"
            >
              Map
            </Link>
            <Link
              to="/dashboard"
              className="px-4 py-2 rounded-xl text-sm font-medium text-vibe-muted hover:text-vibe-text transition-all"
            >
              Dashboard
            </Link>
          </div>
        </div>
      </nav>

      {/* ═══ MAP AREA ═══ */}
      <div className="flex-1 relative">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-vibe-surface">
            <div className="text-center">
              <div className="shimmer rounded-2xl w-64 h-64 mx-auto" />
              <p className="text-vibe-muted mt-4 text-sm">Loading map…</p>
            </div>
          </div>
        ) : (
          <>
            <MapContainer
              center={sdCenter}
              zoom={13}
              className="h-full w-full"
              zoomControl={true}
              attributionControl={true}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <AutoCenter venues={venues} />

              {venues
                .filter((v) => v.latitude != null && v.longitude != null)
                .map((venue) => {
                  const isLive = venue.is_live === 1;
                  const color = isLive ? "#22c55e" : "#9ca3af";
                  const icon = createCircleMarker(color, isLive);

                  return (
                    <Marker
                      key={venue.id}
                      position={[venue.latitude!, venue.longitude!]}
                      icon={icon}
                      eventHandlers={{
                        click: () => {
                          // Allow tap/click to open popup
                        },
                      }}
                    >
                      <Popup>
                        <div className="min-w-[180px]">
                          <h3
                            className="font-bold text-base text-vibe-text mb-1"
                            style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
                          >
                            {venue.name}
                          </h3>
                          <span
                            className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full border mb-2 uppercase tracking-wide ${
                              venue.category === "club"
                                ? "border-fuchsia-600 text-fuchsia-700"
                                : venue.category === "lounge"
                                ? "border-emerald-600 text-emerald-700"
                                : "border-amber-600 text-amber-700"
                            }`}
                          >
                            {venue.category}
                          </span>
                          {isLive && venue.crowd_density != null && (
                            <div className="flex items-center gap-1.5 mb-2">
                              <span
                                className={`text-xs font-bold ${getDensityColor(venue.crowd_density)}`}
                              >
                                {getDensityLabel(venue.crowd_density)} ({venue.crowd_density}/10)
                              </span>
                            </div>
                          )}
                          {isLive && (
                            <div className="flex items-center gap-1.5 text-vibe-live text-xs font-semibold mb-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-vibe-live live-pulse" />
                              Live · {venue.viewer_count} watching
                            </div>
                          )}
                          {!isLive && (
                            <div className="flex items-center gap-1.5 text-vibe-muted-dim text-xs font-semibold mb-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-vibe-muted-dim" />
                              Offline
                            </div>
                          )}
                          <button
                            onClick={() => navigate(`/venue/${venue.id}`)}
                            className="w-full mt-1 px-3 py-1.5 bg-vibe-accent text-white text-sm font-semibold rounded-xl hover:bg-vibe-accent-glow transition-colors"
                          >
                            View venue →
                          </button>
                        </div>
                      </Popup>
                    </Marker>
                  );
                })}
            </MapContainer>

            {/* ═══ LEGEND ═══ */}
            <div className="absolute bottom-4 left-4 z-[1000] bg-white/90 backdrop-blur-md rounded-2xl px-4 py-3 shadow-lg border border-vibe-border text-xs">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-[#22c55e] border-2 border-white shadow-sm" />
                  <span className="text-vibe-text font-medium">Live</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-[#9ca3af] border-2 border-white shadow-sm" />
                  <span className="text-vibe-muted">Offline</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
