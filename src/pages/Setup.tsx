import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getMe, createVenue } from "../api";
import type { User } from "../types";

const CATEGORIES = ["Bar", "Club", "Lounge", "Brewery", "Restaurant"] as const;

const DEFAULT_HOURS = {
  monday: { open: "17:00", close: "02:00" },
  tuesday: { open: "17:00", close: "02:00" },
  wednesday: { open: "17:00", close: "02:00" },
  thursday: { open: "17:00", close: "02:00" },
  friday: { open: "16:00", close: "03:00" },
  saturday: { open: "16:00", close: "03:00" },
  sunday: { open: "17:00", close: "00:00" },
};

export default function Setup() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Form fields
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("Bar");

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
          // Already has a venue — go straight to dashboard
          navigate("/dashboard/manage");
        }
      })
      .catch(() => {
        localStorage.removeItem("vibecheck_token");
        navigate("/dashboard");
      })
      .finally(() => setLoading(false));
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const venue = await createVenue({
        name: name.trim(),
        location: location.trim(),
        description: description.trim(),
        category: category.toLowerCase(),
        business_hours: JSON.stringify(DEFAULT_HOURS),
      });
      // Redirect to dashboard — stream key will be auto-loaded there
      navigate("/dashboard/manage");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-vibe-bg flex items-center justify-center">
        <div className="shimmer rounded-2xl w-96 h-72" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-vibe-bg flex items-center justify-center px-4">
      <div className="w-full max-w-md animate-fade-up">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-vibe-accent shadow-md mb-5">
            <span className="text-white font-extrabold text-2xl">V</span>
          </div>
          <h1 className="text-3xl font-bold gradient-text">Create Your Venue</h1>
          <p className="text-vibe-muted mt-2 text-sm">
            Set up your venue to start streaming live vibes
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-vibe-card border border-vibe-border rounded-2xl p-6 space-y-5 shadow-card"
        >
          {error && (
            <div className="text-sm p-3 rounded-xl font-medium bg-red-50 text-red-600 border border-red-200">
              {error}
            </div>
          )}

          {/* Venue Name */}
          <div>
            <label className="block text-sm text-vibe-muted mb-1.5 font-medium">
              Venue Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full bg-vibe-bg border border-vibe-border rounded-xl px-4 py-3 text-vibe-text placeholder-vibe-muted-dim focus:outline-none focus:border-vibe-accent focus:ring-1 focus:ring-vibe-accent/20 transition-all"
              placeholder="e.g. Neon Dragon"
            />
          </div>

          {/* Location */}
          <div>
            <label className="block text-sm text-vibe-muted mb-1.5 font-medium">
              Location <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              required
              className="w-full bg-vibe-bg border border-vibe-border rounded-xl px-4 py-3 text-vibe-text placeholder-vibe-muted-dim focus:outline-none focus:border-vibe-accent focus:ring-1 focus:ring-vibe-accent/20 transition-all"
              placeholder="e.g. 242 E 14th St, New York, NY"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm text-vibe-muted mb-1.5 font-medium">
              Category <span className="text-red-400">*</span>
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              required
              className="w-full bg-vibe-bg border border-vibe-border rounded-xl px-4 py-3 text-vibe-text focus:outline-none focus:border-vibe-accent focus:ring-1 focus:ring-vibe-accent/20 transition-all appearance-none"
              style={{
                backgroundImage:
                  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239a9a9a' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 1rem center",
              }}
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm text-vibe-muted mb-1.5 font-medium">
              Description <span className="text-vibe-muted-dim font-normal">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full bg-vibe-bg border border-vibe-border rounded-xl px-4 py-3 text-vibe-text placeholder-vibe-muted-dim focus:outline-none focus:border-vibe-accent focus:ring-1 focus:ring-vibe-accent/20 transition-all resize-none"
              placeholder="Tell people what makes your venue special..."
            />
          </div>

          {/* Business Hours Preview */}
          <div className="bg-vibe-surface border border-vibe-border rounded-xl p-4">
            <p className="text-sm text-vibe-muted font-medium mb-2">
              🕐 Business Hours (editable later)
            </p>
            <div className="text-xs text-vibe-muted space-y-1">
              <p>
                <span className="font-medium text-vibe-text-secondary">Mon–Thu:</span>{" "}
                5:00 PM – 2:00 AM
              </p>
              <p>
                <span className="font-medium text-vibe-text-secondary">Fri–Sat:</span>{" "}
                4:00 PM – 3:00 AM
              </p>
              <p>
                <span className="font-medium text-vibe-text-secondary">Sun:</span>{" "}
                5:00 PM – 12:00 AM
              </p>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-vibe-accent hover:bg-vibe-accent-glow text-white font-semibold rounded-full py-3 transition-all shadow-md disabled:opacity-50 press-scale"
          >
            {submitting ? "Creating venue..." : "Create Venue"}
          </button>
        </form>

        <div className="text-center mt-5">
          <p className="text-vibe-muted-dim text-xs">
            You can edit all details later in your dashboard
          </p>
        </div>
      </div>
    </div>
  );
}
