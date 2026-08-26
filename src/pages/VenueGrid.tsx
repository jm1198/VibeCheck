import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getVenues, getFavorites, toggleFavorite as toggleFavoriteApi } from "../api";
import type { Venue } from "../types";
import VenueCard from "../components/VenueCard";
import { useAuth } from "../AuthContext";

// Fix Leaflet default marker icon paths
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

function createCircleMarker(color: string, isLive: boolean) {
  const dotSize = isLive ? 18 : 13;
  const boxSize = isLive ? 44 : 28;
  const pulse = isLive
    ? `<span class="vibe-marker-pulse" style="width:${dotSize}px;height:${dotSize}px"></span>`
    : "";
  return L.divIcon({
    className: "custom-marker",
    html: `<div class="vibe-marker" style="--marker-color:${color}">${pulse}<span class="vibe-marker-dot" style="width:${dotSize}px;height:${dotSize}px"></span></div>`,
    iconSize: [boxSize, boxSize],
    iconAnchor: [boxSize / 2, boxSize / 2],
    popupAnchor: [0, -(boxSize / 2)],
  });
}

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

export default function VenueGrid() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [favorites, setFavorites] = useState<Venue[]>([]);
  const [favIds, setFavIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"grid" | "map">("grid");
  const navigate = useNavigate();
  const { isLoggedIn } = useAuth();

  useEffect(() => {
    getVenues()
      .then(setVenues)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Load favorites when logged in
  useEffect(() => {
    if (!isLoggedIn) {
      setFavorites([]);
      setFavIds(new Set());
      return;
    }
    getFavorites()
      .then((favs) => {
        setFavorites(favs);
        setFavIds(new Set(favs.map((f) => f.id)));
      })
      .catch(() => {});
  }, [isLoggedIn]);

  const handleToggleFavorite = async (venueId: number) => {
    try {
      const result = await toggleFavoriteApi(venueId);
      if (result.favorited) {
        // Find venue and add to favorites
        const venue = venues.find((v) => v.id === venueId);
        if (venue) {
          setFavorites((prev) => [venue, ...prev.filter((f) => f.id !== venueId)]);
          setFavIds((prev) => new Set(prev).add(venueId));
        }
      } else {
        setFavorites((prev) => prev.filter((f) => f.id !== venueId));
        setFavIds((prev) => {
          const next = new Set(prev);
          next.delete(venueId);
          return next;
        });
      }
    } catch (err) {
      console.error("Failed to toggle favorite:", err);
    }
  };

  const filtered = venues.filter((v) => {
    const matchesSearch =
      v.name.toLowerCase().includes(search.toLowerCase()) ||
      v.location.toLowerCase().includes(search.toLowerCase());
    const matchesFilter =
      filter === "all" ||
      (filter === "live" && v.is_live === 1) ||
      v.category === filter;
    return matchesSearch && matchesFilter;
  });

  const categories = [
    { key: "all", label: "All" },
    { key: "live", label: "🔴 Live" },
    { key: "bar", label: "Bars" },
    { key: "club", label: "Clubs" },
    { key: "lounge", label: "Lounges" },
  ];

  return (
    <div className="min-h-screen bg-vibe-bg">
      {/* ═══ TOP NAV BAR ═══ */}
      <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur-xl border-b border-vibe-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <img
              src="/icon-192.png"
              alt="VibeCheck logo"
              className="w-9 h-9 rounded-xl shadow-md"
            />
            <span className="text-vibe-text font-bold text-lg tracking-tight hidden sm:block" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>
              VibeCheck
            </span>
          </Link>
          <div className="flex items-center gap-2 bg-vibe-surface rounded-2xl p-1 border border-vibe-border">
            <Link
              to="/"
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-vibe-accent text-white shadow-md transition-all"
            >
              Browse
            </Link>
            <Link
              to="/map"
              className="px-4 py-2 rounded-xl text-sm font-medium text-vibe-muted hover:text-vibe-text transition-all"
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

      {/* ═══ HERO SECTION ═══ */}
      <section className="relative">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-16 pb-12 sm:pt-20 sm:pb-16">
          <div className="text-center max-w-2xl mx-auto">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.15]">
              <span className="gradient-text">See the vibe</span>
              <br />
              <span className="text-vibe-text">before you go</span>
            </h1>
            <p className="text-vibe-muted mt-6 text-base sm:text-lg leading-relaxed max-w-lg mx-auto">
              Browse live camera feeds from bars and clubs near you. Find the perfect spot — no more guessing.
            </p>
          </div>

          {/* Search bar */}
          <div className="relative mt-10 max-w-xl mx-auto">
            <svg
              className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-vibe-muted-dim pointer-events-none"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              placeholder="Search venues or locations..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-white border border-vibe-border rounded-2xl pl-12 pr-4 py-4 text-vibe-text placeholder-vibe-muted-dim text-base focus:outline-none focus:border-vibe-accent focus:ring-1 focus:ring-vibe-accent/20 transition-all duration-200 shadow-sm"
            />
          </div>

          {/* Filter pills — dark outline style */}
          <div className="flex gap-3 justify-center mt-6 overflow-x-auto pb-2 no-scrollbar">
            {categories.map((cat) => (
              <button
                key={cat.key}
                onClick={() => setFilter(cat.key)}
                className={`shrink-0 px-5 py-2.5 rounded-full text-sm font-semibold transition-all duration-200 press-scale border ${
                  filter === cat.key
                    ? "bg-vibe-text text-white border-vibe-text"
                    : "bg-transparent text-vibe-muted hover:text-vibe-text border-vibe-border hover:border-vibe-border-dark"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ VENUE GRID ═══ */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 pb-12 sm:pb-16">
        {/* ═══ YOUR FAVORITES (auth-gated) ═══ */}
        {isLoggedIn && favorites.length > 0 && (
          <div className="mb-12">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-9 h-9 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                <svg className="w-4.5 h-4.5 text-red-500" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
                </svg>
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-bold text-vibe-text">Your Favorites</h2>
                <p className="text-vibe-muted text-sm">
                  {favorites.length} venue{favorites.length !== 1 ? "s" : ""} saved
                </p>
              </div>
            </div>
            {/* Horizontal scrollable row */}
            <div className="flex gap-5 overflow-x-auto pb-4 -mx-1 px-1 no-scrollbar snap-x">
              {favorites.map((venue, i) => (
                <Link
                  key={venue.id}
                  to={`/venue/${venue.id}`}
                  className="animate-card-in shrink-0 w-[280px] snap-start"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <VenueCard
                    venue={venue}
                    isFavorited={true}
                    showFavorite={true}
                    onToggleFavorite={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleToggleFavorite(venue.id);
                    }}
                  />
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Section heading */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-9 h-9 rounded-xl bg-vibe-accent/10 flex items-center justify-center shrink-0">
            <svg className="w-4.5 h-4.5 text-vibe-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-vibe-text">Venues</h2>
            <p className="text-vibe-muted text-sm">
              {filter === "all" ? "Browse all locations" : `Showing ${filter} venues`}
            </p>
          </div>
          {/* Grid/Map toggle */}
          <div className="flex items-center bg-vibe-surface rounded-xl p-1 border border-vibe-border">
            <button
              onClick={() => setViewMode("grid")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                viewMode === "grid"
                  ? "bg-white text-vibe-text shadow-sm"
                  : "text-vibe-muted hover:text-vibe-text"
              }`}
            >
              <svg className="w-4 h-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
              Grid
            </button>
            <button
              onClick={() => setViewMode("map")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                viewMode === "map"
                  ? "bg-white text-vibe-text shadow-sm"
                  : "text-vibe-muted hover:text-vibe-text"
              }`}
            >
              <svg className="w-4 h-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              Map
            </button>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="shimmer rounded-2xl h-[420px] max-w-[80%] sm:max-w-full mx-auto" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-24 animate-fade-up">
            <p className="text-6xl mb-6">🔍</p>
            <p className="text-vibe-text text-xl font-bold">No venues found</p>
            <p className="text-vibe-muted text-base mt-2">
              Try a different search or filter
            </p>
          </div>
        ) : viewMode === "map" ? (
          /* ── Inline Map View ── */
          <div className="vibe-map-shell rounded-2xl overflow-hidden border border-vibe-border shadow-card-hover" style={{ height: "500px" }}>
            <MapContainer
              center={[32.7157, -117.1611]}
              zoom={13}
              className="h-full w-full"
              zoomControl={true}
              attributionControl={true}
              zoomAnimation={true}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
                url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                subdomains="abcd"
              />
              {filtered
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
                              <span className={`text-xs font-bold ${getDensityColor(venue.crowd_density)}`}>
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
            {/* subtle edge vignette for depth */}
            <div className="vibe-map-vignette" aria-hidden />
          </div>
        ) : (
          /* ── Grid View ── */
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
            {filtered.map((venue, i) => (
              <Link
                key={venue.id}
                to={`/venue/${venue.id}`}
                className="animate-card-in block max-w-[80%] sm:max-w-full mx-auto"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <VenueCard
                  venue={venue}
                  isFavorited={favIds.has(venue.id)}
                  showFavorite={isLoggedIn}
                  onToggleFavorite={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleToggleFavorite(venue.id);
                  }}
                />
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="border-t border-vibe-border py-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center text-vibe-muted text-sm">
          <p className="mb-2 flex items-center justify-center gap-2">
            <img
              src="/icon-192.png"
              alt="VibeCheck logo"
              className="w-5 h-5 rounded-md"
            />
            <span className="font-bold text-vibe-text">VibeCheck</span> — Real-time venue vibes.
          </p>
          <a
            href="https://www.instagram.com/vibecheck.sd/"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="VibeCheck on Instagram"
            className="inline-flex items-center justify-center w-10 h-10 rounded-full border border-vibe-border text-vibe-muted hover:text-white hover:bg-vibe-accent hover:border-vibe-accent transition-colors mt-3"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
              <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
              <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
            </svg>
          </a>
          <p>
            For venue owners:{" "}
            <Link to="/dashboard" className="text-vibe-accent hover:underline font-semibold">
              manage your listing
            </Link>
          </p>
          <p className="mt-3">
            <Link to="/privacy" className="text-vibe-muted hover:text-vibe-text hover:underline font-medium">
              Privacy Policy
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
