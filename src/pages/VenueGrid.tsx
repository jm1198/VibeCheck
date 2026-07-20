import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getVenues } from "../api";
import type { Venue } from "../types";
import VenueCard from "../components/VenueCard";

export default function VenueGrid() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    getVenues()
      .then(setVenues)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

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
            <div className="w-9 h-9 rounded-xl bg-vibe-accent flex items-center justify-center shadow-md">
              <span className="text-white font-extrabold text-lg">V</span>
            </div>
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
        {/* Section heading */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-9 h-9 rounded-xl bg-vibe-accent/10 flex items-center justify-center shrink-0">
            <svg className="w-4.5 h-4.5 text-vibe-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-bold text-vibe-text">Venues</h2>
            <p className="text-vibe-muted text-sm">
              {filter === "all" ? "Browse all locations" : `Showing ${filter} venues`}
            </p>
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
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
            {filtered.map((venue, i) => (
              <Link
                key={venue.id}
                to={`/venue/${venue.id}`}
                className="animate-card-in block max-w-[80%] sm:max-w-full mx-auto"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <VenueCard venue={venue} />
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="border-t border-vibe-border py-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center text-vibe-muted text-sm">
          <p className="mb-2">
            <span className="font-bold text-vibe-text">VibeCheck</span> — Real-time venue vibes.
          </p>
          <p>
            For venue owners:{" "}
            <Link to="/dashboard" className="text-vibe-accent hover:underline font-semibold">
              manage your listing
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
