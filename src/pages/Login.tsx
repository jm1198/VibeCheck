import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login, signup } from "../api";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "login") {
        const result = await login(email, password);
        localStorage.setItem("vibecheck_token", result.token);
        if (result.venue_id) {
          navigate("/dashboard/manage");
        } else {
          navigate("/setup");
        }
      } else {
        await signup(email, password);
        // Auto-login after signup and redirect to venue setup
        const loginResult = await login(email, password);
        localStorage.setItem("vibecheck_token", loginResult.token);
        navigate("/setup");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-vibe-bg">
      <div className="w-full max-w-sm animate-fade-up">
        {/* Logo / Brand */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-vibe-accent shadow-md mb-6">
            <span className="text-white font-extrabold text-3xl">V</span>
          </div>
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-none" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>
            <span className="gradient-text">VibeCheck</span>
          </h1>
          <p className="text-vibe-muted mt-3 text-sm sm:text-base font-medium">Venue Owner Dashboard</p>
        </div>

        {/* Form Card — white with subtle shadow and dark border */}
        <form
          onSubmit={handleSubmit}
          className="bg-vibe-card border border-vibe-border rounded-2xl p-6 space-y-4 shadow-card"
        >
          <h2 className="text-xl font-bold text-vibe-text tracking-tight">
            {mode === "login" ? "Log In" : "Create Account"}
          </h2>

          {error && (
            <div
              className={`text-sm p-3 rounded-xl font-medium ${
                error.includes("created")
                  ? "bg-vibe-accent/8 text-vibe-accent border border-vibe-accent/20"
                  : "bg-red-50 text-red-600 border border-red-200"
              }`}
            >
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm text-vibe-muted mb-1.5 font-medium">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-vibe-bg border border-vibe-border rounded-xl px-4 py-3 text-vibe-text placeholder-vibe-muted-dim focus:outline-none focus:border-vibe-accent focus:ring-1 focus:ring-vibe-accent/20 transition-all"
              placeholder="demo@vibecheck.app"
            />
          </div>

          <div>
            <label className="block text-sm text-vibe-muted mb-1.5 font-medium">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full bg-vibe-bg border border-vibe-border rounded-xl px-4 py-3 text-vibe-text placeholder-vibe-muted-dim focus:outline-none focus:border-vibe-accent focus:ring-1 focus:ring-vibe-accent/20 transition-all"
              placeholder="demo123"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-vibe-accent hover:bg-vibe-accent-glow text-white font-semibold rounded-full py-3 transition-all shadow-md disabled:opacity-50 press-scale"
          >
            {loading ? "Please wait..." : mode === "login" ? "Log In" : "Sign Up"}
          </button>

          <p className="text-center text-sm text-vibe-muted">
            {mode === "login" ? (
              <>
                Don't have an account?{" "}
                <button
                  type="button"
                  onClick={() => {
                    setMode("signup");
                    setError("");
                  }}
                  className="text-vibe-accent hover:underline font-semibold"
                >
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => {
                    setMode("login");
                    setError("");
                  }}
                  className="text-vibe-accent hover:underline font-semibold"
                >
                  Log in
                </button>
              </>
            )}
          </p>
        </form>

        {/* Demo hint */}
        <div className="mt-5 text-center">
          <p className="text-vibe-muted-dim text-xs">
            Demo:{" "}
            <code className="text-vibe-accent font-mono bg-vibe-surface px-1.5 py-0.5 rounded border border-vibe-border">
              demo@vibecheck.app
            </code>{" "}
            /{" "}
            <code className="text-vibe-accent font-mono bg-vibe-surface px-1.5 py-0.5 rounded border border-vibe-border">
              demo123
            </code>
          </p>
        </div>

        <div className="text-center mt-6">
          <a href="/" className="text-vibe-muted hover:text-vibe-text text-sm transition-colors">
            ← Back to venue browser
          </a>
        </div>
      </div>
    </div>
  );
}
