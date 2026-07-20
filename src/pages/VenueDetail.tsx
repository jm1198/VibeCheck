import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getVenue, getVenues } from "../api";
import type { Venue } from "../types";
import LiveFeed from "../components/LiveFeed";
import VenueCard from "../components/VenueCard";

export default function VenueDetail() {
  const { id } = useParams<{ id: string }>();
  const [venue, setVenue] = useState<Venue | null>(null);
  const [others, setOthers] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([getVenue(parseInt(id)), getVenues()])
      .then(([v, all]) => {
        setVenue(v);
        setOthers(all.filter((o) => o.id !== v.id).slice(0, 3));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

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

      {/* Live Feed — dark border frame */}
      <div className="rounded-2xl overflow-hidden border-2 border-vibe-border-dark shadow-card">
        <LiveFeed venue={venue} />
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
                className="animate-card-in block"
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
