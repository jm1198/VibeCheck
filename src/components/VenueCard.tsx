import type { Venue } from "../types";

function getDensityInfo(score: number | null | undefined) {
  if (score == null) return null;
  const colors: Record<number, { dot: string; bg: string; border: string; text: string }> = {
    1: { dot: "bg-blue-500", bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700" },
    2: { dot: "bg-blue-500", bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700" },
    3: { dot: "bg-green-500", bg: "bg-green-50", border: "border-green-200", text: "text-green-700" },
    4: { dot: "bg-green-500", bg: "bg-green-50", border: "border-green-200", text: "text-green-700" },
    5: { dot: "bg-yellow-500", bg: "bg-yellow-50", border: "border-yellow-200", text: "text-yellow-700" },
    6: { dot: "bg-yellow-500", bg: "bg-yellow-50", border: "border-yellow-200", text: "text-yellow-700" },
    7: { dot: "bg-orange-500", bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700" },
    8: { dot: "bg-orange-500", bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700" },
    9: { dot: "bg-red-500", bg: "bg-red-50", border: "border-red-200", text: "text-red-700" },
    10: { dot: "bg-red-500", bg: "bg-red-50", border: "border-red-200", text: "text-red-700" },
  };
  const labels: Record<number, string> = {
    1: "Empty", 2: "Empty",
    3: "Quiet", 4: "Quiet",
    5: "Moderate", 6: "Moderate",
    7: "Busy", 8: "Busy",
    9: "Packed", 10: "Packed",
  };
  return { ...colors[score] || colors[5], label: labels[score] || "Moderate" };
}

export default function VenueCard({ venue }: { venue: Venue }) {
  const categoryColors: Record<string, string> = {
    bar: "border-amber-600 text-amber-700",
    club: "border-fuchsia-600 text-fuchsia-700",
    lounge: "border-emerald-600 text-emerald-700",
  };
  const categoryStyle = categoryColors[venue.category] || "border-vibe-accent text-vibe-accent";

  return (
    <div className="group glow-on-hover bg-vibe-card border border-vibe-border rounded-2xl overflow-hidden cursor-pointer h-full press-scale transition-all duration-300">
      {/* Thumbnail — portrait dominant, with dark frame border */}
      <div className="relative aspect-[3/4] bg-vibe-surface overflow-hidden border-b-2 border-vibe-border-dark">
        <img
          src={venue.thumbnail_url}
          alt={venue.name}
          className="thumb-img w-full h-full object-cover"
          loading="lazy"
        />

        {/* Subtle gradient overlay — barely visible, for readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent pointer-events-none" />

        {/* Live / Offline badge — refined */}
        <div className="absolute top-4 left-4">
          {venue.is_live === 1 ? (
            <div className="flex items-center gap-2 bg-white/95 backdrop-blur-md rounded-full pl-2.5 pr-4 py-1.5 shadow-md border border-gray-200">
              <span className="relative flex h-2.5 w-2.5">
                <span className="live-ring-glow absolute inline-flex h-full w-full rounded-full bg-vibe-live opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-vibe-live live-pulse" />
              </span>
              <span className="text-vibe-live text-xs font-bold tracking-widest uppercase">
                Live
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-white/90 backdrop-blur-md rounded-full px-4 py-1.5 shadow-md border border-gray-200">
              <span className="w-2 h-2 rounded-full bg-gray-400" />
              <span className="text-gray-500 text-xs font-semibold tracking-widest uppercase">
                Offline
              </span>
            </div>
          )}
        </div>

        {/* Viewer count */}
        {venue.is_live === 1 && venue.viewer_count > 0 && (
          <div className="absolute top-4 right-4 flex items-center gap-1.5 bg-white/90 backdrop-blur-md rounded-full px-3 py-1.5 shadow-md border border-gray-200">
            <svg className="w-3.5 h-3.5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            <span className="text-gray-700 text-sm font-semibold tabular-nums">
              {venue.viewer_count}
            </span>
          </div>
        )}

        {/* Density badge */}
        {venue.is_live === 1 && venue.crowd_density != null && (() => {
          const info = getDensityInfo(venue.crowd_density);
          if (!info) return null;
          return (
            <div className={`absolute bottom-4 right-4 flex items-center gap-1.5 ${info.bg} backdrop-blur-md rounded-full pl-2 pr-3 py-1.5 shadow-md border ${info.border}`}>
              <span className={`w-2 h-2 rounded-full ${info.dot}`} />
              <span className={`${info.text} text-xs font-semibold`}>
                {info.label} {venue.crowd_density}/10
              </span>
            </div>
          );
        })()}

        {/* Category pill — dark outline style, no fill */}
        <div className="absolute bottom-4 left-4">
          <span className={`inline-block bg-white/90 backdrop-blur-sm text-xs font-bold px-3.5 py-1.5 rounded-full tracking-widest uppercase shadow-md border ${categoryStyle}`}>
            {venue.category}
          </span>
        </div>
      </div>

      {/* Info — refined spacing */}
      <div className="p-5">
        <h3 className="font-bold text-vibe-text text-lg leading-tight group-hover:text-vibe-accent transition-colors duration-200 truncate">
          {venue.name}
        </h3>
        <p className="text-vibe-muted text-sm mt-2 flex items-center gap-1.5 truncate">
          <svg className="w-4 h-4 shrink-0 text-vibe-muted-dim" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          {venue.location}
        </p>
      </div>
    </div>
  );
}
