import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getVenue, getVenues, getDensity, toggleFavorite } from "../api";
import type { Venue, CrowdDensity } from "../types";
import LiveFeed from "../components/LiveFeed";
import VenueCard from "../components/VenueCard";
import { useAuth } from "../AuthContext";

export default function VenueDetail() {
  const { id } = useParams<{ id: string }>();
  const [venue, setVenue] = useState<Venue | null>(null);
  const [others, setOthers] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [density, setDensity] = useState<CrowdDensity | null>(null);
  const [isFavorited, setIsFavorited] = useState(false);
  const [favLoading, setFavLoading] = useState(false);
  const { isLoggedIn, loading: authLoading } = useAuth();

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([getVenue(parseInt(id)), getVenues()])
      .then(([v, all]) => {
        setVenue(v);
        setOthers(all.filter((o) => o.id !== v.id).slice(0, 3));
        // Fetch density if venue is live
        if (v.is_live === 1) {
          getDensity(v.id).then(setDensity).catch(() => {});
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const handleToggleFavorite = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!venue || favLoading) return;
    setFavLoading(true);
    try {
      const result = await toggleFavorite(venue.id);
      setIsFavorited(result.favorited);
    } catch (err) {
      console.error("Failed to toggle favorite:", err);
    } finally {
      setFavLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="shimmer rounded-2xl h-[350px] mb-6" />
        <div className="shimmer rounded-xl h-8 w-56 mb-3" />
        <div className="shimmer rounded-lg h-4 w-full mb-2" />
        <div className="shimmer rounded-lg h-4 w-3/4 mb-2" />
      </div>
    );
  }

  if (!venue) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center animate-fade-up">
        <p className="text-5xl mb-5">😕</p>
        <p className="text-vibe-text text-xl font-semibold">Venue not found</p>
        <Link
          to="/"
          className="text-vibe-accent hover:underline mt-5 inline-flex items-center gap-1.5 font-medium transition-colors"
        >
          <span>←</span> Back to venues
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
      {/* Back nav */}
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-vibe-muted hover:text-vibe-accent transition-colors mb-5 text-sm font-medium group"
      >
        <svg
          className="w-4 h-4 transition-transform group-hover:-translate-x-0.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to venues
      </Link>

      {/* Live Feed — gated behind auth */}
      <div className="rounded-2xl overflow-hidden border-2 border-vibe-border-dark shadow-card">
        {!authLoading && isLoggedIn ? (
          <LiveFeed venue={venue} />
        ) : !authLoading ? (
          <SignInPrompt venueName={venue.name} />
        ) : (
          <div className="relative aspect-video bg-vibe-surface border border-vibe-border flex items-center justify-center overflow-hidden">
            <div className="shimmer rounded-full w-14 h-14" />
          </div>
        )}
      </div>

      {/* Venue Info */}
      <div className="mt-6 animate-fade-up">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-vibe-text tracking-tight">
              {venue.name}
            </h1>
            <p className="text-vibe-muted mt-1.5 flex items-center gap-1.5 text-sm sm:text-base">
              <svg
                className="w-4 h-4 text-vibe-muted-dim shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              {venue.location}
            </p>
          </div>
          <div className="flex gap-2.5">
            {isLoggedIn && (
              <button
                onClick={handleToggleFavorite}
                disabled={favLoading}
                className={`inline-flex items-center justify-center w-9 h-9 rounded-full border transition-all press-scale ${
                  isFavorited
                    ? "bg-red-50 border-red-200 text-red-500"
                    : "bg-white border-vibe-border text-gray-400 hover:text-red-400 hover:border-red-200"
                }`}
                aria-label={isFavorited ? "Unfavorite" : "Favorite"}
              >
                {isFavorited ? (
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                  </svg>
                )}
              </button>
            )}
            {venue.featured && (
              <span className="inline-flex items-center gap-1.5 bg-vibe-accent text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-sm uppercase tracking-wide">
                <span className="text-amber-300">★</span> Featured
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 bg-transparent text-vibe-text text-xs font-semibold px-3 py-1.5 rounded-full border border-vibe-border-dark uppercase tracking-wide">
              {venue.category}
            </span>
            {venue.is_live === 1 && (
              <span className="inline-flex items-center gap-1.5 bg-vibe-live/10 text-vibe-live text-xs font-semibold px-3 py-1.5 rounded-full border border-vibe-live/30 live-pulse uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-vibe-live" /> Live
              </span>
            )}
          </div>
        </div>

        {/* Density display */}
        {density && (
          <div className="mt-4 flex items-center gap-3 p-3 bg-vibe-card border border-vibe-border rounded-xl">
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
              const timeAgo = secondsAgo < 60
                ? `${secondsAgo}s ago`
                : secondsAgo < 3600
                  ? `${Math.floor(secondsAgo / 60)}m ago`
                  : `${Math.floor(secondsAgo / 3600)}h ago`;
              return (
                <>
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${c}`}>
                    <span className="w-2 h-2 rounded-full bg-current" />
                    {density.label} ({density.density_score}/10)
                  </span>
                  <span className="text-vibe-muted text-sm">
                    · {density.people_count} people detected · updated {timeAgo}
                  </span>
                </>
              );
            })()}
          </div>
        )}

        <p className="text-vibe-text-secondary mt-4 leading-relaxed text-sm sm:text-base">
          {venue.description}
        </p>

        {/* Stats row */}
        <div className="flex gap-5 mt-6 p-4 bg-vibe-card rounded-2xl border border-vibe-border shadow-sm">
          <div>
            <p className="text-xl sm:text-2xl font-bold text-vibe-text tabular-nums">
              {venue.is_live ? venue.viewer_count : "—"}
            </p>
            <p className="text-vibe-muted text-xs sm:text-sm mt-0.5">Viewers</p>
          </div>
          <div className="w-px bg-vibe-border self-stretch" />
          <div>
            <p className="text-xl sm:text-2xl font-bold text-vibe-text">
              {venue.is_live ? (
                <span className="text-vibe-live">Online</span>
              ) : (
                <span className="text-vibe-muted-dim">Offline</span>
              )}
            </p>
            <p className="text-vibe-muted text-xs sm:text-sm mt-0.5">Status</p>
          </div>
          <div className="w-px bg-vibe-border self-stretch" />
          <div>
            <p className="text-xl sm:text-2xl font-bold text-vibe-text capitalize">
              {venue.category}
            </p>
            <p className="text-vibe-muted text-xs sm:text-sm mt-0.5">Type</p>
          </div>
        </div>
      </div>

      {/* Other venues */}
      {others.length > 0 && (
        <div className="mt-16">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-lg bg-vibe-accent/10 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-vibe-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-vibe-text tracking-tight">
              Nearby venues
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-8">
            {others.map((v, i) => (
              <Link
                key={v.id}
                to={`/venue/${v.id}`}
                className="animate-card-in block max-w-[80%] sm:max-w-full mx-auto"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <VenueCard venue={v} />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SignInPrompt({ venueName }: { venueName: string }) {
  return (
    <div className="relative aspect-video bg-vibe-surface border border-vibe-border flex items-center justify-center overflow-hidden">
      <div className="text-center px-6 max-w-sm">
        <div className="text-5xl mb-4">🔐</div>
        <p className="text-vibe-text text-base font-semibold">Sign in to watch</p>
        <p className="text-vibe-muted text-sm mt-2">
          Create a free account to watch the live feed from {venueName} and check the vibe before you go.
        </p>
        <Link
          to="/login"
          className="mt-5 inline-flex items-center gap-2 bg-vibe-accent hover:bg-vibe-accent-glow text-white font-semibold rounded-full px-6 py-2.5 transition-all shadow-md press-scale text-sm"
        >
          Sign in to watch
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </Link>
      </div>
    </div>
  );
}
