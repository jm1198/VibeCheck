import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { checkIn } from "../api";
import { useAuth } from "../AuthContext";
import type { CheckInResponse } from "../types";

export default function CheckIn() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { user, isLoggedIn, loading: authLoading } = useAuth();

  const [state, setState] = useState<"loading" | "success" | "error" | "need_login">("loading");
  const [result, setResult] = useState<CheckInResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (authLoading) return;

    if (!isLoggedIn || !user) {
      setState("need_login");
      return;
    }

    if (!code) {
      setState("error");
      setErrorMsg("No check-in code provided");
      return;
    }

    setState("loading");
    checkIn(code)
      .then((res) => {
        setResult(res);
        setState("success");
      })
      .catch((err) => {
        setState("error");
        setErrorMsg(err instanceof Error ? err.message : "Could not check in");
      });
  }, [code, isLoggedIn, user, authLoading]);

  if (authLoading || state === "loading") {
    return (
      <div className="min-h-screen bg-vibe-bg flex items-center justify-center">
        <div className="text-center animate-fade-up">
          <div className="shimmer rounded-2xl w-80 h-48 mx-auto" />
          <p className="text-vibe-muted mt-4 text-sm">Verifying your check-in...</p>
        </div>
      </div>
    );
  }

  if (state === "need_login") {
    // Store the intended check-in path so we can redirect back after login
    const checkInPath = `/check-in/${code}`;
    return (
      <div className="min-h-screen bg-vibe-bg flex items-center justify-center px-4">
        <div className="text-center max-w-sm animate-fade-up">
          <p className="text-5xl mb-5">🔐</p>
          <h1 className="text-2xl font-bold text-vibe-text font-[Playfair_Display] mb-3">
            Sign in to check in
          </h1>
          <p className="text-vibe-muted text-sm mb-7 leading-relaxed">
            You need a VibeCheck account to redeem this offer. It takes 30 seconds.
          </p>
          <button
            onClick={() => navigate(`/login?redirect=${encodeURIComponent(checkInPath)}`)}
            className="bg-vibe-accent hover:bg-vibe-accent-glow text-white font-semibold rounded-full px-8 py-3 transition-all shadow-md press-scale"
          >
            Sign In / Sign Up
          </button>
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="min-h-screen bg-vibe-bg flex items-center justify-center px-4">
        <div className="text-center max-w-sm animate-fade-up">
          <p className="text-5xl mb-5">😕</p>
          <h1 className="text-2xl font-bold text-vibe-text font-[Playfair_Display] mb-3">
            Couldn't check in
          </h1>
          <p className="text-vibe-muted text-sm mb-7">{errorMsg}</p>
          <button
            onClick={() => navigate("/")}
            className="text-vibe-accent hover:underline font-medium text-sm"
          >
            Explore venues →
          </button>
        </div>
      </div>
    );
  }

  // Success state
  const isRepeat = result?.already_checked_in;

  return (
    <div className="min-h-screen bg-vibe-bg flex items-center justify-center px-4">
      <div className="text-center max-w-sm animate-fade-up">
        {/* Emoji + animation */}
        <div className="mb-4">
          <span className="text-7xl inline-block animate-bounce">
            {isRepeat ? "👋" : "🎉"}
          </span>
        </div>

        {/* Venue name */}
        <h1 className="text-3xl font-bold text-vibe-text font-[Playfair_Display] mb-3 tracking-tight leading-tight">
          {isRepeat ? "Welcome back!" : "You checked in at"}
        </h1>
        <h2 className="text-2xl font-bold text-vibe-accent font-[Playfair_Display] mb-6">
          {result?.venue_name}
        </h2>

        {/* Discount card */}
        <div className="bg-vibe-card border-2 border-vibe-accent/20 rounded-2xl p-6 shadow-card mb-6">
          <p className="text-sm text-vibe-muted mb-1 uppercase tracking-wider font-semibold">
            Your Offer
          </p>
          <p className="text-4xl font-bold text-vibe-accent font-[Playfair_Display] mb-2">
            {result?.offer}
          </p>
          <p className="text-vibe-muted-dim text-sm">
            {isRepeat
              ? "You already checked in today — show this screen to redeem your offer."
              : "Show this screen to your bartender to redeem."}
          </p>
        </div>

        {/* Confetti-like accent line */}
        <div className="flex justify-center gap-1 mb-6">
          {["#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#3b82f6"].map((color, i) => (
            <div
              key={i}
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: color, opacity: 0.7 }}
            />
          ))}
        </div>

        <button
          onClick={() => navigate("/")}
          className="text-vibe-accent hover:underline font-medium text-sm"
        >
          Explore more venues →
        </button>
      </div>
    </div>
  );
}
