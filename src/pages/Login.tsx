import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { login, signup, googleLogin } from "../api";
import { useAuth } from "../AuthContext";

// Extend Window for Google Identity Services
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            auto_select?: boolean;
            context?: string;
          }) => void;
          prompt: (momentListener?: (notification: unknown) => void) => void;
          renderButton: (element: HTMLElement, config: { theme?: string; size?: string; type?: string; shape?: string }) => void;
          cancel: () => void;
        };
      };
    };
  }
}

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isLoggedIn, user, refresh } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [accountType, setAccountType] = useState<"consumer" | "venue_owner">("consumer");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Determine account type from URL: /dashboard = venue_owner, /login = consumer
  const isDashboardPath = location.pathname === "/dashboard";

  // Redirect if already logged in
  useEffect(() => {
    if (!isLoggedIn || !user) return;
    if (user.role === "venue_owner" && user.venue_id) {
      navigate("/dashboard/manage", { replace: true });
    } else {
      navigate("/", { replace: true });
    }
  }, [isLoggedIn, user, navigate]);

  // Set account type based on path
  useEffect(() => {
    if (isDashboardPath) {
      setAccountType("venue_owner");
    }
  }, [isDashboardPath]);

  // Load Google Identity Services
  useEffect(() => {
    if (accountType !== "consumer" || mode !== "login") return;

    // Load the GIS script
    const scriptId = "google-gis-script";
    if (!document.getElementById(scriptId)) {
      const script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = initGoogleButton;
      document.head.appendChild(script);
    } else {
      initGoogleButton();
    }

    return () => {
      // Don't remove the script on unmount — it may be needed elsewhere
    };
  }, [accountType, mode]);

  const initGoogleButton = useCallback(() => {
    if (!window.google?.accounts) return;

    const btnContainer = document.getElementById("google-signin-btn");
    if (!btnContainer) return;

    window.google.accounts.id.initialize({
      client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID || "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
      callback: handleGoogleCredential,
      auto_select: false,
      context: "signin",
    });

    window.google.accounts.id.renderButton(btnContainer, {
      theme: "outline",
      size: "large",
      type: "standard",
      shape: "pill",
      text: "continue_with",
      width: btnContainer.clientWidth || 320,
    });
  }, []);

  const handleGoogleCredential = async (response: { credential: string }) => {
    setError("");
    setLoading(true);
    try {
      const result = await googleLogin(response.credential);
      localStorage.setItem("vibecheck_token", result.token);
      await refresh();
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
    } finally {
      setLoading(false);
    }
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "login") {
        const result = await login(email, password);
        localStorage.setItem("vibecheck_token", result.token);
        await refresh();
        if (result.role === "venue_owner" && result.venue_id) {
          navigate("/dashboard/manage", { replace: true });
        } else {
          navigate("/", { replace: true });
        }
      } else {
        const role = accountType;
        await signup(email, password, role);
        // Auto-login after signup
        const loginResult = await login(email, password);
        localStorage.setItem("vibecheck_token", loginResult.token);
        await refresh();
        if (role === "venue_owner") {
          navigate("/setup", { replace: true });
        } else {
          navigate("/", { replace: true });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  // Don't render if already logged in (will redirect)
  if (isLoggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-vibe-bg">
        <div className="shimmer rounded-full w-12 h-12" />
      </div>
    );
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
          <p className="text-vibe-muted mt-3 text-sm sm:text-base font-medium">
            {isDashboardPath ? "Venue Owner Dashboard" : "See the vibe before you go"}
          </p>
        </div>

        {/* Account type toggle (only on /login, not /dashboard) */}
        {!isDashboardPath && (
          <div className="flex gap-2 mb-5 p-1 bg-vibe-card border border-vibe-border rounded-2xl">
            <button
              type="button"
              onClick={() => setAccountType("consumer")}
              className={`flex-1 py-2 px-3 rounded-xl text-sm font-semibold transition-all ${
                accountType === "consumer"
                  ? "bg-vibe-accent text-white shadow-md"
                  : "text-vibe-muted hover:text-vibe-text"
              }`}
            >
              For Viewers
            </button>
            <button
              type="button"
              onClick={() => setAccountType("venue_owner")}
              className={`flex-1 py-2 px-3 rounded-xl text-sm font-semibold transition-all ${
                accountType === "venue_owner"
                  ? "bg-vibe-accent text-white shadow-md"
                  : "text-vibe-muted hover:text-vibe-text"
              }`}
            >
              For Venues
            </button>
          </div>
        )}

        {/* Form Card */}
        <form
          onSubmit={handleSubmit}
          className="bg-vibe-card border border-vibe-border rounded-2xl p-6 space-y-4 shadow-card"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-vibe-text tracking-tight">
              {mode === "login" ? "Log In" : "Create Account"}
            </h2>
            {accountType === "venue_owner" && (
              <span className="text-xs font-medium text-vibe-accent bg-vibe-accent/10 px-2 py-0.5 rounded-full">
                Venue Owner
              </span>
            )}
          </div>

          {error && (
            <div
              className={`text-sm p-3 rounded-xl font-medium ${
                error.includes("created") || error.includes("success")
                  ? "bg-vibe-accent/8 text-vibe-accent border border-vibe-accent/20"
                  : "bg-red-50 text-red-600 border border-red-200"
              }`}
            >
              {error}
            </div>
          )}

          {/* Google Sign In (consumer login only) */}
          {accountType === "consumer" && mode === "login" && (
            <>
              <div id="google-signin-btn" className="flex justify-center min-h-[40px]" />
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-vibe-border" />
                <span className="text-xs text-vibe-muted font-medium">or</span>
                <div className="flex-1 h-px bg-vibe-border" />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm text-vibe-muted mb-1.5 font-medium">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-vibe-bg border border-vibe-border rounded-xl px-4 py-3 text-vibe-text placeholder-vibe-muted-dim focus:outline-none focus:border-vibe-accent focus:ring-1 focus:ring-vibe-accent/20 transition-all"
              placeholder={isDashboardPath ? "demo@vibecheck.app" : "you@email.com"}
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
              placeholder={isDashboardPath ? "demo123" : "••••••••"}
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

        {/* Demo hint — only for dashboard */}
        {isDashboardPath && (
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
        )}

        <div className="text-center mt-6">
          <a href="/" className="text-vibe-muted hover:text-vibe-text text-sm transition-colors">
            ← Back to venue browser
          </a>
        </div>
      </div>
    </div>
  );
}
