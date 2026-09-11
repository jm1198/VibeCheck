import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { resetPassword } from "../api";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!password) {
      setError("Please choose a new password.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match. Please re-enter them.");
      return;
    }
    setLoading(true);
    try {
      await resetPassword(token, password);
      navigate("/login?reset=1", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-vibe-bg">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center mb-6">
            <img
              src="/icon-192.png"
              alt="VibeCheck logo"
              className="w-16 h-16 rounded-2xl shadow-md"
            />
          </div>
          <h1 className="text-5xl font-bold tracking-tight leading-none" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>
            <span className="gradient-text">VibeCheck</span>
          </h1>
          <p className="text-vibe-muted mt-3 text-sm font-medium">Choose a new password</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-vibe-card border border-vibe-border rounded-2xl p-6 space-y-4 shadow-card"
        >
          <h2 className="text-xl font-bold text-vibe-text tracking-tight">Set New Password</h2>

          {!token ? (
            <>
              <p className="text-sm text-vibe-muted leading-relaxed">
                This reset link is missing or invalid. Please request a new one from the login page.
              </p>
              <Link
                to="/login"
                className="block w-full text-center bg-vibe-accent hover:bg-vibe-accent-glow text-white font-semibold rounded-full py-3 transition-all shadow-md"
              >
                Back to Log In
              </Link>
            </>
          ) : (
            <>
              {error && (
                <div className="text-sm p-3 rounded-xl font-medium bg-red-50 text-red-600 border border-red-200">
                  {error}
                </div>
              )}
              <p className="text-sm text-vibe-muted leading-relaxed">
                Enter a new password for your account. It must be at least 8 characters.
              </p>
              <div>
                <label className="block text-sm text-vibe-muted mb-1.5 font-medium">New password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                  minLength={8}
                  className="w-full bg-vibe-bg border border-vibe-border rounded-xl px-4 py-3 text-vibe-text placeholder-vibe-muted-dim focus:outline-none focus:border-vibe-accent focus:ring-1 focus:ring-vibe-accent/20 transition-all"
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label className="block text-sm text-vibe-muted mb-1.5 font-medium">Confirm password</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                  className="w-full bg-vibe-bg border border-vibe-border rounded-xl px-4 py-3 text-vibe-text placeholder-vibe-muted-dim focus:outline-none focus:border-vibe-accent focus:ring-1 focus:ring-vibe-accent/20 transition-all"
                  placeholder="••••••••"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-vibe-accent hover:bg-vibe-accent-glow text-white font-semibold rounded-full py-3 transition-all shadow-md disabled:opacity-50 press-scale"
              >
                {loading ? "Please wait..." : "Update Password"}
              </button>
              <p className="text-center text-sm text-vibe-muted">
                <Link to="/login" className="text-vibe-accent hover:underline font-semibold">
                  Back to log in
                </Link>
              </p>
            </>
          )}
        </form>
      </div>
    </div>
  );
}